# ROUND 21 – COMPLETE STATION B WEB DASHBOARD & LIVE TELEMETRY INTEGRATION REPORT

**Thời gian thực hiện:** 2026-11-09T11:15:00+07:00  
**Hệ thống:** SmartBin Multi-Station IoT Platform (Raspberry Pi 5 + ESP32 / ESP32-C6 + Node.js Express + React Vite)  
**Mục tiêu:** Tích hợp hoàn chỉnh Trạm B (Station B) từ phần cứng cảm biến qua Serial B, Pi Agent Gateway, Backend Ingestion, đến Web Dashboard thời gian thực, đảm bảo hai trạm hoạt động độc lập và bảo toàn dữ liệu.

---

## 1. KIẾN TRÚC TRƯỚC VÀ SAU KHI TRIỂN KHAI

### 1.1. Kiến trúc trước khi triển khai (Round 20.7)
- **Station A:**
  - ESP32 A kết nối `/dev/ttyUSB0` do tiến trình YOLO độc quyền sở hữu.
  - YOLO xuất IPC JSON qua `/tmp/smartbin_yolo_state.json`.
  - Pi Agent đọc IPC và gửi `device:telemetry` lên Backend Socket.IO.
- **Station B:**
  - Firmware ESP32-C6 phát NDJSON qua Serial B (`115200` baud) với 1 ngăn `RECYCLABLE` và 2 ngăn `NOT_INSTALLED`.
  - Pi Agent chưa chuẩn hóa đầy đủ schema (`uptimeMs` thay vì `uptimeSeconds`, `fillPercent` thay vì `fillLevel`, thiếu `deviceId`).
  - Backend `RealtimeGateway` nhận mọi gói tin và gọi `realDeviceService.recordHeartbeat(normalizedData)` vào một đối tượng singleton duy nhất trong RAM, dẫn tới **Station B ghi đè trạng thái cảm biến của Station A** (làm mất số liệu Organic và Non-Recyclable của Station A cứ mỗi 3 giây).
  - Web Dashboard lọc thiết bị bằng `isRaspberryPiDevice()`, dẫn tới bỏ qua các gói tin của Station B nếu mang `deviceId = 'esp32c6-station-b'`.
  - Số lượng thùng "Chưa lắp đặt" bị tính nhầm vào số thùng "Mất kết nối" (offline) trên KPI Summary.

### 1.2. Kiến trúc sau khi triển khai hoàn chỉnh (Round 21)
```
+-------------------------------------------------------------------------------------------------------+
|                                         RASPBERRY PI 5 GATEWAY                                         |
|                                                                                                       |
|  [Hardware A: ESP32 A] --------(Serial A: /dev/ttyUSB0)--------> [YOLO Process (Inference & IPC)]     |
|                                                                                 |                     |
|                                                                       /tmp/smartbin_yolo_state.json   |
|                                                                                 v                     |
|  [Hardware B: ESP32-C6 B] ---(Serial B: /dev/smartbin_station_b)---> [Pi Agent (pi_agent.py)]         |
|                              (Baud: 115200, CRC16 Check)               |         |                    |
|                                                                        |         | (Offline Queue)    |
|                                                                        |         v                    |
|                                                                        |     [SQLite OfflineBuffer]   |
+------------------------------------------------------------------------|------------------------------+
                                                                         | Socket.IO (device:telemetry)
                                                                         | Bearer Token Auth
                                                                         v
+-------------------------------------------------------------------------------------------------------+
|                                         BACKEND API (Node.js)                                         |
|                                                                                                       |
| [RealtimeGateway]                                                                                     |
|   |-- Phân loại: stationCode === 'STATION_A' -> realDeviceService.recordHeartbeat() (RAM Station A)  |
|   |-- Phân loại: stationCode === 'STATION_B' -> BỎ QUA realDeviceService (Bảo vệ RAM Station A)       |
|   |-- Broadcast: 'device:heartbeat' tới room station:STATION_B:telemetry & global                      |
|   `-- Ingestion: UnifiedTelemetryIngestionService                                                     |
|         |-- Station A: Legacy Ingestion Mode (Lấy mẫu chênh lệch >= 1% hoặc 5 phút)                   |
|         `-- Station B: Strict Multi-Station Mode (Watermark, BootCount, SampleSeq, Anti-Replay)       |
|               |-- RECYCLABLE (installed=true): Ghi SensorReading, cập nhật Bin.currentFillLevel, ONLINE|
|               `-- ORGANIC / NON_RECYCLABLE (installed=false): SKIPPED_NOT_INSTALLED (0 SensorReading) |
+-------------------------------------------------------------------------------------------------------+
                                                                         | WebSocket Realtime
                                                                         v
