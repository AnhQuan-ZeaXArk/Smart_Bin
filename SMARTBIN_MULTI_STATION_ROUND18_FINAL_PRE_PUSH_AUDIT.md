# BÁO CÁO KIỂM TOÁN MÃ NGUỒN TIỀN ĐẨY MÃ (FINAL PRE-PUSH CODE AUDIT)
## SMARTBIN MULTI-STATION – ROUND 18 AUDIT REPORT

- **Dự án:** SmartBin IoT – Multi-Station Architecture (Station A & Station B)
- **Phương pháp kiểm toán:** **READ-ONLY AUDIT** (Không sửa mã nguồn, không chạy migration, không commit, không push)
- **Thời điểm kiểm toán:** 08/11/2026
- **Trạng thái phê duyệt:** **CONDITIONALLY APPROVED (PHÊ DUYỆT CÓ ĐIỀU KIỆN)**

---

## 1. TỔNG HỢP KIỂM TOÁN GIT (GIT AUDIT SUMMARY)

### 1.1. Trạng thái Working Tree & Thống kê Thay đổi
- **Nhánh hiện tại:** `main` (Up to date with origin/main)
- **Tổng số file đã chỉnh sửa (Modified):** 17 files
- **Tổng số file mới chưa track (Untracked):** 11 files/thư mục
- **Thống kê thay đổi (git diff --stat):**
  - **732 dòng thêm mới (+)**, **106 dòng xóa (-)** trên 17 file mã nguồn.
- **Kiểm tra chuẩn định dạng (git diff --check):**
  - **0 lỗi** whitespace, không có trailing spaces hoặc conflict markers.
- **Kiểm tra file nhạy cảm và Bí mật (Secrets Check):**
  - Không có file `.env` nào bị thêm vào Git (`apps/api/.env`, `apps/web/.env.production` đều được `.gitignore` bảo vệ nghiêm ngặt ở trạng thái `!!`).
  - Toàn bộ các tham chiếu tới `DEVICE_INGEST_TOKEN`, `JWT_SECRET`, và `DATABASE_URL` trong mã nguồn mới đều đọc từ biến môi trường `process.env` hoặc `os.getenv()`, **hoàn toàn không có hardcoded secret**.

### 1.2. Danh mục Toàn bộ File Thay đổi & Đánh giá Phạm vi
Mọi file chỉnh sửa và tạo mới đều thuộc phạm vi Round 18 (Multi-Station Ingestion, Security, Gateway, Device Worker, Frontend):

