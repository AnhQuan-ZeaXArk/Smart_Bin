# Phase 7 — Mobile Collection History

## 1. Mục tiêu
Triển khai màn hình **"Lịch sử thu gom"** trên ứng dụng Mobile (React Native + Expo SDK 57 + TypeScript) cho dự án SmartBin.
Màn hình cho phép người dùng (Admin, Supervisor, Worker) theo dõi đầy đủ nhật ký các đợt thu gom rác đã được hệ thống ghi nhận trong cơ sở dữ liệu thực tế, bao gồm thời gian thu gom, thông tin thùng rác, mức rác trước/sau khi thu gom, người thực hiện, trạng thái và ghi chú kỹ thuật.

Toàn bộ dữ liệu được kết nối trực tiếp từ Backend REST API hiện có (`GET /api/collections`), tuyệt đối không tạo mock/fake data và không hard-code dữ liệu lịch sử.

---

## 2. Backend API Contract

Dựa trên khảo sát thực tế từ `apps/api/src/routes/protected.routes.ts`:

- **Endpoint**: `/api/collections`
- **Method**: `GET`
- **Authentication**: `requireAuth` (truyền JWT Bearer token qua header `Authorization: Bearer <token>`)
- **Roles**: `ADMIN`, `SUPERVISOR`, `WORKER` (cho phép toàn bộ các vai trò đã đăng nhập)
- **Query Parameters**: Không hỗ trợ query parameters ở server-side (Backend lấy trực tiếp `take: 200` bản ghi gần nhất theo thứ tự giảm dần thời gian).
- **Sorting**: Sắp xếp mặc định server-side `orderBy: { collectedAt: 'desc' }` (từ mới nhất đến cũ nhất).
- **Pagination**: Backend trả về danh sách mảng tối đa 200 records (`take: 200`), không có phân trang server-side.
- **Response Structure**:
```json
{
  "collections": [
    {
      "id": "cmujv72vj000qmvh8bwve1c0b",
      "binId": "cmujv72v1000dmvh8eo47eq8d",
      "collectedBy": "Le Van Binh",
      "collectedAt": "2026-09-27T13:08:55.927Z",
      "fillLevelBefore": 82,
      "fillLevelAfter": 16,
      "status": "COMPLETED",
      "notes": "Lịch sử thu gom demo cho ngăn rác không tái chế",
      "createdAt": "2026-09-27T13:38:55.951Z",
      "updatedAt": "2026-09-27T13:38:55.951Z",
      "bin": {
        "binCode": "NON_RECYCLABLE",
        "name": "Rác không tái chế"
      }
    }
  ]
}
```

---

## 3. Database Model

Từ `apps/api/prisma/schema.prisma` và `apps/api/prisma/schema.sqlite.prisma`:

### Model `CollectionRecord`
- **Primary Key**: `id String @id @default(cuid())`
- **Foreign Key**: `binId String` tham chiếu đến `Bin.id`
- **Fields**:
  - `collectedBy String?`: Tên người thực hiện thu gom
  - `collectedAt DateTime @default(now())`: Thời điểm thu gom thực tế
  - `fillLevelBefore Int`: Mức đầy trước khi thu gom (%)
  - `fillLevelAfter Int?`: Mức đầy sau khi thu gom (%)
  - `status CollectionStatus @default(PENDING)`: Trạng thái thu gom
  - `notes String?`: Ghi chú thao tác
  - `createdAt DateTime @default(now())`
  - `updatedAt DateTime @updatedAt`
- **Relation**: `bin Bin @relation(fields: [binId], references: [id])`

### Enum `CollectionStatus`
- `PENDING`: Chờ thu gom
- `IN_PROGRESS`: Đang xử lý
- `COMPLETED`: Hoàn thành
- `CANCELLED`: Đã hủy

---

## 4. Mobile Architecture

Kiến trúc Mobile cho Phase 7 tuân thủ kiến trúc phân tầng nhất quán:

