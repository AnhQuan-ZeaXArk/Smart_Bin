# SMARTBIN ROUND 19.1 – BÁO CÁO TINH CHỈNH GIAO DIỆN DASHBOARD ĐA TRẠM (MULTI-STATION UI REFINEMENT)

**Dự án:** Hệ thống Thùng rác Thông minh SmartBin  
**Phiên:** Round 19.1 – Multi-Station Dashboard UI Refinement  
**Thời gian thực hiện:** 2026-11-08  
**Phạm vi:** Frontend (`apps/web/`) – Tuyệt đối không sửa Backend, Database, Serial protocol hay Pi Agent  
**Trạng thái triển khai:** HOÀN TẤT & ĐÃ XÁC MINH TOÀN DIỆN (100% Tests Passed)

---

## 1. Mục tiêu phiên làm việc

Tiếp tục tinh chỉnh giao diện Dashboard sau Round 19 nhằm:
1. **Hiển thị đồng thời Station A và Station B** theo cấu hình trạm chuẩn, ngay cả khi Station B chưa có dữ liệu telemetry từ Backend.
2. Đảm bảo cấu hình thùng của Station B chuẩn xác: **RECYCLABLE: INSTALLED**, **ORGANIC: NOT_INSTALLED**, **NON_RECYCLABLE: NOT_INSTALLED**.
3. **Loại bỏ thông tin dư thừa** trên tiêu đề trạm (bỏ Vị trí, Gateway, Controller; chỉ giữ Station Code, Tên trạm, Trạng thái, Số thùng đã lắp, Mức đầy TB, Thời gian cập nhật và Nút thu gọn/mở rộng).
4. **Xóa bỏ khu vực mức đầy trùng lặp** trong component `RealDeviceCard` (Raspberry Pi 5 Gateway) để mức đầy chỉ hiển thị duy nhất tại khu vực Station tương ứng.
5. **Chuẩn hóa KPI tổng quan**: Tổng số trạm: 2, Tổng số thùng đã lắp: 4, không tính NOT_INSTALLED thành OFFLINE.
6. Giữ bộ lọc trạm hoạt động mượt mà (Tất cả, Station A, Station B).
7. Điều tra và báo cáo rõ nguyên nhân vì sao Station B trước đây chưa xuất hiện và kiểm toán mức độ đáp ứng của API.

---

## 2. Danh sách các tệp đã thay đổi

