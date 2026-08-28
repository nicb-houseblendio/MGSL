/**
 * Summary data for CWP ARCH.
 *
 * Mirrors `useSummaryData` (IND/MTL) but is unit-native (BF / SQFT / LF / units),
 * carries the extra `reserve` / `readyToBuild` buckets, and filters on container —
 * which is a LOT attribute, so a row matches when any of its lots sits in a
 * selected container.
 *
 * SOURCE: the ARCH RESTlet, with the local fixtures as a visible fallback. The
 * grid renders fixtures on the first paint and upgrades itself to live data when
 * the request lands; the header badge says which of the two you are looking at.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getArchFixtureRows } from '@/lib/archFixtures';
import { apiGet } from '@/lib/api';
import type { ArchSummaryRow, ArchTotals } from '@/types/arch';
import type { FilterState } from '@/types';

const EMPTY_TOTALS: ArchTotals = {
  onHand: 0,
  reserve: 0,
  readyToBuild: 0,
  outbound: 0,
  onOrder: 0,
  inTransit: 0,
  available: 0,
  units: [],
};

const applyArchFilters = (rows: ArchSummaryRow[], filters: FilterState): ArchSummaryRow[] => {
  let out = rows;

  if (filters.location?.length) {
    const set = new Set(filters.location.map(String));
    out = out.filter((r) => set.has(r.locationId));
  }
  if (filters.species?.length) {
    const set = new Set(filters.species);
    out = out.filter((r) => !!r.species && set.has(r.species));
  }
  if (filters.thickness?.length) {
    const set = new Set(filters.thickness);
    out = out.filter((r) => !!r.thickness && set.has(r.thickness));
  }
  if (filters.category?.length) {
    const set = new Set(filters.category);
    out = out.filter((r) => !!r.category && set.has(r.category));
  }
  // No grade branch either, removed 2026-08-27 with the filter, and removing the
  // BRANCH matters more than removing the control.
  //
  // The builder hard-codes `grade: ''` on every ARCH row, so this branch's
  // `!!r.grade` was false for every row, and any non-empty grade selection removed
  // the ENTIRE grid rather than narrowing it.
  //
  // ⚠️ CORRECTED 2026-08-28: this used to say "because cseggrade lives on
  // TRANSACTIONLINE and not on the item". False, copied from a stale builder
  // comment. cseggrade IS on item, 539 items populated, just null on the ARCH
  // SKUs. The branch removal stands; the stated reason did not.
  //
  // That is a live hazard and not a hypothetical, because saved views persist
  // filters to localStorage. A view saved before today can still carry
  // `grade: [...]`. Had only the FilterPanel control been taken away, restoring
  // such a view would blank every row with no visible filter to explain it and no
  // control left to clear it. Ignoring the key is what makes the removal safe.
  //
  // No containerNo branch, removed 2026-08-19 with the filter itself, for the same
  // reason. `FilterState` still declares both keys because it is shared with
  // IND/MTL, so a stale saved filter could still carry either one — ignoring them
  // is correct, since ARCH no longer offers the filters and every lot's containerNo
  // is empty anyway.
  return out;
};

/**
 * The sums are still computed across mixed units — the footer decides whether
 * they can honestly be shown, and a Category filter collapses `units` to one,
 * at which point they are correct. Computing them unconditionally keeps this
 * function pure and puts the judgement in one place instead of two.
 */
const sumTotals = (rows: ArchSummaryRow[]): ArchTotals => {
  const totals = rows.reduce<ArchTotals>(
    (acc, r) => ({
      onHand: acc.onHand + (r.onHand || 0),
      reserve: acc.reserve + (r.reserve || 0),
      readyToBuild: acc.readyToBuild + (r.readyToBuild || 0),
      outbound: acc.outbound + (r.outbound || 0),
      onOrder: acc.onOrder + (r.onOrder || 0),
      inTransit: acc.inTransit + (r.inTransit || 0),
      available: acc.available + (r.available || 0),
      units: acc.units,
    }),
    { ...EMPTY_TOTALS, units: [] }
  );
  totals.units = [...new Set(rows.map((r) => r.unit))];
  return totals;
};

/**
 * Options for one filter, computed against the rows left after EVERY OTHER
 * filter is applied — so the choices on offer can never produce an empty grid.
 */
const optionsFor = (
  rows: ArchSummaryRow[],
  filters: FilterState,
  key: keyof FilterState,
  extract: (r: ArchSummaryRow) => { value: string; label: string }[]
) => {
  const subset = applyArchFilters(rows, { ...filters, [key]: undefined });
  const seen = new Set<string>();
  const items: { value: string; label: string }[] = [];
  for (const r of subset) {
    for (const opt of extract(r)) {
      if (opt.value && !seen.has(opt.value)) {
        seen.add(opt.value);
        items.push(opt);
      }
    }
  }
  return items;
};