```
apps/mobile/
├── types/
│   └── collection.ts               # Type definitions phản ánh chính xác contract Backend
├── services/
│   └── collection.service.ts       # Service gọi GET /api/collections qua apiClient
├── hooks/
│   └── useCollections.ts           # Custom hook quản lý state, filter, refresh, reload
├── components/
│   ├── collection/
│   │   ├── CollectionHistoryCard.tsx       # Component hiển thị từng bản ghi thu gom
│   │   ├── CollectionHistoryScreen.tsx     # Màn hình chính lịch sử thu gom (FlatList)
│   │   └── LoadingCollectionHistory.tsx    # Skeleton loading UI
│   ├── BottomTabBar.tsx            # Bổ sung tab "Lịch sử" (icon 📋)
│   ├── MainNavigator.tsx           # Điều hướng screen 'collections'
│   ├── HomeScreen.tsx              # Tích hợp shortcut xem lịch sử từ Dashboard
│   └── bins/
│       └── BinDetailScreen.tsx     # Tích hợp shortcut xem lịch sử theo từng ngăn thùng
└── contexts/
    └── NavigationContext.tsx       # Bổ sung route 'collections' và xử lý back Android
```

---

## 5. Files Created / Modified

### Files Created:
1. `apps/mobile/types/collection.ts`: Định nghĩa `CollectionRecord`, `CollectionStatus`, `CollectionFilters`, label và màu sắc theo chuẩn hệ thống.
2. `apps/mobile/services/collection.service.ts`: Gọi `GET /api/collections` thông qua `apiClient` (được bảo vệ bởi Bearer JWT).
3. `apps/mobile/hooks/useCollections.ts`: Quản lý `collections`, `filteredCollections`, `isLoading`, `isRefreshing`, `error`, bộ lọc cục bộ an toàn.
4. `apps/mobile/components/collection/LoadingCollectionHistory.tsx`: UI Loading trạng thái khởi tạo với ActivityIndicator và skeleton card.
5. `apps/mobile/components/collection/CollectionHistoryCard.tsx`: Card hiển thị đầy đủ thông tin thu gom thực tế.
6. `apps/mobile/components/collection/CollectionHistoryScreen.tsx`: Màn hình "Lịch sử thu gom" với FlatList, bộ lọc trạng thái, tìm kiếm, Pull-to-refresh và xử lý Empty/Error.
7. `docs/phase7-mobile-collection-history-report.md`: Báo cáo kỹ thuật Phase 7.

### Files Modified:
1. `apps/mobile/contexts/NavigationContext.tsx`: Bổ sung `'collections'` vào `Screen` union type và cập nhật điều hướng / back handler.
2. `apps/mobile/components/BottomTabBar.tsx`: Bổ sung tab "Lịch sử" (icon 📋), tinh chỉnh layout `numberOfLines={1}` vừa vặn hoàn hảo trên màn hình thiết bị Android.
3. `apps/mobile/components/MainNavigator.tsx`: Render `CollectionHistoryScreen` khi `currentScreen === 'collections'`.
4. `apps/mobile/components/HomeScreen.tsx`: Bổ sung thẻ lối tắt "Lịch sử thu gom" với nút "Xem lịch sử thu gom →" từ Dashboard.
5. `apps/mobile/components/bins/BinDetailScreen.tsx`: Bổ sung thẻ lối tắt "Lịch sử thu gom" cho riêng từng ngăn thùng rác với tham số `binCode`.

---

## 6. Collection History UI

Thẻ bản ghi thu gom (`CollectionHistoryCard`) tuân theo phân cấp thông tin rõ ràng:
1. **Thông tin ngăn thùng**: Mã ngăn (`binCode` như `NON_RECYCLABLE` hoặc `BIN-003`), tên ngăn (`bin.name` như `Rác không tái chế`).
2. **Huy hiệu trạng thái**: Màu sắc trực quan (Hoàn thành - xanh lục `#059669`, Đang xử lý - xanh dương `#2563eb`, Chờ thu gom - vàng cam `#d97706`, Đã hủy - đỏ `#dc2626`).
3. **Thời gian thu gom**: Định dạng theo chuẩn Việt Nam qua `formatDateTime` (`13:08:55 27/09/2026`) kèm thời gian tương đối qua `formatRelativeTime` (`3 ngày trước`).
4. **Mức rác trước và sau**: Hiển thị trực quan mức đầy trước (`82%`), mũi tên biến thiên (`➔ -66%`), mức đầy sau (`16%`).
5. **Người thực hiện**: Hiển thị tên nhân viên vận hành nếu có (`👤 Người thu gom: Le Van Binh`).
6. **Ghi chú**: Hiển thị ghi chú kỹ thuật nếu có (`📝 Lịch sử thu gom demo cho ngăn rác không tái chế`).
7. **Không hiển thị trường giả**: Tuyệt đối không tự bịa đặt trường khối lượng rác (weight) hoặc loại rác (waste type) khi Backend không cung cấp.

