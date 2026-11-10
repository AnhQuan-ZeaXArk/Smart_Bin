import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export const deviceCollectionEventSchema = z.object({
  eventId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  stationId: z.string().trim().min(1).default('station_a'),
  triggerSource: z.enum(['PHYSICAL_BUTTON', 'WEB_DASHBOARD']).default('PHYSICAL_BUTTON'),
  eventType: z.enum(['OPEN', 'CLOSE']),
  occurredAt: z.string().trim().refine((val) => !Number.isNaN(new Date(val).getTime()), {
    message: 'Invalid ISO-8601 occurredAt timestamp'
  }),
  fillPercent: z.number().int().min(0).max(100).optional().nullable()
});

export type DeviceCollectionEventInput = z.infer<typeof deviceCollectionEventSchema>;

export interface BinCompartmentInfo {
  binId: string;
  binCode: string;
  name: string;
  fillLevelBefore: number | null;
  fillLevelAfter: number | null;
}

export interface CollectionSessionMetadata {
  type: 'COLLECTION_SESSION';
  sessionId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  triggerSource: 'PHYSICAL_BUTTON' | 'WEB_DASHBOARD';
  openEventId: string;
  closeEventId: string | null;
  openedAt: string;
  closedAt: string | null;
  fillLevelBefore: number | null;
  fillLevelAfter: number | null;
  compartmentsCount: number;
  compartments: BinCompartmentInfo[];
  createdAt: string;
}

export interface CollectionSessionIngestResult {
  success: boolean;
  status:
    | 'OPENED_SAVED'
    | 'CLOSED_SAVED'
    | 'DUPLICATE_IGNORED'
    | 'SESSION_ALREADY_OPEN'
    | 'SESSION_NOT_FOUND'
    | 'SESSION_ALREADY_CLOSED'
    | 'VALIDATION_FAILED'
    | 'STATION_BIN_NOT_FOUND'
    | 'INGESTION_ERROR';
  duplicate?: boolean;
  eventId?: string;
  sessionId?: string;
  eventType?: 'OPEN' | 'CLOSE';
  createdAt?: string;
  error?: string;
  session?: {
    sessionId: string;
    stationId: string;
    stationCode: string;
    stationName: string;
    triggerSource: string;
    openedAt: string;
    closedAt: string | null;
    fillLevelBefore: number | null;
    fillLevelAfter: number | null;
    status: 'IN_PROGRESS' | 'COMPLETED';
    openEventId: string;
    closeEventId: string | null;
    compartmentsCount: number;
    compartments: BinCompartmentInfo[];
    createdAt: string;
  };
}

