/*
 * SmartBin Station B - ESP32-C6 Firmware (v2.0)
 * Giao tiếp UART Serial B (Baud rate 115200, 8N1)
 *
 * CẤU HÌNH PHẦN CỨNG:
 * - Trạm B chỉ lắp đặt duy nhất ngăn rác RECYCLABLE (Cảm biến HC-SR04).
 * - Hai ngăn còn lại (NON_RECYCLABLE và ORGANIC) có trạng thái NOT_INSTALLED.
 * - Lưu trữ bootCount trong ESP32 Non-Volatile Storage (NVS Preferences).
 * - Sinh chuỗi UUIDv4 định danh bootId ngẫu nhiên khi khởi động.
 * - Đóng gói NDJSON kèm Checksum CRC-16/CCITT-FALSE.
 */

#include <Arduino.h>
#include <Preferences.h>
#include <ArduinoJson.h>

#define TRIG_PIN 4
#define ECHO_PIN 5
#define SERIAL_BAUD 115200

Preferences preferences;
uint32_t bootCount = 0;
String bootId = "";
uint32_t sampleSeq = 0;

uint16_t calculateCRC16(const uint8_t *data, size_t length) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc;
}

String generateUUID() {
    uint8_t uuid[16];
    esp_fill_random(uuid, sizeof(uuid));
    uuid[6] = (uuid[6] & 0x0F) | 0x40; // Version 4
    uuid[8] = (uuid[8] & 0x3F) | 0x80; // Variant 1

    char buf[37];
    snprintf(buf, sizeof(buf),
             "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
             uuid[0], uuid[1], uuid[2], uuid[3],
             uuid[4], uuid[5], uuid[6], uuid[7],
             uuid[8], uuid[9], uuid[10], uuid[11],
             uuid[12], uuid[13], uuid[14], uuid[15]);
    return String(buf);
}

float measureDistanceCm() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    long duration = pulseIn(ECHO_PIN, HIGH, 30000); // Timeout 30ms (~500cm)
    if (duration == 0) return -1.0;
    return (duration * 0.0343) / 2.0;
}

void setup() {
    Serial.begin(SERIAL_BAUD);
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);

    preferences.begin("smartbin_b", false);
    bootCount = preferences.getUInt("boot_count", 0) + 1;
    preferences.putUInt("boot_count", bootCount);
    preferences.end();

    bootId = generateUUID();
}

void loop() {
    sampleSeq++;
    float dist = measureDistanceCm();
    int fill = -1;
    String status = "OK";

    if (dist < 2.0 || dist > 400.0) {
        status = "ERROR";
    } else {
        // Hiệu chuẩn khoảng cách: 50cm = 0%, 5cm = 100%
        fill = round(((50.0 - dist) / 45.0) * 100.0);
        fill = max(0, min(100, fill));
    }

    StaticJsonDocument<512> doc;
    doc["stationCode"] = "STATION_B";
    doc["bootCount"] = bootCount;
    doc["bootId"] = bootId;
    doc["sampleSeq"] = sampleSeq;
    doc["uptimeMs"] = millis();

    JsonObject sensors = doc.createNestedObject("sensors");
    
    // Ngăn RECYCLABLE: Đã lắp đặt cảm biến
    JsonObject rec = sensors.createNestedObject("recyclable");
    if (status == "OK") {
        rec["distanceCm"] = dist;
        rec["fillPercent"] = fill;
        rec["status"] = "OK";
    } else {
        rec["status"] = status;
    }

    // Hai ngăn còn lại: KHÔNG LẮP ĐẶT (NOT_INSTALLED)
    JsonObject nonRec = sensors.createNestedObject("nonRecyclable");
    nonRec["status"] = "NOT_INSTALLED";

    JsonObject org = sensors.createNestedObject("organic");
    org["status"] = "NOT_INSTALLED";

    String jsonStr;
    serializeJson(doc, jsonStr);
    uint16_t crc = calculateCRC16((const uint8_t*)jsonStr.c_str(), jsonStr.length());
    doc["crc16"] = crc;

    serializeJson(doc, Serial);
    Serial.println();

    delay(3000); // Chu kỳ gửi 3 giây
}

