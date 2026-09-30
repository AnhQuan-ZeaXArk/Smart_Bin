/**
 * Utility functions for formatting dates, time, and metrics in Vietnamese locale
 */

export function formatTime(date: Date | null): string {
  if (!date) return '--:--:--';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatDate(date: Date | null): string {
  if (!date) return '--/--/----';
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null || latencyMs === undefined) return '-- ms';
  return `${latencyMs} ms`;
}

export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'Chưa cập nhật';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'Chưa cập nhật';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 45) return 'Vừa cập nhật';
  if (diffMin < 60) return `${diffMin} phút trước`;
  if (diffHour < 24) return `${diffHour} giờ trước`;
  if (diffDay < 7) return `${diffDay} ngày trước`;

  return formatDate(date);
}

export function formatDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '--:-- --/--/----';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '--:-- --/--/----';

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();

  return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return 'Chưa có dữ liệu';
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes} phút ${remainingSeconds > 0 ? `${remainingSeconds}s` : ''}`.trim();
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours} giờ ${remainingMinutes > 0 ? `${remainingMinutes}p` : ''}`.trim();
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days} ngày ${remainingHours > 0 ? `${remainingHours}h` : ''}`.trim();
}