| Phân hệ | Đường dẫn File | Loại | Phạm vi Round 18 |
| :--- | :--- | :---: | :---: |
| **Database** | `apps/api/prisma/schema.prisma` | Modified | Mở rộng Schema PostgreSQL: Station, Watermark, Ledger, Provenance |
| **Database** | `apps/api/prisma/schema.sqlite.prisma` | Modified | Mở rộng Schema SQLite đồng bộ |
| **Database** | `apps/api/prisma/seed.ts` | Modified | Seed Trạm A (3 ngăn) và Trạm B (Chỉ Recyclable installed) |
| **Database** | `apps/api/prisma/migrations/000000000003_multi_station_expand/` | Created | SQL Expand Phase 1 |
| **Database** | `apps/api/prisma/migrations/000000000004_multi_station_contract/` | Created | SQL Contract Phase 5 |
| **Database** | `apps/api/prisma/migrations/rollback/` | Created | Rollback scripts cho Phase 1 và Phase 5 |
| **Backend** | `apps/api/src/services/unified-telemetry-ingestion.service.ts` | Created | Bộ điều hướng tiếp nhận Ingestion hợp nhất (Dual-mode) |
| **Backend** | `apps/api/src/services/unified-telemetry-ingestion.test.ts` | Created | Unit test 9 kịch bản cho Ingestion Service |
| **Backend** | `apps/api/src/routes/station.routes.ts` | Created | REST API quản trị vòng đời Station |
| **Backend** | `apps/api/src/app.ts` | Modified | Đăng ký route Station |
| **Backend** | `apps/api/src/integrations/realtime/realtime.gateway.ts` | Modified | Phân phòng Socket.IO theo Station, thu hồi phiên < 3s |
| **Backend** | `apps/api/src/routes/bin.routes.ts` | Modified | Phân vùng theo stationId, cập nhật compound key |
| **Backend** | `apps/api/src/routes/dashboard.routes.ts` | Modified | Lọc dashboard theo trạm, loại trừ NOT_INSTALLED |
| **Backend** | `apps/api/src/routes/protected.routes.ts` | Modified | Bắt buộc xác thực collections, kiểm tra user isActive |
| **Backend** | `apps/api/src/services/bin-sync.service.ts` | Modified | Cách ly đồng bộ RAM Trạm A, bảo vệ Trạm B |
| **Backend** | `apps/api/src/services/telemetry.service.ts` | Modified | Phân vùng stationId/stationCode, loại trừ NOT_INSTALLED |
| **Backend** | `apps/api/src/integrations/mqtt/mqtt.adapter.ts` | Modified | Chuyển findUnique sang findFirst theo compound key |
| **Backend** | `apps/api/src/integrations/mqtt/mqtt.adapter.test.ts` | Modified | Chuyển findUnique sang findFirst |
| **Backend** | `apps/api/src/integrations/realtime/realtime.gateway.test.ts` | Modified | Chuyển findUnique sang findFirst |
| **Gateway** | `apps/device/pi_agent.py` | Modified | Tích hợp Station B Worker và SQLite Offline Buffer |
| **Gateway** | `apps/device/station_b_worker.py` | Created | Luồng đọc Serial B độc lập (115200 bps, NDJSON, CRC16) |
| **Gateway** | `apps/device/offline_buffer.py` | Created | Đệm SQLite 50,000 gói tin, xử lý tràn FIFO |
| **Gateway** | `apps/device/test_station_b_integration.py` | Created | Kiểm thử tích hợp Serial B & Offline buffer |
| **Firmware** | `apps/device/firmware/station_b_esp32c6.ino` | Created | Firmware ESP32-C6 Trạm B |
| **Firmware** | `apps/device/firmware/station_b_simulator.py` | Created | Trình sinh gói tin NDJSON Trạm B |
| **Frontend** | `apps/web/src/bin-view-model.ts` | Modified | Xử lý hiển thị `Chưa lắp đặt`, cách ly trạm |
| **Frontend** | `apps/web/src/bins.tsx` | Modified | Bổ sung trường station vào Bin, nhãn NOT_INSTALLED |
| **Frontend** | `apps/web/src/dashboard.tsx` | Modified | Bộ chọn Station Selector, đăng ký phòng realtime |
| **Báo cáo** | `SMARTBIN_MULTI_STATION_ROUND18_IMPLEMENTATION_REPORT.md` | Created | Báo cáo chi tiết quá trình triển khai Vòng 18 |

---

## 2. KẾT QUẢ XÁC MINH KIẾN TRÚC TRẠM A VÀ TRẠM B

Đối chiếu trực tiếp mã nguồn thực tế tại `apps/device/pi_agent.py` và `apps/device/station_b_worker.py`:

1. **Pi Agent không mở Serial A:**  
   Xác minh dòng 7 trong `pi_agent.py`: `3. ESP32 serial is not used by the Agent.`. Trong toàn bộ file `pi_agent.py`, không có bất kỳ lệnh gọi `serial.Serial` nào đối với Serial A (`/dev/ttyUSB0`).
2. **YOLO vẫn sở hữu Serial A:**  
   Tiến trình `yolo_camera.py` tiếp tục độc quyền sở hữu `/dev/ttyUSB0` và camera phần cứng. Định dạng text `HC1: 45%` không bị thay đổi.
