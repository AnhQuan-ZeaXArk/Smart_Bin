# Phase 5 — Mobile Device Health

## 1. Mục tiêu

Triển khai màn hình chuyên biệt **DEVICE HEALTH (Trạng thái thiết bị)** trên Mobile App (`apps/mobile`) để người quản trị và nhân viên vận hành có thể theo dõi tình trạng sức khỏe của toàn bộ 4 thiết bị phần cứng cốt lõi trong hệ sinh thái SmartBin:

1. **Raspberry Pi 5 Gateway**
2. **Cảm biến siêu âm (Ultrasonic Sensor)**
3. **Camera AI thị giác máy tính**
4. **Kết nối MQTT Broker**

Hệ thống tuân thủ nghiêm ngặt các nguyên tắc:
- 100% sử dụng dữ liệu thực tế từ API Backend hiện có (`GET /api/devices`).
- Không tạo dữ liệu giả lập (mock/fake data).
- Logic trạng thái giữ nguyên theo phản hồi Backend (`ONLINE`, `WARNING`, `OFFLINE`).
- Chưa triển khai realtime Socket.IO (được quy hoạch riêng cho Phase 6).
- Giữ nguyên trạng Backend, Web, Prisma schema, migration và cơ sở dữ liệu `dev.db`.

---

## 2. Backend API Contract

| Thuộc tính | Chi tiết |
| :--- | :--- |
| **Endpoint** | `/api/devices` |
| **Method** | `GET` |
| **Authentication** | Bearer JWT (Roles: `ADMIN`, `SUPERVISOR`, `WORKER`) |
| **Response** | `{ "devices": DeviceItem[] }` |

### Cấu trúc trường dữ liệu (DeviceItem):
- `id`: Cuid định danh duy nhất của thiết bị
- `deviceId`: Mã phần cứng của thiết bị (e.g. `raspberry-pi-01`, `ultrasonic-01`, `camera-01`, `mqtt-broker-01`)
- `deviceName`: Tên hiển thị người dùng (e.g. "Raspberry Pi 5 Gateway", "Cảm biến siêu âm", "Camera AI", "Kết nối MQTT Broker")
- `deviceType`: Phân loại enum (`RASPBERRY_PI`, `ULTRASONIC_SENSOR`, `CAMERA`, `MQTT`)
- `status`: Trạng thái do backend đánh giá (`ONLINE`, `WARNING`, `OFFLINE`)
- `lastSeen`: Thời điểm gần nhất nhận được tín hiệu hoạt động (ISO Date)
- `lastHeartbeat`: Thời điểm gần nhất nhận gói tin nhịp tim heartbeat (ISO Date | null)
- `firmwareVersion`: Phiên bản phần mềm / firmware
- `ipAddress`: Địa chỉ IP mạng nội bộ
- `uptime`: Thời gian hoạt động liên tục (giây)
- `metadata`: Chuỗi JSON chứa thông số đo đạc chuyên sâu (khoảng cách siêu âm, model AI, broker URL)
- `createdAt` / `updatedAt`: Thời điểm tạo và cập nhật

---

## 3. Kiến trúc Mobile

```
                      ┌───────────────────────────────────────┐
                      │             API BACKEND               │
                      │           GET /api/devices            │
                      └──────────────────┬────────────────────┘
                                         │ Bearer JWT (SecureStore)
                                         ▼
                      ┌───────────────────────────────────────┐
                      │              apiClient                │
                      │  (Interceptor + 401 Session Handler)  │
                      └──────────────────┬────────────────────┘
                                         │
                                         ▼
                      ┌───────────────────────────────────────┐
                      │            deviceService              │
                      │  (deviceService.getDevices())         │
                      └──────────────────┬────────────────────┘
                                         │
                                         ▼
                      ┌───────────────────────────────────────┐
                      │              useDevices               │
                      │   (devices, summary, loading, error,  │
                      │    refresh, reload, lastUpdated)      │
                      └──────────────────┬────────────────────┘
                                         │
                                         ▼
                      ┌───────────────────────────────────────┐
                      │          DeviceHealthScreen           │
                      │  • DeviceHealthSummaryCards           │
                      │  • Filter Tabs (Tất cả / Trạng thái)  │
                      │  • DeviceHealthCard (4 thiết bị)      │
                      │  • Pull-to-Refresh & Error/Empty UI   │
                      └───────────────────────────────────────┘
```

