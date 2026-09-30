# BÁO CÁO KỸ THUẬT PHASE 4 — SMARTBIN MOBILE BINS & BIN DETAIL

## 1. Mục tiêu
Triển khai hoàn chỉnh phân hệ Quản lý Thùng rác (Bins) & Chi tiết thùng rác (Bin Detail) cho ứng dụng di động SmartBin Mobile (`apps/mobile`):
- Màn hình danh sách thùng rác (`BinsScreen`): Liệt kê đầy đủ các thùng rác thực tế từ API backend với bộ lọc theo loại rác và thống kê nhanh.
- Màn hình chi tiết thùng rác (`BinDetailScreen`): Hiển thị thông số dung tích, vị trí, mức đầy hiện tại, khoảng cách đo cảm biến siêu âm, thông tin thiết bị IoT, cảnh báo liên quan.
- Lịch sử đo cảm biến (`SensorHistoryCard`): Hiển thị lịch sử các lần đo thực tế từ cảm biến siêu âm (`GET /api/dashboard/sensor-readings?binCode=...`).
- Kiến trúc điều hướng mượt mà: Dashboard → Bins → BinDetail → Back, tích hợp phím Back phần cứng trên Android (`BackHandler`).
- Tuyệt đối tuân thủ nguyên tắc: Không mock/fake data, không hard-code mức đầy, không sửa schema/migration/dev.db của backend, không can thiệp code web.

---

## 2. Backend API Contract

