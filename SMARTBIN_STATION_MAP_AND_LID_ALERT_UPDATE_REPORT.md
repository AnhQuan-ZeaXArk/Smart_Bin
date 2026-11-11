# BÁO CÁO HOÀN TẤT ĐIỀU CHỈNH GIAO DIỆN BẢN ĐỒ TOÀN CẢNH VÀ CẢNH BÁO LỖI NẮP SMARTBIN

**Thời gian thực hiện:** Ngày 11 tháng 11 năm 2026  
**Dự án:** Hệ thống Quản trị & Giám sát Thùng rác Thông minh SMARTBIN  
**Môi trường:** Workspace Production Local (Node.js, Vite, React, Express, Prisma, PostgreSQL, Socket.IO)

---

## 1. TỔNG QUAN YÊU CẦU VÀ KẾT QUẢ ĐẠT ĐƯỢC

Toàn bộ 3 hạng mục yêu cầu kỹ thuật đã được triển khai hoàn tất, đồng bộ từ Backend API đến Frontend Web và đã được kiểm tra tính toàn vẹn (build & lint sạch 100%, 0 lỗi, 0 cảnh báo):

| STT | Hạng mục yêu cầu | Hiện trạng trước | Kết quả sau khi điều chỉnh | Trạng thái |
|---|---|---|---|:---:|
| **1** | **Đổi tên phân loại rác thứ ba** | Hiển thị tên "Còn lại" hoặc "Rác còn lại" | Đổi thành **"Thùng rác không tái chế"** (rút gọn: **"Không tái chế"**) đồng bộ trên toàn bộ Website (Dashboard, sơ đồ trạm, modal, danh sách thùng, trang chi tiết). | ✅ ĐÃ HOÀN TẤT |
| **2** | **Modal Bản đồ toàn cảnh tương tác** | Modal chỉ phóng to ảnh crop đơn lẻ từng trạm | Triển khai **Modal Toàn cảnh Sơ đồ Bố trí SMARTBIN** (`smartbin-map-overview.png`): hiển thị toàn bộ khuôn viên có Trạm A & Trạm B, vòng sáng nhấp nháy (pulsing ring) nổi bật cho trạm đang chọn, làm mờ trạm còn lại, badge nổi `📍 TRẠM (ĐANG CHỌN)`, bộ zoom (100% / 130% / 160%), chuyển đổi trạm tức thì và nút cuộn mượt xuống card giám sát. | ✅ ĐÃ HOÀN TẤT |
| **3** | **Cảnh báo lỗi nắp tại Trạm A** | Thông điệp chung chung hoặc gán sai thiết bị | **Banner**: `CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC TẠI TRẠM A!` (tự ẩn sau 10s, tái kích hoạt khi có lỗi mới, không nổ khi F5).<br>**Trang Cảnh báo**: Gán đúng `Trạm A`, tiêu đề `Phát hiện lỗi nắp thùng rác tại Trạm A.`, mô tả chi tiết kiểm tra cơ cấu nắp & servo, deduplicate chống trùng lặp. | ✅ ĐÃ HOÀN TẤT |

---

## 2. CHI TIẾT CÁC THAY ĐỔI THEO TỪNG HẠNG MỤC

### 2.1. Đổi tên loại thùng rác thành "Thùng rác không tái chế"

1. **Quy chuẩn danh pháp hiển thị:**
   - **Tên đầy đủ:** `Thùng rác không tái chế`
   - **Tên ngắn gọn:** `Không tái chế`
   - **Quy ước màu sắc chuẩn:**
     - 🔵 **Xanh dương (`#2563eb`)**: Rác tái chế (A1, B1) - Giấy, nhựa, kim loại.
     - 🟢 **Xanh lá (`#10b981`)**: Rác hữu cơ (A2, B2) - Thức ăn, lá cây,...
     - 🟠 **Vàng / Cam (`#f59e0b` / `#ea580c`)**: Rác không tái chế (A3, B3) - Rác sinh hoạt khác.

