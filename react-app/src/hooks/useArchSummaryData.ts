/**
 * Summary data for CWP ARCH.
 *
 * Mirrors `useSummaryData` (IND/MTL) but is board-foot native, carries the extra
 * `reserve` / `readyToBuild` buckets, and filters on container — which is a LOT
 * attribute, so a row matches when any of its lots sits in a selected container.
 *
 * SOURCE: local fixtures. The ARCH RESTlet does not exist yet — see
 * lib/archFixtures.ts for why. When it lands, replace the body of `load()` with
 * an `apiGet<ArchSummaryResponse>('summary', { subsidiaryId: '9' })` call; the
 * rest of this file and every component above it stays as-is.
 */

import { useState, useCallback, useEffect } from 'react';
import { getArchFixtureRows } from '@/lib/archFixtures';
import type { ArchSummaryRow, ArchTotals } from '@/types/arch';
import type { FilterState } from '@/types';

export const ARCH_IS_DEMO_DATA = true;

const EMPTY_TOTALS: ArchTotals = {
  onHand: 0,
  reserve: 0,
  readyToBuild: 0,
  outbound: 0,
  onOrder: 0,
  inTransit: 0,
  available: 0,
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
  if (filters.grade?.length) {
    const set = new Set(filters.grade);
    out = out.filter((r) => !!r.grade && set.has(r.grade));
  }
  if (filters.containerNo?.length) {
    const set = new Set(filters.containerNo);
    // Lot-level: keep the row if ANY of its lots is in a selected container.
    out = out.filter((r) => r.lots.some((l) => !!l.containerNo && set.has(l.containerNo)));
  }
  return out;
};

const sumTotals = (rows: ArchSummaryRow[]): ArchTotals =>
  rows.reduce<ArchTotals>(
    (acc, r) => ({
      onHand: acc.onHand + (r.onHand || 0),
      reserve: acc.reserve + (r.reserve || 0),
      readyToBuild: acc.readyToBuild + (r.readyToBuild || 0),
      outbound: acc.outbound + (r.outbound || 0),
      onOrder: acc.onOrder + (r.onOrder || 0),
      inTransit: acc.inTransit + (r.inTransit || 0),
      available: acc.available + (r.available || 0),
    }),
    { ...EMPTY_TOTALS }
  );

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

export const useArchSummaryData = (enabled: boolean) => {
  const [allRows, setAllRows] = useState<ArchSummaryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = getArchFixtureRows();
      setAllRows(rows);
      return rows;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ARCH data');
      setAllRows(null);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled && !allRows) {
      void load().catch(() => {});
    }
  }, [enabled, allRows, load]);

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
        grade: optionsFor(allRows, filters, 'grade', (r) => [{ value: r.grade, label: r.grade }]),
        containerNo: optionsFor(allRows, filters, 'containerNo', (r) =>
          r.lots.filter((l) => !!l.containerNo).map((l) => ({ value: l.containerNo, label: l.containerNo }))
        ),
      };
      Object.values(out).forEach((list) => list.sort((a, b) => compareLabels(a.label, b.label)));
      return out;
    },
    [allRows]
  );

  // `reload` is unused today (fixtures never go stale) but is the seam the real
  // RESTlet will need — the refresh button wires to it when the back end lands.
  return { allRows, loading, error, reload: load, getFilteredRows, getTotals, getFilterOptions };
};
