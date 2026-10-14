import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { setupCustomization } from './customization.js';

// ================= CONFIG =================
const ASSETS = '/assets/';
// Nhân vật: nên dùng file FBX "With Skin" tải từ Mixamo (cùng rig với các animation Without Skin).
// Có thể đổi sang .glb nếu glb đó có cùng skeleton với animation.
const MODEL_FILE = 'character-smooth.fbx';
const ANIM_FILES = {
  idle: 'Happy Idle.fbx',
  run: 'Running.fbx',
  jump: 'Jump Idle.fbx',
};
const CHAR_HEIGHT = 1.7;   // model sẽ tự scale về chiều cao này (mét)
const RADIUS = 0.3;        // bán kính capsule
const RUN_SPEED = 5;
const JUMP_SPEED = 7.5;
const GRAVITY = -20;
const HALF = CHAR_HEIGHT / 2 - RADIUS; // nửa chiều cao phần trụ của capsule
// ==========================================

const hud = document.getElementById('hud');
const wardrobe = document.getElementById('wardrobe');
const HINT = 'WASD: di chuyển | Space: nhảy | Kéo chuột: xoay camera';

// Chuẩn hoá tên bone để khớp "mixamorigSpine1" với "Spine01", "Spine1"...
const norm = (n) =>
  n.replace(/^mixamorig[:_]?/i, '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/0+(\d)/g, '$1');

function buildBoneMap(root) {
  const map = new Map();
  root.traverse((o) => { if (o.isBone) map.set(norm(o.name), o.name); });
  return map;
}

// Chỉ giữ track quaternion (xoay), đổi tên bone cho khớp model.
// Bỏ track position/scale để không bị lệch đơn vị (FBX Mixamo thường là cm).
function prepareClip(fbx, name, boneMap) {
  const src = fbx.animations[0];
  const tracks = [];
  const missed = new Set();
  for (const t of src.tracks) {
    const i = t.name.lastIndexOf('.');
    const bone = t.name.slice(0, i);
    const prop = t.name.slice(i + 1);
    if (prop !== 'quaternion') continue;
    const target = boneMap.get(norm(bone));
    if (!target) { missed.add(bone); continue; }
    const nt = t.clone();
    nt.name = `${target}.quaternion`;
    tracks.push(nt);
  }
  if (missed.size) console.warn(`[${name}] bone không khớp:`, [...missed]);
  return new THREE.AnimationClip(name, src.duration, tracks);
}

async function main() {
  // ---------- Three ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb7d8);
  scene.fog = new THREE.Fog(0x8fb7d8, 30, 80);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 3, 6);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(10, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 60 });
  scene.add(sun);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------- Rapier ----------
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });

  function addBox(x, y, z, w, h, d, color) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z));
  }
  addBox(0, -0.5, 0, 100, 1, 100, 0x5d8a4a);   // mặt đất (mặt trên ở y = 0)
  addBox(4, 0.5, -4, 2, 1, 2, 0xc9a66b);
  addBox(6.5, 1, -4, 2, 2, 2, 0xb5895a);
  addBox(-5, 0.25, 3, 3, 0.5, 3, 0x9aa5b1);
  addBox(0, 0.15, -8, 6, 0.3, 1.5, 0x9aa5b1);

  // Nhân vật: kinematic body + character controller (có autostep, snap to ground)
  const SPAWN = { x: 0, y: CHAR_HEIGHT / 2 + 0.01, z: 0 };
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN.x, SPAWN.y, SPAWN.z)
  );
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS), body);
  const cc = world.createCharacterController(0.01);
  cc.enableAutostep(0.3, 0.1, true);
  cc.enableSnapToGround(0.2);
  cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);

  // ---------- Model ----------
  const modelUrl = ASSETS + encodeURI(MODEL_FILE);
  const model = MODEL_FILE.toLowerCase().endsWith('.fbx')
    ? await new FBXLoader().loadAsync(modelUrl)
    : (await new GLTFLoader().loadAsync(modelUrl)).scene;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

  // Tự scale model về CHAR_HEIGHT và đặt chân sát đáy
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(CHAR_HEIGHT / (box.max.y - box.min.y));
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  model.position.y = -box.min.y;

  const pivot = new THREE.Group(); // pivot: vị trí chân + hướng xoay
  pivot.add(model);
  scene.add(pivot);

  const boneMap = buildBoneMap(model);
  console.log('Bones của model:', [...boneMap.values()]);
  await setupCustomization(model, wardrobe);

  // ---------- Animation ----------
  const mixer = new THREE.AnimationMixer(model);
  const fbxLoader = new FBXLoader();
  const actions = {};
  for (const [key, file] of Object.entries(ANIM_FILES)) {
    const fbx = await fbxLoader.loadAsync(ASSETS + encodeURI(file));
    actions[key] = mixer.clipAction(prepareClip(fbx, key, boneMap));
  }
  actions.jump.setLoop(THREE.LoopOnce, 1);
  actions.jump.clampWhenFinished = true;

  let current = actions.idle;
  current.play();
  function play(next) {
    if (next === current) return;
    next.reset().fadeIn(0.2).play();
    current.fadeOut(0.2);
    current = next;
  }

  // ---------- Input ----------
  const keys = new Set();
  let jumpQueued = false;
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('#wardrobe')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat && !keys.has('Space')) jumpQueued = true;
    }
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); jumpQueued = false; });
  const axis = (pos, neg) => Number(pos.some((k) => keys.has(k))) - Number(neg.some((k) => keys.has(k)));

  // ---------- Loop ----------
  const UP = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camDelta = new THREE.Vector3();
  const clock = new THREE.Clock();
  let vy = 0;
  let grounded = false;
  let jumping = false;

  hud.textContent = HINT;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 30);

    // Hướng di chuyển theo camera
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, UP);
    const fz = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const fx = axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    move.set(0, 0, 0).addScaledVector(fwd, fz).addScaledVector(right, fx);
    const moving = move.lengthSq() > 0;
    if (moving) move.normalize();

    // Giữ một lực hướng xuống khi đứng trên mặt đất để tiếp xúc ổn định.
    if (grounded && !jumping) vy = -0.5;
    else vy += GRAVITY * dt;
    if (jumpQueued && grounded && !jumping) {
      vy = JUMP_SPEED;
      jumping = true;
    }
    jumpQueued = false;

    const desired = { x: move.x * RUN_SPEED * dt, y: vy * dt, z: move.z * RUN_SPEED * dt };
    cc.computeColliderMovement(collider, desired);
    const m = cc.computedMovement();
    if (vy > 0 && m.y < desired.y - 1e-4) vy = 0; // đụng trần
    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    grounded = cc.computedGrounded();
    if (jumping && grounded && vy <= 0) jumping = false;

    world.timestep = dt;
    world.step();

    // Respawn nếu rơi khỏi map
    let p = body.translation();
    if (p.y < -20) {
      body.setTranslation(SPAWN, true);
      vy = 0;
      grounded = false;
      jumping = false;
      p = body.translation();
    }

    // Đồng bộ model với physics
    pivot.position.set(p.x, p.y - CHAR_HEIGHT / 2, p.z);
    if (moving) {
      const targetYaw = Math.atan2(move.x, move.z);
      let d = targetYaw - pivot.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      pivot.rotation.y += d * Math.min(1, 12 * dt);
    }

    // Chọn animation
    if (jumping) play(actions.jump);
    else if (moving) play(actions.run);
    else play(actions.idle);
    mixer.update(dt);

    // Camera bám theo nhân vật
    camTarget.set(p.x, p.y + 0.3, p.z);
    camDelta.copy(camTarget).sub(controls.target);
    camera.position.add(camDelta);
    controls.target.copy(camTarget);
    controls.update();

    renderer.render(scene, camera);
  }
  frame();
}

main().catch((err) => {
  console.error(err);
  hud.textContent = 'Lỗi: ' + err.message + '\nKiểm tra file đã copy vào public/assets/ chưa (xem console).';
});
