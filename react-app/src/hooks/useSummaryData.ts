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
  if (filters.quantityGreaterThanZero !== false) {
    filtered = filtered.filter((r) => {
      const total =
        (r.onHand || 0) + (r.committed || 0) + (r.outbound || 0) + (r.onOrder || 0) + (r.inTransit || 0);
      return total > 0;
    });
  }
  return filtered;
}

export const useSummaryData = (subsidiaryId: string) => {
  const [allRows, setAllRows] = useState<SummaryRow[] | null>(null);
  const [meta, setMeta] = useState<{ lastUpdated: string; cacheVersion: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<SummaryResponse>('summary', { greaterThanZero: true });
      setAllRows(result.rows);
      setMeta(result.meta ? { lastUpdated: result.meta.lastUpdated, cacheVersion: result.meta.cacheVersion } : null);
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
  }, []);

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

  const getFilterOptions = useCallback((rows: SummaryRow[] | null) => {
    if (!rows?.length) return {} as Record<string, { value: string; label: string }[]>;
    const options: Record<string, { value: string; label: string }[]> = {};
    const add = (valueKey: keyof SummaryRow, labelKey: keyof SummaryRow, outKey: string) => {
      const seen = new Set<string>();
      rows.forEach((r) => {
        const v = String(r[valueKey] ?? '').trim();
        const lbl = String(r[labelKey] ?? v).trim();
        if (v && !seen.has(v)) {
          seen.add(v);
          if (!options[outKey]) options[outKey] = [];
          options[outKey].push({ value: v, label: lbl || v });
        }
      });
    };
    add('locationId', 'locationName', 'location');
    add('internalId', 'itemCode', 'item');
    add('species', 'species', 'species');
    add('thickness', 'thickness', 'thickness');
    add('width', 'width', 'width');
    add('length', 'length', 'length');
    add('grade', 'grade', 'grade');
    add('finition', 'finition', 'finition');
    add('humidity', 'humidity', 'humidity');
    add('plannage', 'plannage', 'plannage');
    add('etampage', 'etampage', 'etampage');
    add('autres', 'autres', 'autres');
    return options;
  }, []);

  return {
    allRows,
    meta,
    loading,
    error,
    fetchSummary,
    getFilteredRows,
    getTotals,
    getFilterOptions,
  };
};