| STT | Tệp tin | Thao tác | Mục đích thay đổi |
| :---: | :--- | :---: | :--- |
| 1 | [`apps/web/src/bin-view-model.ts`](file:///E:/Smart_Bin/apps/web/src/bin-view-model.ts) | Sửa đổi | Xuất `DEFAULT_STATION_CONFIG` gồm Station A & B; cập nhật `groupBinsByStation()` để Station B luôn có 1 thùng `RECYCLABLE` (INSTALLED, chờ telemetry - OFFLINE) và 2 thùng `ORGANIC`, `NON_RECYCLABLE` (NOT_INSTALLED). Tuyệt đối không sinh telemetry giả. |
| 2 | [`apps/web/src/dashboard.tsx`](file:///E:/Smart_Bin/apps/web/src/dashboard.tsx) | Sửa đổi | Khởi tạo `stations` bằng `DEFAULT_STATION_CONFIG`; loại bỏ `.station-meta-row` (Vị trí, Gateway, Controller) khỏi `.station-header`; tính toán KPI toàn diện trên cả 2 trạm từ `stationGroups`. |
| 3 | [`apps/web/src/real-device-card.tsx`](file:///E:/Smart_Bin/apps/web/src/real-device-card.tsx) | Sửa đổi | Xóa bỏ hoàn toàn section `.real-compartments-section` ("Mức Đầy 3 Ngăn Rác Thực Tế") và hàm `renderCompartmentCard`; bảo toàn toàn bộ 6 card chỉ số phần cứng và kết nối Socket.IO/REST. |
| 4 | [`apps/web/src/dashboard-multi-station.test.ts`](file:///E:/Smart_Bin/apps/web/src/dashboard-multi-station.test.ts) | Cập nhật | Viết lại bộ kiểm thử 9 kịch bản nghiệp vụ (T1 - T9) kiểm tra hiển thị 2 trạm, Station B không telemetry, cấu hình 1 installed/2 uninstalled, KPI 2 trạm/4 thùng, bộ lọc, loại bỏ header meta, loại bỏ mức đầy trên Pi 5, và tương thích ngược. |

---

## 3. Điều tra: Vì sao Station B trước đây chưa xuất hiện?

Qua kiểm tra trực tiếp mã nguồn Frontend, Backend và cấu hình môi trường, xác định **5 nguyên nhân cốt lõi** khiến Station B không hiển thị trên Dashboard thực tế trước Round 19.1:

```
[Render Production DB (Migration 02)]
            │
            ▼ (Chưa chạy Migration 03 Expand: Bảng Station chưa tồn tại)
   GET /api/stations  ───►  Trả về HTTP 500 hoặc thất bại
            │
            ▼
   catch(() => {}) trên Frontend nuốt lỗi  ───►  state `stations` = []
            │
            ▼
   groupBinsByStation(data.bins, stations=[])
            │
            ▼ (Quét data.bins chỉ có 3 thùng cũ không có stationId)
   Chỉ tìm thấy mã "STATION_A"  ───►  stationDefs = [STATION_A] duy nhất!
            │
            ▼
   ===> Station B hoàn toàn bị bỏ qua trên giao diện!
```

1. **Migration 03 Expand chưa chạy trên Render Production Database:**
   - Database trên Render hiện đang ở Migration 02. Bảng `Station` chưa được tạo và cột `stationId` chưa được thêm vào bảng `Bin`.
   - Khi Frontend gọi `GET /api/stations`, Backend Production gặp lỗi không tìm thấy bảng `Station` và trả về lỗi. Khối `.catch(() => {})` trên Frontend không làm sập ứng dụng nhưng khiến state `stations` rỗng `[]`.
2. **Cơ chế Fallback cũ quét mã trạm từ `data.bins`:**
   - Khi `stations` rỗng, `groupBinsByStation()` tự động trích xuất các trạm từ mảng `data.bins` (nhận từ `GET /api/dashboard/summary`).
   - Do Production DB chỉ chứa 3 ngăn rác của hệ thống cũ (`stationId: null`), hàm chỉ gán mặc định về `'STATION_A'`. Tập hợp `foundCodes` chỉ có `{'STATION_A'}`, dẫn đến việc Station B không hề được khởi tạo.
3. **Tệp dữ liệu Demo (`DEMO_BINS`) không có Station B:**
   - Trong chế độ Demo Mode (`env.isDemoMode = true`), tệp `apps/api/src/demo/demo-data.ts` chỉ định nghĩa 3 thùng rác (`bin-organic-01`, `bin-recyclable-02`, `bin-non-recyclable-03`), hoàn toàn không có bản ghi nào cho Station B.
4. **Frontend thiếu cấu hình trạm mặc định (Station Configuration):**
   - Trước Round 19.1, Frontend phụ thuộc 100% vào phản hồi của `/api/stations`. Khi API này không trả về dữ liệu (do Migration 03 chưa triển khai), Frontend không có nguồn cấu hình dự phòng để hiển thị Station B.
5. **Logic xử lý Placeholder cũ gán `installed: false` cho toàn bộ các thùng thiếu telemetry:**
   - Trong Round 19, khi Station B được cấu hình nhưng Backend chưa có telemetry, logic placeholder đã gán `installed: false` cho cả 3 ngăn của Station B (kể cả RECYCLABLE), khiến Station B có 0 thùng lắp đặt thay vì 1 thùng.

---

## 4. Kiểm toán: API Backend có cung cấp đủ dữ liệu hai trạm không?

### 4.1. Mã nguồn Backend (`apps/api/src/`)
- **`GET /api/stations`**: Đã hỗ trợ trả về danh sách trạm gồm cả Station A (`status: ONLINE`) và Station B (`status: OFFLINE`, `installedBinsCount: 1`).
- **`GET /api/dashboard/summary`**: Đã hỗ trợ query `?stationCode=` và quan hệ `include: { station: true }`.
- **`seed.ts`**: Đã định nghĩa `stationA` và `stationB`, cùng 3 thùng cho Station A và 3 thùng cho Station B (`RECYCLABLE: installed=true`, `NON_RECYCLABLE: installed=false`, `ORGANIC: installed=false`).

### 4.2. Trạng thái thực tế trên Production
- **Database Production**: Chưa áp dụng Migration 03 (bảng `Station` chưa có). Do đó `GET /api/stations` trên Production thực tế chưa thể trả về Station B từ database.
- **Telemetry Station B**: Chưa có dữ liệu thực tế từ phần cứng (do ESP32 B và cổng Serial B chưa kết nối trực tiếp với Pi Agent).

### 4.3. Giải pháp chuẩn kiến trúc tại Frontend (Round 19.1)
- Frontend khai báo và xuất `DEFAULT_STATION_CONFIG` làm nguồn chân lý cấu hình trạm chuẩn (`STATION_A` và `STATION_B`).
- Dashboard nạp ngay `DEFAULT_STATION_CONFIG` vào state, đảm bảo cả hai trạm **luôn luôn xuất hiện đồng thời** trên giao diện mà không phụ thuộc vào việc Migration 03 đã chạy hay chưa.
- Khi API `/api/stations` hoạt động và phản hồi thành công, Dashboard sẽ tự động cập nhật trạng thái động từ Backend.
- Ngăn `RECYCLABLE` của Station B được đánh dấu là `installed: true` nhưng trạng thái `OFFLINE` và `currentFillLevel: null` (hiển thị `'—'`), phản ánh trung thực rằng phần cứng đã được cấu hình trong mạng lưới nhưng hiện chưa phát tín hiệu nhịp/telemetry.

---

## 5. Cải tiến chi tiết các khu vực giao diện

### 5.1. Khu vực giám sát trạm – Tinh gọn Header (Loại bỏ thông tin dư thừa)
Đã xóa bỏ hoàn toàn thẻ thông tin phần cứng `.station-meta-row` (Vị trí, Gateway, Controller). Tiêu đề mỗi trạm giờ đây vô cùng thoáng đãng, sắc nét và tập trung:
- **Bên trái:**
  - `station-code-chip`: Huy hiệu mã trạm (`STATION_A` màu xanh ngọc, `STATION_B` màu xanh lam).
  - `station-name`: Tên trạm (`Trạm Thu gom Trung tâm A`, `Trạm Thu gom Mở rộng B`).
  - `station-status-badge`: Trạng thái kết nối (`TRỰC TUYẾN`, `MẤT KẾT NỐI`).
- **Bên phải:**
  - Pill `Đã lắp`: Hiển thị `3/3 thùng` (Station A) và `1/3 thùng` (Station B).
  - Pill `Mức đầy TB`: Hiển thị phần trăm trung bình thực tế (`54%` cho Station A, `—` cho Station B khi chưa có telemetry).
  - Pill `Cập nhật`: Thời gian nhận tín hiệu gần nhất (`vài giây trước` hoặc `Chưa có dữ liệu`).
  - Button `Thu gọn ▲ / Mở rộng ▼`: Cho phép người vận hành đóng/mở từng trạm độc lập.

### 5.2. Component `RealDeviceCard` (Raspberry Pi 5 Gateway)
- **Đã xóa bỏ:** Section `.real-compartments-section` ("Mức Đầy 3 Ngăn Rác Thực Tế") và toàn bộ các thanh đo mức đầy con của 3 loại rác bên trong component này.
- **Lợi ích:** Tránh việc hiển thị trùng lặp mức đầy rác ở hai nơi gây rối mắt người dùng. Mức độ đầy của rác giờ đây chỉ được hiển thị duy nhất và chuẩn xác tại khu vực Station tương ứng.
- **Bảo toàn:** Toàn bộ 6 thẻ giám sát phần cứng Pi 5 vẫn hoạt động 100%:
  1. Trạng thái kết nối (ONLINE/WARNING/OFFLINE).
  2. Heartbeat gần nhất (thời gian trôi qua trực tiếp).
  3. Thời gian hoạt động (Uptime).
  4. Tổng gói tin Telemetry.
  5. Nhiệt độ CPU Pi 5 (°C).
  6. Kênh kết nối Pi 5 (Socket.IO Trực tiếp / HTTP Fallback).

### 5.3. Khu vực tổng quan KPI
Các chỉ số KPI được tính toán tự động dựa trên toàn bộ các ngăn rác của cả 2 trạm:
- **Tổng số trạm:** `2` (Station A và Station B).
- **Thùng đã lắp đặt:** `4` (3 thùng của Station A + 1 thùng `RECYCLABLE` của Station B).
- **Trạm trực tuyến:** `1/2` (Station A đang ONLINE, Station B đang OFFLINE).
- **Gần đầy / Cần thu gom:** Tính toán từ các thùng đã lắp đặt có mức đầy $\ge 70\%$.
- **Thiết bị OFFLINE:** `1` (chỉ tính thùng `RECYCLABLE` của Station B đang mất kết nối; 2 thùng `NOT_INSTALLED` tuyệt đối không bị tính vào đây).

### 5.4. Bộ lọc trạm
- Dropdown bộ lọc hỗ trợ: **Tất cả các trạm**, **Station A**, **Station B**.
- Khi chọn **Station B**, giao diện hiển thị riêng Station B với đầy đủ 3 ngăn rác:
  - `RECYCLABLE`: Thùng đã lắp đặt, trạng thái `MẤT KẾT NỐI`, mức đầy `—` (chờ telemetry).
  - `ORGANIC`: Mờ nhẹ, viền đứt nét, badge xám `CHƯA LẮP ĐẶT`, mức đầy `—`.
  - `NON_RECYCLABLE`: Mờ nhẹ, viền đứt nét, badge xám `CHƯA LẮP ĐẶT`, mức đầy `—`.

---

## 6. Ghi nhận cấu hình Serial B trên Raspberry Pi

Ghi nhận cấu hình mặc định dự kiến cho Raspberry Pi Gateway:
- **Station A (ESP32 A):** `/dev/ttyUSB0`
- **Station B (ESP32-C6 B):** `/dev/ttyUSB1`
- **Camera AI (YOLO):** Thiết bị Video4Linux (`/dev/video*`), **không phải cổng Serial**.

> [!NOTE]
> - Đây là cấu hình mặc định dự kiến, không phải định danh phần cứng cố định.
> - Tuyệt đối không can thiệp hay sửa đổi Pi Agent hoặc giao thức Serial trong Round này.
> - Tuyệt đối không dùng `/dev/ttyUSB1` để truy cập Camera.
> - Việc xác minh và bind cổng thực tế sẽ được thực hiện riêng trên Raspberry Pi thông qua udev rules hoặc script cấu hình phần cứng.

---

## 7. Kết quả Kiểm thử Nghiệp vụ (T1 - T9)

Bộ kiểm thử tại [`apps/web/src/dashboard-multi-station.test.ts`](file:///E:/Smart_Bin/apps/web/src/dashboard-multi-station.test.ts) bao gồm 9 kịch bản tự động:

| Mã | Kịch bản kiểm thử | Trạng thái | Chi tiết xác nhận |
| :---: | :--- | :---: | :--- |
| **T1** | Hiển thị cả Station A và B khi có cấu hình 2 trạm | **PASS** | `groups.length === 2`, cả `STATION_A` và `STATION_B` đều tồn tại và có tên chuẩn |
| **T2** | Station B hiển thị ngay cả khi chưa có telemetry | **PASS** | Truyền mảng bins chỉ có Station A, Station B vẫn được tạo với đủ 3 compartments |
| **T3** | Station B có đúng 1 bin INSTALLED và 2 bin NOT_INSTALLED | **PASS** | `installedCount === 1`, `totalBinsCount === 3`. RECYCLABLE có `installed: true` (status: OFFLINE, fillLevel: null). ORGANIC & NON_RECYCLABLE có `installed: false` |
| **T4** | KPI tính tổng 2 trạm và 4 thùng đã lắp | **PASS** | Tổng số trạm: 2, Thùng đã lắp: 4. Offline bins: 1 (chỉ tính RECYCLABLE, loại trừ 2 thùng NOT_INSTALLED) |
| **T5** | Bộ lọc Station A / Station B hoạt động chính xác | **PASS** | Lọc ALL trả về 2 trạm; lọc STATION_A trả về 3 thùng; lọc STATION_B trả về 3 thùng (1 installed, 2 uninstalled) |
| **T6** | Header không còn Vị trí, Gateway, Controller | **PASS** | Kiểm tra mã nguồn `dashboard.tsx`: Không còn `.station-meta-row`, `gatewayInfo`, hay `controllerInfo` trong DOM |
| **T7** | Device status không còn section mức đầy 3 ngăn rác | **PASS** | Kiểm tra mã nguồn `real-device-card.tsx`: Đã xóa sạch `.real-compartments-section`, `renderCompartmentCard` |
| **T8** | Heartbeat và telemetry của Pi 5 vẫn hoạt động | **PASS** | Cả 6 card phần cứng: Trạng thái kết nối, Heartbeat, Uptime, Tổng gói, CPU Temp, Kênh kết nối đều hiện diện |
| **T9** | Không phát sinh regression với Dashboard cũ | **PASS** | Khi truyền cấu hình 1 trạm legacy với dữ liệu cũ không có stationCode, hệ thống chạy mượt mà không crash |

### Kết quả Quality Gates toàn diện
- **Multi-Station Refinement Tests:**
  ```
  node --import tsx apps/web/src/dashboard-multi-station.test.ts
  === ALL 9 REFINEMENT TESTS (T1 - T9) PASSED CLEANLY! ===
  ```
- **Dashboard Real Data Regression Tests:**
  ```
  node --import tsx apps/web/src/dashboard-real-data.test.ts
  === ALL 10 REGRESSION TESTS PASSED CLEANLY! ===
  ```
- **Dashboard Phase 8 Integration Tests:**
  ```
  node --import tsx apps/web/src/dashboard.test.ts
  === ALL PHASE 8 TESTS (D1 - D12) PASSED SUCCESSFULLY! ===
  ```
- **Web Linter (`oxlint`):**
  ```
  npm run lint --workspace @smartbin/web
  Found 0 warnings and 0 errors. Finished in 35ms on 31 files.
  ```
- **Web Build (`tsc -b && vite build`):**
  ```
  npm run build --workspace @smartbin/web
  ✓ built in 235ms (0 errors, 0 warnings)
  ```

---

## 8. Những vấn đề còn tồn tại & Khuyến nghị

1. **Render Production Database:**
   - Cơ sở dữ liệu Render hiện chưa chạy Migration 03 Expand.
   - Khi chuẩn bị Release 1 trên Render, cần thực hiện Migration 03 Expand và chạy Backfill SQL để bảng `Station` và dữ liệu quan hệ trạm được kích hoạt chính thức trên Database.
2. **Phần cứng Station B thực tế:**
   - Cần kết nối ESP32-C6 (Controller Station B) vào cổng USB trên Raspberry Pi và xác minh tên cổng thực tế (`/dev/ttyUSB1` hoặc udev symlink).
   - Khi Pi Agent gửi nhịp chứa `stationCode: "STATION_B"` và telemetry cảm biến siêu âm của ngăn Rác tái chế, Dashboard sẽ tự động cập nhật mức phần trăm sống động theo thời gian thực mà không cần sửa bất kỳ dòng mã nào nữa.

---

## 9. Kết luận

Toàn bộ các yêu cầu của **Round 19.1** đã được thực thi và kiểm chứng hoàn tất 100%. Giao diện Dashboard SmartBin hiện tại đã đạt độ hoàn thiện cao, thể hiện trực quan mô hình giám sát đa trạm độc lập, sạch sẽ, không dư thừa thông tin và hoàn toàn không sử dụng dữ liệu giả mạo.

