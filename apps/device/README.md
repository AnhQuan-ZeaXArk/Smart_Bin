# Hướng Dẫn Cài Đặt & Chạy SmartBin Agent Trên Raspberry Pi 5 (Debian 13 ARM64)

Tài liệu này hướng dẫn chi tiết cách kết nối qua **PuTTY (SSH)** vào Raspberry Pi 5 chạy hệ điều hành Debian 13 (Trixie) ARM64, tạo môi trường ảo Python (`venv`), cài đặt thư viện phần cứng (YOLOv8, OpenCV, PySerial, Socket.IO v4), cấu hình quyền truy cập Camera/Serial và khởi động hệ thống tự động qua **systemd**.

---

## 1. Kết Nối Vào Raspberry Pi 5 Bằng PuTTY

1. Mở phần mềm **PuTTY** trên máy tính Windows.
2. Trong ô **Host Name (or IP address)**: Nhập địa chỉ IP mạng cục bộ của Pi (ví dụ: `192.168.1.100` hoặc `raspberrypi.local`).
3. Port: `22` | Connection type: `SSH`.
4. Nhấn **Open** (nếu hiện cảnh báo bảo mật Host Key lần đầu, chọn *Accept*).
5. Nhập tài khoản và mật khẩu đăng nhập vào Raspberry Pi (user mặc định: `pi`).

---

## 2. Cài Đặt Phân Quyền Phần Cứng (Camera Rapoo C200 & USB Serial ESP32)

Thêm user `pi` vào các nhóm thiết bị phần cứng để đọc Camera và Serial không cần `sudo`:

```bash
sudo usermod -a -G video,dialout pi
```

Kiểm tra thiết bị phần cứng đã cắm:
```bash
# Kiểm tra Camera Rapoo C200 USB
ls -l /dev/video*
# (Thường xuất hiện /dev/video0 và /dev/video1)

# Kiểm tra ESP32 cắm qua cổng USB
ls -l /dev/ttyUSB* /dev/ttyACM* /dev/serial/by-id/
# (Thường là /dev/ttyUSB0 hoặc /dev/serial/by-id/usb-Silicon_Labs_CP2102_...)
```

---

## 3. Chuẩn Bị Môi Trường Ảo Python (venv) & Cài Đặt Thư Viện

```bash
# 1. Cập nhật hệ điều hành và gói phụ thuộc
sudo apt update && sudo apt install -y python3 python3-pip python3-venv git libgl1 libglib2.0-0

# 2. Tạo thư mục làm việc cho SmartBin Agent
mkdir -p ~/smartbin-agent
cd ~/smartbin-agent

# 3. Tạo môi trường ảo cách ly (Virtual Environment)
python3 -m venv venv

# 4. Kích hoạt môi trường ảo
source venv/bin/activate
```

Sau khi kích hoạt, dòng nhắc terminal sẽ có tiền tố `(venv)`.

Cài đặt các gói thư viện:
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 4. Cấu Hình Biến Môi Trường Bảo Mật

Tạo file `.env` tại `~/smartbin-agent/.env`:

```bash
nano .env
```

Nội dung file `.env`:
```ini
# 1. Server & Auth
SERVER_URL=https://smartbin-api-e08b.onrender.com
DEVICE_ID=raspberry-pi-5
DEVICE_INGEST_TOKEN=ThayBangTokenIngestCuaBan
TELEMETRY_INTERVAL=5

# 2. IPC Bridge AI YOLO (nhận kết quả từ ~/Desktop/yolo_camera.py)
SMARTBIN_YOLO_STATE_FILE=/tmp/smartbin_yolo_state.json

# 3. ESP32 Serial (Cảm biến siêu âm 3 ngăn)
ESP32_PORT=/dev/ttyUSB0
ESP32_BAUD_RATE=115200

# 4. Hiệu chuẩn thùng rác
EMPTY_DISTANCE_CM=50.0
FULL_DISTANCE_CM=5.0
```

> [!CAUTION]
> - Thay `ThayBangTokenIngestCuaBan` bằng giá trị `DEVICE_INGEST_TOKEN` đã cấu hình trên Render Environment Variables.
> - Tuyệt đối không commit file `.env` này vào Git hoặc chia sẻ công khai.

Phân quyền bảo vệ file `.env`:
```bash
chmod 600 .env
```

Chương trình YOLO và mô hình AI:
Mô hình YOLO và camera do chương trình `~/Desktop/yolo_camera.py` chạy trực tiếp trong virtualenv `~/yolo-env-new/` trên Raspberry Pi quản lý độc lập.
Pi Agent tự động nhận kết quả nhận diện đã được xuất qua file cầu nối IPC `/tmp/smartbin_yolo_state.json`.

---

## 5. Chạy Thử Nghiệm Pi Agent

Trong môi trường ảo `(venv)`:

```bash
python3 pi_agent.py
```

### Kết quả mong đợi trên màn hình terminal:
```text
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5] ==================================================
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5]    SmartBin Raspberry Pi 5 Agent v2.0.0
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5]    Nền tảng: Debian 13 ARM64
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5]    Device ID: raspberry-pi-5
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5]    Server URL: https://smartbin-api-e08b.onrender.com
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5]    Chu kỳ Telemetry: 5 giây
[2026-11-05 11:30:00] [INFO] [SmartBin-Pi5] ==================================================
[2026-11-05 11:30:01] [INFO] [SmartBin-Pi5] Khởi động ESP32 Serial Reader...
[2026-11-05 11:30:01] [INFO] [SmartBin-Pi5] Chế độ Bridge: Đọc kết quả nhận diện từ yolo_camera.py qua /tmp/smartbin_yolo_state.json...
[2026-11-05 11:30:01] [INFO] [SmartBin-Pi5] Đang khởi tạo kết nối Socket.IO...
[2026-11-05 11:30:02] [INFO] [SmartBin-Pi5] Đã kết nối thành công tới SmartBin Socket.IO Server
[2026-11-05 11:30:02] [INFO] [SmartBin-Pi5] Socket.IO telemetry -> uptime: 12450s | temp: 48.5°C | Subsystems: [YOLO: RUNNING, Cam: CONNECTED, ESP32: CONNECTED]
```

Nhấn `Ctrl + C` để dừng script an toàn.

---

## 6. Cài Đặt Systemd Service (Tự Động Khởi Động Cùng Pi 5 & Tự Hồi Phục Khi Lỗi)

Tạo file service hệ thống:
```bash
sudo nano /etc/systemd/system/smartbin-pi.service
```

Nội dung:
```ini
[Unit]
Description=SmartBin Raspberry Pi 5 Telemetry, YOLO AI & ESP32 Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/smartbin-agent
Environment=PATH=/home/pi/smartbin-agent/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
ExecStart=/home/pi/smartbin-agent/venv/bin/python3 /home/pi/smartbin-agent/pi_agent.py
Restart=always
RestartSec=5
KillMode=control-group
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Kích hoạt và bật service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable smartbin-pi.service
sudo systemctl start smartbin-pi.service
```

Kiểm tra trạng thái:
```bash
sudo systemctl status smartbin-pi.service
```

Theo dõi log thời gian thực:
```bash
journalctl -u smartbin-pi.service -f
```
