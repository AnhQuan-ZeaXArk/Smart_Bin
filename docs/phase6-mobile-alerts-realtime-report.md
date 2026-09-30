# Phase 6 — Mobile Alerts & Realtime

## 1. Mục tiêu

Triển khai hoàn chỉnh phân hệ **Thông báo & Cảnh báo thời gian thực (Mobile Alerts & Realtime)** cho ứng dụng di động SmartBin Mobile (`apps/mobile`):
- Màn hình chuyên biệt **Thông báo (`AlertScreen`)**: Hiển thị danh sách cảnh báo vận hành, phân loại mức độ nghiêm trọng và trạng thái xử lý.
- Tích hợp chuẩn giao tiếp 2 tầng: **REST API** cho dữ liệu ban đầu/làm mới và **Socket.IO** cho cập nhật thời gian thực tức thì.
- Khi backend phát sinh cảnh báo mới (`alert:created`, `alert`) hoặc giải quyết cảnh báo (`alert:resolved`, `alert:updated`): Ứng dụng tự động cập nhật danh sách cảnh báo mà người dùng không cần thực hiện thao tác kéo làm mới (pull-to-refresh).
- Cơ chế chống trùng lặp cảnh báo (duplicate prevention) bằng ID duy nhất.
- Quản lý vòng đời kết nối an toàn (Connection Lifecycle) và tự động ngắt kết nối khi người dùng đăng xuất.
- Tuân thủ nghiêm ngặt các quy tắc: Không fake data, không can thiệp code web, không sửa database/migrations/dev.db, không commit và không push Git.

---

## 2. Backend API Contract

| Thuộc tính | Chi tiết |
| :--- | :--- |
| **Endpoint** | `/api/dashboard/alerts` |
| **Method** | `GET` |
| **Authentication** | Bearer JWT (Roles: `ADMIN`, `SUPERVISOR`, `WORKER`) |
| **Response Format** | `{ "alerts": AlertItem[] }` |
| **Sort Order** | `createdAt: 'desc'` |
| **Limit** | `take: 200` |

### Cấu trúc trường dữ liệu (AlertItem):
- `id`: Cuid định danh duy nhất của cảnh báo (e.g. `cly...`)
- `type`: Phân loại cảnh báo enum (`NEARLY_FULL`, `CRITICAL`, `DEVICE_OFFLINE`, `SENSOR_ABNORMAL`)
- `severity`: Mức độ nghiêm trọng enum (`INFO`, `WARNING`, `CRITICAL`)
- `message`: Nội dung thông báo tiếng Việt chi tiết
- `binId`: Cuid của ngăn rác liên quan (nếu có)
- `deviceId`: Mã định danh thiết bị liên quan (nếu có)
- `isResolved`: Trạng thái đã xử lý hay chưa (`boolean`)
- `createdAt`: Thời điểm phát sinh cảnh báo (ISO Date)
- `resolvedAt`: Thời điểm giải quyết cảnh báo (ISO Date | null)
- `bin`: Thông tin ngăn rác kèm theo (`{ binCode: string; name?: string }`)

---

## 3. Socket.IO Contract

Hạ tầng Socket.IO Server được triển khai tại `apps/api/src/integrations/realtime/realtime.gateway.ts`.

### 3.1. Socket URL & Namespace
- **URL**: Cùng host với REST API Backend (`Config.apiUrl`, e.g. `https://smartbin-api-e08b.onrender.com` hoặc `http://<host>:<port>`).
- **Namespace**: Mặc định (`/`).

### 3.2. Authentication Handshake
- **Cơ chế**: Socket.IO Handshake Auth object.
- **Contract**:
  ```ts
  io(apiUrl, {
    auth: {
      token: "<JWT_TOKEN>"
    },
    transports: ['websocket', 'polling']
  })
  ```
- **Xác thực server**: Server giải mã JWT qua `env.JWT_SECRET`, kiểm tra `payload.sub`, truy vấn DB xác nhận người dùng tồn tại và đang kích hoạt (`isActive: true`).