/** "4/4" < "5/4" < "12/4" — numeric where possible, alphabetical otherwise. */
const compareLabels = (a: string, b: string): number => {
  const quarters = (s: string) => {
    const m = s.match(/^(\d+)\s*\/\s*4$/);
    return m ? parseInt(m[1], 10) : NaN;
  };
  const qa = quarters(a);
  const qb = quarters(b);
  if (!isNaN(qa) && !isNaN(qb)) return qa - qb;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
};

/** ARCH subsidiary — the RESTlet's service factory routes on this. */
const ARCH_SUBSIDIARY_ID = 9;

/** Which dataset the screen is actually showing. */
export type ArchDataSource = 'netsuite' | 'fixtures';

/**
 * What the cache says about itself, so the screen can be specific rather than
 * implying every column is real.
 */
export interface ArchCacheMeta {
  lastUpdated?: string;
  lastAttempt?: string;
  rowCount?: number;
  /** Buckets with a real source behind them. */
  bucketsBuilt?: string[];
  /** Structurally zero — today: readyToBuild, which has no field to read. */
  bucketsEmpty?: string[];
  /** >0 means On Hand is LOW: lots exist that could not be converted. */
  skippedLotCount?: number;
  /** True means the last run REFUSED to update; these are the previous rows. */
  shrinkGuard?: boolean;
  shrinkGuardRefused?: number;
  /** Accounting book the AVG COST column is priced in. 1 = Primary = CAD. */
  costBook?: number;
  /** Rows carrying a cost, and rows showing an em dash because none was found. */
  costedRowCount?: number | null;
  uncostedRowCount?: number | null;
}

interface ArchSummaryResponse {
  success?: boolean;
  rows?: ArchSummaryRow[];
  meta?: ArchCacheMeta;
}

/* ══ Live data lives at module scope, NOT in component state ══════════════════
 *
 * Two failures on this screen were both caused by tying ARCH data to one
 * component instance's state, and both looked like "the data never arrived":
 *
 *   1. Loading from a mount effect left the grid permanently empty — measured in
 *      the deployed screen, `allRows=null loading=false error=null` while calling
 *      the fixture getter from that same render returned 40 rows.
 *   2. Loading from a promise callback fetched fine and changed nothing — the
 *      request completed in 184ms with 42KB of rows (browser resource timing),
 *      and the grid still showed all 40 fixtures with no error. The `setState`
 *      had run against a fiber that was no longer the one rendering.
 *
 * The common cause is state ownership, so the state moved out. The resolved rows
 * are held here and READ DURING RENDER, which means:
 *
 *   • Any instance that renders — first mount, remount, a second one — sees the
 *     newest data. There is no instance that can hold a stale copy.
 *   • Arrival only has to trigger a re-render, not deliver a value. Even if that
 *     notification is missed, the next render for ANY reason shows live data, so
 *     the screen is self-healing rather than permanently wrong.
 *
 * `window.__archDbg` keeps a timestamped trail of the fetch for exactly the kind
 * of diagnosis above — the failure mode here is silence, and silence needs
 * breadcrumbs. It is a few bytes and it is the only reason #2 was findable.
 * ══════════════════════════════════════════════════════════════════════════ */

const archDbg = (event: string, detail?: unknown): void => {
  try {
    const w = window as unknown as { __archDbg?: unknown[] };
    if (!w.__archDbg) w.__archDbg = [];
    w.__archDbg.push({ t: Math.round(performance.now()), event, detail });
  } catch {
    /* never let instrumentation break the screen */
  }
};

interface ArchLiveState {
  rows: ArchSummaryRow[] | null;
  meta: ArchCacheMeta | null;
  error: string | null;
  inFlight: boolean;
}

const live: ArchLiveState = { rows: null, meta: null, error: null, inFlight: false };

/**
 * The version setter of every hook instance, so arrival can force a re-render.
 *
 * Registered during render rather than from an effect — deliberately, because
 * failure #1 above was an effect that never ran, and this subscription must not
 * depend on the mechanism it exists to survive. It is idempotent: setters are
 * stable per fiber and a Set dedupes by identity.
 */
const subscribers = new Set<(fn: (v: number) => number) => void>();

const notify = (): void => {
  archDbg('notify', { subscribers: subscribers.size, rows: live.rows?.length ?? null, error: live.error });
  subscribers.forEach((bump) => {
    try {
      bump((v) => v + 1);
    } catch {
      // Setting state on an unmounted fiber is a no-op in React 18, not an
      // error — but one bad subscriber must not stop the others being told.
    }
  });
};

let liveStarted = false;
let inFlightPromise: Promise<void> | null = null;