2. **Các tệp mã nguồn cập nhật:**
   - [`apps/web/src/waste-category.ts`](file:///e:/Smart_Bin/apps/web/src/waste-category.ts):
     - `WASTE_CATEGORY_LABEL`: Chuyển key `NON_RECYCLABLE` thành `"Thùng rác không tái chế"`.
     - `WASTE_CATEGORY_SHORT_LABEL`: Gán nhãn ngắn gọn `"Không tái chế"`.
     - `WASTE_CATEGORY_REGEX.NON_RECYCLABLE`: Bổ sung matcher tương thích ngược cả chuỗi cũ `còn lại|con lai` lẫn chuỗi mới `khong tai che`.
   - [`apps/web/src/bin-view-model.ts`](file:///e:/Smart_Bin/apps/web/src/bin-view-model.ts):
     - Cập nhật ánh xạ tên thùng mặc định cho mã `A3` và `B3` thành `"Thùng rác không tái chế"`.
   - [`apps/web/src/bins.tsx`](file:///e:/Smart_Bin/apps/web/src/bins.tsx):
     - Chuẩn hóa hàm hiển thị tên thùng `displayBinName` để tự động thay thế mọi biến thể cũ (`"Rác còn lại"`, `"Còn lại"`) thành `"Thùng rác không tái chế"`.
   - [`apps/web/src/dashboard.tsx`](file:///e:/Smart_Bin/apps/web/src/dashboard.tsx):
     - Cập nhật cấu hình `BIN_MAPPINGS` cho A3 và B3: nhãn `Không tái chế`, tên đầy đủ `Thùng rác không tái chế`.
     - Cập nhật chú giải màu sắc trên modal và trên các card chi tiết.

---

### 2.2. Modal Bản đồ toàn cảnh tương tác hệ thống SMARTBIN

1. **Hình ảnh nguồn & tích hợp:**
   - Ảnh gốc chất lượng cao toàn bộ khuôn viên SMARTBIN được tích hợp vào thư mục static Frontend tại:
     - [`apps/web/public/smartbin-map-overview.jpg`](file:///e:/Smart_Bin/apps/web/public/smartbin-map-overview.jpg)
     - [`apps/web/public/smartbin-map-overview.png`](file:///e:/Smart_Bin/apps/web/public/smartbin-map-overview.png)
   - Giữ nguyên cấu trúc nguyên bản gồm tiêu đề *"Sơ đồ bố trí trạm SMARTBIN"*, đài phun nước trung tâm, Trạm A (bên trái), Trạm B (bên phải) và bảng chú giải màu sắc phía dưới.

2. **Tọa độ căn chỉnh vùng tương tác chính xác (Normalized Coordinate Mapping):**
   - **Vùng Trạm A:** `left: 6.4%`, `top: 32.0%`, `width: 26.6%`, `height: 23.8%`
   - **Vùng Trạm B:** `left: 69.5%`, `top: 32.0%`, `width: 26.6%`, `height: 23.8%`

3. **Cơ chế tương tác trong component `OverviewMapModal`:**
   - **Khi mở từ Trạm A (hoặc nhấp chọn Trạm A):**
     - Vùng Trạm A viền xanh dương rực rỡ, kèm hiệu ứng vòng xung điện nhấp nháy vô tận (`@keyframes pulseStationRingA`).
     - Badge nổi `📍 TRẠM A (ĐANG CHỌN)` xuất hiện phía trên trạm với hoạt ảnh lượn nhẹ (subtle floating bounce).
     - Hàng badge bên dưới hiển thị rõ 3 ngăn: `A1: Tái chế`, `A2: Hữu cơ`, `A3: Không tái chế` với màu tương ứng.
     - Vùng Trạm B tự động được phủ một lớp tối mờ nhẹ (dimmed backdrop blur) kèm tooltip `Nhấp để chọn Trạm B`.
   - **Khi mở từ Trạm B (hoặc nhấp chọn Trạm B):**
     - Đảo ngược trạng thái: Trạm B phát sáng với vòng xung xanh lục (`@keyframes pulseStationRingB`), gắn badge `📍 TRẠM B (ĐANG CHỌN)` và các nhãn `B1`, `B2`, `B3`.
     - Trạm A được làm mờ nhẹ kèm gợi ý nhấp chọn.
   - **Công cụ điều khiển linh hoạt:**
     - Tab chuyển đổi nhanh giữa `Trạm A` và `Trạm B` ngay trên thanh tiêu đề modal.
     - Bộ nút Zoom: `100%`, `130%`, `160%`, `Đặt lại` với tâm zoom (`transform-origin`) tự động hướng về trạm đang chọn.
     - Nút hành động: `Đi đến khu vực giám sát của Trạm A/B ↓` đóng modal và cuộn mượt (smooth scroll) trực tiếp đến nhóm card thời gian thực tương ứng của trạm đó.

---

### 2.3. Chuẩn hóa Cảnh báo lỗi nắp tại Trạm A

1. **Quy định thông điệp và gán nguồn:**
   - **Banner cảnh báo đỏ trên cùng (`LidAlertBanner` trong `App.tsx`):**
     `CẢNH BÁO: PHÁT HIỆN LỖI NẮP THÙNG RÁC TẠI TRẠM A!`
   - **Bản ghi tại Trung tâm Cảnh báo (`AlertsPage` trong `dashboard.tsx`):**
     - **Cột Thiết bị / Vị trí:** Hiển thị rõ **`Trạm A`** (không gán nhầm sang thùng A1, A2, A3 hay B).
     - **Tiêu đề sự kiện:** **`Phát hiện lỗi nắp thùng rác tại Trạm A.`**
     - **Mô tả chi tiết:** *`Thiết bị phát hiện sự cố trong quá trình mở hoặc đóng nắp thùng rác tại Trạm A. Vui lòng kiểm tra cơ cấu nắp và hệ thống servo.`*

2. **Cơ chế lưu trữ, Deduplication và Realtime:**
   - **Backend API:**
     - [`apps/api/src/demo/real-device.service.ts`](file:///e:/Smart_Bin/apps/api/src/demo/real-device.service.ts): Gắn chặt `stationCode: 'STATION_A'`, định nghĩa thông điệp và mô tả chuẩn hóa.
     - [`apps/api/src/integrations/realtime/realtime.gateway.ts`](file:///e:/Smart_Bin/apps/api/src/integrations/realtime/realtime.gateway.ts): Truy vấn kiểm tra chống tạo bản ghi trùng lặp trong cơ sở dữ liệu khi sự cố trước đó chưa được resolve (`isResolved: false`).
     - [`apps/api/src/routes/dashboard.routes.ts`](file:///e:/Smart_Bin/apps/api/src/routes/dashboard.routes.ts): Hàm `mergeAndDeduplicateLidAlert` lọc và chuẩn hóa dữ liệu trả về cho Frontend, đặt `deviceId: 'Trạm A'` và `binId: null`.
   - **Frontend Web:**
     - Banner chỉ lắng nghe sự kiện realtime Socket.IO `device:lid:alert`. Khi nhận sự kiện: hiển thị ngay lập tức, đếm lùi 10 giây rồi tự động ẩn.
     - Nếu trong lúc đang hiển thị có sự kiện lỗi mới: timer 10s được reset lại để người dùng luôn nhận biết được sự cố mới.
     - Khi reload trang (F5): banner không tự ý hiện lên gây khó chịu (trừ khi có sự kiện lỗi mới được bắn từ phần cứng).

---

## 3. KẾT QUẢ KIỂM THỬ VÀ XÁC MINH HỆ THỐNG

| Lệnh kiểm tra | Kết quả thực tế | Ghi chú |
|---|---|---|
| `npm run lint --workspace @smartbin/api` | **Code 0 - Thành công** | `tsc -p tsconfig.json --noEmit` đạt 0 lỗi type. |
| `npm run lint --workspace @smartbin/web` | **Code 0 - Thành công** | `oxlint` quét 35 files, 116 rules: **0 errors, 0 warnings**. |
| `npm run build --workspace @smartbin/api` | **Code 0 - Thành công** | Prisma generate và TypeScript compiler build dist hoàn tất. |
| `npm run build --workspace @smartbin/web` | **Code 0 - Thành công** | Vite build client production hoàn tất (267ms). |
| `npm run build` (toàn bộ monorepo) | **Code 0 - Thành công** | Cả Backend API và Web Client đều build sạch sẽ. |

---

## 4. DANH SÁCH TỆP TIN THAY ĐỔI

1. `apps/api/src/demo/real-device.service.ts`
2. `apps/api/src/integrations/realtime/realtime.gateway.ts`
3. `apps/api/src/routes/dashboard.routes.ts`
4. `apps/web/src/waste-category.ts`
5. `apps/web/src/bin-view-model.ts`
6. `apps/web/src/bins.tsx`
7. `apps/web/src/dashboard.tsx`
8. `apps/web/src/App.tsx`
9. `apps/web/src/App.css`
10. `apps/web/public/smartbin-map-overview.jpg` *(tệp mới)*
11. `apps/web/public/smartbin-map-overview.png` *(tệp mới)*

---
*Báo cáo được khởi tạo tự động phục vụ công tác đối soát chất lượng phần mềm hệ thống SMARTBIN.*