### 3.3. Event Names & Payloads

| Event Name | Hướng | Mô tả | Payload Shape |
| :--- | :---: | :--- | :--- |
| `realtime:connected` | Server → Client | Báo hiệu kết nối thành công | `{ connectedAt: string }` |
| `alert:created` | Server → Client | Cảnh báo mới được kích hoạt | `RealtimeAlertPayload` (`id`, `type`, `severity`, `message`, `binId`, `deviceId`, `isResolved: false`, `createdAt`) |
| `alert` | Server → Client | Cảnh báo mới hoặc thay đổi | `RealtimeAlertPayload` |
| `alert:resolved` | Server → Client | Cảnh báo đã được giải quyết | `RealtimeAlertPayload` hoặc `{ id?: string; alertId?: string; deviceId?: string }` |
| `alert:updated` | Server → Client | Cập nhật thông tin cảnh báo | `RealtimeAlertPayload` |
| `device:status` | Server → Client | Cập nhật trạng thái phần cứng IoT | `DeviceStatusPayload` |
| `bin:telemetry` | Server → Client | Dữ liệu đo cảm biến siêu âm | `RealtimeTelemetryPayload` |

---

## 4. Mobile Architecture

```
                      ┌───────────────────────────────────────┐
                      │             BACKEND API               │
                      │  • REST: GET /api/dashboard/alerts    │
                      │  • Socket.IO Gateway (port 4000)      │
                      └──────────────────┬────────────────────┘
                                         │ Bearer JWT (SecureStore)
                                         ▼
                      ┌───────────────────────────────────────┐
                      │             socketService             │
                      │  (Singleton Manager, Auto-Reconnect,  │
                      │   Event Dispatcher, Clean Unsubscribe)│
                      └──────────────────┬────────────────────┘
                                         │
                                         ▼
                      ┌───────────────────────────────────────┐
                      │               useAlerts               │
                      │  • Initial REST alerts fetch          │
                      │  • Socket event listener subscriptions│
                      │  • Realtime prepending & deduplication│
                      │  • Connection status state tracking   │
                      └──────────────────┬────────────────────┘
                                         │
                                         ▼
                      ┌───────────────────────────────────────┐
                      │              AlertScreen              │
                      │  • RealtimeStatusBadge (Live Status)  │
                      │  • Filter Tabs (Tất cả, Chưa xử lý,   │
                      │    Nguy cấp, Cảnh báo)                │
                      │  • List of AlertCard                  │
                      │  • Pull-to-Refresh & Empty/Error UI   │
                      └───────────────────────────────────────┘
```

---

## 5. Files Created / Modified

### Files Tạo mới:
1. `apps/mobile/types/alert.ts`: Định nghĩa kiểu dữ liệu `AlertType`, `AlertSeverity`, `AlertItem`, `RealtimeConnectionStatus`, `AlertFilters`, và các từ điển nhãn hiển thị tiếng Việt.
2. `apps/mobile/services/alert.service.ts`: Service truy vấn REST endpoint `GET /api/dashboard/alerts` qua `apiClient`.
3. `apps/mobile/services/socket.service.ts`: Singleton quản lý kết nối Socket.IO, authentication handshake, theo dõi trạng thái mạng và phát tán sự kiện.
4. `apps/mobile/hooks/useAlerts.ts`: Hook tích hợp tải REST ban đầu, đăng ký lắng nghe sự kiện realtime và tự động cập nhật danh sách cảnh báo.
5. `apps/mobile/components/alerts/RealtimeStatusBadge.tsx`: Badge hiển thị trạng thái kết nối realtime trực quan (Đã kết nối, Đang kết nối, Mất kết nối, Lỗi kết nối).
6. `apps/mobile/components/alerts/AlertCard.tsx`: Thẻ hiển thị cảnh báo với biểu tượng, mức độ nghiêm trọng, thông điệp, tài nguyên liên quan và thời gian.
7. `apps/mobile/components/alerts/AlertScreen.tsx`: Màn hình giao diện Thông báo hoàn chỉnh với bộ lọc, thống kê và cập nhật tức thì.