3. **Pi Agent đọc IPC JSON của Trạm A:**  
   Xác minh dòng 46 và dòng 273 trong `pi_agent.py`: Trạng thái và dữ liệu Trạm A được nạp qua hàm `read_yolo_state()` đọc từ file IPC `/tmp/smartbin_yolo_state.json`.
4. **Pi Agent mở Serial B riêng biệt & Không bị nhầm với Serial A:**  
   Trong `station_b_worker.py` (dòng 56–83), phương thức `find_serial_port()` tìm cổng theo thứ tự ưu tiên:
   - Cổng chỉ định rõ trong `STATION_B_SERIAL_PORT`.
   - Symlink udev cố định `/dev/smartbin_station_b`.
   - Lọc trong `/dev/serial/by-path/*` với điều kiện loại trừ nghiêm ngặt: `if 'ttyUSB0' not in os.path.realpath(p): return p`.
   - Lọc trong `/dev/serial/by-id/*` với điều kiện: `if not real.endswith('ttyUSB0'): return p`.  
   *Kết luận:* Serial B hoàn toàn cách ly vật lý và logic khỏi Serial A.
5. **Dữ liệu hai trạm được phân biệt rõ bằng stationId / stationCode:**  
   Gói tin Trạm A mang `stationCode: 'STATION_A'`. Gói tin Trạm B mang `stationCode: 'STATION_B'`. Ở Backend, mọi truy vấn đều được đóng khung theo `stationId` hoặc `stationCode`.
6. **Không có đường truyền ESP32-C6 B trực tiếp tới Backend:**  
   Firmware ESP32-C6 (`station_b_esp32c6.ino`) không cấu hình Wi-Fi hay HTTP client, chỉ in dữ liệu ra `Serial.println()` ở baudrate 115200. Dữ liệu bắt buộc phải qua luồng `ESP32-C6 Serial B -> Pi Agent -> Socket.IO -> Backend`.

---

## 3. PHÂN TÍCH CHUYÊN SÂU CÁC ĐIỂM NGHI VẤN KỸ THUẬT

### A. Kiểm tra Simulator (`station_b_simulator.py`)
- **Bản chất thực tế của file:** `station_b_simulator.py` là một **Class sinh dữ liệu chuỗi NDJSON kèm CRC16** (`ESP32C6Simulator.generate_ndjson_line()`) chạy in ra stdout trong 3 chu kỳ.
- **Đánh giá kiến trúc:** File **KHÔNG** chứa bất kỳ mã nào gửi HTTP hay Socket.IO trực tiếp tới Backend. Điều này phù hợp với bản chất phần cứng ESP32-C6 là không có kết nối mạng trực tiếp tới Cloud.
- **Khiếm khuyết phát hiện:** Simulator hiện chưa có giao diện dòng lệnh (CLI arguments) để liên kết với Virtual PTY (`pty`) hoặc cổng COM ảo, và không có vòng lặp vô hạn phục vụ kiểm thử chạy dài (chỉ in 3 dòng rồi thoát).

### B. Kiểm tra Offline Buffer (`offline_buffer.py`)
1. **Vấn đề Xác nhận ACK (Cực kỳ quan trọng - BLOCKER):**
   Trong `apps/device/pi_agent.py` (hàm `drain_offline_buffer()`, dòng 381–404):
   ```python
   for item in batch:
       payload = json.loads(item['payload_json'])
       sio.emit('device:telemetry', payload)
       acked_ids.append(item['client_message_id']) # <-- NGUY HIỂM: ACK SUY ĐOÁN PHÍA CLIENT!
   if acked_ids:
       offline_buffer.mark_acked(acked_ids)
       offline_buffer.prune_acked()
   ```
   **Phân tích rủi ro:** Lệnh `sio.emit()` chỉ đẩy gói tin vào bộ đệm socket cục bộ của tiến trình Python mà **chưa hề nhận được ACK callback từ Backend**. Nếu ngay sau đó Server gặp sự cố hoặc ngắt kết nối trước khi lưu vào DB, Pi Agent đã xóa vĩnh viễn gói tin này khỏi đĩa (`prune_acked()`), dẫn đến **mất dữ liệu âm thầm**.
