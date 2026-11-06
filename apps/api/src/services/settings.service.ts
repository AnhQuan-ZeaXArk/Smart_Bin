import { env } from '../config/env.js';
import { prisma, isDatabaseReady } from '../lib/prisma.js';

export interface SystemThresholds {
  warningThreshold: number;
  nearFullThreshold: number;
  fullThreshold: number;
  updatedAt: string;
}

export const DEFAULT_THRESHOLDS: SystemThresholds = {
  warningThreshold: 50,
  nearFullThreshold: 70,
  fullThreshold: 90,
  updatedAt: new Date().toISOString()
};

// Cache TTL (Time-To-Live): 30 giây để hỗ trợ đồng bộ tự động giữa nhiều Backend instance
const CACHE_TTL_MS = 30_000;

class SettingsService {
  private inMemoryThresholds: SystemThresholds = { ...DEFAULT_THRESHOLDS };
  private lastFetchedAt = 0;
  private isFetching = false;

  /**
   * Lấy cấu hình ngưỡng cảnh báo hiện tại.
   * PostgreSQL là nguồn dữ liệu chính thức duy nhất (Single Source of Truth).
   */
  async getThresholds(): Promise<SystemThresholds> {
    if (env.isDemoMode || !isDatabaseReady()) {
      return { ...this.inMemoryThresholds };
    }

    try {
      // Tìm cấu hình hệ thống duy nhất (id = 'default')
      const row = await prisma.systemSetting.findUnique({
        where: { id: 'default' }
      });

      if (!row) {
        // Chưa có dữ liệu: Khởi tạo giá trị mặc định vào PostgreSQL một cách an toàn
        const created = await prisma.systemSetting.create({
          data: {
            id: 'default',
            warningThreshold: DEFAULT_THRESHOLDS.warningThreshold,
            nearFullThreshold: DEFAULT_THRESHOLDS.nearFullThreshold,
            fullThreshold: DEFAULT_THRESHOLDS.fullThreshold
          }
        });

        this.inMemoryThresholds = {
          warningThreshold: created.warningThreshold,
          nearFullThreshold: created.nearFullThreshold,
          fullThreshold: created.fullThreshold,
          updatedAt: created.updatedAt.toISOString()
        };
        this.lastFetchedAt = Date.now();
        return { ...this.inMemoryThresholds };
      }

      this.inMemoryThresholds = {
        warningThreshold: row.warningThreshold,
        nearFullThreshold: row.nearFullThreshold,
        fullThreshold: row.fullThreshold,
        updatedAt: row.updatedAt.toISOString()
      };
      this.lastFetchedAt = Date.now();
      return { ...this.inMemoryThresholds };
    } catch (error) {
      console.warn('[SettingsService] Failed to read settings from PostgreSQL, falling back to cache:', error instanceof Error ? error.message : error);
      return { ...this.inMemoryThresholds };
    }
  }

  /**
   * Cập nhật cấu hình ngưỡng cảnh báo.
   * Thao tác nguyên tử vào PostgreSQL (upsert) để đảm bảo không bị ghi đè một phần.
   */
  async updateThresholds(input: {
    warningThreshold: number;
    nearFullThreshold: number;
    fullThreshold: number;
  }): Promise<SystemThresholds> {
    const { warningThreshold, nearFullThreshold, fullThreshold } = input;

    // Validate logic chặt chẽ: 0 <= warning < nearFull < full <= 100
    if (
      !Number.isFinite(warningThreshold) ||
      !Number.isFinite(nearFullThreshold) ||
      !Number.isFinite(fullThreshold) ||
      warningThreshold < 0 ||
      warningThreshold > 100 ||
      nearFullThreshold < 0 ||
      nearFullThreshold > 100 ||
      fullThreshold < 0 ||
      fullThreshold > 100
    ) {
      throw new Error('Giá trị ngưỡng phải nằm trong khoảng 0–100.');
    }

    if (!(warningThreshold < nearFullThreshold && nearFullThreshold < fullThreshold)) {
      throw new Error('Thứ tự ngưỡng không hợp lệ: phải thỏa mãn 0 <= Cảnh báo < Gần đầy < Đầy <= 100.');
    }

    const now = new Date();

    if (env.isDemoMode || !isDatabaseReady()) {
      this.inMemoryThresholds = {
        warningThreshold,
        nearFullThreshold,
        fullThreshold,
        updatedAt: now.toISOString()
      };
      this.lastFetchedAt = Date.now();
      return { ...this.inMemoryThresholds };
    }

    try {
      // Upsert nguyên tử vào PostgreSQL: bộ 3 ngưỡng luôn được ghi đồng thời như một đơn vị thống nhất
      const updated = await prisma.systemSetting.upsert({
        where: { id: 'default' },
        create: {
          id: 'default',
          warningThreshold,
          nearFullThreshold,
          fullThreshold,
          updatedAt: now
        },
        update: {
          warningThreshold,
          nearFullThreshold,
          fullThreshold,
          updatedAt: now
        }
      });

      this.inMemoryThresholds = {
        warningThreshold: updated.warningThreshold,
        nearFullThreshold: updated.nearFullThreshold,
        fullThreshold: updated.fullThreshold,
        updatedAt: updated.updatedAt.toISOString()
      };
      this.lastFetchedAt = Date.now();
      return { ...this.inMemoryThresholds };
    } catch (error) {
      console.error('[SettingsService] Failed to persist settings to PostgreSQL:', error);
      // Khi Database thất bại, KHÔNG cập nhật cache nhằm tránh tình trạng cache lưu dữ liệu chưa được PostgreSQL chấp nhận
      throw error;
    }
  }

  /**
   * Lấy nhanh cấu hình từ bộ nhớ đệm (dùng cho các luồng xử lý telemetry realtime liên tục).
   * Tự động kích hoạt làm mới ngầm nếu cache quá hạn (TTL 30s) nhằm đảm bảo nhiều instance luôn đồng bộ.
   */
  getCachedThresholds(): SystemThresholds {
    const elapsed = Date.now() - this.lastFetchedAt;
    if (elapsed > CACHE_TTL_MS && !this.isFetching && !env.isDemoMode && isDatabaseReady()) {
      this.isFetching = true;
      this.getThresholds()
        .catch(() => {})
        .finally(() => {
          this.isFetching = false;
        });
    }
    return { ...this.inMemoryThresholds };
  }
}

export const settingsService = new SettingsService();