| Endpoint | Method | Auth | Parameters | Response Shape | Mục đích |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/bins` | `GET` | Bearer JWT (Role: ADMIN, SUPERVISOR, WORKER) | Query: `status`, `search`, `fillCategory` | `{ bins: Bin[] }` | Lấy toàn bộ danh sách thùng rác đang kích hoạt (`isActive: true`), kèm `fillCategory` tính toán động từ backend |
| `/api/bins/:id` | `GET` | Bearer JWT (Role: ADMIN, SUPERVISOR, WORKER) | Path: `id` (cuid) | `{ bin: Bin }` | Lấy chi tiết thông số cấu hình của 1 thùng rác theo ID |
| `/api/dashboard/sensor-readings` | `GET` | Bearer JWT (Role: ADMIN, SUPERVISOR, WORKER) | Query: `binCode`, `from`, `to`, `fillMin`, `fillMax` | `{ readings: SensorReadingItem[] }` | Lấy danh sách lịch sử đo siêu âm và mức đầy sắp xếp giảm dần theo thời gian (`take: 200`) |
| `/api/dashboard/alerts` | `GET` | Bearer JWT (Role: ADMIN, SUPERVISOR, WORKER) | None | `{ alerts: DashboardAlert[] }` | Lấy danh sách cảnh báo vận hành để liên kết hiển thị cho từng thùng rác tương ứng |
| `/api/devices` | `GET` | Bearer JWT (Role: ADMIN, SUPERVISOR, WORKER) | None | `{ devices: DashboardDevice[] }` | Lấy tình trạng hoạt động của các thiết bị IoT liên kết (Cảm biến siêu âm, Raspberry Pi Gateway) |

---

## 3. Bin Data Model

Mô hình dữ liệu `Bin` trong Prisma schema (`apps/api/prisma/schema.prisma`):
- **Bản chất Entity**: Mỗi bản ghi `Bin` đại diện cho một **ngăn lưu trữ chuyên biệt** thuộc trạm SmartBin tập trung.
- **Mã phân loại (`binCode`)**: Có 3 giá trị chuẩn tương ứng 3 ngăn:
  - `ORGANIC`: Rác hữu cơ
  - `RECYCLABLE`: Rác tái chế
  - `NON_RECYCLABLE`: Rác không tái chế
- **Các trường dữ liệu cốt lõi**:
  - `id`: Cuid định danh duy nhất
  - `binCode`: Chuỗi mã định danh duy nhất (`ORGANIC` / `RECYCLABLE` / `NON_RECYCLABLE`)
  - `name`: Tên tiếng Việt hiển thị ("Rác hữu cơ", "Rác tái chế", "Rác không tái chế")
  - `location`: Vị trí đặt ngăn chứa rác
  - `capacity`: Dung tích ngăn chứa (Lít, e.g. 240L, 360L)
  - `currentFillLevel`: Tỷ lệ phần trăm rác hiện tại (0 – 100%)
  - `status`: Enum `ONLINE` | `OFFLINE` | `MAINTENANCE`
  - `isActive`: Boolean xác định trạng thái kích hoạt của thùng
  - `lastSeen`: Thời điểm gần nhất nhận được tín hiệu đo cảm biến
  - `latitude`, `longitude`: Tọa độ GPS trạm rác
- **Quy tắc phân loại mức đầy (`fillCategory`) từ backend**:
  - `currentFillLevel <= 50%`: `NORMAL` (Bình thường - Xanh lá)
  - `currentFillLevel <= 75%`: `MONITOR` (Cần chú ý - Vàng)
  - `currentFillLevel <= 90%`: `NEARLY_FULL` (Gần đầy - Cam)
  - `currentFillLevel > 90%`: `CRITICAL` (Mức nguy hiểm / Đầy - Đỏ)

---

## 4. Web API Mapping

- Khảo sát ứng dụng Web (`apps/web/src/bins.tsx`):
  - Web hiện sử dụng giao diện phân loại 3 ngăn (`ORGANIC`, `RECYCLABLE`, `NON_RECYCLABLE`) với các threshold màu sắc và nhãn trạng thái tương đồng.
  - Phân hệ Mobile Phase 4 tái hiện đầy đủ và nhất quán các phân loại tiếng Việt:
    - `ORGANIC` → "Rác hữu cơ"
    - `RECYCLABLE` → "Rác tái chế"
    - `NON_RECYCLABLE` → "Rác không tái chế"
  - Khác với Web dùng demo tĩnh, Mobile kết nối 100% dữ liệu thực từ backend API qua `apiClient` bảo mật Bearer JWT.

---

## 5. Mobile Navigation Architecture

- **Giải pháp**: Xây dựng Typed Stack & Tab Navigation nội bộ trên React Native core primitives (`NavigationContext`), tương thích 100% với Expo SDK 57 và React 19 mà không làm phát sinh peer-dependency conflicts.
- **Hỗ trợ đầy đủ luồng di chuyển**:
  1. `Dashboard` → `Bins`: Chuyển qua Bottom Tab bar hoặc nút "Xem tất cả →" trên card mức đầy.
  2. `Dashboard` → `BinDetail`: Bấm trực tiếp vào từng ngăn rác tại Dashboard.
  3. `Bins` → `BinDetail`: Bấm vào bất kỳ thẻ thùng rác nào trong danh sách.
  4. `BinDetail` → `Back`: Bấm nút "← Quay lại" tại thanh tiêu đề hoặc nhấn phím Back phần cứng trên Android.
- **Tích hợp Android `BackHandler`**:
  - Khi đang ở `bin-detail`: Nhấn Back quay về màn hình trước đó (`bins` hoặc `dashboard`).
  - Khi đang ở `bins`: Nhấn Back quay về `dashboard`.
  - Khi đang ở `dashboard`: Hệ thống Android xử lý thu nhỏ ứng dụng theo chuẩn nền tảng.

---

## 6. Bins Screen (`BinsScreen.tsx`)

- **Thanh tiêu đề**: "Thùng rác", kèm thông tin quản lý hệ thống 3 ngăn SmartBin.
- **Thống kê nhanh (Quick Stats)**: Tổng số ngăn, số ngăn trực tuyến (`ONLINE`), số ngăn cần thu gom (`NEARLY_FULL` / `CRITICAL`).
- **Bộ lọc danh mục**: Thanh lọc cuộn ngang ("Tất cả", "Hữu cơ", "Tái chế", "Không tái chế").
- **Thẻ thùng rác (`BinCard`)**:
  - Tên tiếng Việt và mã phân loại (`binCode`).
  - Vị trí đặt và dung tích danh định (`240L`, `360L`).
  - Mức đầy và thanh tiến trình trực quan (`BinFillIndicator`).
  - Trạng thái kết nối (`BinStatusBadge`).
  - Khoảng cách đo siêu âm nếu có.
  - Thời gian cập nhật định dạng tiếng Việt tương đối ("Vừa cập nhật", "5 phút trước", v.v.).
- **Tương tác**: Kéo xuống để làm mới (Pull-to-Refresh), bấm vào thẻ để mở màn hình chi tiết.

---

## 7. Bin Detail Screen (`BinDetailScreen.tsx`)

- **Thanh điều hướng đỉnh trang**: Nút "← Quay lại" rõ ràng, hỗ trợ thao tác một tay.
- **Khối tổng quan ngăn rác**: Tên ngăn, mã ngăn, trạng thái hoạt động trực tuyến/ngoại tuyến.
- **Khối đo mức độ đầy**: Gauge kích thước lớn với tỷ lệ phần trăm (0–100%), thanh tiến trình và nhãn trạng thái mức đầy.
- **Khối cảm biến siêu âm**:
  - Khoảng cách đo thực tế đến bề mặt rác (`distanceCm` cm).
  - Dung tích ngăn chứa (`capacity` L).
- **Khối thông số chi tiết**: Vị trí trạm, tọa độ GPS (hoặc mặc định nếu chưa gán), trạng thái vận hành, thời điểm cập nhật chi tiết (`formatDateTime` và `formatRelativeTime`).
- **Khối cảnh báo liên quan**: Liệt kê các cảnh báo chưa giải quyết liên quan đến thùng rác hiện tại.
- **Khối lịch sử cảm biến**: Bảng theo dõi các lần đo từ thiết bị IoT.

---

## 8. Sensor History (`SensorHistoryCard.tsx`)

- **Nguồn dữ liệu**: Gọi API thực tế `GET /api/dashboard/sensor-readings?binCode=<binCode>`.
- **Thông tin hiển thị cho từng bản ghi**:
  - Thời gian đo: Định dạng `HH:mm:ss DD/MM/YYYY`.
  - Khoảng cách siêu âm: `distance` cm.
  - Mức đầy: `fillLevel` %.
  - Badge trạng thái: Màu sắc theo phân ngưỡng (Bình thường / Cần chú ý / Gần đầy / Đầy).
- **Trạng thái rỗng**: "Chưa có bản ghi đo cảm biến nào." khi chưa có dữ liệu đo.

---

## 9. Components

| Component | Đường dẫn | Chức năng |
| :--- | :--- | :--- |
| `BinStatusBadge` | `apps/mobile/components/bins/BinStatusBadge.tsx` | Hiển thị badge trạng thái kết nối (`ONLINE`/`OFFLINE`) và mức đầy (`NORMAL`/`MONITOR`/`NEARLY_FULL`/`CRITICAL`) |
| `BinFillIndicator` | `apps/mobile/components/bins/BinFillIndicator.tsx` | Hiển thị tỷ lệ phần trăm mức đầy, thanh tiến trình màu sắc và nhãn phân loại |
| `BinCard` | `apps/mobile/components/bins/BinCard.tsx` | Thẻ hiển thị tóm tắt thông tin thùng rác trong danh sách |
| `SensorHistoryCard` | `apps/mobile/components/bins/SensorHistoryCard.tsx` | Bảng hiển thị lịch sử đo đạc từ cảm biến siêu âm IoT |
| `BinsScreen` | `apps/mobile/components/bins/BinsScreen.tsx` | Màn hình danh sách thùng rác với bộ lọc, thống kê và danh sách thẻ |
| `BinDetailScreen` | `apps/mobile/components/bins/BinDetailScreen.tsx` | Màn hình chi tiết toàn diện của một ngăn rác |
| `BottomTabBar` | `apps/mobile/components/BottomTabBar.tsx` | Thanh điều hướng dưới đáy giữa Tổng quan (Dashboard) và Thùng rác (Bins) |
| `MainNavigator` | `apps/mobile/components/MainNavigator.tsx` | Bộ chuyển đổi màn hình và quản lý thanh Bottom Tab |

---

## 10. Services (`apps/mobile/services/bin.service.ts`)

- `getBins(filters?: BinFilters): Promise<Bin[]>`: Truy vấn danh sách thùng rác kèm bộ lọc `status`, `search`, `fillCategory`.
- `getBinById(id: string): Promise<Bin>`: Lấy chi tiết thông số của 1 thùng rác theo CUID.
- `getSensorReadings(binCode?: string): Promise<SensorReadingItem[]>`: Lấy lịch sử đo cảm biến theo mã ngăn.
- `getAlerts(binId?: string, binCode?: string): Promise<DashboardAlert[]>`: Lấy cảnh báo hệ thống lọc theo thùng rác.
- `getBinDetail(id: string, binCode?: string): Promise<BinDetailData>`: Sử dụng `Promise.allSettled` gọi đồng thời các endpoint chi tiết, ghép nối khoảng cách siêu âm mới nhất và cảnh báo liên quan.

---

## 11. Hooks

- `useBins(initialFilters?: BinFilters)`: Quản lý danh sách thùng rác, trạng thái loading, refreshing, error, hàm `refresh` và `reload`.
- `useBinDetail(binId: string, binCode?: string)`: Quản lý dữ liệu chi tiết thùng rác, lịch sử cảm biến và cảnh báo liên quan.
- `useNavigation()`: Cung cấp API điều hướng `navigate`, `goBack`, `currentScreen`, `params`, `canGoBack`.

---

## 12. Types (`apps/mobile/types/bin.ts`)

- Khai báo chuẩn TypeScript phản ánh chính xác backend DTO:
  - `WasteCompartmentKey`: `'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE'`
  - `Bin`: Toàn bộ các trường từ Prisma `Bin` kèm `fillCategory` và `distanceCm`
  - `BinDetailData`: `{ bin, sensorReadings, alerts, lastUpdated }`
  - `BinFilters`: `{ status?, search?, fillCategory? }`
- Không sử dụng `any`, xử lý đầy đủ các trường `null` và `optional`.

---

## 13. Loading / Error / Empty / Refresh

- **Loading State**: Hiển thị `ActivityIndicator` màu Emerald kèm thông báo tiếng Việt ("Đang tải danh sách thùng rác...", "Đang tải dữ liệu thùng rác...").
- **Error State**: Thông báo lỗi rõ ràng ("Không thể tải danh sách thùng rác.", "Không thể tải thông tin thùng rác.") kèm nút "Thử lại" (`reload`).
- **Empty State**: Icon thùng rác và dòng thông báo "Chưa có thùng rác nào.", không xem đây là lỗi.
- **Pull-to-Refresh**: Tích hợp `RefreshControl` trên cả màn hình danh sách và màn hình chi tiết, cho phép cập nhật thủ công tức thì.

---

## 14. Bảo mật (Security)

- Mọi API request đều đi qua lớp `apiClient` tự động chèn header `Authorization: Bearer <token>` lấy từ `expo-secure-store`.
- Tuyệt đối không log token, mật khẩu hoặc dữ liệu nhạy cảm ra màn hình hay console.
- Cơ chế bắt mã phản hồi 401 tự động kích hoạt phiên đăng xuất an toàn và điều hướng người dùng về màn hình đăng nhập.

---

## 15. Test Matrix (B1 – B25)

| Mã kiểm thử | Nội dung kiểm thử | Kết quả | Ghi chú |
| :--- | :--- | :--- | :--- |
| **B1** | Login → Dashboard | **PASS** | Đăng nhập thành công, tự động chuyển vào Dashboard |
| **B2** | Dashboard → Bins | **PASS** | Chuyển qua tab "Thùng rác" hoặc nút "Xem tất cả →" |
| **B3** | Bins API request thành công | **PASS** | Gọi `GET /api/bins` thành công |
| **B4** | Danh sách bins hiển thị đúng | **PASS** | Hiển thị 3 ngăn rác (`ORGANIC`, `RECYCLABLE`, `NON_RECYCLABLE`) |
| **B5** | Fill level đúng API | **PASS** | Khớp chính xác giá trị `currentFillLevel` từ DB (25%, 58%, 78%) |
| **B6** | Status đúng backend | **PASS** | Hiển thị đúng status `ONLINE` và `fillCategory` từ backend |
| **B7** | Empty state | **PASS** | Hiển thị "Chưa có thùng rác nào." khi danh sách rỗng |
| **B8** | Error state | **PASS** | Hiển thị thông báo lỗi thân thiện khi API mất kết nối |
| **B9** | Retry | **PASS** | Nút "Thử lại" gọi hàm reload tải lại dữ liệu |
| **B10** | Pull-to-refresh | **PASS** | `RefreshControl` hoạt động mượt mà |
| **B11** | Bấm Bin → Bin Detail | **PASS** | Điều hướng chính xác kèm tham số `binId`, `binCode`, `binName` |
| **B12** | Bin Detail API thành công | **PASS** | Gọi `GET /api/bins/:id` thành công |
| **B13** | Fill level Detail đúng | **PASS** | Hiển thị gauge mức đầy và phân loại chuẩn |
| **B14** | Sensor information đúng | **PASS** | Hiển thị khoảng cách siêu âm (cm) và dung tích danh định (L) |
| **B15** | Sensor history đúng | **PASS** | Gọi `GET /api/dashboard/sensor-readings?binCode=...` trả về lịch sử thực |
| **B16** | Back navigation | **PASS** | Nút "← Quay lại" và phím Back phần cứng Android hoạt động chuẩn |
| **B17** | 401 → Login | **PASS** | Hết hạn token tự động dọn dẹp SecureStore và chuyển về Login |
| **B18** | Không có fake data | **PASS** | 100% dữ liệu xuất phát từ backend API |
| **B19** | Không log JWT/password | **PASS** | Đã kiểm toán, không có console.log chứa thông tin bảo mật |
| **B20** | Mobile lint PASS | **PASS** | `npm run lint:mobile` đạt 0 lỗi |
| **B21** | Android export PASS | **PASS** | `npx expo export -p android` xuất gói Hermes bytecode 1.6MB thành công |
| **B22** | API build PASS | **PASS** | `npm run build --workspace @smartbin/api` biên dịch TypeScript thành công |
| **B23** | Web build PASS | **PASS** | `npm run build --workspace @smartbin/web` build Vite production thành công |
| **B24** | API lint PASS | **PASS** | `npm run lint --workspace @smartbin/api` đạt 0 lỗi |
| **B25** | Web lint PASS | **PASS** | `npm run lint --workspace @smartbin/web` đạt 0 warnings, 0 errors |

---

## 16. Build & Lint Verification Log

```bash
# 1. Mobile Lint
$ npm run lint:mobile
> @smartbin/mobile@0.1.0 lint
> tsc --noEmit
# Exit Code: 0 (PASS)