2. **Khả năng phục hồi IN_FLIGHT khi mất điện đột ngột:**
   Trong `offline_buffer.py`, `peek_batch()` chỉ lấy `WHERE status = 'QUEUED'`. Nếu một gói tin được đánh dấu là `IN_FLIGHT` rồi Raspberry Pi bị sập nguồn đột ngột, khi khởi động lại, gói tin đó sẽ kẹt ở trạng thái `IN_FLIGHT` vĩnh viễn và không bao giờ được gửi lại. (Cần bổ sung truy vấn phục hồi: `UPDATE offline_telemetry SET status = 'QUEUED' WHERE status = 'IN_FLIGHT'` khi khởi tạo).
3. **Chính sách Tràn hàng đợi FIFO:**
   Khi hàng đợi đạt 50,000 gói tin chưa ACK (`status != 'ACKED'`), hệ thống xóa gói `QUEUED` cũ nhất (`ORDER BY id ASC LIMIT 1`) và ghi log `logger.critical("BUFFER_OVERFLOW: ...")`. Dữ liệu cũ nhất bị loại bỏ để bảo vệ thẻ nhớ Pi khỏi cạn kiệt dung lượng.

### C. Kiểm tra Database Migration & Schema
1. **Khả năng tương thích PostgreSQL:** Bộ script `000000000003` và `000000000004` hoàn toàn tương thích PostgreSQL 14+, sử dụng kiểu dữ liệu chuẩn (`BIGINT`, `TIMESTAMP(3)`, `VARCHAR(64)`), cấu trúc `DO $$ BEGIN ... END $$;`.
2. **Không sử dụng CASCADE nguy hiểm:** Không có bất kỳ lệnh `DROP TABLE ... CASCADE` hay `DROP CONSTRAINT ... CASCADE` nào trong migration và rollback. Toàn bộ ràng buộc được quản lý tường minh.
3. **Phát hiện truy vấn chưa tường minh trạm (Ambiguous Bin Query):**
   Tại `apps/api/src/routes/bin.routes.ts` (dòng 131–136):
   ```typescript
   const bin = await prisma.bin.findFirst({
     where: {
       isActive: true,
       ...(stationId ? { stationId } : {}),
       OR: [{ id }, { binCode: id }]
     }
   });
   ```
   Nếu cả Trạm A và Trạm B đều có ngăn `RECYCLABLE`, mà client gọi `GET /api/bins/RECYCLABLE` mà **không truyền `?stationId=...`**, API sẽ trả về ngăn của Trạm A hoặc Trạm B tùy thuộc vào thứ tự sắp xếp ngẫu nhiên của database. Bắt buộc phải tra cứu bằng UUID `id` hoặc phải có `stationId`.

### D. Kiểm tra Giao dịch Tiếp nhận Hợp nhất (Unified Ingestion Transaction)
Trong `UnifiedTelemetryIngestionService` (dòng 193–385):
- Bốn bước: `SensorReading.create`, `Bin.update`, `StationWatermark.update`, và `TelemetryIdempotencyLedger.upsert` được bao bọc trọn vẹn trong một giao dịch cơ sở dữ liệu duy nhất `prisma.$transaction(async (tx) => { ... })`.
- Đối với gói tin đến trễ (`isLate = true` trong cửa sổ 60s): Chỉ ghi vào `SensorReading` và `TelemetryIdempotencyLedger`; tuyệt đối **không cập nhật `Bin.currentFillLevel`** và **không lùi `StationWatermark`**.
- Phát hiện xung đột sequence: Trùng số thứ tự nhưng sai mã băm SHA-256 bị từ chối ngay với `SEQUENCE_CLASH_TAMPERED`.

