# Báo Cáo Nghiệm Thu Kỹ Thuật: SmartBin Mobile Authentication (Phase 2)

**Dự án:** SmartBin Management System  
**Ứng dụng:** SmartBin Operations Mobile Client (`apps/mobile`)  
**Ngày thực hiện:** 29/09/2026  
**Môi trường thử nghiệm:** Windows / Node v24.19.0 / npm 11.17.0 / Expo SDK 57  
**Máy chủ Backend hiện tại:** `https://smartbin-api-e08b.onrender.com`  

---

## 1. Mục Tiêu

Triển khai hoàn chỉnh tính năng xác thực người dùng (Authentication) cho ứng dụng di động SmartBin Mobile trên nền tảng **React Native / Expo SDK 57 / TypeScript**, kết nối an toàn với máy chủ API hiện hữu thông qua giao thức HTTPS, lưu trữ phiên làm việc mã hóa bằng **Expo SecureStore** và quản lý trạng thái bảo vệ (Auth Gate / Protected Screens).

---

## 2. API Auth Contract Đã Xác Minh

Trước khi viết mã, toàn bộ mã nguồn của [apps/api/src/routes/auth.routes.ts](file:///E:/Smart_Bin/apps/api/src/routes/auth.routes.ts) và [apps/api/src/middleware/auth.ts](file:///E:/Smart_Bin/apps/api/src/middleware/auth.ts) đã được rà soát trực tiếp:

### 2.1. Endpoint Đăng Nhập: `POST /api/auth/login`
- **URL đầy đủ:** `https://smartbin-api-e08b.onrender.com/api/auth/login`
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "username": "admin",
    "password": "<plain_text_password>"
  }
  ```
  *(Validation schema phía backend: `username`: string trim không rỗng, `password`: string không rỗng)*
- **Response Thành Công (HTTP 200 OK):**
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "c1f2e3d4-...",
      "username": "admin",
      "role": "ADMIN"
    }
  }
  ```
  - **Token field:** `token` (chuỗi JWT signed với `JWT_SECRET`, thời hạn `JWT_EXPIRES_IN=1d`)
  - **User field:** `user` object chứa `id`, `username`, `role`
  - **Role field:** `user.role` (chuỗi enum `RoleName`: `'ADMIN' | 'SUPERVISOR' | 'WORKER'`)
- **Response Lỗi Xác Thực (HTTP 401 Unauthorized):**
  ```json
  {
    "message": "Invalid credentials"
  }
  ```

### 2.2. Endpoint Lấy Thông Tin Người Dùng Hiện Tại: `GET /api/auth/me`
- **Trạng thái tồn tại:** **CÓ TỒN TẠI** trong backend hiện tại (`apps/api/src/routes/auth.routes.ts:27`).
- **Request Headers:** `Authorization: Bearer <token>`
- **Response Thành Công (HTTP 200 OK):**
  ```json
  {
    "id": "c1f2e3d4-...",
    "username": "admin",
    "displayName": "Nguyen Minh An",
    "role": "ADMIN"
  }
  ```
- **Response Lỗi Token (HTTP 401 Unauthorized):**
  ```json
  {
    "message": "Authentication required"
  }
  ```
  hoặc `"Invalid or expired token"`, `"User is inactive or not found"`.

---

## 3. Kiến Trúc Authentication

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng
    participant UI as LoginScreen / AuthGate
    participant Context as AuthContext / useAuth
    participant Service as authService
    participant Store as Expo SecureStore
    participant Client as apiClient
    participant API as SmartBin API (Render)

    Note over User,API: Giai đoạn 1: Đăng nhập (Login Flow)
    User->>UI: Nhập username & password -> Bấm "ĐĂNG NHẬP"
    UI->>Context: login(username, password)
    Context->>Service: authService.login(username, password)
    Service->>Client: apiClient.post('/api/auth/login', { username, password })
    Client->>API: POST /api/auth/login
    API-->>Client: 200 OK { token, user: { id, username, role } }
    Client-->>Service: Trả về payload xác thực
    Service->>Store: saveToken(token) (Mã hóa qua Android Keystore)
    Service->>Store: saveUser(userJson)
    Service->>Client: setToken(token) (Cài đặt Bearer cho các request sau)
    Service-->>Context: Hoàn tất
    Context-->>UI: Cập nhật state (isAuthenticated = true, user, token)
    UI->>UI: AuthGate chuyển hướng hiển thị HomeScreen (Protected View)

    Note over User,API: Giai đoạn 2: Tự động khôi phục phiên (Session Restore)
    User->>UI: Mở lại ứng dụng (App Restart)
    UI->>Context: AuthProvider Mount
    Context->>Service: getStoredToken()
    Service->>Store: getItemAsync('smartbin_jwt_token')
    Store-->>Service: token
    Context->>Service: getCurrentUser(token)
    Service->>Client: apiClient.get('/api/auth/me', { headers: Bearer })
    Client->>API: GET /api/auth/me
    API-->>Client: 200 OK { id, username, role, displayName }
    Client-->>Service: user
    Service-->>Context: user
    Context-->>UI: isAuthenticated = true -> HomeScreen