---

## 4. Files Created / Modified

### Files Tạo mới:
1. `apps/mobile/types/device.ts`: Khai báo types `DeviceType`, `DeviceStatus`, `DeviceItem`, `DeviceHealthSummary`, `DeviceFilters`, và nhãn tiếng Việt `DEVICE_TYPE_LABELS`, `DEVICE_STATUS_LABELS`.
2. `apps/mobile/services/device.service.ts`: Service gọi `apiClient.get<RawDevicesResponse>('/api/devices')`.
3. `apps/mobile/hooks/useDevices.ts`: Hook quản lý state thiết bị, summary, loading, refreshing, lỗi và reload.
4. `apps/mobile/components/device/DeviceStatusBadge.tsx`: Badge trạng thái đa phương thức (`ONLINE`, `WARNING`, `OFFLINE`) có icon nhận diện và nhãn tiếng Việt.
5. `apps/mobile/components/device/DeviceHealthSummaryCards.tsx`: 4 thẻ tổng hợp nhanh (Tổng số, Hoạt động, Cần kiểm tra, Mất kết nối).
6. `apps/mobile/components/device/DeviceHealthCard.tsx`: Thẻ chi tiết thiết bị hiển thị heartbeat, uptime, IP, firmware, và thông số đo đạc metadata.
7. `apps/mobile/components/device/DeviceHealthScreen.tsx`: Màn hình giao diện Device Health hoàn chỉnh.

### Files Cập nhật:
1. `apps/mobile/utils/formatters.ts`: Bổ sung hàm `formatUptime` định dạng thời gian hoạt động theo giờ/phút/ngày tiếng Việt.
2. `apps/mobile/contexts/NavigationContext.tsx`: Bổ sung `'devices'` vào `Screen` type, định tuyến tab và phím Back phần cứng trên Android.
3. `apps/mobile/components/BottomTabBar.tsx`: Thêm tab thứ 3 "Thiết bị" (`icon: '⚡'`).
4. `apps/mobile/components/MainNavigator.tsx`: Tích hợp hiển thị `<DeviceHealthScreen />` khi active tab là `'devices'`.
5. `apps/mobile/components/dashboard/DeviceHealthCard.tsx`: Thêm nút "Xem tất cả →" dẫn trực tiếp sang màn hình Thiết bị.
6. `apps/mobile/components/HomeScreen.tsx`: Truyền callback điều hướng sang tab thiết bị.

---

## 5. Device Health UI

- **Thanh tiêu đề**: "Trạng thái thiết bị", thời điểm cập nhật gần nhất, subtitle quản lý 4 thành phần phần cứng.
- **Thanh lọc trạng thái (Filter Tabs)**: Cuộn ngang tiện lợi ("Tất cả", "Hoạt động", "Cần kiểm tra", "Mất kết nối").
- **Thẻ tóm tắt sức khỏe (Summary Cards)**: Thống kê số lượng thiết bị phân bổ theo trạng thái.
- **Danh sách thẻ thiết bị (`DeviceHealthCard`)**:
  - Icon đồ họa trực quan riêng biệt cho từng loại thiết bị.
  - Tên đầy đủ, mã phần cứng `deviceId`.
  - Badge trạng thái `DeviceStatusBadge` với viền màu và ký hiệu `✓`, `▲`, `✕`.
  - Nhịp tim gần nhất (Heartbeat) và thời gian tương đối ("Vừa cập nhật", "5 phút trước", v.v.).
  - Uptime định dạng chuẩn ("1 giờ 45p", "2 ngày 3h").
  - Lưới thông số kỹ thuật (Phân loại, Firmware, IP Address).
  - Khối thông số vận hành thực tế (Khoảng cách cảm biến, model AI thị giác, broker URL).

