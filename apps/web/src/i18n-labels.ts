// Ánh xạ nhãn hiển thị tiếng Việt cho các giá trị enum của backend (không đổi giá trị enum gốc).
export function translateBinStatus(status: string): string {
  switch (status) {
    case 'ONLINE': return 'Trực tuyến';
    case 'OFFLINE': return 'Ngoại tuyến';
    case 'MAINTENANCE': return 'Bảo trì';
    default: return status;
  }
}

export function translateFillCategory(category: string): string {
  switch (category) {
    case 'NORMAL': return 'Bình thường';
    case 'MONITOR': return 'Cần theo dõi';
    case 'NEARLY_FULL': return 'Gần đầy';
    case 'CRITICAL': return 'Đầy';
    default: return category;
  }
}


export function translateAlertSeverity(severity: string): string {
  switch (severity) {
    case 'INFO': return 'Thông tin';
    case 'WARNING': return 'Cảnh báo';
    case 'CRITICAL': return 'Nghiêm trọng';
    default: return severity;
  }
}
