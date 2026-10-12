import React from 'react';
import { StateCard } from '../ui/kit';

interface DashboardErrorProps {
  errorMessage?: string | null;
  onRetry: () => void;
}

export const DashboardError: React.FC<DashboardErrorProps> = ({ errorMessage, onRetry }) => {
  return (
    <StateCard
      kind="error"
      title="Không thể tải dữ liệu tổng quan"
      message={errorMessage || 'Đã xảy ra lỗi khi kết nối đến máy chủ SmartBin. Vui lòng kiểm tra kết nối mạng và thử lại.'}
      onRetry={onRetry}
    />
  );
};
