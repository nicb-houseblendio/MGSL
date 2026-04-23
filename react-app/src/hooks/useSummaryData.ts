import { useState, useCallback, useEffect } from 'react';
import { apiGet } from '@/lib/api';
import type { SummaryResponse, SummaryRow } from '@/lib/api';
import type { FilterState } from '@/types';

function applyClientFilters(rows: SummaryRow[], filters: FilterState): SummaryRow[] {
  let filtered = rows;
  if (filters.location?.length) {
    const locSet = new Set(filters.location.map(String));
    filtered = filtered.filter((r) => locSet.has(r.locationId));
  }
  if (filters.item?.length) {
    const itemSet = new Set(filters.item.map(String));
    filtered = filtered.filter((r) => itemSet.has(r.internalId));
  }
  if (filters.species?.length) {
    const set = new Set(filters.species);
    filtered = filtered.filter((r) => r.species && set.has(r.species));
  }
  if (filters.thickness?.length) {
    const set = new Set(filters.thickness);
    filtered = filtered.filter((r) => r.thickness && set.has(r.thickness));
  }
  if (filters.width?.length) {
    const set = new Set(filters.width);
    filtered = filtered.filter((r) => r.width && set.has(r.width));
  }
  if (filters.length?.length) {
    const set = new Set(filters.length);
    filtered = filtered.filter((r) => r.length && set.has(r.length));
  }
  if (filters.grade?.length) {
    const set = new Set(filters.grade);
    filtered = filtered.filter((r) => r.grade && set.has(r.grade));
  }
  if (filters.finition?.length) {
    const set = new Set(filters.finition);
    filtered = filtered.filter((r) => r.finition && set.has(r.finition));
  }
  if (filters.humidity?.length) {
    const set = new Set(filters.humidity);
    filtered = filtered.filter((r) => r.humidity && set.has(r.humidity));
  }
  if (filters.plannage?.length) {
    const set = new Set(filters.plannage);
    filtered = filtered.filter((r) => r.plannage && set.has(r.plannage));
  }
  if (filters.etampage?.length) {
    const set = new Set(filters.etampage);
    filtered = filtered.filter((r) => r.etampage && set.has(r.etampage));
  }
  if (filters.autres?.length) {
    const set = new Set(filters.autres);
    filtered = filtered.filter((r) => r.autres && set.has(r.autres));
  }
  if (filters.country?.length) {
    const set = new Set(filters.country);
    filtered = filtered.filter((r) => !!r.country && set.has(r.country));
  }
  if (filters.vendor?.length) {
    const set = new Set(filters.vendor);
    filtered = filtered.filter((r) => r.vendor && set.has(r.vendor));
  }
  if (filters.po?.length) {
    const set = new Set(filters.po);
    filtered = filtered.filter((r) => {
      if (!r.pos || !Array.isArray(r.pos)) return false;
      return r.pos.some((p: string) => set.has(p));
    });
  }
  return filtered;
}