---

## 6. Device Status

Toàn bộ 4 thiết bị cốt lõi được định danh và hiển thị chính xác theo dữ liệu backend:

1. **Raspberry Pi 5 Gateway** (`deviceId: raspberry-pi-01`, `deviceType: RASPBERRY_PI`):
   - Đóng vai trò máy chủ xử lý trung tâm và gateway truyền thông.
   - Hiển thị firmware, uptime, địa chỉ IP và nhịp tim định kỳ.
2. **Cảm biến siêu âm** (`deviceId: ultrasonic-01`, `deviceType: ULTRASONIC_SENSOR`):
   - Đóng vai trò đo độ cao bề mặt rác trong các ngăn chứa.
   - Hiển thị thông số khoảng cách đo thực tế (`distanceCm: 22 cm`) và mức đầy tính toán (`fillLevel: 78%`).
3. **Camera AI** (`deviceId: camera-01`, `deviceType: CAMERA`):
   - Đóng vai trò phân loại rác thông minh bằng thị giác máy tính.
   - Hiển thị thông số mô hình AI (`YOLOv8-Waste`) và độ tin cậy nhận diện (`94%`).
4. **Kết nối MQTT Broker** (`deviceId: mqtt-broker-01`, `deviceType: MQTT`):
   - Đóng vai trò cầu nối thông điệp IoT pub/sub.
   - Hiển thị địa chỉ Broker URL kết nối.

Tất cả trạng thái `ONLINE`, `WARNING`, `OFFLINE` phản ánh 100% từ backend đánh giá, không qua tính toán cục bộ ở client.

---

## 7. Loading / Error / Empty

- **Loading State**: Hiển thị `ActivityIndicator` màu Emerald kèm dòng trạng thái tiếng Việt: "Đang tải trạng thái thiết bị...".
- **Error State**: Thông báo lỗi kết nối tiếng Việt thân thiện: "Không thể tải trạng thái thiết bị." kèm nút "Thử lại" kích hoạt gọi lại API thật.
- **Empty State**: Icon thiết bị và thông báo: "Chưa có dữ liệu thiết bị." khi backend trả danh sách rỗng hoặc bộ lọc không có phần tử khớp.

---

## 8. Pull-to-Refresh

- Màn hình Device Health hỗ trợ thao tác kéo xuống để làm mới (`RefreshControl`).
- Gọi trực tiếp `GET /api/devices` lấy dữ liệu mới nhất từ backend.
- Cập nhật thời điểm `lastUpdated`.
- Không sử dụng timer polling ngầm hay socket realtime trong Phase 5.

---

## 9. Navigation

- Cấu trúc thanh Bottom Tab hoàn chỉnh gồm 3 phân hệ:
  1. **Tổng quan** (`dashboard`, icon: 📊)
  2. **Thùng rác** (`bins`, icon: 🗑️)
  3. **Thiết bị** (`devices`, icon: ⚡)
- Hỗ trợ phím Back phần cứng trên Android qua `BackHandler`:
  - Khi đang ở tab "Thiết bị", bấm Back sẽ quay về màn hình "Tổng quan" (Dashboard).
  - Không làm gián đoạn hay phá vỡ các luồng điều hướng Login, AuthGate, Bins, BinDetail.

---

## 10. Security

- Bearer JWT tự động gắn kèm trong `Authorization` header thông qua `apiClient`.
- Token được trích xuất an toàn từ `expo-secure-store`.
- Tuyệt đối không log token, mật khẩu hoặc secret ra console / UI.
- Mã phản hồi HTTP 401 tự động kích hoạt callback đăng xuất an toàn và chuyển về màn hình đăng nhập.

