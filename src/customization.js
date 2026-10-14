import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Mỗi món gồm một hoặc nhiều phần GLB gắn vào bone.
const SLOTS = {
  hair: { label: 'Tóc', items: [
    { id: 'male-hair-001', label: 'Tóc nam 001', parts: [
      // Nhân vật hướng về +Z: nghiêng tóc theo trục X để mái đổ ra trước.
      { file: 'hair/male-hair-001.glb', bone: 'Head', size: 0.62, offset: [0, 0.14, 0.04], rotation: [1, 0, 0] },
    ] },
    { id: 'female-hair-001', label: 'Tóc nữ 001', parts: [
      { file: 'hair/female-hair-001.glb', bone: 'Head', size: 0.7, offset: [0, -0.05, -0.04], rotation: [0.12, 0, 0] },
    ] },
  ] },
  hand: { label: 'Tay / găng', items: [] },
  pants: { label: 'Quần', items: [] },
  shoe: { label: 'Giày', items: [
    { id: 'shoe-001', label: 'Giày 001', parts: [
      { file: 'shoes/shoe-001.glb', foot: 'RightFoot', size: 1.2, offset: [0, 0, 0], rotation: [0, 0, 0] },
      { file: 'shoes/shoe-001.glb', foot: 'LeftFoot', mirror: true, size: 1.2, offset: [0, 0, 0], rotation: [0, 0, 0] },
    ] },
  ] },
};

const boneKey = (name) => name.replace(/^mixamorig[:_]?/i, '').toLowerCase();