export function parseSessionMetadata(notes: string | null | undefined): CollectionSessionMetadata | null {
  if (!notes || typeof notes !== 'string') return null;
  try {
    const parsed = JSON.parse(notes) as Partial<CollectionSessionMetadata>;
    if (
      parsed &&
      parsed.type === 'COLLECTION_SESSION' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.openEventId === 'string' &&
      typeof parsed.openedAt === 'string'
    ) {
      const stationCode = typeof parsed.stationCode === 'string' ? parsed.stationCode : 'STATION_A';
      const stationId =
        typeof parsed.stationId === 'string' ? parsed.stationId : (stationCode === 'STATION_B' ? 'station_b' : 'station_a');
      const stationName =
        typeof parsed.stationName === 'string' ? parsed.stationName : (stationCode === 'STATION_B' ? 'Trạm B' : 'Trạm A');
      const triggerSource =
        parsed.triggerSource === 'WEB_DASHBOARD' || parsed.triggerSource === 'PHYSICAL_BUTTON'
          ? parsed.triggerSource
          : 'PHYSICAL_BUTTON';

      const compartments: BinCompartmentInfo[] = Array.isArray(parsed.compartments)
        ? parsed.compartments.map((c) => ({
            binId: typeof c.binId === 'string' ? c.binId : '',
            binCode: typeof c.binCode === 'string' ? c.binCode : 'UNKNOWN',
            name: typeof c.name === 'string' ? c.name : 'Ngăn rác',
            fillLevelBefore:
              typeof c.fillLevelBefore === 'number' && c.fillLevelBefore >= 0 && c.fillLevelBefore <= 100
                ? c.fillLevelBefore
                : null,
            fillLevelAfter:
              typeof c.fillLevelAfter === 'number' && c.fillLevelAfter >= 0 && c.fillLevelAfter <= 100
                ? c.fillLevelAfter
                : null
          }))
        : [];

      return {
        type: 'COLLECTION_SESSION',
        sessionId: parsed.sessionId,
        stationId,
        stationCode,
        stationName,
        triggerSource,
        openEventId: parsed.openEventId,
        closeEventId: typeof parsed.closeEventId === 'string' ? parsed.closeEventId : null,
        openedAt: parsed.openedAt,
        closedAt: typeof parsed.closedAt === 'string' ? parsed.closedAt : null,
        fillLevelBefore:
          typeof parsed.fillLevelBefore === 'number' && parsed.fillLevelBefore >= 0 && parsed.fillLevelBefore <= 100
            ? parsed.fillLevelBefore
            : null,
        fillLevelAfter:
          typeof parsed.fillLevelAfter === 'number' && parsed.fillLevelAfter >= 0 && parsed.fillLevelAfter <= 100
            ? parsed.fillLevelAfter
            : null,
        compartmentsCount:
          typeof parsed.compartmentsCount === 'number' ? parsed.compartmentsCount : (compartments.length || 3),
        compartments,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : parsed.openedAt
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function serializeCollectionRecord(record: {
  id: string;
  collectedBy: string | null;
  collectedAt: Date | string;
  fillLevelBefore: number;
  fillLevelAfter: number | null;
  status: string;
  notes: string | null;
  createdAt?: Date | string;
  bin: {
    binCode: string;
    name: string;
    stationId?: string | null;
    station?: { code: string; name: string } | null;
  };
}) {
  const sessionMeta = parseSessionMetadata(record.notes);
  const collectedAtIso =
    record.collectedAt instanceof Date ? record.collectedAt.toISOString() : new Date(record.collectedAt).toISOString();
  const createdAtIso =
    record.createdAt instanceof Date
      ? record.createdAt.toISOString()
      : typeof record.createdAt === 'string'
        ? record.createdAt
        : sessionMeta?.createdAt ?? collectedAtIso;

  const stationCode = sessionMeta?.stationCode ?? record.bin.station?.code ?? 'STATION_A';
  const stationId =
    sessionMeta?.stationId ?? (stationCode === 'STATION_B' ? 'station_b' : 'station_a');
  const stationName =
    sessionMeta?.stationName ?? record.bin.station?.name ?? (stationCode === 'STATION_B' ? 'Trạm B' : 'Trạm A');
  const triggerSource =
    sessionMeta?.triggerSource ??
    (record.collectedBy === 'PHYSICAL_BUTTON' || record.collectedBy === 'WEB_DASHBOARD'
      ? record.collectedBy
      : (record.collectedBy || 'PHYSICAL_BUTTON'));
  const openedAt = sessionMeta?.openedAt ?? collectedAtIso;
  const closedAt =
    sessionMeta?.closedAt ?? (record.status === 'COMPLETED' && !sessionMeta ? collectedAtIso : null);

  const resolvedFillBefore =
    sessionMeta?.fillLevelBefore !== undefined
      ? sessionMeta.fillLevelBefore
      : (typeof record.fillLevelBefore === 'number' && record.fillLevelBefore >= 0 && record.fillLevelBefore <= 100
          ? record.fillLevelBefore
          : null);

  const resolvedFillAfter =
    sessionMeta?.fillLevelAfter !== undefined
      ? sessionMeta.fillLevelAfter
      : (typeof record.fillLevelAfter === 'number' && record.fillLevelAfter >= 0 && record.fillLevelAfter <= 100
          ? record.fillLevelAfter
          : (record.status === 'COMPLETED' ? 0 : null));

  const defaultCompartments: BinCompartmentInfo[] = [
    { binId: '', binCode: 'RECYCLABLE', name: 'Rác tái chế', fillLevelBefore: resolvedFillBefore, fillLevelAfter: resolvedFillAfter },
    { binId: '', binCode: 'ORGANIC', name: 'Rác hữu cơ', fillLevelBefore: resolvedFillBefore, fillLevelAfter: resolvedFillAfter },
    { binId: '', binCode: 'NON_RECYCLABLE', name: 'Rác không tái chế', fillLevelBefore: resolvedFillBefore, fillLevelAfter: resolvedFillAfter }
  ];

  const compartments =
    sessionMeta?.compartments && sessionMeta.compartments.length > 0
      ? sessionMeta.compartments
      : defaultCompartments;

  const compartmentsCount = sessionMeta?.compartmentsCount ?? compartments.length;

  return {
    ...record,
    fillLevelBefore: resolvedFillBefore,
    fillLevelAfter: resolvedFillAfter,
    sessionId: sessionMeta?.sessionId ?? record.id,
    stationId,
    stationCode,
    stationName,
    triggerSource,
    openedAt,
    closedAt,
    openEventId: sessionMeta?.openEventId ?? null,
    closeEventId: sessionMeta?.closeEventId ?? null,
    compartmentsCount,
    compartments,
    createdAt: createdAtIso
  };
}

export class CollectionSessionService {
  private mutex: Promise<void> = Promise.resolve();
  private lastManualCollectionByStation = new Map<string, { timestamp: number; result: CollectionSessionIngestResult }>();

  public async ingestEvent(rawPayload: unknown): Promise<CollectionSessionIngestResult> {
    let release!: () => void;
    const prev = this.mutex;
    this.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await this.processEventInternal(rawPayload);
    } finally {
      release();
    }
  }

  public async resolveStationBins(
    stationIdInput: string,
    dbClient: any = prisma
  ): Promise<{
    stationId: string;
    stationCode: string;
    stationName: string;
    normalizedStationId: string;
    anchorBin: {
      id: string;
      binCode: string;
      name: string;
      currentFillLevel: number | null;
    };
    bins: Array<{
      id: string;
      binCode: string;
      name: string;
      currentFillLevel: number | null;
    }>;
  } | null> {
    const normalized = stationIdInput.trim().toLowerCase();
    const targetStationCode = normalized === 'station_b' ? 'STATION_B' : 'STATION_A';
    const normalizedStationId = targetStationCode === 'STATION_B' ? 'station_b' : 'station_a';

    const station = await dbClient.station.findUnique({
      where: { code: targetStationCode },
      include: {
        bins: {
          orderBy: { binCode: 'asc' }
        }
      }
    });

    if (station && station.bins && station.bins.length > 0) {
      const preferred = station.bins.find((b: any) => b.binCode === 'RECYCLABLE') ?? station.bins[0];
      return {
        stationId: station.id,
        stationCode: station.code,
        stationName: station.name,
        normalizedStationId,
        anchorBin: preferred,
        bins: station.bins
      };
    }

    const fallbackBins = await dbClient.bin.findMany({
      where: {
        OR: [
          { station: { code: targetStationCode } },
          { stationId: normalizedStationId }
        ]
      },
      include: {
        station: true
      },
      orderBy: { binCode: 'asc' }
    });

    if (fallbackBins && fallbackBins.length > 0) {
      const preferred = fallbackBins.find((b: any) => b.binCode === 'RECYCLABLE') ?? fallbackBins[0];
      return {
        stationId: fallbackBins[0].stationId ?? normalizedStationId,
        stationCode: fallbackBins[0].station?.code ?? targetStationCode,
        stationName: fallbackBins[0].station?.name ?? (targetStationCode === 'STATION_B' ? 'Trạm B' : 'Trạm A'),
        normalizedStationId,
        anchorBin: preferred,
        bins: fallbackBins
      };
    }

    const allBins = await dbClient.bin.findMany({
      include: { station: true },
      orderBy: { binCode: 'asc' }
    });

    if (!allBins || allBins.length === 0) {
      return null;
    }

    return {
      stationId: allBins[0].stationId ?? normalizedStationId,
      stationCode: allBins[0].station?.code ?? targetStationCode,
      stationName: allBins[0].station?.name ?? (targetStationCode === 'STATION_B' ? 'Trạm B' : 'Trạm A'),
      normalizedStationId,
      anchorBin: allBins[0],
      bins: allBins
    };
  }

  private async processEventInternal(rawPayload: unknown): Promise<CollectionSessionIngestResult> {
    const parsed = deviceCollectionEventSchema.safeParse(rawPayload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return {
        success: false,
        status: 'VALIDATION_FAILED',
        eventId: typeof (rawPayload as any)?.eventId === 'string' ? (rawPayload as any).eventId : undefined,
        sessionId: typeof (rawPayload as any)?.sessionId === 'string' ? (rawPayload as any).sessionId : undefined,
        error: issues
      };
    }

    const { eventId, sessionId, stationId, triggerSource, eventType, occurredAt, fillPercent } = parsed.data;
    const occurredDate = new Date(occurredAt);
    const normalizedOccurredAt = occurredDate.toISOString();

    try {
      const runTransaction = async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
        if (typeof (prisma as any).$transaction === 'function') {
          return await (prisma as any).$transaction(callback);
        }
        return await callback(prisma);
      };

      return await runTransaction(async (tx) => {
        // 1. Check idempotency across existing session records (by eventId)
        const recentSessionRecords = await tx.collectionRecord.findMany({
          where: {
            OR: [
              { id: sessionId },
              { collectedBy: 'PHYSICAL_BUTTON' }
            ]
          },
          orderBy: { collectedAt: 'desc' },
          take: 200
        });

        for (const rec of recentSessionRecords) {
          const meta = parseSessionMetadata(rec.notes);
          if (!meta) continue;
          if (meta.openEventId === eventId || meta.closeEventId === eventId) {
            return {
              success: true,
              status: 'DUPLICATE_IGNORED',
              duplicate: true,
              eventId,
              sessionId: meta.sessionId,
              eventType,
              createdAt: meta.createdAt,
              session: {
                sessionId: meta.sessionId,
                stationId: meta.stationId,
                stationCode: meta.stationCode,
                stationName: meta.stationName,
                triggerSource: meta.triggerSource,
                openedAt: meta.openedAt,
                closedAt: meta.closedAt,
                fillLevelBefore: meta.fillLevelBefore,
                fillLevelAfter: meta.fillLevelAfter,
                status: rec.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
                openEventId: meta.openEventId,
                closeEventId: meta.closeEventId,
                compartmentsCount: meta.compartmentsCount,
                compartments: meta.compartments,
                createdAt: meta.createdAt
              }
            };
          }
        }

        if (eventType === 'OPEN') {
          const normalizedStationId = stationId.trim().toLowerCase() === 'station_b' ? 'station_b' : 'station_a';

          // Reject if sessionId already exists or if there is already an open session on this station
          const existingById = recentSessionRecords.find((r: any) => r.id === sessionId);
          if (existingById) {
            return {
              success: false,
              status: 'SESSION_ALREADY_OPEN',
              eventId,
              sessionId,
              eventType: 'OPEN',
              error: `Session ${sessionId} already exists.`
            };
          }

          const existingOpenOnStation = recentSessionRecords.find((r: any) => {
            if (r.status !== 'IN_PROGRESS') return false;
            const m = parseSessionMetadata(r.notes);
            return m !== null && m.stationId === normalizedStationId && m.closeEventId === null;
          });

          if (existingOpenOnStation) {
            return {
              success: false,
              status: 'SESSION_ALREADY_OPEN',
              eventId,
              sessionId,
              eventType: 'OPEN',
              error: `Station ${normalizedStationId} already has an active open collection session (${existingOpenOnStation.id}).`
            };
          }

          const stationInfo = await this.resolveStationBins(stationId, tx);
          if (!stationInfo) {
            return {
              success: false,
              status: 'STATION_BIN_NOT_FOUND',
              eventId,
              sessionId,
              eventType: 'OPEN',
              error: `No station bins found for station ${stationId}.`
            };
          }

          // Snapshot all 3 bins of the station
          const compartments: BinCompartmentInfo[] = stationInfo.bins.map((b) => ({
            binId: b.id,
            binCode: b.binCode,
            name: b.name,
            fillLevelBefore:
              typeof b.currentFillLevel === 'number' && b.currentFillLevel >= 0 && b.currentFillLevel <= 100
                ? b.currentFillLevel
                : null,
            fillLevelAfter: null
          }));

          // Determine fillLevelBefore: if payload provides fillPercent, use it; otherwise compute average of valid compartment levels
          let measuredFill: number | null = null;
          if (typeof fillPercent === 'number' && fillPercent >= 0 && fillPercent <= 100) {
            measuredFill = fillPercent;
          } else {
            const validLevels = compartments
              .map((c) => c.fillLevelBefore)
              .filter((lvl): lvl is number => lvl !== null);
            if (validLevels.length > 0) {
              measuredFill = Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length);
            } else if (typeof stationInfo.anchorBin.currentFillLevel === 'number') {
              measuredFill = stationInfo.anchorBin.currentFillLevel;
            }
          }

          const dbFillLevelBefore = measuredFill !== null ? measuredFill : -1;
          const nowIso = new Date().toISOString();

          const metadata: CollectionSessionMetadata = {
            type: 'COLLECTION_SESSION',
            sessionId,
            stationId: stationInfo.normalizedStationId,
            stationCode: stationInfo.stationCode,
            stationName: stationInfo.stationName,
            triggerSource,
            openEventId: eventId,
            closeEventId: null,
            openedAt: normalizedOccurredAt,
            closedAt: null,
            fillLevelBefore: measuredFill,
            fillLevelAfter: null,
            compartmentsCount: stationInfo.bins.length,
            compartments,
            createdAt: nowIso
          };

          const created = await tx.collectionRecord.create({
            data: {
              id: sessionId,
              binId: stationInfo.anchorBin.id,
              collectedBy: triggerSource,
              collectedAt: occurredDate,
              fillLevelBefore: dbFillLevelBefore,
              fillLevelAfter: null,
              status: 'IN_PROGRESS',
              notes: JSON.stringify(metadata)
            }
          });

          const serverCreatedAt = created.createdAt.toISOString();
          return {
            success: true,
            status: 'OPENED_SAVED',
            duplicate: false,
            eventId,
            sessionId,
            eventType: 'OPEN',
            createdAt: serverCreatedAt,
            session: {
              sessionId,
              stationId: stationInfo.normalizedStationId,
              stationCode: stationInfo.stationCode,
              stationName: stationInfo.stationName,
              triggerSource,
              openedAt: normalizedOccurredAt,
              closedAt: null,
              fillLevelBefore: measuredFill,
              fillLevelAfter: null,
              status: 'IN_PROGRESS',
              openEventId: eventId,
              closeEventId: null,
              compartmentsCount: stationInfo.bins.length,
              compartments,
              createdAt: serverCreatedAt
            }
          };
        }

        // eventType === 'CLOSE'
        const existingSession = await tx.collectionRecord.findUnique({
          where: { id: sessionId }
        });

        if (!existingSession) {
          return {
            success: false,
            status: 'SESSION_NOT_FOUND',
            eventId,
            sessionId,
            eventType: 'CLOSE',
            error: `Cannot close collection session ${sessionId}: no matching open session found.`
          };
        }

        const existingMeta = parseSessionMetadata(existingSession.notes);
        if (existingSession.status === 'COMPLETED' || (existingMeta && existingMeta.closeEventId !== null)) {
          return {
            success: false,
            status: 'SESSION_ALREADY_CLOSED',
            eventId,
            sessionId,
            eventType: 'CLOSE',
            error: `Collection session ${sessionId} is already closed.`
          };
        }

        // Transaction step 1: Reset all 3 bins of this station to currentFillLevel: 0
        const stationLookup = existingMeta?.stationId ?? stationId;
        const stationInfo = await this.resolveStationBins(stationLookup, tx);
        if (stationInfo && stationInfo.bins.length > 0) {
          const binIds = stationInfo.bins.map((b) => b.id);
          await tx.bin.updateMany({
            where: { id: { in: binIds } },
            data: {
              currentFillLevel: 0,
              status: 'ONLINE'
            }
          });
        }

        // Transaction step 2: Build updated compartments with fillLevelAfter: 0
        const updatedCompartments: BinCompartmentInfo[] =
          existingMeta?.compartments && existingMeta.compartments.length > 0
            ? existingMeta.compartments.map((c) => ({
                ...c,
                fillLevelAfter: 0
              }))
            : (stationInfo?.bins ?? []).map((b) => ({
                binId: b.id,
                binCode: b.binCode,
                name: b.name,
                fillLevelBefore: typeof b.currentFillLevel === 'number' ? b.currentFillLevel : null,
                fillLevelAfter: 0
              }));

        const updatedMeta: CollectionSessionMetadata = {
          type: 'COLLECTION_SESSION',
          sessionId,
          stationId: existingMeta?.stationId ?? (stationId.trim().toLowerCase() === 'station_b' ? 'station_b' : 'station_a'),
          stationCode: existingMeta?.stationCode ?? (stationInfo?.stationCode ?? 'STATION_A'),
          stationName: existingMeta?.stationName ?? (stationInfo?.stationName ?? 'Trạm A'),
          triggerSource: existingMeta?.triggerSource ?? triggerSource,
          openEventId: existingMeta?.openEventId ?? sessionId,
          closeEventId: eventId,
          openedAt: existingMeta?.openedAt ?? existingSession.collectedAt.toISOString(),
          closedAt: normalizedOccurredAt,
          fillLevelBefore:
            existingMeta?.fillLevelBefore !== undefined
              ? existingMeta.fillLevelBefore
              : (existingSession.fillLevelBefore >= 0 ? existingSession.fillLevelBefore : null),
          fillLevelAfter: 0,
          compartmentsCount: updatedCompartments.length || 3,
          compartments: updatedCompartments,
          createdAt: existingMeta?.createdAt ?? existingSession.createdAt.toISOString()
        };

        const updated = await tx.collectionRecord.update({
          where: { id: sessionId },
          data: {
            status: 'COMPLETED',
            fillLevelAfter: 0,
            notes: JSON.stringify(updatedMeta)
          }
        });

        const serverCreatedAt = updated.createdAt.toISOString();
        return {
          success: true,
          status: 'CLOSED_SAVED',
          duplicate: false,
          eventId,
          sessionId,
          eventType: 'CLOSE',
          createdAt: serverCreatedAt,
          session: {
            sessionId,
            stationId: updatedMeta.stationId,
            stationCode: updatedMeta.stationCode,
            stationName: updatedMeta.stationName,
            triggerSource: updatedMeta.triggerSource,
            openedAt: updatedMeta.openedAt,
            closedAt: updatedMeta.closedAt,
            fillLevelBefore: updatedMeta.fillLevelBefore,
            fillLevelAfter: 0,
            status: 'COMPLETED',
            openEventId: updatedMeta.openEventId,
            closeEventId: updatedMeta.closeEventId,
            compartmentsCount: updatedMeta.compartmentsCount,
            compartments: updatedCompartments,
            createdAt: serverCreatedAt
          }
        };
      });
    } catch (err) {
      console.error('[CollectionSessionService] Error ingesting collection event transaction:', err);
      return {
        success: false,
        status: 'INGESTION_ERROR',
        eventId,
        sessionId,
        eventType,
        error: err instanceof Error ? err.message : 'Database transaction failed'
      };
    }
  }

  /**
   * Tạo một phiên thu gom hoàn tất trực tiếp khi người dùng xác nhận thu gom trên Web Frontend.
   * Thao tác được thực hiện nguyên tử trong Transaction:
   * 1. Lấy thông tin trạm và cả 3 thùng rác.
   * 2. Reset mức rác của cả 3 thùng rác về 0%.
   * 3. Ghi nhận ĐÚNG 1 bản ghi CollectionRecord cho phiên đó với 3 ngăn và fillLevelAfter = 0.
   */
  public async createManualSession(input: {
    stationCode?: string;
    stationId?: string;
    triggerSource?: 'WEB_DASHBOARD';
    collectedBy?: string;
    notes?: string;
  }): Promise<CollectionSessionIngestResult> {
    let release!: () => void;
    const prev = this.mutex;
    this.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const stationTarget = input.stationCode || input.stationId || 'STATION_A';
      const normalizedStation = stationTarget.trim().toLowerCase() === 'station_b' ? 'station_b' : 'station_a';
      const nowMs = Date.now();

      // Debounce multi-clicks within 3 seconds
      const last = this.lastManualCollectionByStation.get(normalizedStation);
      if (last && nowMs - last.timestamp < 3000) {
        return {
          ...last.result,
          duplicate: true,
          status: 'DUPLICATE_IGNORED'
        };
      }

      const runTransaction = async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
        if (typeof (prisma as any).$transaction === 'function') {
          return await (prisma as any).$transaction(callback);
        }
        return await callback(prisma);
      };

      const result = await runTransaction(async (tx) => {
        const stationInfo = await this.resolveStationBins(stationTarget, tx);
        if (!stationInfo) {
          return {
            success: false,
            status: 'STATION_BIN_NOT_FOUND',
            error: `Không tìm thấy trạm hoặc thùng rác cho trạm ${stationTarget}.`
          } as CollectionSessionIngestResult;
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const sessionId = `col-manual-${Date.now()}`;
        const openEventId = `evt-manual-open-${Date.now()}`;
        const closeEventId = `evt-manual-close-${Date.now()}`;

        // Snapshot current fill levels of all 3 bins
        const compartments: BinCompartmentInfo[] = stationInfo.bins.map((b) => ({
          binId: b.id,
          binCode: b.binCode,
          name: b.name,
          fillLevelBefore:
            typeof b.currentFillLevel === 'number' && b.currentFillLevel >= 0 && b.currentFillLevel <= 100
              ? b.currentFillLevel
              : null,
          fillLevelAfter: 0
        }));

        // Calculate fillLevelBefore
        const validLevels = compartments
          .map((c) => c.fillLevelBefore)
          .filter((lvl): lvl is number => lvl !== null);
        const fillBefore =
          validLevels.length > 0
            ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
            : null;
        const dbFillBefore = fillBefore !== null ? fillBefore : -1;

        // Reset all 3 bins in database to 0
        const binIds = stationInfo.bins.map((b) => b.id);
        await tx.bin.updateMany({
          where: { id: { in: binIds } },
          data: {
            currentFillLevel: 0,
            status: 'ONLINE'
          }
        });

        // Close any currently open session on this station
        await tx.collectionRecord.updateMany({
          where: {
            status: 'IN_PROGRESS',
            binId: { in: binIds }
          },
          data: {
            status: 'COMPLETED',
            fillLevelAfter: 0
          }
        });

        const metadata: CollectionSessionMetadata = {
          type: 'COLLECTION_SESSION',
          sessionId,
          stationId: stationInfo.normalizedStationId,
          stationCode: stationInfo.stationCode,
          stationName: stationInfo.stationName,
          triggerSource: 'WEB_DASHBOARD',
          openEventId,
          closeEventId,
          openedAt: nowIso,
          closedAt: nowIso,
          fillLevelBefore: fillBefore,
          fillLevelAfter: 0,
          compartmentsCount: stationInfo.bins.length,
          compartments,
          createdAt: nowIso
        };

        const created = await tx.collectionRecord.create({
          data: {
            id: sessionId,
            binId: stationInfo.anchorBin.id,
            collectedBy: input.collectedBy || 'WEB_DASHBOARD',
            collectedAt: now,
            fillLevelBefore: dbFillBefore,
            fillLevelAfter: 0,
            status: 'COMPLETED',
            notes: JSON.stringify(metadata)
          }
        });

        return {
          success: true,
          status: 'CLOSED_SAVED',
          sessionId,
          eventId: closeEventId,
          eventType: 'CLOSE',
          createdAt: created.createdAt.toISOString(),
          session: {
            sessionId,
            stationId: stationInfo.normalizedStationId,
            stationCode: stationInfo.stationCode,
            stationName: stationInfo.stationName,
            triggerSource: 'WEB_DASHBOARD',
            openedAt: nowIso,
            closedAt: nowIso,
            fillLevelBefore: fillBefore,
            fillLevelAfter: 0,
            status: 'COMPLETED',
            openEventId,
            closeEventId,
            compartmentsCount: stationInfo.bins.length,
            compartments,
            createdAt: created.createdAt.toISOString()
          }
        } as CollectionSessionIngestResult;
      });

      if (result.success) {
        this.lastManualCollectionByStation.set(normalizedStation, { timestamp: nowMs, result });
      }

      return result;
    } catch (err) {
      console.error('[CollectionSessionService] Error creating manual collection session:', err);
      return {
        success: false,
        status: 'INGESTION_ERROR',
        error: err instanceof Error ? err.message : 'Database transaction failed'
      };
    } finally {
      release();
    }
  }
}

export const collectionSessionService = new CollectionSessionService();