const startLive = (force = false): Promise<void> => {
  if (inFlightPromise) return inFlightPromise;
  if (liveStarted && !force) return Promise.resolve();
  liveStarted = true;
  live.inFlight = true;
  archDbg('fetch:start', { force });

  inFlightPromise = apiGet<ArchSummaryResponse>('summary', { subsidiaryId: ARCH_SUBSIDIARY_ID })
    .then((res) => {
      // An empty ARCH cache is legitimate, so `rows: []` is accepted. A missing
      // `rows` key is not — that is a malformed response, and demo data with an
      // explanation beats rendering nothing.
      if (!res || !Array.isArray(res.rows)) {
        live.error = 'The ARCH cache returned an unexpected response, so demo data is showing.';
        archDbg('fetch:malformed', res);
        return;
      }
      live.rows = res.rows;
      live.meta = res.meta ?? null;
      live.error = null;
      archDbg('fetch:ok', { rows: res.rows.length, meta: res.meta ?? null });
    })
    .catch((e: unknown) => {
      // apiGet throws on CACHE_MISS, on a missing RESTlet URL (local preview or
      // storybook), and on any transport error. All three mean the same here:
      // keep the fixtures and say why.
      live.error = e instanceof Error ? e.message : 'The ARCH cache could not be reached.';
      archDbg('fetch:error', live.error);
    })
    .then(() => {
      live.inFlight = false;
      inFlightPromise = null;
      notify();
    });

  return inFlightPromise;
};

export const useArchSummaryData = (enabled: boolean) => {
  const [, bump] = useState(0);

  /**
   * The fallback, computed once. A fixture that THROWS must not be mistaken for
   * an empty dataset, so the failure is captured and surfaced through `error`.
   */
  const [fixtureRows, fixtureError] = useMemo<[ArchSummaryRow[] | null, string | null]>(() => {
    try {
      return [getArchFixtureRows(), null];
    } catch (e) {
      return [null, e instanceof Error ? e.message : 'The ARCH demo data failed to load.'];
    }
  }, []);

  // Subscribe during render, unsubscribe on unmount. If the effect never runs
  // the Set keeps one dead setter per fiber — bounded, and a no-op when called.
  subscribers.add(bump);
  useEffect(() => () => void subscribers.delete(bump), [bump]);

  // Gated on `enabled` so opening IND or MTL never fires an ARCH request.
  if (enabled) void startLive();

  const allRows = live.rows ?? fixtureRows;
  const source: ArchDataSource = live.rows ? 'netsuite' : 'fixtures';
  // Only a hard failure — one that leaves nothing to draw. A failed live fetch
  // while fixtures are showing is reported by `sourceError` and the badge, not
  // as a grid-level error.
  const error = allRows ? null : live.error ?? fixtureError;
  const loading = live.inFlight && !allRows;

  /** Re-fetch live data. Wired to the refresh button. */
  const reload = useCallback(async () => {
    await startLive(true);
    return live.rows ?? [];
  }, []);

  const getFilteredRows = useCallback(
    (filters: FilterState): ArchSummaryRow[] => (allRows ? applyArchFilters(allRows, filters) : []),
    [allRows]
  );

  const getTotals = useCallback((rows: ArchSummaryRow[]) => sumTotals(rows), []);

  const getFilterOptions = useCallback(
    (filters: FilterState): Record<string, { value: string; label: string }[]> => {
      if (!allRows?.length) return {};
      const out: Record<string, { value: string; label: string }[]> = {
        location: optionsFor(allRows, filters, 'location', (r) => [
          { value: r.locationId, label: r.locationName },
        ]),
        species: optionsFor(allRows, filters, 'species', (r) => [{ value: r.species, label: r.species }]),
        thickness: optionsFor(allRows, filters, 'thickness', (r) => [
          { value: r.thickness, label: r.thickness },
        ]),
        category: optionsFor(allRows, filters, 'category', (r) => [{ value: r.category, label: r.category }]),
        // No grade options — the filter was removed 2026-08-27, and this only ever
        // produced an empty list anyway since every row's grade is ''.
        // No containerNo options — the filter was removed 2026-08-19.
        // Both: see applyArchFilters.
      };
      Object.values(out).forEach((list) => list.sort((a, b) => compareLabels(a.label, b.label)));
      return out;
    },
    [allRows]
  );

  return {
    allRows,
    loading,
    error,
    reload,
    getFilteredRows,
    getTotals,
    getFilterOptions,
    /** 'netsuite' | 'fixtures' — what the grid is actually showing. */
    source,
    /** The cache's own account of itself. Null while on fixtures. */
    meta: live.meta,
    /** Why the live fetch failed, when it did. Null while live data is showing. */
    sourceError: live.error,
  };
};
