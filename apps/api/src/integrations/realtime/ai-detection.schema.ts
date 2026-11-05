import { z } from 'zod';

/**
 * Schema chuẩn cho kết quả nhận diện AI (YOLO) gửi từ Raspberry Pi 5.
 *
 * Contract: confidence là số thực trong khoảng [0, 1] (ví dụ 0.958 = 95.8%).
 * Pi Agent (smartbin_yolo_bridge.py) chuẩn hóa giá trị trước khi gửi;
 * Dashboard chỉ nhân 100 khi hiển thị.
 *
 * Giá trị ngoài [0, 1] KHÔNG được tự động quy đổi.
 */
export const aiDetectionStrictSchema = z.object({
  class: z.string(),
  rawClass: z.string().optional(),
  // Strict: phải là JSON number hữu hạn. Không coerce (null / "" / "0.92" bị từ chối,
  // NaN / Infinity bị z.number() từ chối mặc định).
  confidence: z.number().min(0).max(1),
  inferenceTimeMs: z.coerce.number().optional().nullable(),
  timestamp: z.string()
});

/**
 * Dùng trong schema telemetry/heartbeat: nếu aiDetection không hợp lệ
 * (ví dụ confidence = 95.8 theo thang 0-100), chỉ loại bỏ trường aiDetection
 * (trả về null) và ghi cảnh báo — KHÔNG từ chối toàn bộ gói heartbeat, để
 * trạng thái kết nối của thiết bị không bị báo sai thành OFFLINE.
 */
export const aiDetectionInputSchema = aiDetectionStrictSchema
  .optional()
  .nullable()
  .catch((ctx) => {
    const issues = ctx.error.issues.map((i) => `${i.path.join('.') || 'aiDetection'}: ${i.message}`).join(', ');
    console.warn(`[AiDetection] Dropped invalid aiDetection payload (expected confidence in [0, 1]): ${issues}`);
    return null;
  });