export async function setupCustomization(model, panel) {
  const loader = new GLTFLoader();
  const assets = new Map();
  const bones = new Map();
  const equipped = new Map();
  const selected = new Map();
  const revisions = new Map();
  const selects = new Map();
  const skinMaterials = [];
  const footMeshes = [];
  const status = document.createElement('p');
  status.className = 'wardrobe-status';
  model.parent.updateMatrixWorld(true);
  const rootInverse = model.parent.matrixWorld.clone().invert();
  const restBones = new Map();
  const avatarHeight = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;

  model.traverse((object) => {
    if (object.isBone) {
      const key = boneKey(object.name);
      bones.set(key, object);
      restBones.set(key, rootInverse.clone().multiply(object.matrixWorld));
    }
    if (object.isMesh) {
      if (object.isSkinnedMesh) {
        const geometry = object.geometry;
        const skinIndex = geometry.getAttribute('skinIndex');
        const skinWeight = geometry.getAttribute('skinWeight');
        const footBones = new Set(object.skeleton.bones.flatMap((bone, index) =>
          /^(left|right)(foot|toebase|toeend)$/.test(boneKey(bone.name)) ? [index] : []
        ));
        if (skinIndex && skinWeight && footBones.size) {
          const visible = [];
          const sourceIndex = geometry.index;
          const count = sourceIndex?.count ?? geometry.getAttribute('position').count;
          for (let i = 0; i < count; i += 3) {
            const triangle = [0, 1, 2].map((j) => sourceIndex ? sourceIndex.getX(i + j) : i + j);
            const footWeight = triangle.map((vertex) => {
              let weight = 0;
              for (let j = 0; j < 4; j++) {
                if (footBones.has(skinIndex.getComponent(vertex, j))) {
                  weight += skinWeight.getComponent(vertex, j);
                }
              }
              return weight;
            });
            // Bỏ cả tam giác giao mép bàn chân để da không xuyên qua giày.
            if (footWeight.some((weight) => weight > 0.5)) continue;
            visible.push(...triangle);
          }
          const withoutFeet = geometry.clone();
          withoutFeet.setIndex(visible);
          footMeshes.push({ object, normal: geometry, shoes: withoutFeet });
        }
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const copies = materials.map((material) => {
        const copy = material.clone();
        if (copy.color) skinMaterials.push({ material: copy, original: copy.color.clone() });
        return copy;
      });
      object.material = Array.isArray(object.material) ? copies : copies[0];
    }
  });

  const defaultSkin = new THREE.Color('#ffd1b2');
  for (const { material } of skinMaterials) material.color.copy(defaultSkin);
  const skinRow = document.createElement('label');
  skinRow.textContent = 'Màu da';
  const skinControls = document.createElement('span');
  skinControls.className = 'skin-controls';
  const skinPicker = document.createElement('input');
  skinPicker.type = 'color';
  skinPicker.value = `#${defaultSkin.getHexString()}`;
  skinPicker.setAttribute('aria-label', 'Chọn màu da');
  skinPicker.addEventListener('input', () => {
    for (const { material } of skinMaterials) material.color.set(skinPicker.value);
  });
  const resetSkin = document.createElement('button');
  resetSkin.type = 'button';
  resetSkin.textContent = 'Gốc';
  resetSkin.setAttribute('aria-label', 'Khôi phục màu da gốc');
  resetSkin.addEventListener('click', () => {
    for (const { material } of skinMaterials) material.color.copy(defaultSkin);
    skinPicker.value = `#${defaultSkin.getHexString()}`;
  });
  skinControls.append(skinPicker, resetSkin);
  skinRow.append(skinControls);
  panel.append(skinRow);

  function load(file) {
    const url = `/assets/custom/${file.split('/').map(encodeURIComponent).join('/')}`;
    if (!assets.has(url)) {
      const pending = loader.loadAsync(url).catch((error) => {
        assets.delete(url);
        throw error;
      });
      assets.set(url, pending);
    }
    return assets.get(url);
  }

  async function makePart(part) {
    if (part.foot) {
      const anchor = bones.get(boneKey(part.foot));
      const rest = restBones.get(boneKey(part.foot));
      if (!anchor || !rest) throw new Error(`Không tìm thấy bone ${part.foot}`);
      const gltf = await load(part.file);
      const asset = gltf.scene.clone(true);
      const bounds = new THREE.Box3().setFromObject(asset);
      if (bounds.isEmpty()) throw new Error(`${part.file} không có mesh hợp lệ`);

      // GLB chứa một chiếc giày cỡ lớn, hướng mũi về +Z. Căn giữa mesh
      // rồi phản chiếu qua trục X để tạo chiếc bên trái.
      asset.position.sub(bounds.getCenter(new THREE.Vector3()));
      // size là hệ số so với cỡ giày đã căn sẵn (1 = vừa chân).
      // offset dùng đơn vị mét theo trục nhân vật; rotation dùng radian.
      const scale = (avatarHeight / 1.99) * 0.65 * (part.size ?? 1);
      const side = part.mirror ? 1 : -1;
      const center = new THREE.Vector3().setFromMatrixPosition(rest).add(
        new THREE.Vector3(side * 0.02, -0.012, 0.05).multiplyScalar(avatarHeight / 1.99)
      ).add(new THREE.Vector3().fromArray(part.offset ?? [0, 0, 0]));
      const target = new THREE.Matrix4().compose(
        center,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]))),
        new THREE.Vector3(part.mirror ? -scale : scale, scale, scale),
      );
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(rest.clone().invert().multiply(target));
      asset.traverse((object) => {
        if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; }
      });
      holder.add(asset);
      return { anchor, holder };
    }

    const anchor = bones.get(boneKey(part.bone));
    if (!anchor) throw new Error(`Không tìm thấy bone ${part.bone}`);

    const gltf = await load(part.file);
    if (gltf.scene.getObjectByProperty('isSkinnedMesh', true)) {
      throw new Error(`${part.file} cần rig chung với nhân vật`);
    }
    const asset = gltf.scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(asset);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (bounds.isEmpty() || size.x <= 0) throw new Error(`${part.file} không có mesh hợp lệ`);

    model.updateMatrixWorld(true);
    const worldScale = anchor.getWorldScale(new THREE.Vector3());
    const scale = part.size / (size.x * Math.abs(worldScale.x));
    const holder = new THREE.Group();
    holder.scale.setScalar(scale);
    holder.position.set(
      (part.offset?.[0] ?? 0) / worldScale.x,
      (part.offset?.[1] ?? 0) / worldScale.y,
      (part.offset?.[2] ?? 0) / worldScale.z,
    );
    if (part.rotation) holder.rotation.set(...part.rotation);
    asset.position.sub(center);
    asset.traverse((object) => {
      if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; }
    });
    holder.add(asset);
    return { anchor, holder };
  }

  async function equip(slot, id) {
    const revision = (revisions.get(slot) ?? 0) + 1;
    revisions.set(slot, revision);
    const item = SLOTS[slot].items.find((option) => option.id === id);
    status.textContent = item ? `Đang tải ${item.label}...` : '';

    try {
      // Tải đủ các phần trước khi tháo món hiện tại.
      const parts = item ? await Promise.all(item.parts.map(makePart)) : [];
      if (revisions.get(slot) !== revision) return;
      for (const object of equipped.get(slot) ?? []) object.removeFromParent();
      for (const { anchor, holder } of parts) anchor.add(holder);
      if (slot === 'shoe') {
        for (const { object, normal, shoes } of footMeshes) object.geometry = id ? shoes : normal;
      }
      equipped.set(slot, parts.map(({ holder }) => holder));
      selected.set(slot, id);
      status.textContent = item ? `Đã trang bị: ${item.label}` : '';
    } catch (error) {
      if (revisions.get(slot) !== revision) return;
      console.error('Không thể trang bị:', error);
      status.textContent = error.message;
      selects.get(slot).value = selected.get(slot) ?? '';
      return;
    }
  }

  for (const [slot, config] of Object.entries(SLOTS)) {
    const row = document.createElement('label');
    row.textContent = config.label;
    const select = document.createElement('select');
    select.add(new Option('Mặc định', ''));
    for (const item of config.items) select.add(new Option(item.label, item.id));
    select.disabled = config.items.length === 0;
    select.addEventListener('change', () => { void equip(slot, select.value); });
    row.append(select);
    panel.append(row);
    selects.set(slot, select);
  }
  panel.append(status);

  const firstHair = SLOTS.hair.items[0];
  if (firstHair) {
    selects.get('hair').value = firstHair.id;
    await equip('hair', firstHair.id);
  }
  const firstShoe = SLOTS.shoe.items[0];
  if (firstShoe) {
    selects.get('shoe').value = firstShoe.id;
    await equip('shoe', firstShoe.id);
  }
}