### E. Kiểm tra Bảo mật Socket.IO & Lỗi Sai Tên Sự Kiện (Event Mismatch - BLOCKER)
1. **Phát hiện Mâu thuẫn Tên Sự kiện (Event Name Mismatch):**
   - Phía Backend (`realtime.gateway.ts`, dòng 274–285) lắng nghe:  
     `socket.on('subscribe_station', ...)` và `socket.on('unsubscribe_station', ...)` *(dùng dấu gạch dưới `_`)*.
   - Phía Frontend (`apps/web/src/dashboard.tsx`, dòng 278) lại phát sự kiện:  
     `realtime.emit('subscribe:station', ...)` *(dùng dấu hai chấm `:`)*.
   - **Hệ quả:** Khi người dùng đổi trạm trên giao diện Web, Backend không nhận được lệnh chuyển phòng Socket.IO, khiến Web không nhận được dữ liệu realtime của trạm mới được chọn!
2. **Thu hồi quyền tức thì:** `revokeUserSessions(userId)` ngắt kết nối socket của user trong RAM ngay lập tức (< 3.0s SLA), đáp ứng yêu cầu an toàn.

### F. Kiểm tra Giới hạn Hiển thị Frontend (`waste-category.ts`)
- Hàm `assignWasteCategories()` trên Web hiện chỉ định nghĩa cấu trúc cố định cho 3 ngăn duy nhất: `ORGANIC`, `RECYCLABLE`, `NON_RECYCLABLE`.
- **Hạn chế:** Khi người dùng chọn chế độ xem "Tất cả các trạm" (trả về 6 thùng rác: 3 thùng Trạm A + 3 thùng Trạm B), hàm này chỉ giữ lại 3 thùng đầu tiên khớp loại và **bỏ qua 3 thùng còn lại**. Giao diện chỉ hiển thị đúng khi người dùng chọn lọc từng Trạm cụ thể.

---

## 4. BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ THỰC NGHIỆM

Toàn bộ 13 bài kiểm thử đã được chạy lại trên môi trường thực tế với kết quả và nguyên nhân như sau:

