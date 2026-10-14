# Three.js + Rapier character

## Chạy
1. Đặt trong `public/assets/`: `character-smooth.fbx` (nhân vật dùng rig Mixamo, **With Skin**) và 3 animation `Happy Idle.fbx`, `Jump Idle.fbx`, `Running.fbx` (Without Skin).
   Vì các animation được tạo từ rig của Mixamo nên nhân vật cũng phải dùng rig của Mixamo, không dùng GLB gốc từ Meshy.
2. `npm install`
3. `npm run dev` rồi mở link Vite in ra

## Điều khiển
- WASD / phím mũi tên: di chuyển (theo hướng camera)
- Space: nhảy
- Chuột kéo: xoay camera, lăn chuột: zoom
- Bảng **Trang phục** bên phải: chọn tóc, giày hoặc trả về mặc định. Các ô tay/găng và quần sẽ bật khi có mẫu trong catalog.
- Ô **Màu da** trong bảng Trang phục: chọn màu cho nhân vật, nút **Gốc** khôi phục màu ban đầu. Model FBX hiện có một material cho toàn thân, nên màu được áp dụng lên toàn bộ model gốc; tóc GLB custom giữ màu riêng.

## Thêm trang phục
Đặt GLB vào `public/assets/custom/<loại>/`, rồi thêm một item vào slot tương ứng trong `src/customization.js`. Hai mẫu tóc `male-hair-001.glb` và `female-hair-001.glb` đã có trong danh sách; tóc nam được trang bị khi mở trang.

Mỗi `part` khai báo `file`, `bone`, `size` (chiều rộng mong muốn tính bằng mét) và `offset` (x/y/z tính bằng mét theo hướng của bone). Một item có thể chứa nhiều `part`, ví dụ găng trái/phải gắn vào `LeftHand` và `RightHand`, hoặc giày vào `LeftFoot` và `RightFoot`. Có thể thêm `rotation: [x, y, z]` theo radian để chỉnh hướng.

Cơ chế trang phục dùng GLB tĩnh gắn vào bone. Nếu model gốc đã có tóc liền trong cùng mesh, tóc custom có thể chồng lên tóc gốc.

## Cấu trúc
- `src/main.js`: toàn bộ logic (load model, retarget animation, physics, camera)
- `src/customization.js`: catalog, gắn phụ kiện vào bone và bảng chọn trang phục
- Phần `CONFIG` ở đầu file để đổi tên file, tốc độ, chiều cao nhân vật

## Debug
Mở console (F12): sẽ in danh sách bone của model và cảnh báo các bone của animation không khớp được.
