/**
 * Định dạng độ tin cậy (confidence) của kết quả nhận diện AI để hiển thị trên Dashboard.
 *
 * Contract dữ liệu: confidence là số thực trong khoảng [0, 1]
 * (do Pi Agent / smartbin_yolo_bridge chuẩn hóa trước khi gửi telemetry).
 * Chỉ nhân 100 tại thời điểm hiển thị.
 *
 * Ví dụ: 0.92 -> "92%", 0.856 -> "85.6%", 1 -> "100%".
 *
 * Giá trị null, undefined, NaN, Infinity, không phải số hoặc nằm ngoài [0, 1]
 * được coi là không hợp lệ và trả về ký hiệu thay thế (không đoán định thang đo).
 */
export const CONFIDENCE_PLACEHOLDER = '—';

export function formatConfidence(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CONFIDENCE_PLACEHOLDER;
  }
  if (value < 0 || value > 1) {
    return CONFIDENCE_PLACEHOLDER;
  }
  // Làm tròn tới 1 chữ số thập phân; bỏ phần ".0" (0.92 -> 92, 0.856 -> 85.6)
  const percent = Math.round(value * 1000) / 10;
  return `${percent}%`;
}

