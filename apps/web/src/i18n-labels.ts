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

export function translateEmployeeStatus(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'Đang hoạt động';
    case 'INACTIVE': return 'Không hoạt động';
    default: return status;
  }
}

export function translateCardStatus(status: string | null | undefined): string {
  switch (status) {
    case 'ACTIVE': return 'Đang hoạt động';
    case 'REVOKED': return 'Đã thu hồi';
    case 'LOST': return 'Đã mất';
    case 'EXPIRED': return 'Đã hết hạn';
    default: return 'Chưa gán';
  }
}

export function translateAccessResult(result: string): string {
  switch (result) {
    case 'ALLOWED': return 'Được phép';
    case 'DENIED': return 'Từ chối';
    default: return result;
  }
}

export function translateAccessReason(reason: string): string {
  switch (reason) {
    case 'VALID_CARD': return 'Thẻ hợp lệ';
    case 'UNKNOWN_CARD': return 'Thẻ không xác định';
    case 'REVOKED_CARD': return 'Thẻ đã thu hồi';
    case 'LOST_CARD': return 'Thẻ đã mất';
    case 'EXPIRED_CARD': return 'Thẻ đã hết hạn';
    case 'INACTIVE_EMPLOYEE': return 'Nhân viên ngừng hoạt động';
    default: return reason;
  }
}

export function translateAccessAction(action: string): string {
  return action === 'AUTHENTICATE' ? 'Xác thực' : action;
}

export function translateAlertSeverity(severity: string): string {
  switch (severity) {
    case 'INFO': return 'Thông tin';
    case 'WARNING': return 'Cảnh báo';
    case 'CRITICAL': return 'Nghiêm trọng';
    default: return severity;
  }
}