export function parseNumericLabel(s: string): number {
  // Direct integer or decimal: "4", "6", "10", "1.5"
  if (!isNaN(parseFloat(s)) && !/[\s/']/.test(s)) return parseFloat(s);
  // Mixed fraction: "3 1/2", "1 3/8", "5 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  // Simple fraction: "1/2", "3/4"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  // Length with apostrophe: "10'", "8'", "10' Green Rough"
  const feet = s.match(/^([\d.]+)'/);
  if (feet) return parseFloat(feet[1]);
  return NaN;
}

export const useSummaryData = (subsidiaryId: string) => {
  const [allRows, setAllRows] = useState<SummaryRow[] | null>(null);
  const [meta, setMeta] = useState<{ lastUpdated: string; cacheVersion: number; uniquePOs?: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<SummaryResponse>('summary', { greaterThanZero: true, subsidiaryId });
      setAllRows(result.rows);
      setMeta(result.meta ? {
        lastUpdated: result.meta.lastUpdated,
        cacheVersion: result.meta.cacheVersion,
        uniquePOs: result.meta.uniquePOs || [],
      } : null);

      // ── UoM diagnostic ──────────────────────────────────────────
      if (result.rows?.length > 0) {
        const total = result.rows.length;
        const withMbf = result.rows.filter(r => r.mbfFactor != null && r.mbfFactor > 0).length;
        const sample = result.rows.slice(0, 5).map(r => ({
          itemCode: r.itemCode,
          mbfFactor: r.mbfFactor,
          fieldPresent: 'mbfFactor' in r,
        }));
        console.group('[UoM Diagnostic] mbfFactor data check');
        console.log(`Rows with mbfFactor > 0: ${withMbf} / ${total}`);
        console.table(sample);
        if (withMbf === 0) {
          console.warn(
            'ALL rows have mbfFactor=0 or missing. MBF mode will show N/A everywhere.\n' +
            'Checklist:\n' +
            '  1. NetSuite saved search has custitem_mgsl_fbm + custitem_mgsl_ppp as GROUP columns?\n' +
            '  2. MR script (mcgi_mr_trader_screen_cache.js) deployed with mbfFactor code?\n' +
            '  3. MR has been run since deployment? (trigger manual run or wait for schedule)\n' +
            '  4. Items in NetSuite have FBM per Piece and Pieces per Pack fields populated?'
          );
        }
        console.groupEnd();
      }
      // ── end diagnostic ──────────────────────────────────────────

      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load data';
      setError(msg);
      setAllRows(null);
      setMeta(null);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [subsidiaryId]);

  useEffect(() => {
    if (subsidiaryId) {
      fetchSummary().catch(() => {});
    }
  }, [subsidiaryId, fetchSummary]);

  const getFilteredRows = useCallback(
      (filters: FilterState): SummaryRow[] => {
        if (!allRows) return [];
        return applyClientFilters(allRows, filters);
      },
      [allRows]
  );

  const getTotals = useCallback((rows: SummaryRow[]) => {
    return rows.reduce(
        (acc, r) => ({
          onHand: acc.onHand + (r.onHand || 0),
          committed: acc.committed + (r.committed || 0),
          outbound: acc.outbound + (r.outbound || 0),
          onOrder: acc.onOrder + (r.onOrder || 0),
          inTransit: acc.inTransit + (r.inTransit || 0),
          available: acc.available + (r.available || 0),
        }),
        { onHand: 0, committed: 0, outbound: 0, onOrder: 0, inTransit: 0, available: 0 }
    );
  }, []);

  const getTotalsMBF = useCallback((rows: SummaryRow[]) => {
    return rows.reduce(
        (acc, r) => {
          const f = r.mbfFactor ?? 0;
          return {
            onHand: acc.onHand + (r.onHand * f),
            committed: acc.committed + (r.committed * f),
            outbound: acc.outbound + (r.outbound * f),
            onOrder: acc.onOrder + (r.onOrder * f),
            inTransit: acc.inTransit + (r.inTransit * f),
            available: acc.available + (r.available * f),
          };
        },
        { onHand: 0, committed: 0, outbound: 0, onOrder: 0, inTransit: 0, available: 0 }
    );
  }, []);

  const getFilterOptions = useCallback(
      (rows: SummaryRow[] | null, filters: FilterState) => {
        if (!rows?.length) return {} as Record<string, { value: string; label: string }[]>;

        const FILTER_FIELDS: { valueKey: keyof SummaryRow; labelKey: keyof SummaryRow; outKey: string; filterKey: keyof FilterState; availableOnly?: boolean }[] = [
          { valueKey: 'locationId', labelKey: 'locationName', outKey: 'location', filterKey: 'location' },
          { valueKey: 'internalId', labelKey: 'itemCode', outKey: 'item', filterKey: 'item' },
          { valueKey: 'species', labelKey: 'species', outKey: 'species', filterKey: 'species' },
          { valueKey: 'thickness', labelKey: 'thickness', outKey: 'thickness', filterKey: 'thickness' },
          { valueKey: 'width', labelKey: 'width', outKey: 'width', filterKey: 'width' },
          { valueKey: 'length', labelKey: 'length', outKey: 'length', filterKey: 'length' },
          { valueKey: 'grade', labelKey: 'grade', outKey: 'grade', filterKey: 'grade' },
          { valueKey: 'finition', labelKey: 'finition', outKey: 'finition', filterKey: 'finition' },
          { valueKey: 'humidity', labelKey: 'humidity', outKey: 'humidity', filterKey: 'humidity' },
          { valueKey: 'plannage', labelKey: 'plannage', outKey: 'plannage', filterKey: 'plannage' },
          { valueKey: 'etampage', labelKey: 'etampage', outKey: 'etampage', filterKey: 'etampage' },
          { valueKey: 'autres', labelKey: 'autres', outKey: 'autres', filterKey: 'autres' },
          { valueKey: 'country', labelKey: 'country', outKey: 'country', filterKey: 'country' },
          { valueKey: 'vendor', labelKey: 'vendor', outKey: 'vendor', filterKey: 'vendor', availableOnly: true },
        ];

        const options: Record<string, { value: string; label: string }[]> = {};
        for (const field of FILTER_FIELDS) {
          const filtersWithout: FilterState = { ...filters, [field.filterKey]: undefined };
          let subset = applyClientFilters(rows, filtersWithout);
          if (field.availableOnly) {
            subset = subset.filter((r) => (r.available ?? 0) > 0);
          }
          const seen = new Set<string>();
          const items: { value: string; label: string }[] = [];
          for (const r of subset) {
            const v = String(r[field.valueKey] ?? '').trim();
            const lbl = String(r[field.labelKey] ?? v).trim();
            if (v && !seen.has(v)) {
              seen.add(v);
              items.push({ value: v, label: lbl || v });
            }
          }
          options[field.outKey] = items.sort((a, b) => {
            const aNum = parseNumericLabel(a.label);
            const bNum = parseNumericLabel(b.label);
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
          });
        }
        return options;
      },
      []
  );

  return {
    allRows,
    meta,
    loading,
    error,
    fetchSummary,
    getFilteredRows,
    getTotals,
    getTotalsMBF,
    getFilterOptions,
  };
};