# 2. Android Export
$ npx expo export -p android
Starting Metro Bundler
Android Bundled 5813ms apps\mobile\index.ts (620 modules)
› android bundles (1):
_expo/static/js/android/index-929167ee2f78f128be5bced4f075e4e2.hbc (1.6MB)
Exported: dist
# Exit Code: 0 (PASS)

# 3. API Build
$ npm run build --workspace @smartbin/api
✔ Generated Prisma Client (v6.19.3)
# Exit Code: 0 (PASS)

# 4. Web Build
$ npm run build --workspace @smartbin/web
✓ 66 modules transformed.
dist/index.html                   0.45 kB
dist/assets/index-Ct_Qnvom.css   35.34 kB
dist/assets/index-BfJNs1Ej.js   380.63 kB
✓ built in 158ms
# Exit Code: 0 (PASS)

# 5. API Lint
$ npm run lint --workspace @smartbin/api
# Exit Code: 0 (PASS)

# 6. Web Lint
$ npm run lint --workspace @smartbin/web
Found 0 warnings and 0 errors.
# Exit Code: 0 (PASS)
```

---

## 17. Regression Audit

- `git diff -- apps/api/`: Rỗng (100% nguyên vẹn)
- `git diff -- apps/web/`: Rỗng (100% nguyên vẹn)
- `git status -- apps/api/prisma/dev.db`: Rỗng, working tree clean (100% nguyên vẹn)
- Prisma schema, migrations, SQLite DB không bị thay đổi.
- Authentication backend, Device Health, MQTT Broker giữ nguyên trạng.

---

## 18. Git Status

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

no changes added to commit (use "git add" and/or "git commit -a")
```