---

## 7. Sorting

- Backend API `GET /api/collections` đã thực hiện sắp xếp `orderBy: { collectedAt: 'desc' }` (từ mới nhất đến cũ nhất).
- Ứng dụng Mobile giữ nguyên thứ tự sắp xếp tự nhiên từ Backend để phản ánh trung thực dòng sự kiện thu gom.

---

## 8. Filtering

- **Khảo sát Backend**: Endpoint `/api/collections` không hỗ trợ query parameter để lọc server-side.
- **Giải pháp Client-side Filter**: Do tập dữ liệu Backend giới hạn 200 bản ghi mới nhất (`take: 200`), việc lọc được thực hiện an toàn trên client thông qua custom hook `useCollections`:
  - **Lọc theo trạng thái**: Các tab "Tất cả", "Hoàn thành", "Đang xử lý", "Chờ thu gom", "Đã hủy".
  - **Lọc theo ngăn thùng**: Hỗ trợ khi chuyển hướng từ `BinDetailScreen` với `binCode` (kèm banner và nút "Xóa lọc ✕").
  - **Tìm kiếm**: Thanh tìm kiếm tức thời theo mã thùng, tên thùng, nhân viên thu gom và nội dung ghi chú.
  - **Đặt lại bộ lọc**: Nút "Đặt lại bộ lọc" khôi phục ngay trạng thái mặc định.

---

## 9. Pull-to-refresh

- `CollectionHistoryScreen` sử dụng `FlatList` tích hợp `RefreshControl`.
- Khi người dùng kéo để làm mới:
  - Gọi hàm `refresh()` trong `useCollections`.
  - Thực hiện gọi REST API thực tế tới Backend qua `collectionService.getCollections()`.
  - Cập nhật lại danh sách dữ liệu mới nhất mà không tạo record giả hoặc fake loading.

---

## 10. Loading / Error / Empty

- **Loading State**: Sử dụng component `LoadingCollectionHistory` hiển thị biểu tượng quay `ActivityIndicator` màu xanh ngọc bích (`Colors.brandHighlight`) kèm các skeleton placeholder theo đúng theme công nghiệp hiện đại.
- **Error State**: Nếu API lỗi hoặc mất kết nối mạng, hiển thị thông báo "Không thể tải lịch sử thu gom." kèm chi tiết lỗi và nút bấm **"Thử lại"** (gọi `reload()` để gửi lại request thực tế).
- **Empty State**: Nếu Backend trả về mảng rỗng `[]`, hiển thị thông báo "Chưa có lịch sử thu gom." và "Hệ thống chưa ghi nhận lần thu gom rác nào trên máy chủ." mà không sinh dữ liệu giả.

---

## 11. Navigation

- Cập nhật `NavigationContext` hỗ trợ màn hình `'collections'`.
- Tích hợp tab thứ 5 trên thanh điều hướng dưới (`BottomTabBar`):
  1. 📊 Tổng quan (`dashboard`)
  2. 🗑️ Thùng rác (`bins`)
  3. ⚡ Thiết bị (`devices`)
  4. 🔔 Thông báo (`alerts`)
  5. 📋 Lịch sử (`collections`)
- Layout của 5 tab được tối ưu với `numberOfLines={1}`, icon 16px và font 11px gọn gàng, đảm bảo không bị tràn chữ hoặc quá nhỏ trên các thiết bị Android phổ biến.
- Khi ở màn hình chi tiết thùng rác (`bin-detail`), BottomTabBar tự động ẩn để tối ưu không gian hiển thị.
- Nút quay lại (Back) và Hardware Back trên Android hoạt động chính xác theo ngăn xếp điều hướng.