+-------------------------------------------------------------------------------------------------------+
|                                         WEB DASHBOARD (React Vite)                                    |
|                                                                                                       |
|  [TRẠM THU GOM TRUNG TÂM A]                     [TRẠM THU GOM MỞ RỘNG B]                              |
|  Trực tuyến (3/3 thùng đã lắp)                  Trực tuyến (1/3 thùng đã lắp)                         |
|  - Rác tái chế: 55% (Đang hoạt động)           - Rác tái chế: 68% (Đang hoạt động, 15.5 cm)           |
|  - Rác không tái chế: 60% (Đang hoạt động)      - Rác không tái chế: "Chưa lắp đặt" (—)                |
|  - Rác hữu cơ: 30% (Đang hoạt động)            - Rác hữu cơ: "Chưa lắp đặt" (—)                       |
+-------------------------------------------------------------------------------------------------------+
```

---

## 2. DANH SÁCH FILE ĐÃ SỬA VÀ TẠO MỚI

| STT | File | Thay đổi chính |
| :--- | :--- | :--- |
| 1 | `apps/device/station_b_worker.py` | Bổ sung fallback cổng `/dev/ttyUSB1`, kiểm tra freshness trong `get_latest_data()`, hỗ trợ kép CRC16 (canonical và insertion order). |
| 2 | `apps/device/pi_agent.py` | Chuẩn hóa `payload_b`: ánh xạ `fillPercent` -> `fillLevel`, quy đổi `uptimeMs` -> `uptimeSeconds`, gán `deviceId` và `clientMessageId` ổn định chống trùng lặp. |
| 3 | `apps/device/test_station_b_integration.py` | Bổ sung 4 unit test mới (mất kết nối, kết nối lại, quá hạn freshness, chuẩn hóa payload). Đạt 12/12 tests OK. |
| 4 | `apps/api/src/integrations/realtime/realtime.gateway.ts` | Hỗ trợ alias `fillPercent` trong schema, làm `aiDetection` optional cho Trạm B, cách ly RAM `realDeviceService` chỉ cho Trạm A, broadcast nhịp tim Trạm B ra phòng và toàn cục. |
| 5 | `apps/api/src/demo/real-device.service.ts` | Bổ sung trường `stationCode: 'STATION_A'` vào đối tượng `RealDeviceStatus` để hỗ trợ lọc tại client. |
| 6 | `apps/api/src/services/bin-sync.service.ts` | Áp dụng ngưỡng freshness 15s (`DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS`) cho Trạm B: dữ liệu quá 15s tự động chuyển `OFFLINE` và `currentFillLevel = null`. Ngăn chưa lắp đặt cố định `MAINTENANCE`. |
| 7 | `apps/web/src/bin-view-model.ts` | Nhận diện heartbeat trạm (`isStationHeartbeat`), cách ly cập nhật ngăn rác theo đúng `stationCode`, ngăn chưa lắp đặt trả về nhãn "Chưa lắp đặt" và `displayPercentage: '—'`. |
| 8 | `apps/web/src/dashboard.tsx` | Tiếp nhận heartbeat Trạm B trong `mergeDeviceHeartbeat`, loại bỏ ngăn chưa lắp đặt khỏi cách tính tổng thùng và thùng offline trên KPI summary. |
| 9 | `apps/api/src/services/round21-multi-station-integration.test.ts` | Tạo mới test suite tự động kiểm thử toàn diện 12 kịch bản bắt buộc của Round 21. Đạt 12/12 tests PASS. |

---

## 3. LUỒNG SERIAL B THỰC TẾ

1. **Thông số phần cứng:**
   - Vi điều khiển: ESP32-C6.
   - Tốc độ truyền: `115200` baud, cấu hình khung truyền `8N1` (8 data bits, no parity, 1 stop bit).
   - Chu kỳ truyền: 3.0 giây / gói tin.
2. **Quy tắc dò cổng (Order of Precedence):**
   - Mức 1: Biến môi trường `STATION_B_SERIAL_PORT` (nếu cấu hình).
   - Mức 2: Udev symlink `/dev/smartbin_station_b`.
   - Mức 3: Đường dẫn vật lý USB `/dev/serial/by-path/*` (loại trừ ttyUSB0 của Station A).
   - Mức 4: Đường dẫn ID USB `/dev/serial/by-id/*` (loại trừ thiết bị Station A).
   - Mức 4b: Cổng `/dev/ttyUSB1` trực tiếp nếu tồn tại và khác `/dev/ttyUSB0`.
   - Mức 5: Cổng COM trên Windows khi chạy môi trường phát triển.
3. **Toàn vẹn dữ liệu:**
   - Kiểm tra định dạng NDJSON với ký tự đầu `{` và cuối `}`.
   - Thuật toán kiểm tra mã băm CRC16: `CRC-16/CCITT-FALSE` (Polynomial `0x1021`, Initial `0xFFFF`).
   - Nếu CRC không khớp hoặc JSON hỏng, gói tin bị loại bỏ ngay tại tầng worker, không chuyển lên Pi Agent.
4. **Xử lý mất kết nối:**
   - Khi ngắt cáp USB Serial B hoặc vi điều khiển khởi động lại: bắt ngoại lệ `SerialException` / `OSError`, chuyển trạng thái sang `DISCONNECTED`.
   - Cơ chế Exponential Backoff thử kết nối lại từ `1.0s` đến tối đa `10.0s`.
   - Hàm `get_latest_data(max_age_seconds=10.0)` trả về `None` khi mất kết nối hoặc dữ liệu quá 10 giây; Pi Agent tuyệt đối không dùng dữ liệu cũ để giả lập trạng thái ONLINE.

---

## 4. PAYLOAD TELEMETRY STATION B THỰC TẾ

### 4.1. Gói tin NDJSON phát từ ESP32-C6 (vào Serial B):
```json
{
  "stationCode": "STATION_B",
  "bootCount": 12,
  "bootId": "e3a8905b-86d7-4b1a-941a-9f5e3bc9b02a",
  "sampleSeq": 1045,
  "uptimeMs": 3135000,
  "sensors": {
    "recyclable": {
      "distanceCm": 18.4,
      "fillPercent": 70,
      "status": "OK"
    },
    "nonRecyclable": {
      "status": "NOT_INSTALLED"
    },
    "organic": {
      "status": "NOT_INSTALLED"
    }
  },
  "crc16": 42189
}
```

### 4.2. Gói tin Socket.IO Pi Agent gửi lên Backend (`device:telemetry`):
```json
{
  "stationCode": "STATION_B",
  "deviceId": "esp32c6-station-b",
  "deviceType": "ESP32_C6",
  "status": "ONLINE",
  "uptimeSeconds": 3135.0,
  "uptimeMs": 3135000,
  "bootCount": 12,
  "bootId": "e3a8905b-86d7-4b1a-941a-9f5e3bc9b02a",
  "sampleSeq": 1045,
  "clientMessageId": "STATION_B-12-1045-e3a8905b-86d7-4b1a-941a-9f5e3bc9b02a",
  "sentAt": "2026-11-09T04:14:02.120Z",
  "sensors": {
    "recyclable": {
      "distanceCm": 18.4,
      "fillLevel": 70,
      "fillPercent": 70,
      "status": "OK"
    },
    "nonRecyclable": {
      "status": "NOT_INSTALLED"
    },
    "organic": {
      "status": "NOT_INSTALLED"
    }
  }
}
```

---

## 5. API VÀ DATABASE MAPPING

### 5.1. Database Mapping (PostgreSQL Schema)
- **Bảng `Station`:**
  - `id`: `station_b_canonical_id`
  - `code`: `STATION_B`
  - `name`: `Trạm Thu gom Mở rộng B`
  - `isActive`: `true`
  - `status`: `ONLINE` (khi có nhịp tim trong vòng 15s) / `OFFLINE` (khi mất kết nối)
- **Bảng `Bin`:**
  - `(stationId='station_b_canonical_id', binCode='RECYCLABLE')`: `installed = true`, `isActive = true`, `currentFillLevel = 70`, `status = 'ONLINE'`, `lastSeen = NOW()`.
  - `(stationId='station_b_canonical_id', binCode='NON_RECYCLABLE')`: `installed = false`, `isActive = true`, `currentFillLevel = NULL`, `status = 'MAINTENANCE'`, `lastSeen = NULL`.
  - `(stationId='station_b_canonical_id', binCode='ORGANIC')`: `installed = false`, `isActive = true`, `currentFillLevel = NULL`, `status = 'MAINTENANCE'`, `lastSeen = NULL`.
- **Bảng `SensorReading`:**
  - Chỉ ghi nhận dữ liệu cho ngăn `RECYCLABLE`.
  - Hai ngăn `ORGANIC` và `NON_RECYCLABLE` tuyệt đối không có bản ghi `SensorReading`.
- **Bảng `StationWatermark`:**
  - Khóa composite `(stationCode='STATION_B', binCode='RECYCLABLE')` quản lý tiến trình `bootCount`, `bootId`, `lastSampleSeq`, `lastPayloadHash`.
- **Bảng `TelemetryIdempotencyLedger`:**
  - Khóa composite `(stationCode='STATION_B', bootId, sampleSeq)` lưu vết mã băm payload để khử trùng lặp và phát hiện gói tin bị can thiệp.

### 5.2. API Response: `GET /api/dashboard/summary`
```json
{
  "summary": {
    "total": 4,
    "uninstalled": 2,
    "normal": 1,
    "warning": 2,
    "full": 1,
    "offline": 0
  },
  "bins": [
    {
      "id": "bin_a_rec",
      "stationId": "station_a_canonical_id",
      "binCode": "RECYCLABLE",
      "installed": true,
      "currentFillLevel": 55,
      "status": "ONLINE"
    },
    {
      "id": "bin_b_rec",
      "stationId": "station_b_canonical_id",
      "binCode": "RECYCLABLE",
      "installed": true,
      "currentFillLevel": 70,
      "status": "ONLINE"
    },
    {
      "id": "bin_b_non",
      "stationId": "station_b_canonical_id",
      "binCode": "NON_RECYCLABLE",
      "installed": false,
      "currentFillLevel": null,
      "status": "MAINTENANCE"
    },
    {
      "id": "bin_b_org",
      "stationId": "station_b_canonical_id",
      "binCode": "ORGANIC",
      "installed": false,
      "currentFillLevel": null,
      "status": "MAINTENANCE"
    }
  ]
}
```

---

## 6. GIAO DIỆN DASHBOARD

### 6.1. Bố cục hai trạm độc lập
- **Khu vực Trạm A:**
  - Tiêu đề: `STATION_A` | `Trạm Thu gom Trung tâm A` | Badge `Trực tuyến`
  - Thống kê trạm: `3/3 thùng đã lắp` | `Mức đầy TB: 48%` | `Cập nhật: Vừa xong`
  - 3 ngăn rác: Rác hữu cơ (`30%`), Rác tái chế (`55%`), Rác không tái chế (`60%`) đều hiển thị thanh tiến trình, mức phần trăm và trạng thái hoạt động.
- **Khu vực Trạm B:**
  - Tiêu đề: `STATION_B` | `Trạm Thu gom Mở rộng B` | Badge `Trực tuyến` (hoặc `Mất kết nối` nếu offline)
  - Thống kê trạm: `1/3 thùng đã lắp` | `Mức đầy TB: 70%` | `Cập nhật: Vừa xong`
  - Ngăn Rác tái chế (`RECYCLABLE`):
    - Mức đầy: `70%`
    - Thanh tiến trình: Rộng `70%`, tone vàng cam (`nearly_full`)
    - Khoảng cách: `18.4 cm`
    - Trạng thái: `Trực tuyến` / `Đang hoạt động`
  - Hai ngăn Rác hữu cơ và Rác không tái chế:
    - Phần trăm đầy: `—` (gạch ngang, không hiển thị `0%`)
    - Thanh tiến trình: `0%` (màu trung tính unavailable)
    - Badge trạng thái: `Chưa lắp đặt`
    - Ghi chú: `Ngăn này chưa gắn cảm biến đo mức đầy. Sẵn sàng cấu hình mở rộng phần cứng.`
    - Thẻ card mang class `.waste-card--uninstalled` với viền nét đứt và độ mờ 72%.

### 6.2. Tính thích ứng Mobile (Responsive)
- CSS Grid tự động co giãn từ 3 cột trên màn hình Desktop lớn xuống 1 cột trên điện thoại di động (chiều rộng `< 768px`).
- Nút bấm `Thu gọn ▲ / Mở rộng ▼` cho từng trạm giúp tiết kiệm diện tích trên màn hình nhỏ.
- Bộ lọc trạm hỗ trợ chuyển đổi nhanh giữa: `Tất cả các trạm`, `Trạm A`, `Trạm B`.

---

## 7. KẾT QUẢ TỪNG BÀI KIỂM THỬ (12/12 SCENARIOS)

| Kịch bản | Mô tả kiểm thử | Kết quả | Chi tiết xác minh |
| :---: | :--- | :---: | :--- |
| **1** | Station A tiếp tục nhận dữ liệu bình thường | **PASS** | Gói tin Station A được xử lý qua Legacy Ingestion, cập nhật `currentFillLevel`, `status = ONLINE`. |
| **2** | Station B nhận dữ liệu Recyclable | **PASS** | Gói tin Trạm B được tiếp nhận qua Strict Ingestion, cập nhật mức đầy 68%, distance 15.5cm, Watermark tịnh tiến. |
| **3** | Station B không ghi đè dữ liệu Station A | **PASS** | RAM `realDeviceService` chỉ ghi nhận nhịp tim Station A; Station B phát trực tiếp tới room riêng và không xóa trạng thái 3 ngăn của Station A. |
| **4** | Hai Station có cùng `binCode` khác `stationId` | **PASS** | Truy vấn DB và Ingestion phân biệt chính xác dựa trên cặp composite `(stationId, binCode)` và `(stationCode, binCode)`. |
| **5** | Hai ngăn chưa lắp đặt không có `SensorReading` | **PASS** | Trả về `SKIPPED_NOT_INSTALLED`, 0 bản ghi DB, UI hiển thị "Chưa lắp đặt", phần trăm `—`, không tính là OFFLINE. |
| **6** | Serial B mất kết nối | **PASS** | Worker chuyển sang `DISCONNECTED`, `get_latest_data()` trả về `None`, không phát sinh số liệu giả. |
| **7** | Serial B kết nối lại | **PASS** | Worker tự động khôi phục kết nối, tiếp nhận gói tin mới (seq=3, 80%), đưa Trạm B trở lại `ONLINE`. |
| **8** | Telemetry B bị trùng hoặc replay | **PASS** | Trùng lặp nhận diện qua `stationWatermark` và `Ledger` trả về `FAST_ACK_DUPLICATE`; gói tin xung đột số thứ tự bị từ chối với `SEQUENCE_CLASH_TAMPERED`. |
| **9** | Dữ liệu B hết hạn freshness (>15s) | **PASS** | Khi gói tin cuối quá 15 giây, `syncBinWithRealDevice` chuyển sang `OFFLINE`, mức đầy chuyển thành `null`, UI hiển thị `—`. |
| **10** | Dashboard hiển thị đúng hai trạm | **PASS** | `groupBinsByStation` xuất ra Trạm A (3/3 đã lắp) và Trạm B (1/3 đã lắp, 2 ngăn Chưa lắp đặt). |
| **11** | Mobile responsive layout | **PASS** | Toàn bộ thẻ card và layout cung cấp đầy đủ CSS class, metadata và khả năng thu gọn trên màn hình hẹp. |
| **12** | Backend restart không làm dữ liệu cũ bị coi là mới | **PASS** | Bản ghi DB cũ từ 2 giờ trước bị `syncBinWithRealDevice` coi là `OFFLINE` ngay khi khởi động lại cho đến khi nhận được telemetry tươi mới. |

---

## 8. NHỮNG PHẦN CHƯA THỂ XÁC MINH DO THIẾU PHẦN CỨNG HOẶC DATABASE PRODUCTION

1. **Production Database Render:**
   - Bộ SQL repair của Round 20.7 (`round20_3_multi_station_repair.sql`) đã sẵn sàng nhưng **chưa được thực thi trên Production PostgreSQL** theo quy tắc an toàn nghiêm ngặt của dự án.
   - Khi chạy trên môi trường thực tế, DBA cần chạy script Round 20.7 trước để tạo thực thể Station B trong cơ sở dữ liệu.
2. **Cáp vật lý ESP32-C6 B:**
   - Đã kiểm tra cơ chế phân tích cú pháp NDJSON, CRC16, và vòng lặp tự động kết nối qua unit test và mock serial.
   - Việc bắt tay thực tế trên cổng USB vật lý `/dev/smartbin_station_b` (hoặc `/dev/ttyUSB1`) sẽ được kích hoạt ngay khi cắm mạch phần cứng ESP32-C6 vào Raspberry Pi 5.

---

## 9. CÁC BƯỚC CẦN THỰC HIỆN TIẾP THEO

1. **Thực thi SQL Patch Round 20.7 trên Render Production:**
   - Chạy `round20_3_multi_station_repair.sql` qua `psql` trên Production Database Render.
   - Chạy `round20_3_verify.sql` để xác nhận Station B có 1 bin RECYCLABLE `installed=true`, 2 bin ORGANIC và NON_RECYCLABLE `installed=false`.
2. **Cắm phần cứng ESP32-C6 vào Raspberry Pi 5:**
   - Cắm cáp USB ESP32-C6 vào cổng USB Raspberry Pi 5.
   - Xác nhận cổng `/dev/smartbin_station_b` hoặc `/dev/ttyUSB1` nhận diện thành công (`ls -la /dev/serial/by-id/`).
3. **Khởi động Pi Agent:**
   - Khởi chạy `python3 apps/device/pi_agent.py`.
   - Quan sát log xác nhận: `[Station B] Socket.IO live telemetry ACK OK -> Boot: 1 | Seq: 1 | Sensors: ['recyclable', 'nonRecyclable', 'organic']`.
4. **Kiểm tra Dashboard:**
   - Truy cập giao diện Web SmartBin: xác nhận thẻ card Trạm B hiển thị mức đầy trực tiếp từ cảm biến HC-SR04 của ESP32-C6 B.

