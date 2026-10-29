# Hướng Dẫn Cài Đặt & Chạy SmartBin Agent Trên Raspberry Pi 5 (Debian 13 ARM64)

Tài liệu này hướng dẫn chi tiết cách kết nối qua **PuTTY (SSH)** vào Raspberry Pi 5 chạy hệ điều hành Debian 13 (Trixie) ARM64, tạo môi trường ảo Python (`venv`), cài đặt thư viện tương thích Socket.IO v4, cấu hình bảo mật `DEVICE_INGEST_TOKEN` và chạy agent giao tiếp hai chiều với SmartBin Web.

---

## 1. Kết Nối Vào Raspberry Pi 5 Bằng PuTTY

1. Mở phần mềm **PuTTY** trên máy tính Windows.
2. Trong ô **Host Name (or IP address)**: Nhập địa chỉ IP mạng cục bộ của Pi (ví dụ: `192.168.1.100` hoặc `raspberrypi.local`).
3. Port: `22` | Connection type: `SSH`.
4. Nhấn **Open** (nếu hiện cảnh báo bảo mật Host Key lần đầu, chọn *Accept*).
5. Nhập tài khoản và mật khẩu đăng nhập vào Raspberry Pi (ví dụ mặc định: user `pi`).

---

## 2. Chuẩn Bị Thư Mục & Môi Trường Ảo Python (venv)

Trên terminal của Pi 5, thực hiện các lệnh sau:

```bash
# 1. Cập nhật gói phần mềm hệ điều hành
sudo apt update && sudo apt install -y python3 python3-pip python3-venv git

# 2. Tạo thư mục làm việc cho SmartBin Agent
mkdir -p ~/smartbin-agent
cd ~/smartbin-agent

# 3. Tạo môi trường ảo cách ly (Virtual Environment)
python3 -m venv venv

# 4. Kích hoạt môi trường ảo
source venv/bin/activate
```

Sau khi kích hoạt, dòng nhắc terminal sẽ có tiền tố `(venv)`.

---

## 3. Tải Mã Nguồn & Cài Đặt Thư Viện

Nếu clone từ repository:
```bash
# Copy file pi_agent.py và requirements.txt vào thư mục ~/smartbin-agent
# Hoặc copy trực tiếp từ repo Smart_Bin
```

Cài đặt các gói thư viện tương thích với Backend Socket.IO:
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

*Ghi chú tương thích*: `python-socketio>=5.11.0` và `python-engineio>=4.9.0` kết nối hoàn toàn tương thích với giao thức Socket.IO `v4.8.x` trên Node.js Backend.

---

## 4. Cấu Hình Biến Môi Trường Bảo Mật

Tạo file `.env` bảo mật tại thư mục `~/smartbin-agent/.env`:

```bash
nano .env
```

Nội dung file `.env`:
```ini
SERVER_URL=https://smartbin-api-e08b.onrender.com
DEVICE_ID=raspberry-pi-5
DEVICE_INGEST_TOKEN=ThayBangTokenIngestCuaBan
TELEMETRY_INTERVAL=5
```

> [!CAUTION]
> - Thay `ThayBangTokenIngestCuaBan` bằng giá trị `DEVICE_INGEST_TOKEN` đã cấu hình trên Render Environment Variables.
> - Tuyệt đối không commit file `.env` này vào Git hoặc chia sẻ công khai.

Phân quyền bảo vệ file `.env`:
```bash
chmod 600 .env
```

---

## 5. Chạy Thử Nghiệm Pi Agent

Trong môi trường ảo `(venv)`, chạy trực tiếp:

```bash
python3 pi_agent.py
```

### Kết quả mong đợi trên màn hình terminal:
```text
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5] ==================================================
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5]    SmartBin Raspberry Pi 5 Agent v1.0.0          
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5]    Nền tảng: Debian 13 ARM64                     
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5]    Device ID: raspberry-pi-5
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5]    Server URL: https://smartbin-api-e08b.onrender.com
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5]    Chu kỳ Telemetry: 5 giây                     
[2026-10-29 20:00:00] [INFO] [SmartBin-Pi5] ==================================================
[2026-10-29 20:00:01] [INFO] [SmartBin-Pi5] Đang khởi tạo kết nối Socket.IO...
[2026-10-29 20:00:02] [INFO] [SmartBin-Pi5] Đã kết nối thành công tới SmartBin Socket.IO Server
[2026-10-29 20:00:02] [INFO] [SmartBin-Pi5] Gửi Socket.IO telemetry -> uptime: 12450s | temp: 48.5°C
```

Khi nhấn nút **PING** từ Web Dashboard:
```text
[2026-10-29 20:00:15] [INFO] [SmartBin-Pi5] >>> Nhận lệnh từ Web: action='PING' (commandId=cmd_1761742815_abc12)
[2026-10-29 20:00:15] [INFO] [SmartBin-Pi5] <<< Hoàn tất lệnh PING và gửi ACK COMPLETED (temp: 48.7°C, uptime: 12465s)
```

Nhấn `Ctrl + C` để dừng script an toàn.

---

## 6. Chạy Ngầm Bằng Systemd Service (Tự Động Chạy Cùng Hệ Điều Hành)

Để script luôn chạy ngầm và tự động bật lại khi khởi động lại Pi 5:

1. Tạo file service:
```bash
sudo nano /etc/systemd/system/smartbin-pi.service
```

2. Dán nội dung sau (thay `pi` bằng user của bạn nếu khác):
```ini
[Unit]
Description=SmartBin Raspberry Pi 5 Telemetry Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/smartbin-agent
ExecStart=/home/pi/smartbin-agent/venv/bin/python3 /home/pi/smartbin-agent/pi_agent.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

3. Kích hoạt và bật service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable smartbin-pi.service
sudo systemctl start smartbin-pi.service
```

4. Kiểm tra trạng thái service:
```bash
sudo systemctl status smartbin-pi.service
```

5. Xem log trực tiếp khi đang chạy:
```bash
journalctl -u smartbin-pi.service -f
```
