import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { updateFillAlert } from './alert.service.js';

export interface IngestionPacket {
  stationCode: string;
  binCode: string;
  fillLevel?: number | null;
  distanceCm?: number | null;
  sensorStatus: 'OK' | 'ERROR' | 'OUT_OF_RANGE' | 'NOT_INSTALLED';
  isLegacy?: boolean;
  clientMessageId?: string;
  bootCount?: bigint | number;
  bootId?: string;
  sampleSeq?: number;
  payloadHash?: string;
  timestamp?: string | Date;
}

export interface IngestionResult {
  accepted: boolean;
  status:
    | 'ACCEPTED_IN_ORDER'
    | 'ACCEPTED_LATE'
    | 'FAST_ACK_DUPLICATE'
    | 'SKIPPED_NOT_INSTALLED'
    | 'SKIPPED_NO_VALID_READING'
    | 'UNKNOWN_STATION'
    | 'UNKNOWN_BIN'
    | 'COMMISSIONING_REQUIRED'
    | 'SEQUENCE_CLASH_TAMPERED'
    | 'LATE_PACKET_EXPIRED'
    | 'HASH_MISMATCH';
  stationCode: string;
  binCode: string;
  sampleSeq?: number;
  isLate?: boolean;
  alert?: any;
}

export class UnifiedTelemetryIngestionService {
  // Bộ nhớ đệm khử trùng lặp tầng truyền vận cho các gói tin gửi lại (TTL 60s)
  private readonly transportCache = new Map<string, number>();

  constructor() {
    // Dọn dẹp cache transport mỗi 60 giây
    setInterval(() => {
      const now = Date.now();
      for (const [key, exp] of this.transportCache.entries()) {
        if (now > exp) {
          this.transportCache.delete(key);
        }
      }
    }, 60000).unref();
  }

