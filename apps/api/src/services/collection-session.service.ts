import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export const deviceCollectionEventSchema = z.object({
  eventId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  stationId: z.string().trim().min(1).default('station_a'),
  triggerSource: z.enum(['PHYSICAL_BUTTON']).default('PHYSICAL_BUTTON'),
  eventType: z.enum(['OPEN', 'CLOSE']),
  occurredAt: z.string().trim().refine((val) => !Number.isNaN(new Date(val).getTime()), {
    message: 'Invalid ISO-8601 occurredAt timestamp'
  }),
  fillPercent: z.number().int().min(0).max(100).optional().nullable()
});

export type DeviceCollectionEventInput = z.infer<typeof deviceCollectionEventSchema>;

export interface CollectionSessionMetadata {
  type: 'COLLECTION_SESSION';
  sessionId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  triggerSource: 'PHYSICAL_BUTTON';
  openEventId: string;
  closeEventId: string | null;
  openedAt: string;
  closedAt: string | null;
  fillLevelBefore: number | null;
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
    status: 'IN_PROGRESS' | 'COMPLETED';
    openEventId: string;
    closeEventId: string | null;
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
      return {
        type: 'COLLECTION_SESSION',
        sessionId: parsed.sessionId,
        stationId: typeof parsed.stationId === 'string' ? parsed.stationId : 'station_a',
        stationCode: typeof parsed.stationCode === 'string' ? parsed.stationCode : 'STATION_A',
        stationName: typeof parsed.stationName === 'string' ? parsed.stationName : 'Trạm A',
        triggerSource: 'PHYSICAL_BUTTON',
        openEventId: parsed.openEventId,
        closeEventId: typeof parsed.closeEventId === 'string' ? parsed.closeEventId : null,
        openedAt: parsed.openedAt,
        closedAt: typeof parsed.closedAt === 'string' ? parsed.closedAt : null,
        fillLevelBefore:
          typeof parsed.fillLevelBefore === 'number' && parsed.fillLevelBefore >= 0 && parsed.fillLevelBefore <= 100
            ? parsed.fillLevelBefore
            : null,
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
  const stationName = sessionMeta?.stationName ?? record.bin.station?.name ?? (stationCode === 'STATION_B' ? 'Trạm B' : 'Trạm A');
  const triggerSource = sessionMeta?.triggerSource ?? (record.collectedBy === 'PHYSICAL_BUTTON' ? 'PHYSICAL_BUTTON' : (record.collectedBy || 'PHYSICAL_BUTTON'));
  const openedAt = sessionMeta?.openedAt ?? collectedAtIso;
  const closedAt = sessionMeta?.closedAt ?? (record.status === 'COMPLETED' && !sessionMeta ? collectedAtIso : null);

  // Semantically accurate fillLevelBefore: if sentinel (-1) or missing, return null (never fake 0)
  const resolvedFillBefore =
    sessionMeta?.fillLevelBefore !== undefined
      ? sessionMeta.fillLevelBefore
      : (typeof record.fillLevelBefore === 'number' && record.fillLevelBefore >= 0 && record.fillLevelBefore <= 100
          ? record.fillLevelBefore
          : null);

  return {
    ...record,
    fillLevelBefore: resolvedFillBefore,
    sessionId: sessionMeta?.sessionId ?? record.id,
    stationId,
    stationCode,
    stationName,
    triggerSource,
    openedAt,
    closedAt,
    openEventId: sessionMeta?.openEventId ?? null,
    closeEventId: sessionMeta?.closeEventId ?? null,
    createdAt: createdAtIso
  };
}

export class CollectionSessionService {
  private mutex: Promise<void> = Promise.resolve();

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