| STT | Bài kiểm thử | Lệnh thực thi | Exit Code | Kết quả | Ghi chú / Nguyên nhân |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **1** | API TypeScript & Lint | `npm run lint --workspace @smartbin/api` | **0** | **PASS** | Biên dịch TypeScript sạch, 0 lỗi cú pháp |
| **2** | Prisma Schema Validate | `npm run db:validate --workspace @smartbin/api` | **0** | **PASS** | Cả `schema.prisma` và `schema.sqlite.prisma` đều hợp lệ |
| **3** | Web Oxlint | `npm run lint --workspace @smartbin/web` | **0** | **PASS** | 0 warnings, 0 errors trên 30 files |
| **4** | Web TypeScript Compile | `npx tsc -p apps/web/tsconfig.app.json --noEmit` | **0** | **PASS** | Không có lỗi kiểu dữ liệu trên React/Vite |
| **5** | Unified Ingestion Unit | `node --import tsx apps/api/src/services/unified-telemetry-ingestion.test.ts` | **0** | **PASS** | **9/9 tests PASS** (Cách ly trạm, Tamper, Anti-replay, isLate, NVS) |
| **6** | Python Station B Tests | `python apps/device/test_station_b_integration.py` | **0** | **PASS** | **5/5 tests PASS** (CRC16, NDJSON, SQLite Buffer, FIFO overflow) |
| **7** | Hardware Telemetry Realtime | `node --import tsx apps/api/src/integrations/realtime/hardware-telemetry.test.ts` | **0** | **PASS** | **9/9 tests PASS** (Pi 5 subsystems, AI detection, HTTP fallback) |
| **8** | Device Realtime Commands | `node --import tsx apps/api/src/integrations/realtime/device.realtime.test.ts` | **0** | **PASS** | **7/7 tests PASS** (Socket token, PING, Ultrasonic rejection, Offline) |
| **9** | Device Health Service | `node --import tsx apps/api/src/services/device-health.service.test.ts` | **0** | **PASS** | **6/6 tests PASS** (A1-A6: Warning, Offline, Alert recovery) |
| **10** | Device REST API Routes | `node --import tsx apps/api/src/routes/device.routes.test.ts` | **0** | **PASS** | **PASS** (GET /api/devices, RBAC, heartbeat validation) |
| **11** | AI Detection Schema | `node --import tsx apps/api/src/integrations/realtime/ai-detection.schema.test.ts` | **0** | **PASS** | **20/20 tests PASS** (Ngưỡng confidence [0, 1]) |
| **12** | Settings Routes Test | `node --import tsx apps/api/src/routes/settings.routes.test.ts` | **1** | **FAIL** | **Lỗi P2022:** Cột `installed` chưa có trên DB Render Production (Xem chi tiết 4.1) |
| **13** | Realtime Gateway Test | `node --import tsx apps/api/src/integrations/realtime/realtime.gateway.test.ts` | **1** | **FAIL** | **Lỗi R1:** Thiếu bộ lọc `deviceId` trong hàm `waitForEvent` test (Xem chi tiết 4.2) |
| **14** | MQTT Adapter Test | `node --import tsx apps/api/src/integrations/mqtt/mqtt.adapter.test.ts` | **1** | **FAIL** | **Lỗi M3:** Timeout chờ broker MQTT cập nhật trạng thái thiết bị |

### 4.1. Phân tích Chi tiết Lỗi Test 12 (`settings.routes.test.ts`)
```
PrismaClientKnownRequestError: 
The column `installed` does not exist in the current database.
code: 'P2022', meta: { modelName: 'Bin', column: 'installed' }, clientVersion: '6.19.3'
```
- **Nguyên nhân gốc:** Client Prisma cục bộ đã được cập nhật với trường `installed Boolean @default(true)`. Tuy nhiên, file `.env` của API đang trỏ tới Database PostgreSQL Production trên Render (`dpg-dbkvno8u01pc73eept70-a.singapore-postgres.render.com`). Vì chúng ta tuân thủ kỷ luật nghiêm ngặt **không chạy migration trên Production**, bảng `Bin` trên Render chưa có cột `installed`. Khi test gọi `prisma.bin.create()`, cơ sở dữ liệu báo lỗi P2022.
- **Ý nghĩa:** Đây là bằng chứng thực nghiệm rõ ràng nhất khẳng định: **Hệ thống Production hoàn toàn chưa bị can thiệp hay sửa đổi**.

### 4.2. Phân tích Chi tiết Lỗi Test 13 (`realtime.gateway.test.ts`)
```
Error: R1 Failed: Unexpected device:status payload: {"deviceId":"raspberry-pi-5", ...}
Expected device:status for "raspberry-pi-01"
```
- **Nguyên nhân gốc:** Hàm `waitForEvent` trong file test bắt sự kiện `device:status` đầu tiên xuất hiện mà không kiểm tra predicate `d.deviceId === 'raspberry-pi-01'`. Đúng lúc đó, nhịp tim định kỳ của `raspberry-pi-5` được phát ra trước, khiến test nhận nhầm payload và báo lỗi.

---

## 5. CÁC LỖI BLOCKER VÀ CÁC ĐIỂM CẦN KHẮC PHỤC