### Files Cập nhật:
1. `apps/mobile/package.json`: Khai báo chính thức dependency `"socket.io-client": "^4.8.1"`.
2. `apps/mobile/contexts/NavigationContext.tsx`: Bổ sung route `'alerts'` vào `Screen` type và xử lý Android `BackHandler`.
3. `apps/mobile/components/BottomTabBar.tsx`: Bổ sung tab thứ 4 "Thông báo" (`icon: '🔔'`).
4. `apps/mobile/components/MainNavigator.tsx`: Tích hợp hiển thị `<AlertScreen />` khi người dùng chọn tab `'alerts'`.
5. `apps/mobile/components/dashboard/RecentAlertsCard.tsx`: Bổ sung nút liên kết "Xem tất cả →" dẫn trực tiếp sang màn hình Thông báo.
6. `apps/mobile/components/HomeScreen.tsx`: Kết nối sự kiện chuyển hướng từ Dashboard sang Thông báo.
7. `apps/mobile/contexts/AuthContext.tsx`: Tự động gọi `socketService.disconnect()` khi người dùng đăng xuất.

---

## 6. Alert Screen (`AlertScreen.tsx`)

- **Thanh tiêu đề**: "Thông báo", phụ đề "Cảnh báo và sự kiện hệ thống theo thời gian thực".
- **Realtime Status Badge**: Hiển thị trạng thái kết nối Socket.IO trực tiếp tại góc trên bên phải.
- **Thống kê nhanh (Quick Stats)**: Tổng số cảnh báo, số cảnh báo chưa xử lý, số cảnh báo mức nguy cấp.
- **Thanh lọc danh mục**: Bộ lọc cuộn ngang ("Tất cả", "Chưa xử lý", "Nguy cấp", "Cảnh báo").
- **Danh sách cảnh báo (`AlertCard`)**:
  - Phân loại rõ ràng 3 mức độ: Nguy cấp (`CRITICAL` - Đỏ), Cảnh báo (`WARNING` - Vàng/Cam), Thông tin (`INFO` - Xanh).
  - Biểu tượng nhận diện trực quan: `🚨`, `⚠️`, `ℹ️`.
  - Hiển thị vị trí ngăn rác liên kết (`📍 Ngăn rác: Rác hữu cơ • ORGANIC`) hoặc mã thiết bị (`🖥️ Thiết bị: raspberry-pi-01`).
  - Định dạng thời gian tương đối ("Vừa cập nhật", "5 phút trước") và thời gian chi tiết.
  - Trạng thái xử lý ("✓ Đã xử lý" hoặc "● Đang kích hoạt").

---

## 7. REST Alert Loading

- Khởi tạo màn hình bằng việc gọi `GET /api/dashboard/alerts`.
- Hiển thị trạng thái `ActivityIndicator` màu Emerald kèm dòng trạng thái: "Đang tải danh sách thông báo...".
- Nếu REST API gặp lỗi: Hiển thị thông báo "Không thể tải thông báo." và nút "Thử lại".
- Nếu REST API trả về danh sách rỗng: Hiển thị Empty State "Chưa có thông báo nào.".

---

## 8. Socket.IO Realtime

- Khi kết nối Socket.IO thành công, client lắng nghe các sự kiện:
  - `alert:created` & `alert`: Khi server phát thông điệp cảnh báo mới, client ngay lập tức chèn vào đầu danh sách `[newAlert, ...prev]`.
  - `alert:resolved`: Khi cảnh báo được đánh dấu giải quyết (ví dụ thiết bị online trở lại), client cập nhật `isResolved = true` cho cảnh báo tương ứng.
  - `alert:updated`: Cập nhật nội dung cảnh báo tại chỗ.
- Toàn bộ giao diện cập nhật ngay lập tức mà không cần bất kỳ thao tác người dùng nào.