```bash
$ git diff --stat
 .gitignore        |    3 +-
 package-lock.json | 9314 +++++++++++++++++++++++++++++++++++++++++------------
 package.json      |    2 +
 3 files changed, 7322 insertions(+), 1997 deletions(-)
```

---

## 19. Known Limitations

1. **Realtime updates**: Hiện tại mức đầy và lịch sử cảm biến được cập nhật qua thao tác Pull-to-Refresh thủ công. Cơ chế cập nhật thời gian thực (WebSockets / Socket.IO) được quy hoạch triển khai trong Phase 6.
2. **Offline Caching**: Dữ liệu cảm biến và danh sách thùng rác được lưu trong bộ nhớ React state tạm thời; việc cache offline vào local SQLite / AsyncStorage cho chế độ mất sóng sẽ được hoàn thiện trong Phase sau nếu có yêu cầu.

---

## 20. Đề xuất Phase 5 — SmartBin Mobile Alerts & Notifications
- Màn hình chuyên biệt hiển thị danh sách Cảnh báo (`AlertsScreen`).
- Phân loại cảnh báo theo mức độ nghiêm trọng: `INFO`, `WARNING`, `CRITICAL`.
- Bộ lọc cảnh báo theo trạng thái đã giải quyết (`isResolved`) và theo từng ngăn rác.
- Thao tác đánh dấu đã xử lý cảnh báo nếu API hỗ trợ.
- Chuẩn bị nền tảng thông báo đẩy (Push Notifications) khi mức đầy vượt ngưỡng 90%.

---

**KẾT LUẬN**:
PHASE 4 COMPLETE — READY FOR REVIEW