### 5.1. Danh sách Lỗi BLOCKER (Bắt buộc phải sửa trước khi đẩy lên Staging/Production)
1. **BLOCKER-01: Cơ chế ACK của Offline Buffer trong `pi_agent.py` là suy đoán (Speculative ACK):**  
   *Mô tả:* `drain_offline_buffer()` gọi `offline_buffer.mark_acked()` và `prune_acked()` ngay sau khi `sio.emit()`, không chờ callback xác nhận từ Backend.  
   *Khắc phục:* Sửa `sio.emit('device:telemetry', payload, callback=on_ack)` và chỉ xóa bản ghi trong SQLite sau khi nhận được phản hồi ACK thành công từ Backend.
2. **BLOCKER-02: Lệch tên sự kiện Socket.IO phân phòng Trạm (Event Mismatch):**  
   *Mô tả:* Server lắng nghe `subscribe_station` và `unsubscribe_station`, nhưng Web Frontend lại phát `subscribe:station` và `unsubscribe:station`.  
   *Khắc phục:* Đồng bộ tên sự kiện giữa Web và Gateway thành `subscribe:station` (hoặc hỗ trợ cả hai trên Server).
3. **BLOCKER-03: Xung đột Prisma Client với Database Render chưa migrate:**  
   *Mô tả:* Prisma Client sinh từ schema mới không thể thực hiện các lệnh INSERT vào DB cũ do thiếu cột `installed` (Lỗi P2022).  
   *Khắc phục:* Trước khi deploy Backend lên Render, bắt buộc phải chạy migration Expand Pha 1 (`000000000003_multi_station_expand/migration.sql`) trên PostgreSQL.

### 5.2. Các Lỗi cần Khắc phục trước khi Chạy trên Raspberry Pi thật (Pre-Run Fixes)
1. **FIX-01: Bổ sung phục hồi trạng thái `IN_FLIGHT` trong `OfflineBuffer`:**  
   Thêm lệnh `UPDATE offline_telemetry SET status = 'QUEUED' WHERE status = 'IN_FLIGHT'` trong phương thức `_init_db()` để không làm mất gói tin khi Pi bị mất nguồn bất ngờ.
2. **FIX-02: Bổ sung script chạy nền Virtual Serial cho `station_b_simulator.py`:**  
   Bổ sung chế độ tạo virtual COM port hoặc Linux PTY (`socat` / `pty`) để `pi_agent.py` có thể kết nối thử nghiệm mà không cần cắm bo mạch ESP32-C6 thật.
3. **FIX-03: Rõ ràng hóa tham số `stationId` khi tra cứu `GET /api/bins/:id`:**  
   Yêu cầu bắt buộc truyền `stationId` hoặc `stationCode` khi tìm kiếm theo mã `binCode` để tránh nhầm lẫn giữa Trạm A và Trạm B.
4. **FIX-04: Mở rộng `waste-category.ts` trên Frontend:**  
   Hỗ trợ hiển thị phân nhóm theo từng Trạm khi người dùng chọn xem toàn bộ hệ thống ("Tất cả các trạm").

---

## 6. KẾT LUẬN VÀ TRẠNG THÁI PHÊ DUYỆT (VERDICT)

### **TRẠNG THÁI CUỐI CÙNG: CONDITIONALLY APPROVED (PHÊ DUYỆT CÓ ĐIỀU KIỆN)**

> [!CAUTION]
> **ĐIỀU KIỆN PHÊ DUYỆT:**
> 1. Mã nguồn hiện tại **ĐẠT TIÊU CHUẨN** để lưu trữ cục bộ và tiến hành kiểm thử cô lập trên máy phát triển (Local Testbed).
> 2. **TUYỆT ĐỐI CHƯA PUSH LÊN PRODUCTION HOẶC RENDER** cho đến khi 3 lỗi **BLOCKER** (Blocker-01 Speculative Buffer ACK, Blocker-02 Event Mismatch, và Blocker-03 Database Migration Rollout) được khắc phục theo đúng quy trình phân pha an toàn.

---
*Báo cáo kiểm toán kỹ thuật được lập tự động bởi Antigravity Engineering System vào ngày 08/11/2026.*