  private async resolveAnchorBin(stationIdInput: string, dbClient: any = prisma): Promise<{
    binId: string;
    stationCode: string;
    stationName: string;
    normalizedStationId: string;
    currentFillLevel: number | null;
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

    if (station && station.bins.length > 0) {
      const preferred = station.bins.find((b: any) => b.binCode === 'RECYCLABLE') ?? station.bins[0];
      return {
        binId: preferred.id,
        stationCode: station.code,
        stationName: station.name,
        normalizedStationId,
        currentFillLevel: typeof preferred.currentFillLevel === 'number' ? preferred.currentFillLevel : null
      };
    }

    const fallbackBin = await dbClient.bin.findFirst({
      where: {
        OR: [
          { station: { code: targetStationCode } },
          { binCode: 'RECYCLABLE' }
        ]
      },
      include: {
        station: true
      }
    }) ?? await dbClient.bin.findFirst({ include: { station: true } });

    if (!fallbackBin) {
      return null;
    }

    return {
      binId: fallbackBin.id,
      stationCode: fallbackBin.station?.code ?? targetStationCode,
      stationName: fallbackBin.station?.name ?? (targetStationCode === 'STATION_B' ? 'Trạm B' : 'Trạm A'),
      normalizedStationId,
      currentFillLevel: typeof fallbackBin.currentFillLevel === 'number' ? fallbackBin.currentFillLevel : null
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
                status: rec.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
                openEventId: meta.openEventId,
                closeEventId: meta.closeEventId,
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

          const anchor = await this.resolveAnchorBin(stationId, tx);
          if (!anchor) {
            return {
              success: false,
              status: 'STATION_BIN_NOT_FOUND',
              eventId,
              sessionId,
              eventType: 'OPEN',
              error: `No anchor bin found for station ${stationId}.`
            };
          }

          // Real sensor fill level: if not measured by sensor, DO NOT fake 0!
          // In DB column (INTEGER NOT NULL): store sentinel -1 to indicate UNKNOWN / NOT_MEASURED.
          // In notes JSON: store null.
          const measuredFill =
            typeof fillPercent === 'number' && fillPercent >= 0 && fillPercent <= 100
              ? fillPercent
              : typeof anchor.currentFillLevel === 'number' && anchor.currentFillLevel >= 0 && anchor.currentFillLevel <= 100
                ? anchor.currentFillLevel
                : null;

          const dbFillLevelBefore = measuredFill !== null ? measuredFill : -1;

          const nowIso = new Date().toISOString();
          const metadata: CollectionSessionMetadata = {
            type: 'COLLECTION_SESSION',
            sessionId,
            stationId: anchor.normalizedStationId,
            stationCode: anchor.stationCode,
            stationName: anchor.stationName,
            triggerSource,
            openEventId: eventId,
            closeEventId: null,
            openedAt: normalizedOccurredAt,
            closedAt: null,
            fillLevelBefore: measuredFill,
            createdAt: nowIso
          };

          const created = await tx.collectionRecord.create({
            data: {
              id: sessionId,
              binId: anchor.binId,
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
              stationId: anchor.normalizedStationId,
              stationCode: anchor.stationCode,
              stationName: anchor.stationName,
              triggerSource,
              openedAt: normalizedOccurredAt,
              closedAt: null,
              fillLevelBefore: measuredFill,
              status: 'IN_PROGRESS',
              openEventId: eventId,
              closeEventId: null,
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

        const updatedMeta: CollectionSessionMetadata = {
          type: 'COLLECTION_SESSION',
          sessionId,
          stationId: existingMeta?.stationId ?? (stationId.trim().toLowerCase() === 'station_b' ? 'station_b' : 'station_a'),
          stationCode: existingMeta?.stationCode ?? 'STATION_A',
          stationName: existingMeta?.stationName ?? 'Trạm A',
          triggerSource: existingMeta?.triggerSource ?? triggerSource,
          openEventId: existingMeta?.openEventId ?? sessionId,
          closeEventId: eventId,
          openedAt: existingMeta?.openedAt ?? existingSession.collectedAt.toISOString(),
          closedAt: normalizedOccurredAt,
          fillLevelBefore:
            existingMeta?.fillLevelBefore !== undefined
              ? existingMeta.fillLevelBefore
              : (existingSession.fillLevelBefore >= 0 ? existingSession.fillLevelBefore : null),
          createdAt: existingMeta?.createdAt ?? existingSession.createdAt.toISOString()
        };

        const updated = await tx.collectionRecord.update({
          where: { id: sessionId },
          data: {
            status: 'COMPLETED',
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
            status: 'COMPLETED',
            openEventId: updatedMeta.openEventId,
            closeEventId: updatedMeta.closeEventId,
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
}

export const collectionSessionService = new CollectionSessionService();