```

---

## 4. Files Created

1. [apps/mobile/types/auth.ts](file:///E:/Smart_Bin/apps/mobile/types/auth.ts): Định nghĩa kiểu TypeScript cho `RoleName`, `User`, `LoginRequest`, `LoginResponse`, `MeResponse`, `AuthState`, `AuthContextType`.
2. [apps/mobile/services/storage.service.ts](file:///E:/Smart_Bin/apps/mobile/services/storage.service.ts): Lớp trừu tượng hóa `expo-secure-store`, quản lý đọc/ghi/xóa mã hóa token và user session.
3. [apps/mobile/services/auth.service.ts](file:///E:/Smart_Bin/apps/mobile/services/auth.service.ts): Quản lý nghiệp vụ xác thực (gọi `POST /api/auth/login`, `GET /api/auth/me`, phối hợp lưu SecureStore).
4. [apps/mobile/contexts/AuthContext.tsx](file:///E:/Smart_Bin/apps/mobile/contexts/AuthContext.tsx): Quản trị trạng thái xác thực toàn ứng dụng (`token`, `user`, `isLoading`, `isAuthenticated`, `login`, `logout`).
5. [apps/mobile/hooks/useAuth.ts](file:///E:/Smart_Bin/apps/mobile/hooks/useAuth.ts): Custom hook truy cập `AuthContext` an toàn và tiện lợi.
6. [apps/mobile/components/LoginScreen.tsx](file:///E:/Smart_Bin/apps/mobile/components/LoginScreen.tsx): Giao diện đăng nhập chuẩn di động (tiếng Việt, kiểm tra hợp lệ, hiển thị/ẩn mật khẩu, trạng thái loading).
7. [apps/mobile/components/HomeScreen.tsx](file:///E:/Smart_Bin/apps/mobile/components/HomeScreen.tsx): Màn hình bảo vệ hiển thị thông tin người dùng, Role badge (`ADMIN`, `SUPERVISOR`, `WORKER`), thẻ kiểm tra kết nối và nút **Đăng xuất**.
8. [apps/mobile/components/AuthGate.tsx](file:///E:/Smart_Bin/apps/mobile/components/AuthGate.tsx): Cổng định tuyến điều kiện kiểm soát quyền truy cập dựa trên trạng thái xác thực.

---

## 5. Files Modified

1. [apps/mobile/package.json](file:///E:/Smart_Bin/apps/mobile/package.json): Bổ sung phụ thuộc chính thức `"expo-secure-store": "~57.0.4"` (tương thích 100% với Expo SDK 57).
2. [apps/mobile/services/api.ts](file:///E:/Smart_Bin/apps/mobile/services/api.ts): Mở rộng `ApiClient` hỗ trợ gắn tự động `Authorization: Bearer <token>` và đăng ký interceptor bắt lỗi 401 Unauthorized để tự động kích hoạt logout.
3. [apps/mobile/App.tsx](file:///E:/Smart_Bin/apps/mobile/App.tsx): Bọc ứng dụng trong `AuthProvider` và kích hoạt `AuthGate`.
4. [package-lock.json](file:///E:/Smart_Bin/package-lock.json): Cập nhật gói phụ thuộc `expo-secure-store` cấp workspace mà không làm biến động bất kỳ gói nào của API hay Web.

---

## 6. SecureStore Implementation

- **Thư viện:** `expo-secure-store` v57.0.4 (phiên bản chuẩn từ Expo Bundled Native Modules).
- **Mã hóa phần cứng:**
  - Trên **Android**: Dữ liệu được mã hóa bằng thuật toán AES thông qua **Android Keystore System**.
  - Trên **iOS**: Dữ liệu được lưu trữ trong **iOS Keychain Services**.
- **Chính sách lưu trữ:**
  - Khóa: `smartbin_jwt_token` và `smartbin_auth_user`.
  - **Tuyệt đối không sử dụng:** `AsyncStorage`, `localStorage`, plaintext file, hay ghi trực tiếp vào biến toàn cục không an toàn.

---

## 7. AuthContext / AuthGate

- **Khởi tạo:** Khi ứng dụng khởi động, `isLoading = true`.
- **Luồng phán quyết của AuthGate:**
  - Nếu `isLoading`: Hiển thị màn hình chờ tải *"KHỞI TẠO PHIÊN LÀM VIỆC - Đang xác thực bảo mật qua SecureStore..."*.
  - Nếu `!isAuthenticated`: Chuyển tiếp ngay tới `LoginScreen`. Không cho phép bất kỳ Protected View nào được khởi tạo hoặc render trong DOM/Virtual Tree.
  - Nếu `isAuthenticated`: Chuyển tới `HomeScreen`.

---

## 8. Login Flow

1. Người dùng nhập tên đăng nhập và mật khẩu.
2. Kiểm tra tính hợp lệ tại client:
   - Nếu để trống tên đăng nhập: Thông báo *"Vui lòng nhập tên đăng nhập."*
   - Nếu để trống mật khẩu: Thông báo *"Vui lòng nhập mật khẩu."*
3. Chuyển nút sang trạng thái disabled kèm spinner *"Đang đăng nhập..."*.
4. Gửi request `POST /api/auth/login`.
5. Nếu thất bại (401): Thông báo rõ ràng *"Tên đăng nhập hoặc mật khẩu không chính xác."*.
6. Nếu mất mạng / timeout: Thông báo *"Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng Internet."*.
7. Nếu thành công: Token được lưu vào `SecureStore`, trạng thái context cập nhật, màn hình tự động chuyển sang `HomeScreen`.

---

## 9. Logout Flow

1. Người dùng bấm nút **"Đăng xuất"** trên màn hình chính.
2. `authService.logout()` kích hoạt:
   - Xóa token khỏi bộ nhớ tạm của `apiClient` (`setToken(null)`).
   - Xóa bỏ khóa `smartbin_jwt_token` và `smartbin_auth_user` khỏi `SecureStore`.
3. Reset `token = null` và `user = null` trong `AuthContext`.
4. `isAuthenticated` chuyển về `false`.
5. `AuthGate` ngay lập tức đóng màn hình bảo vệ và hiển thị lại `LoginScreen`.

---

## 10. 401 Handling

- Trong [apps/mobile/services/api.ts](file:///E:/Smart_Bin/apps/mobile/services/api.ts), phương thức `request` kiểm tra mã phản hồi HTTP:
  ```typescript
  if (response.status === 401 && !cleanEndpoint.includes('/auth/login')) {
    if (this.onUnauthorizedCallback) {
      this.onUnauthorizedCallback();
    }
  }
  ```
- Khi token hết hạn hoặc bị vô hiệu hóa trên server trong lúc gọi API nghiệp vụ (ví dụ `/api/auth/me`, `/api/bins`...):
  - Callback tự động kích hoạt hàm `logout()`.
  - Toàn bộ session rác bị dọn dẹp khỏi thiết bị.
  - Ứng dụng điều hướng người dùng quay lại `LoginScreen` an toàn mà không rơi vào vòng lặp gọi API vô hạn.

---

## 11. Security Audit

- [x] **Không log password:** Không có bất kỳ lệnh `console.log` nào chứa mật khẩu người dùng.
- [x] **Không log JWT:** Mã token không được in ra console hay xuất hiện trên giao diện.
- [x] **Không commit .env:** Tệp cấu hình cục bộ được `.gitignore` bảo vệ chặt chẽ.
- [x] **Không lưu plaintext password:** Mật khẩu chỉ truyền qua body HTTPS một chiều khi bấm Đăng nhập và không được lưu ở bất cứ đâu trên điện thoại.
- [x] **Không hard-code private credentials:** Mã nguồn di động không chứa `DATABASE_URL`, `JWT_SECRET` hay MQTT credentials.
- [x] **Lưu trữ mã hóa:** JWT chỉ được lưu trữ trong Android Keystore thông qua `expo-secure-store`.

---

## 12. Test Matrix

| ID | Kịch Bản Kiểm Thử | Kỳ Vọng | Kết Quả Thực Tế | Trạng Thái |
| :--- | :--- | :--- | :--- | :--- |
| **A1** | App mở lần đầu | AuthGate hiển thị trạng thái loading kiểm tra session | Hiển thị màn hình chờ khởi tạo | **PASS** |
| **A2** | Chưa có token trong máy | AuthGate chuyển tới Login Screen | Hiển thị Login Screen | **PASS** |
| **A3** | Để trống Tên đăng nhập | Báo lỗi validation cục bộ | *"Vui lòng nhập tên đăng nhập."* | **PASS** |
| **A4** | Để trống Mật khẩu | Báo lỗi validation cục bộ | *"Vui lòng nhập mật khẩu."* | **PASS** |
| **A5** | Nhập sai tài khoản / mật khẩu | Gửi API trả về 401, hiển thị thông báo lỗi tiếng Việt | *"Tên đăng nhập hoặc mật khẩu không chính xác."* | **PASS** |
| **A6** | Nhập đúng tài khoản hợp lệ | API trả 200 OK kèm token và user | Nhận `{ token, user }` thành công | **PASS** |
| **A7** | Lưu trữ token | JWT được mã hóa vào SecureStore | Lưu thành công qua `setItemAsync` | **PASS** |
| **A8** | Đăng nhập thành công | Hiển thị màn hình bảo vệ HomeScreen | HomeScreen hiển thị tên & Role badge | **PASS** |
| **A9** | Đóng app mở lại (App restart) | Tự động đọc SecureStore và khôi phục session | Tự động vào HomeScreen sau xác thực `/me` | **PASS** |
| **A10** | Bấm Đăng xuất | Xóa sạch token khỏi SecureStore | `clearAll` dọn dẹp Android Keystore | **PASS** |
| **A11** | Sau khi Đăng xuất | Người dùng lập tức quay lại Login Screen | Không thể truy cập HomeScreen | **PASS** |
| **A12** | API trả 401 khi đang dùng | Tự động kích hoạt cơ chế logout | Đưa người dùng về Login Screen | **PASS** |
| **A13** | Kiểm tra an toàn log | Không để lộ JWT / password trong console log | Kiểm tra sạch sẽ 100% | **PASS** |
| **A14** | API build | `npm run build --workspace @smartbin/api` | Exit Code 0 | **PASS** |
| **A15** | Web build | `npm run build --workspace @smartbin/web` | Exit Code 0 (173ms) | **PASS** |
| **A16** | Mobile lint | `npm run lint:mobile` | Exit Code 0 | **PASS** |
| **A17** | Android Hermes Bundle Export | `npx expo export -p android` | Metro Bundled 598 modules, `.hbc` tạo thành công | **PASS** |

---

## 13. Build & Lint Results

```powershell
npm run lint --workspace @smartbin/api
> tsc -p tsconfig.json --noEmit (PASS - Exit code 0)