  public computePayloadHash(packet: {
    stationCode: string;
    binCode: string;
    fillLevel?: number | null;
    distanceCm?: number | null;
    sensorStatus: string;
  }): string {
    const raw = `${packet.stationCode}:${packet.binCode}:${packet.fillLevel ?? 'null'}:${packet.distanceCm ?? 'null'}:${packet.sensorStatus}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  public async ingest(packet: IngestionPacket): Promise<IngestionResult> {
    const stationCode = packet.stationCode.toUpperCase();
    const binCode = packet.binCode.toUpperCase();

    // 1. Kiểm tra khử trùng lặp tầng truyền vận (Transport Idempotency)
    // QUY TẮC: Khóa khử trùng lặp phải phân biệt theo từng ngăn rác (stationCode:binCode:clientMessageId)
    // để tránh tình trạng gói tin đa ngăn của Trạm A chỉ nạp ngăn đầu tiên và bỏ qua 2 ngăn còn lại.
    if (packet.clientMessageId) {
      const transportKey = `${stationCode}:${binCode}:${packet.clientMessageId}`;
      if (this.transportCache.has(transportKey)) {
        return {
          accepted: true,
          status: 'FAST_ACK_DUPLICATE',
          stationCode,
          binCode
        };
      }
      this.transportCache.set(transportKey, Date.now() + 60000);
    }

    // 2. Tìm trạm và thùng rác tương ứng
    const station = await prisma.station.findUnique({ where: { code: stationCode } });
    if (station && !station.isActive) {
      return { accepted: false, status: 'UNKNOWN_STATION', stationCode, binCode };
    }
    if (!station && stationCode !== 'STATION_A') {
      return { accepted: false, status: 'UNKNOWN_STATION', stationCode, binCode };
    }

    // 2.1. Tìm thùng rác theo đúng stationId và binCode chuẩn
    let bin = station
      ? await prisma.bin.findFirst({
          where: {
            stationId: station.id,
            binCode,
            isActive: true
          }
        })
      : null;

    // 2.2. Fallback cho Station A nếu database Production chưa chạy script gán stationId (stationId IS NULL)
    if (!bin && stationCode === 'STATION_A') {
      bin = await prisma.bin.findFirst({
        where: {
          stationId: null,
          binCode,
          isActive: true
        }
      });
    }

    if (!bin) {
      console.warn(`[UnifiedTelemetryIngestion] UNKNOWN_BIN: Station '${stationCode}' has no active bin '${binCode}'`);
      return { accepted: false, status: 'UNKNOWN_BIN', stationCode, binCode };
    }

    // 3. Xử lý ngăn rác chưa gắn cảm biến (NOT_INSTALLED)
    // QUY TẮC BẤT BIẾN: Không tạo SensorReading, không lưu số liệu đo giả
    if (bin.installed === false || packet.sensorStatus === 'NOT_INSTALLED') {
      return {
        accepted: true,
        status: 'SKIPPED_NOT_INSTALLED',
        stationCode,
        binCode
      };
    }

    // 3.1. Cảm biến lỗi / timeout / giá trị không hợp lệ:
    // QUY TẮC BẤT BIẾN: Không ghi SensorReading, không cập nhật Bin.currentFillLevel,
    // không làm mới Bin.lastSeen. Trước đây `packet.fillLevel ?? 0` biến lỗi cảm biến thành 0% giả.
    const hasValidFill = typeof packet.fillLevel === 'number'
      && Number.isFinite(packet.fillLevel)
      && packet.fillLevel >= 0
      && packet.fillLevel <= 100;
    if (packet.sensorStatus !== 'OK' || !hasValidFill) {
      return {
        accepted: true,
        status: 'SKIPPED_NO_VALID_READING',
        stationCode,
        binCode
      };
    }

    const now = new Date();
    const packetTimestamp = packet.timestamp ? new Date(packet.timestamp) : now;

    // =========================================================================
    // CHẾ ĐỘ 1: LEGACY MODE (Dành cho Firmware A cũ từ Trạm A)
    // TUYỆT ĐỐI KHÔNG TỰ SINH SEQUENCE HAY BOOTCOUNT GIẢ!
    // =========================================================================
    const isLegacy = packet.isLegacy === true || packet.bootCount === undefined || !packet.bootId || packet.sampleSeq === undefined;
    if (isLegacy) {
      const fill = packet.fillLevel ?? 0;
      const distance = packet.distanceCm ?? 0.0;

      // Điều tiết lấy mẫu: Chỉ ghi bản ghi nếu mức đầy đổi >= 1% hoặc sau mỗi 5 phút
      const lastReading = await prisma.sensorReading.findFirst({
        where: { binId: bin.id },
        orderBy: { timestamp: 'desc' }
      });

      const fillDiff = lastReading ? Math.abs(lastReading.fillLevel - fill) : 100;
      const timeElapsedMs = lastReading ? now.getTime() - lastReading.timestamp.getTime() : 1000000;
      const shouldInsertReading = fillDiff >= 1 || timeElapsedMs >= 300000;

      if (shouldInsertReading) {
        await prisma.sensorReading.create({
          data: {
            binId: bin.id,
            fillLevel: fill,
            distance,
            isLate: false,
            timestamp: packetTimestamp
          }
        });
      }

      await prisma.bin.update({
        where: { id: bin.id },
        data: {
          currentFillLevel: fill,
          status: 'ONLINE',
          lastSeen: packetTimestamp
        }
      });

      const alert = await updateFillAlert(bin.id, bin.binCode, fill);
      return {
        accepted: true,
        status: 'ACCEPTED_IN_ORDER',
        stationCode,
        binCode,
        alert
      };
    }

    // =========================================================================
    // CHẾ ĐỘ 2: STRICT MULTI-STATION MODE (Firmware v2.0 Trạm B)
    // Kiểm tra toàn vẹn mã băm, State Machine, Khóa dòng Watermark & Anti-Replay
    // =========================================================================
    const bootCount = BigInt(packet.bootCount!);
    const bootId = packet.bootId!;
    const sampleSeq = packet.sampleSeq!;
    const expectedHash = this.computePayloadHash({
      stationCode,
      binCode,
      fillLevel: packet.fillLevel,
      distanceCm: packet.distanceCm,
      sensorStatus: packet.sensorStatus
    });

    if (packet.payloadHash && packet.payloadHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return {
        accepted: false,
        status: 'HASH_MISMATCH',
        stationCode,
        binCode,
        sampleSeq
      };
    }
    const finalHash = packet.payloadHash || expectedHash;

    // Giao dịch nguyên tử với Watermark
    return await prisma.$transaction(async (tx) => {
      // 1. Tìm hoặc khởi tạo bản ghi Watermark
      let watermark = await tx.stationWatermark.findUnique({
        where: {
          stationCode_binCode: {
            stationCode,
            binCode
          }
        }
      });

      if (!watermark) {
        watermark = await tx.stationWatermark.create({
          data: {
            stationCode,
            binCode,
            bootCount,
            bootId,
            lastSampleSeq: 0,
            lastPayloadHash: finalHash
          }
        });
      }

      // 2. State Machine kiểm tra phiên boot:
      // A. Nếu bootCount nhỏ hơn mốc đã lưu -> Phát hiện NVS bị reset hoặc phát lại phiên cũ
      if (bootCount < watermark.bootCount) {
        // Tạo cảnh báo cách ly COMMISSIONING_REQUIRED
        await tx.alert.create({
          data: {
            binId: bin.id,
            type: 'COMMISSIONING_REQUIRED',
            severity: 'CRITICAL',
            message: `Trạm ${stationCode} ngăn ${binCode} báo bootCount (${bootCount}) nhỏ hơn mốc lưu (${watermark.bootCount}). Đã cách ly chờ Quản trị viên duyệt Commissioning.`
          }
        });
        return {
          accepted: false,
          status: 'COMMISSIONING_REQUIRED',
          stationCode,
          binCode,
          sampleSeq
        };
      }

      // B. Nếu bootCount bằng mốc đã lưu (cùng phiên boot hoặc bình thường)
      if (bootCount === watermark.bootCount) {
        // B1. Trùng sequence:
        if (sampleSeq === watermark.lastSampleSeq) {
          if (finalHash === watermark.lastPayloadHash) {
            // Gói tin gửi lại hợp lệ do mất ACK mạng -> Fast ACK 200, no-op DB
            return {
              accepted: true,
              status: 'FAST_ACK_DUPLICATE',
              stationCode,
              binCode,
              sampleSeq
            };
          } else {
            // Cùng số thứ tự nhưng khác nội dung payload -> Phát hiện giả mạo/xung đột!
            return {
              accepted: false,
              status: 'SEQUENCE_CLASH_TAMPERED',
              stationCode,
              binCode,
              sampleSeq
            };
          }
        }

        // B2. Gói tin đến trễ / Sai thứ tự (sampleSeq < watermark.lastSampleSeq)
        if (sampleSeq < watermark.lastSampleSeq) {
          // Kiểm tra xem đã có trong Ledger chưa
          const inLedger = await tx.telemetryIdempotencyLedger.findUnique({
            where: {
              stationCode_bootId_sampleSeq: {
                stationCode,
                bootId,
                sampleSeq
              }
            }
          });

          if (inLedger) {
            return {
              accepted: true,
              status: 'FAST_ACK_DUPLICATE',
              stationCode,
              binCode,
              sampleSeq
            };
          }

          // Kiểm tra độ trễ (Arrival Delay): Cho phép trong vòng 60 giây
          const arrivalDelayMs = now.getTime() - packetTimestamp.getTime();
          if (arrivalDelayMs <= 60000) {
            // Chấp nhận lưu lịch sử lạnh (Cold Storage)
            // QUY TẮC BẤT BIẾN:
            // 1. Tuyệt đối KHÔNG lùi Watermark
            // 2. Tuyệt đối KHÔNG ghi đè Bin.currentFillLevel
            await tx.sensorReading.create({
              data: {
                binId: bin.id,
                fillLevel: packet.fillLevel ?? 0,
                distance: packet.distanceCm ?? 0.0,
                isLate: true,
                timestamp: packetTimestamp
              }
            });

            await tx.telemetryIdempotencyLedger.create({
              data: {
                stationCode,
                bootId,
                sampleSeq,
                payloadHash: finalHash,
                receivedAt: now
              }
            });

            return {
              accepted: true,
              status: 'ACCEPTED_LATE',
              stationCode,
              binCode,
              sampleSeq,
              isLate: true
            };
          } else {
            // Quá hạn 60s -> Loại bỏ
            return {
              accepted: false,
              status: 'LATE_PACKET_EXPIRED',
              stationCode,
              binCode,
              sampleSeq
            };
          }
        }
      }

      // C. Gói tin hợp lệ theo thứ tự tiến (sampleSeq > watermark.lastSampleSeq HOẶC bootCount mới)
      const fill = packet.fillLevel ?? 0;
      const distance = packet.distanceCm ?? 0.0;

      // 1. Ghi bản ghi đo lường mới
      await tx.sensorReading.create({
        data: {
          binId: bin.id,
          fillLevel: fill,
          distance,
          isLate: false,
          timestamp: packetTimestamp
        }
      });

      // 2. Cập nhật trạng thái tức thời của thùng rác
      await tx.bin.update({
        where: { id: bin.id },
        data: {
          currentFillLevel: fill,
          status: 'ONLINE',
          lastSeen: packetTimestamp
        }
      });

      // 3. Cập nhật Watermark tiến tịnh tiến
      await tx.stationWatermark.update({
        where: { id: watermark.id },
        data: {
          bootCount,
          bootId,
          lastSampleSeq: sampleSeq,
          lastPayloadHash: finalHash,
          updatedAt: now
        }
      });

      // 4. Lưu vết vào Ledger
      await tx.telemetryIdempotencyLedger.upsert({
        where: {
          stationCode_bootId_sampleSeq: {
            stationCode,
            bootId,
            sampleSeq
          }
        },
        create: {
          stationCode,
          bootId,
          sampleSeq,
          payloadHash: finalHash,
          receivedAt: now
        },
        update: {
          payloadHash: finalHash,
          receivedAt: now
        }
      });

      // 5. Cập nhật cảnh báo rác đầy
      const alert = await updateFillAlert(bin.id, bin.binCode, fill);

      return {
        accepted: true,
        status: 'ACCEPTED_IN_ORDER',
        stationCode,
        binCode,
        sampleSeq,
        alert
      };
    });
  }
}

export const unifiedTelemetryIngestionService = new UnifiedTelemetryIngestionService();

