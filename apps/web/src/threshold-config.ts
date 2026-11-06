export type FillLevelStatus = 'NORMAL' | 'WARNING' | 'NEARLY_FULL' | 'FULL';

export type SmartBinThresholds = {
  warningThreshold: number;
  nearFullThreshold: number;
  fullThreshold: number;
};

export const SMARTBIN_SETTINGS_KEY = 'smartbin-demo-settings';

export const DEFAULT_THRESHOLDS: SmartBinThresholds = {
  warningThreshold: 50,
  nearFullThreshold: 70,
  fullThreshold: 90
};

export function readSmartBinThresholds(): SmartBinThresholds {
  try {
    const raw = localStorage.getItem(SMARTBIN_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };

    const parsed = JSON.parse(raw) as Partial<SmartBinThresholds>;
    const warningThreshold = Number(parsed.warningThreshold ?? DEFAULT_THRESHOLDS.warningThreshold);
    const nearFullThreshold = Number(parsed.nearFullThreshold ?? DEFAULT_THRESHOLDS.nearFullThreshold);
    const fullThreshold = Number(parsed.fullThreshold ?? DEFAULT_THRESHOLDS.fullThreshold);

    return {
      warningThreshold: Number.isFinite(warningThreshold) ? warningThreshold : DEFAULT_THRESHOLDS.warningThreshold,
      nearFullThreshold: Number.isFinite(nearFullThreshold) ? nearFullThreshold : DEFAULT_THRESHOLDS.nearFullThreshold,
      fullThreshold: Number.isFinite(fullThreshold) ? fullThreshold : DEFAULT_THRESHOLDS.fullThreshold
    };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveSmartBinThresholds(nextThresholds: SmartBinThresholds) {
  localStorage.setItem(SMARTBIN_SETTINGS_KEY, JSON.stringify(nextThresholds));
}

export function validateSmartBinThresholds(value: SmartBinThresholds) {
  if (
    !Number.isFinite(value.warningThreshold) ||
    !Number.isFinite(value.nearFullThreshold) ||
    !Number.isFinite(value.fullThreshold) ||
    value.warningThreshold < 0 ||
    value.warningThreshold > 100 ||
    value.nearFullThreshold < 0 ||
    value.nearFullThreshold > 100 ||
    value.fullThreshold < 0 ||
    value.fullThreshold > 100
  ) {
    return 'Ngưỡng phải nằm trong khoảng 0–100.';
  }

  if (!(value.warningThreshold < value.nearFullThreshold && value.nearFullThreshold < value.fullThreshold)) {
    return 'Ngưỡng phải thỏa mãn: Cảnh báo < Gần đầy < Đầy.';
  }

  return '';
}

export function getFillLevelStatus(fillLevel: number, thresholds: SmartBinThresholds = DEFAULT_THRESHOLDS): FillLevelStatus {
  const safeValue = Number.isFinite(fillLevel) ? Math.min(100, Math.max(0, fillLevel)) : 0;
  if (safeValue < thresholds.warningThreshold) return 'NORMAL';
  if (safeValue < thresholds.nearFullThreshold) return 'WARNING';
  if (safeValue < thresholds.fullThreshold) return 'NEARLY_FULL';
  return 'FULL';
}

export const FILL_LEVEL_STATUS_LABEL: Record<FillLevelStatus, string> = {
  NORMAL: 'Bình thường',
  WARNING: 'Cảnh báo',
  NEARLY_FULL: 'Gần đầy',
  FULL: 'Đầy'
};

export const FILL_LEVEL_STATUS_TONE: Record<FillLevelStatus, string> = {
  NORMAL: 'normal',
  WARNING: 'monitor',
  NEARLY_FULL: 'nearly_full',
  FULL: 'critical'
};