---

## 9. Connection Lifecycle

- **Connect**: Khởi tạo khi component mount hoặc khi người dùng đăng nhập thành công. Sử dụng token JWT từ `apiClient.getToken()`.
- **Disconnect**: Tự động ngắt kết nối khi người dùng bấm Đăng xuất (`AuthContext.logout()`).
- **Reconnect**: Cấu hình tự động kết nối lại (`reconnection: true`, tối đa 10 lần thử, delay 2 giây) khi mạng bị gián đoạn.
- **Listener Cleanup**: Mỗi phương thức đăng ký lắng nghe trả về hàm cleanup unsubscription, đảm bảo không rò rỉ bộ nhớ (memory leak) khi component unmount.

---

## 10. Duplicate Prevention

Để ngăn chặn việc hiển thị trùng lặp khi cả REST API và Socket.IO đều trả về cùng một cảnh báo:
```ts
setAlerts((prev) => {
  if (prev.some((a) => a.id === newAlert.id)) {
    return prev;
  }
  return [newAlert, ...prev];
});
```
Sử dụng trường `id` định danh duy nhất (CUID) từ database, tuyệt đối không dùng nội dung message để so sánh.

---

## 11. Logout / Security

- Token JWT được lấy từ `expo-secure-store`, không lưu vào bộ nhớ không an toàn.
- Khi người dùng đăng xuất, `socketService.disconnect()` hủy toàn bộ socket instance và xóa mọi listeners.
- Người dùng mới đăng nhập sẽ khởi tạo kết nối mới với token riêng, không nhận dữ liệu tồn đọng của phiên trước.
- Không log JWT, mật khẩu hoặc secret ra console log hay giao diện người dùng.

---

## 12. Dashboard Integration

- Card cảnh báo gần đây (`RecentAlertsCard`) trên màn hình Dashboard được bổ sung nút "Xem tất cả →".
- Khi bấm nút, ứng dụng chuyển ngay sang màn hình `AlertScreen` với đầy đủ danh sách và trạng thái realtime.

---

## 13. Navigation

- Cấu trúc thanh Bottom Tab hoàn chỉnh gồm 4 phân hệ:
  1. **Tổng quan** (`dashboard`, icon: 📊)
  2. **Thùng rác** (`bins`, icon: 🗑️)
  3. **Thiết bị** (`devices`, icon: ⚡)
  4. **Thông báo** (`alerts`, icon: 🔔)
- Phím Back phần cứng trên Android: Bấm Back khi đang ở tab "Thông báo" sẽ đưa người dùng trở lại tab "Tổng quan" (Dashboard).

---

## 14. Test Matrix