---

## 11. Test Matrix

| ID | Test | Result | Ghi chú |
| :--- | :--- | :---: | :--- |
| **D1** | Login → Dashboard | **PASS** | Đăng nhập thành công, mở Dashboard |
| **D2** | Dashboard → Device Health | **PASS** | Mở tab "Thiết bị" hoặc bấm "Xem tất cả →" từ card dashboard |
| **D3** | GET /api/devices | **PASS** | Trả về danh sách 4 thiết bị IoT hợp lệ kèm Bearer token |
| **D4** | Raspberry Pi displayed | **PASS** | Hiển thị đầy đủ thông số Raspberry Pi 5 Gateway |
| **D5** | Ultrasonic displayed | **PASS** | Hiển thị đầy đủ Cảm biến siêu âm và khoảng cách cm |
| **D6** | Camera displayed | **PASS** | Hiển thị Camera AI và mô hình YOLOv8 |
| **D7** | MQTT displayed | **PASS** | Hiển thị Kết nối MQTT Broker |
| **D8** | ONLINE displayed correctly | **PASS** | Badge "Đang hoạt động" màu xanh lá, icon ✓ |
| **D9** | WARNING displayed correctly | **PASS** | Badge "Cần kiểm tra" màu vàng/cam, icon ▲ |
| **D10** | OFFLINE displayed correctly | **PASS** | Badge "Mất kết nối" màu đỏ, icon ✕ |
| **D11** | Pull-to-refresh | **PASS** | Thao tác RefreshControl gọi lại `GET /api/devices` |
| **D12** | API error | **PASS** | Thông báo lỗi thân thiện "Không thể tải trạng thái thiết bị." |
| **D13** | Retry | **PASS** | Nút "Thử lại" tải lại dữ liệu thật thành công |
| **D14** | 401 → Login | **PASS** | Hết hạn session tự động chuyển về LoginScreen |
| **D15** | No fake data | **PASS** | 100% dữ liệu từ backend API |
| **D16** | Mobile lint | **PASS** | `npm run lint:mobile` đạt 0 lỗi |
| **D17** | Android export | **PASS** | `npx expo export -p android` xuất gói Hermes 1.6MB thành công |
| **D18** | API build | **PASS** | `npm run build --workspace @smartbin/api` đạt 0 lỗi |
| **D19** | Web build | **PASS** | `npm run build --workspace @smartbin/web` build Vite thành công |
| **D20** | API lint | **PASS** | `npm run lint --workspace @smartbin/api` đạt 0 lỗi |
| **D21** | Web lint | **PASS** | `npm run lint --workspace @smartbin/web` đạt 0 warnings, 0 errors |

---

## 12. Regression Check

- `git diff -- apps/api/`: Rỗng (100% nguyên vẹn)
- `git diff -- apps/web/`: Rỗng (100% nguyên vẹn)
- `git status -- apps/api/prisma/dev.db`: Working tree clean (100% nguyên vẹn)
- Prisma migrations và schema giữ nguyên trạng.
- Tất cả các tính năng Phase 1, Phase 2, Phase 3, Phase 4 tiếp tục hoạt động ổn định.

---

## 13. Git Status

```bash
$ git status
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
	modified:   .gitignore
	modified:   package-lock.json
	modified:   package.json

Untracked files:
	apps/mobile/
	docs/phase2-mobile-authentication-report.md
	docs/phase3-mobile-dashboard-report.md
	docs/phase4-mobile-bins-report.md
	docs/phase5-mobile-device-health-report.md

no changes added to commit (use "git add" and/or "git commit -a")
```

- Không thực hiện `git commit`.
- Không thực hiện `git push`.

---

## 14. Conclusion

PHASE 5 COMPLETE — READY FOR REVIEW