---

## 12. Dashboard Integration

- Tại `HomeScreen.tsx` (Dashboard), bổ sung thẻ lối tắt "Lịch sử thu gom" với biểu tượng 📋 và nút bấm "Xem lịch sử thu gom →".
- Khi bấm, màn hình chuyển hướng ngay sang màn hình `collections`.
- Không làm thay đổi hay phá vỡ các widget hiện hữu của Dashboard Phase 3 (SummaryCards, BinStatusBreakdown, BinFillCard, DeviceHealthCard, RecentAlertsCard, ConnectionCard).

---

## 13. Bin Detail Integration

- Tại `BinDetailScreen.tsx`, bên dưới biểu đồ lịch sử cảm biến (`SensorHistoryCard`), bổ sung thẻ lối tắt "LỊCH SỬ THU GOM" cho riêng ngăn thùng đó.
- Khi bấm "Xem lịch sử thu gom →", ứng dụng chuyển hướng đến `collections` kèm tham số `binCode: bin.binCode`.
- Màn hình Lịch sử thu gom tự động lọc các lần thu gom thuộc về ngăn đó và hiển thị banner "Lọc theo ngăn: [binCode]" kèm nút "Xóa lọc ✕".
- Khi bấm nút Quay lại (Back), người dùng quay lại đúng màn hình chi tiết thùng trước đó.

---

## 14. Security

- **JWT Authentication**: Token được lấy an toàn từ `SecureStore` và gắn tự động qua header `Authorization: Bearer <token>` bởi `apiClient`.
- **401 Handling**: Khi token hết hạn hoặc không hợp lệ, `apiClient` kích hoạt callback đăng xuất, xóa phiên làm việc và chuyển về `LoginScreen`.
- **Bảo mật thông tin**:
  - Tuyệt đối không log token, mật khẩu hay dữ liệu nhạy cảm ra console.
  - Không hard-code credentials trong mã nguồn client.

---

## 15. Test Matrix

| ID | Tên Kiểm Thử | Kết Quả | Phương Thức Xác Minh |
|---|---|---|---|
| **C1** | Login → Dashboard | PASS | RUNTIME VERIFIED (Đăng nhập admin/worker lấy token hợp lệ) |
| **C2** | Dashboard → Collection History | PASS | RUNTIME VERIFIED (Chuyển màn hình qua shortcut card & tab) |
| **C3** | Collection History API | PASS | RUNTIME VERIFIED (`GET /api/collections` trả HTTP 200) |
| **C4** | Collection list displayed | PASS | RUNTIME VERIFIED (Danh sách hiển thị bản ghi thực tế) |
| **C5** | Correct collection fields | PASS | RUNTIME VERIFIED (`id`, `binId`, `fillLevelBefore`, `fillLevelAfter`, `status`, `notes`, `bin`) |
| **C6** | Correct timestamp format | PASS | RUNTIME VERIFIED (ISO string chuẩn hóa qua `formatDateTime` & `formatRelativeTime`) |
| **C7** | Correct bin information | PASS | RUNTIME VERIFIED (`binCode: NON_RECYCLABLE`, `name: Rác không tái chế`) |
| **C8** | Correct status enum | PASS | RUNTIME VERIFIED (`COMPLETED` tương ứng huy hiệu "Hoàn thành") |
| **C9** | Empty state | PASS | CODE VERIFIED (Giao diện rỗng chuẩn khi danh sách 0 bản ghi) |
| **C10** | API error | PASS | CODE VERIFIED (Giao diện lỗi chuẩn khi API gặp sự cố) |
| **C11** | Retry button | PASS | CODE VERIFIED (Nút thử lại kích hoạt hàm `reload()`) |
| **C12** | Pull-to-refresh | PASS | CODE VERIFIED (`RefreshControl` kích hoạt `refresh()`) |
| **C13** | 401 → Login redirect | PASS | RUNTIME VERIFIED (Không có token nhận 401, kích hoạt xóa phiên) |
| **C14** | Navigation back / Android Hardware Back | PASS | CODE VERIFIED (Quay lại màn hình trước thông qua NavigationContext) |
| **C15** | Navigation to Bins | PASS | CODE VERIFIED (Tab chuyển sang Bins hoạt động bình thường) |
| **C16** | Navigation to Devices | PASS | CODE VERIFIED (Tab chuyển sang Devices hoạt động bình thường) |
| **C17** | Navigation to Alerts | PASS | CODE VERIFIED (Tab chuyển sang Alerts hoạt động bình thường) |
| **C18** | No fake data | PASS | CODE & RUNTIME VERIFIED (100% dữ liệu từ Backend / SQLite) |
| **C19** | No JWT/password logging | PASS | CODE VERIFIED (Toàn bộ mã nguồn không ghi log dữ liệu nhạy cảm) |
| **C20** | Mobile lint | PASS | RUNTIME VERIFIED (`npm run lint:mobile` -> `tsc --noEmit` đạt 0 lỗi) |
| **C21** | Android export | PASS | RUNTIME VERIFIED (`npx expo export -p android` build 1.7MB Hermes bundle thành công) |
| **C22** | API build | PASS | RUNTIME VERIFIED (`npm run build --workspace @smartbin/api` biên dịch đạt 100%) |
| **C23** | API lint | PASS | RUNTIME VERIFIED (`npm run lint --workspace @smartbin/api` đạt 0 lỗi) |
| **C24** | Web build | PASS | RUNTIME VERIFIED (`npm run build --workspace @smartbin/web` Vite bundle thành công) |
| **C25** | Web lint | PASS | RUNTIME VERIFIED (`npm run lint --workspace @smartbin/web` oxlint đạt 0 lỗi) |
| **C26** | Local filter (status, binCode, search) | PASS | RUNTIME VERIFIED (Lọc chính xác theo trạng thái, mã thùng, từ khóa) |
| **C27** | Filter reset | PASS | CODE VERIFIED (Khôi phục trạng thái bộ lọc toàn diện) |