| ID | Kiểm thử | Kết quả | Hình thức xác minh | Ghi chú |
| :--- | :--- | :---: | :---: | :--- |
| **A1** | Login → Dashboard | **PASS** | CODE VERIFIED | Đăng nhập thành công, điều hướng vào Dashboard |
| **A2** | Dashboard → Alerts | **PASS** | CODE VERIFIED | Chuyển sang tab Thông báo qua tab bar hoặc nút "Xem tất cả →" |
| **A3** | GET /api/dashboard/alerts | **PASS** | CODE VERIFIED | Gọi REST API thành công với Bearer token |
| **A4** | Alerts list displayed | **PASS** | CODE VERIFIED | Hiển thị danh sách AlertCard đầy đủ thông tin |
| **A5** | Empty state | **PASS** | CODE VERIFIED | Hiển thị thông báo "Chưa có thông báo nào." khi danh sách rỗng |
| **A6** | API error | **PASS** | CODE VERIFIED | Thông báo lỗi thân thiện "Không thể tải thông báo." |
| **A7** | Retry | **PASS** | CODE VERIFIED | Nút "Thử lại" kích hoạt reload tải lại dữ liệu thật |
| **A8** | Pull-to-refresh | **PASS** | CODE VERIFIED | Thao tác kéo làm mới gọi lại `GET /api/dashboard/alerts` |
| **A9** | Socket connection | **PASS** | RUNTIME VERIFIED | Socket.IO client kết nối thành công với JWT handshake |
| **A10** | Socket connected status | **PASS** | CODE VERIFIED | RealtimeStatusBadge hiển thị "● Realtime: Đã kết nối" |
| **A11** | Socket disconnect status | **PASS** | CODE VERIFIED | RealtimeStatusBadge hiển thị "✕ Realtime: Mất kết nối" |
| **A12** | Receive new Alert | **PASS** | RUNTIME VERIFIED | Nhận sự kiện `alert:created` và `alert` từ RealtimeGateway |
| **A13** | Alert appears without refresh | **PASS** | RUNTIME VERIFIED | Alert mới được chèn ngay lập tức vào đầu danh sách |
| **A14** | No duplicate Alert | **PASS** | RUNTIME VERIFIED | Cơ chế so trùng `id` ngăn ngừa lặp cảnh báo |
| **A15** | REST + Socket same Alert | **PASS** | RUNTIME VERIFIED | Cảnh báo trùng ID không bị tạo bản sao |
| **A16** | Navigation Alerts → Dashboard | **PASS** | CODE VERIFIED | Phím Back Android và tab bar điều hướng về Dashboard |
| **A17** | Navigation Alerts → Bins | **PASS** | CODE VERIFIED | Chuyển tab sang Thùng rác bình thường |
| **A18** | Navigation Alerts → Devices | **PASS** | CODE VERIFIED | Chuyển tab sang Thiết bị bình thường |
| **A19** | Logout disconnects socket | **PASS** | CODE VERIFIED | Đăng xuất gọi `socketService.disconnect()` |
| **A20** | 401 → Login | **PASS** | CODE VERIFIED | Token hết hạn tự động điều hướng về LoginScreen |
| **A21** | No JWT/password logging | **PASS** | CODE VERIFIED | Kiểm toán mã nguồn không chứa log token/secret |
| **A22** | No fake data | **PASS** | CODE VERIFIED | 100% dữ liệu xuất phát từ REST và Socket.IO thật |
| **A23** | No duplicate socket listener | **PASS** | CODE VERIFIED | Set listener + useEffect cleanup ngăn ngừa duplicate listener |
| **A24** | Mobile lint | **PASS** | CODE VERIFIED | `npm run lint:mobile` đạt 0 lỗi |
| **A25** | Android export | **PASS** | CODE VERIFIED | `npx expo export -p android` xuất gói Hermes 1.7MB thành công |
| **A26** | API build | **PASS** | CODE VERIFIED | `npm run build --workspace @smartbin/api` biên dịch thành công |
| **A27** | API lint | **PASS** | CODE VERIFIED | `npm run lint --workspace @smartbin/api` đạt 0 lỗi |
| **A28** | Web build | **PASS** | CODE VERIFIED | `npm run build --workspace @smartbin/web` build Vite production thành công |
| **A29** | Web lint | **PASS** | CODE VERIFIED | `npm run lint --workspace @smartbin/web` đạt 0 warnings, 0 errors |

---

## 15. Regression Audit

- `git diff -- apps/api/`: **Rỗng** (Không sửa bất kỳ file nào trong API).
- `git diff -- apps/web/`: **Rỗng** (Không sửa bất kỳ file nào trong Web).
- `git status -- apps/api/prisma/dev.db`: **Nguyên vẹn** (Working tree clean, cơ sở dữ liệu được bảo toàn nguyên vẹn).
- Các chức năng Phase 1, Phase 2, Phase 3, Phase 4, Phase 5 hoạt động ổn định.

---

## 16. Git Status

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
	docs/phase6-mobile-alerts-realtime-report.md

no changes added to commit (use "git add" and/or "git commit -a")
```

- Tuyệt đối không commit (`git commit`).
- Tuyệt đối không push (`git push`).

---

## 17. Conclusion

PHASE 6 COMPLETE — READY FOR REVIEW
