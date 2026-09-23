/**
 * The trader's own order, on screen AT ONCE (2026-09-23).
 *
 * After a successful order the grid still shows the bundles as sellable until the
 * cache has rebuilt with them (about 2 minutes now, 15 before), so the trader who
 * just sold them could tick them again and only learn from the server's refusal.
 * This overlay marks the ordered bundles as taken on THIS screen the moment the
 * order returns, through the same `lot.reservation` path every lock and badge
 * already reads, and lets go as soon as the cache can speak for itself.
 *
 * Rules, each one a failure mode avoided:
 *  - Only a result that SAYS the order was saved (`ok` with a number). A transport
 *    failure or an unknown outcome marks nothing: the order may not exist.
 *  - A bundle the server reports as NOT attributed (`lotsNotAttributed`, text
 *    "<lot> (<reason>)") is not marked: nothing holds it in NetSuite, and the
 *    screen must not pretend otherwise. A reservation problem IS marked: its claim
 *    exists and the cache shows it as "Reserving".
 *  - Dropped when the payload itself shows the bundle locked (the cache caught up),
 *    or when a rebuild that STARTED more than OVERLAY_SKEW_MS after the order has
 *    been loaded (the cache had its chance; the margin covers a browser clock that
 *    disagrees with NetSuite's), and after OVERLAY_MAX_MS whatever happens.
 *  - Only ever ADDS a lock. It never unlocks, never changes a quantity, and never
 *    replaces a reservation the cache already carries.
 */
import type { ArchSummaryRow, ArchLot } from '@/types/arch';
import { commitmentOn } from '@/lib/archLots';

export const OVERLAY_MAX_MS = 30 * 60 * 1000;
export const OVERLAY_SKEW_MS = 60 * 1000;

export interface ArchOverlayEntry {
  lotId: string;
  lotNo: string;
  soId: string;
  soNumber: string;
  customer: string;
  /** 'sold' = the whole bundle went on the order; 'split' = part of it, to be split. */
  kind: 'sold' | 'split';
  /** Browser time when the order came back, ms. */
  at: number;
}

interface DraftLineLike { lotId: string; lotNo: string; isSplit?: boolean }
interface ResultLike {
  ok: boolean;
  salesOrderId?: number;
  tranId?: string;
  transportFailure?: boolean;
  lotsNotAttributed?: string[];
}

const notAttributed = (lotNo: string, list: string[] | undefined): boolean =>
  (list || []).some((s) => s === lotNo || String(s).startsWith(lotNo + ' (') || String(s).startsWith(lotNo + ':'));

/** The entries to add for one order result. [] unless the order was saved. */
export const overlayFromOrder = (
  lines: DraftLineLike[],
  result: ResultLike,
  customer: string,
  now: number,
): ArchOverlayEntry[] => {
  if (!result || !result.ok || result.transportFailure || !result.tranId) return [];
  const seen = new Set<string>();
  const out: ArchOverlayEntry[] = [];
  (lines || []).forEach((l) => {
    const lotId = String(l.lotId || '');
    if (!lotId || seen.has(lotId) || notAttributed(l.lotNo, result.lotsNotAttributed)) return;
    seen.add(lotId);
    out.push({
      lotId,
      lotNo: l.lotNo,
      soId: String(result.salesOrderId || ''),
      soNumber: String(result.tranId),
      customer: customer || '',
      kind: l.isSplit ? 'split' : 'sold',
      at: now,
    });
  });
  return out;
};

/** Keep only entries the cache has not answered for yet. */
export const pruneOverlay = (
  entries: ArchOverlayEntry[],
  rows: ArchSummaryRow[] | null | undefined,
  startedAt: string | null | undefined,
  now: number,
): ArchOverlayEntry[] => {
  /* "The cache shows the order" = a reservation on the bundle, a commitment
   * against it, or a pre-arrival quantity. NOT isLotLocked: every bundle still on
   * the water is "locked" for a stock sale, so that test would drop an in-transit
   * reservation's mark on the very next load (caught by test, 2026-09-23). */
  const locked = new Set<string>();
  (rows || []).forEach((r) => (r.lots || []).forEach((l) => {
    if (l.lotId && (!!l.reservation || commitmentOn(l) > 0 || (l.preReserved || 0) > 0)) locked.add(String(l.lotId));
  }));
  const started = startedAt ? Date.parse(startedAt) : NaN;
  return (entries || []).filter((e) => {
    if (!(e.at > 0) || now - e.at > OVERLAY_MAX_MS || e.at > now + OVERLAY_SKEW_MS) return false;
    if (rows && locked.has(e.lotId)) return false;
    if (rows && isFinite(started) && started > e.at + OVERLAY_SKEW_MS) return false;
    return true;
  });
};

/** Rows with the overlay's bundles locked. Returns the SAME array when nothing applies. */
export const applyOverlay = (rows: ArchSummaryRow[], entries: ArchOverlayEntry[]): ArchSummaryRow[] => {
  if (!entries || !entries.length || !rows) return rows;
  const byLot = new Map(entries.map((e) => [e.lotId, e]));
  let touched = false;
  const next = rows.map((r) => {
    if (!(r.lots || []).some((l) => byLot.has(String(l.lotId)) && !l.reservation)) return r;
    touched = true;
    return {
      ...r,
      lots: r.lots.map((l): ArchLot => {
        const e = byLot.get(String(l.lotId));
        if (!e || l.reservation) return l;
        return {
          ...l,
          reservation: {
            soId: e.soId,
            soNumber: e.soNumber,
            customer: e.customer,
            pending: false,
            since: '',
            landed: false,
            exception: null,
            local: e.kind,
          },
        };
      }),
    };
  });
  return touched ? next : rows;
};

const STORE_KEY = 'arch.orderOverlay.v1';

/** Per-viewer convenience only: a reload inside the window keeps the marks. */
export const loadOverlay = (now: number): ArchOverlayEntry[] => {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as ArchOverlayEntry[]) : [];
    return Array.isArray(list) ? pruneOverlay(list, null, null, now) : [];
  } catch {
    return [];
  }
};

export const saveOverlay = (entries: ArchOverlayEntry[]): void => {
  try {
    if (entries.length) window.localStorage.setItem(STORE_KEY, JSON.stringify(entries));
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* private window or blocked storage: the overlay still works for this tab */
  }
};