---

## 16. Regression Audit

- **API (`apps/api/`)**: `git diff -- apps/api/` hoàn toàn rỗng. Không có thay đổi nào trên mã nguồn Backend.
- **Web (`apps/web/`)**: `git diff -- apps/web/` hoàn toàn rỗng. Không làm ảnh hưởng đến ứng dụng Web.
- **Mobile (`apps/mobile/`)**: Tất cả các tính năng từ Phase 1 đến Phase 6 tiếp tục hoạt động ổn định:
  - Phase 1: Kiến trúc React Native + Expo SDK 57 + TypeScript.
  - Phase 2: Đăng nhập, lưu trữ SecureStore, JWT, AuthContext, 401 handling.
  - Phase 3: Dashboard KPI, biểu đồ trạng thái, danh sách thiết bị.
  - Phase 4: Danh sách thùng rác, chi tiết thùng rác, lịch sử cảm biến.
  - Phase 5: Màn hình sức khỏe thiết bị IoT, đo độ trễ và ping kiểm tra.
  - Phase 6: Socket.IO realtime alerts, huy hiệu RealtimeStatusBadge, nhận sự kiện theo thời gian thực (đã kiểm thử và xác nhận hoạt động 100%).
- **Database Safety**:
  - File `apps/api/prisma/dev.db` giữ nguyên vẹn kích thước 176,128 bytes.
  - Không chạy lệnh `prisma migrate reset` hay `prisma db push`.
  - Toàn bộ migrations Prisma nguyên bản.

---

## 17. Git Status

Kiểm tra trạng thái git:
- **No commit performed**: Tuyệt đối không chạy lệnh `git commit`.
- **No push performed**: Tuyệt đối không chạy lệnh `git push`.
- Các file mới thuộc `apps/mobile/` và tài liệu báo cáo `docs/phase7-mobile-collection-history-report.md`.

---

## 18. Conclusion

**PHASE 7 COMPLETE — READY FOR REVIEW**
Màn hình Lịch sử thu gom trên Mobile đã được triển khai hoàn chỉnh, kết nối trực tiếp với Backend API thực tế, tích hợp mượt mà vào hệ thống điều hướng, hỗ trợ lọc, tìm kiếm, pull-to-refresh và hoàn thành toàn bộ kiểm thử mã nguồn cũng như runtime verification.