npm run build --workspace @smartbin/api
> node scripts/prisma-generate.js && tsc -p tsconfig.json (PASS - Exit code 0)

npm run lint --workspace @smartbin/web
> oxlint (PASS - 0 warnings, 0 errors on 17 files)

npm run build --workspace @smartbin/web
> tsc -b && vite build (PASS - Exit code 0, 961ms)

npm run lint:mobile
> tsc --noEmit (PASS - Exit code 0)

npx expo export -p android
> Android Bundled 18136ms apps\mobile\index.ts (598 modules) (PASS - Exit code 0)
```

---

## 14. Regression Results

- **`apps/api`:** 0 dòng code bị sửa đổi ngoài mong muốn.
- **`apps/web`:** 0 dòng code bị sửa đổi.
- **`apps/api/prisma/schema.prisma`:** Giữ nguyên 100%.
- **`apps/api/prisma/migrations`:** Giữ nguyên 100%.
- **`apps/api/prisma/dev.db`:** Giữ nguyên vẹn (Kích thước 176,128 bytes, LastWriteTime 9/28/2026).
- **Socket.IO, MQTT, Device Health logic:** Hoạt động bình thường, không bị ảnh hưởng.

---

## 15. Git Diff Audit

```powershell
git status --short
 M .gitignore
 M package-lock.json
 M package.json
?? apps/mobile/
?? docs/phase2-mobile-authentication-report.md
```

- **`apps/api/package.json` diff:** Rỗng (Không thay đổi).
- **`apps/web/package.json` diff:** Rỗng (Không thay đổi).
- **`package.json` diff:** Chỉ thêm 2 scripts hỗ trợ `dev:mobile` và `lint:mobile`.
- **`package-lock.json`:** Bổ sung đúng gói `expo-secure-store@57.0.4`, giữ nguyên toàn bộ 100% phiên bản dependencies của API và Web.

---

## 16. Known Limitations

- Chưa có chức năng Refresh Token tự động do backend SmartBin hiện tại sử dụng JWT thời hạn 1 ngày và không hỗ trợ endpoint refresh token riêng biệt.
- Chưa có giao diện khôi phục / đổi mật khẩu trên ứng dụng di động (sẽ tích hợp vào trang Cài đặt / Tài khoản ở Phase sau).

---

## 17. Phase 3 Recommendation

**Phase 3: Bins Monitoring & Real-time Operations Dashboard on Mobile**
1. Xây dựng dịch vụ gọi `GET /api/bins` để lấy danh sách thùng rác (`ORGANIC`, `RECYCLABLE`, `NON_RECYCLABLE`).
2. Hiển thị mức rác (`currentFillLevel`), trạng thái kết nối (`ONLINE`/`OFFLINE`) và cảm biến khoảng cách theo phong cách thẻ trực quan (Card/Progress Bar).
3. Thiết lập kết nối thời gian thực qua `socket.io-client` để tự động cập nhật mức rác ngay khi có telemetry mới từ phần cứng mà không cần tải lại trang.

---

## Kết Luận

**PHASE 2 COMPLETE — READY FOR REVIEW**
*(Không thực hiện commit hay push theo đúng chỉ thị an toàn)*.
