# MGSL Trader Screen — Part 5: Frontend Core Code (Full Source)

> **Purpose:** Complete source code for all React frontend non-component files: hooks, API layer, types, config, context providers, CSS, and build config.

---

## File 1: types/index.ts

```typescript
export interface InventoryRow {
  internalId: string;
  locationId: string;
  location: { label: string; url?: string };
  itemName: string | null;
  itemCode: { label: string; url?: string } | null;
  quantity: string;
  onHand: string;
  committed: string;
  onOrder: string;
  inTransit: string;
  available: string;
  outbound: string;
  averageCost: string;
  width?: string;
  length?: string;
  grade?: string;
}

export interface ItemsResponse {
  rows: InventoryRow[];
  totals: {
    onHand: number;
    committed: number;
    outbound: number;
    onOrder: number;
    inTransit: number;
    available: number;
  };
  uom: string;
  rowCount: number;
}

export interface DetailRow {
  lotNumber: string;
  documentType: string;
  documentNumber: string;
  documentLink: string;
  [key: string]: unknown;
}

export interface DetailResponse {
  rows: DetailRow[];
  columns: { id: string; label: string }[];
}

export interface FilterState {
  subsidiary?: string[];
  location?: string[];
  reload?: string[];
  item?: string[];
  species?: string[];
  thickness?: string[];
  width?: string[];
  length?: string[];
  grade?: string[];
  supplier?: string[];
  finition?: string[];
  humidity?: string[];
  plannage?: string[];
  etampage?: string[];
  autres?: string[];
  category?: string[];
  quantityGreaterThanZero?: boolean;
}

export interface NetSuiteContext {
  userId: string;
  userName: string;
  subsidiaryId: string;
  subsidiaryName: string;
  accountId: string;
  restletUrl: string;
  uomConfig?: Record<string, string[]>;
}
```

---

## File 2: lib/api.ts

```typescript
import type { NetSuiteContext } from '@/types';

const getRestletUrl = (): string => {
  const win = typeof window !== 'undefined' ? window : null;
  const mcgi = (win as { MCGI_CONFIG?: { restletUrl?: string } })?.MCGI_CONFIG;
  const legacyConfig = (win as { __NS_CONFIG__?: { restletUrl?: string } })?.__NS_CONFIG__;
  const legacyCtx = (win as { __NS_CONTEXT__?: NetSuiteContext })?.__NS_CONTEXT__;
  return (mcgi?.restletUrl ?? legacyConfig?.restletUrl ?? (legacyCtx && typeof legacyCtx === 'object' ? legacyCtx.restletUrl : '')) || '';
};

function resolveRestletUrl(baseUrl: string): string {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin + (trimmed.startsWith('/') ? trimmed : '/' + trimmed);
  }
  return trimmed;
}

function buildUrl(action: string, params: Record<string, unknown> = {}): string {
  const baseUrl = resolveRestletUrl(getRestletUrl());
  if (!baseUrl) return '';
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
  });
  return url.toString();
}

export interface MetaResponse {
  available: boolean;
  reason?: string;
  cacheVersion?: number;
  lastUpdated?: string;
  rowCount?: number;
}

export interface SummaryResponse {
  success: boolean;
  rows: SummaryRow[];
  totals: { onHand: number; committed: number; outbound: number; onOrder: number; inTransit: number; available: number };
  meta: { lastUpdated: string; cacheVersion: number; rowCount: number };
}

export interface SummaryRow {
  internalId: string;
  locationId: string;
  locationName: string;
  locationUrl: string;
  itemCode: string;
  itemName: string;
  itemUrl: string;
  itemType: string;
  isReload?: boolean;
  species: string;
  thickness: string;
  width: string;
  length: string;
  grade: string;
  finition: string;
  humidity: string;
  plannage: string;
  etampage: string;
  autres: string;
  quantityFBM: number;
  onHand: number;
  committed: number;
  outbound: number;
  onOrder: number;
  inTransit: number;
  available: number;
  averageCost: number;
  detailKey: string;
}

export const apiGet = async <T>(action: string, params: Record<string, unknown> = {}): Promise<T> => {
  const urlStr = buildUrl(action, params);
  if (!urlStr) {
    return Promise.reject(new Error('RESTlet URL not configured. Run from NetSuite.'));
  }
  const response = await fetch(urlStr, { method: 'GET', credentials: 'include' });
  const data = await response.json();
  if (response.status === 503 || data?.error === 'CACHE_MISS' || data?.error === 'DETAIL_CACHE_MISS') {
    const msg = data?.message || data?.error || 'Cache unavailable';
    throw new Error(msg + (data?.error === 'CACHE_MISS' ? ' Run or schedule the Trader Screen Map/Reduce script (MCGI_MR_TraderScreenCache) to populate data.' : ''));
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed: ${response.status}`);
  }
  return data as T;
};

export const apiRequest = async <T>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> => {
  const baseUrl = resolveRestletUrl(getRestletUrl());
  if (!baseUrl) {
    return Promise.reject(new Error('RESTlet URL not configured. Run from NetSuite.'));
  }
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  const body = JSON.stringify({ action, ...params });
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'include',
  });
  const data = await response.json();
  if (response.status === 503 || data?.error === 'CACHE_MISS' || data?.error === 'DETAIL_CACHE_MISS') {
    throw new Error(data.message || data.error || 'Cache unavailable');
  }
  if (!response.ok) {
    const errText = data.error || data.message || (await response.text()) || `Request failed: ${response.status}`;
    throw new Error(typeof errText === 'string' ? errText : JSON.stringify(errText));
  }
  if (data.success === false && data.error) {
    throw new Error(data.error);
  }
  return (data.data ?? data) as T;
};
```

---

## File 3: lib/export.ts

```typescript
import * as XLSX from 'xlsx';
import type { SummaryRow } from './api';

export const exportToExcel = (
  rows: SummaryRow[],
  totals: { onHand: number; committed: number; outbound: number; onOrder: number; inTransit: number; available: number }
) => {
  const headers = [
    'Item ID', 'Location', 'Item', 'Species', 'Thickness', 'Width', 'Length', 'Grade',
    'Finish', 'Humidity', 'Planing', 'Stamping',
    'On Hand', 'Committed', 'Outbound', 'On Order', 'In Transit', 'Available', 'Avg Prix/M3',
  ];
  const data = rows.map((r) => [
    r.itemCode, r.locationName, r.itemName, r.species, r.thickness, r.width, r.length, r.grade,
    r.finition, r.humidity, r.plannage, r.etampage,
    r.onHand, r.committed, r.outbound, r.onOrder, r.inTransit, r.available, r.averageCost,
  ]);
  data.push([
    'TOTALS', '', '', '', '', '', '', '', '', '', '', '',
    totals.onHand, totals.committed, totals.outbound, totals.onOrder, totals.inTransit, totals.available, '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Trader Screen');
  XLSX.writeFile(wb, `trader-screen-${Date.now()}.xlsx`);
};
```

---

## File 4: lib/utils.ts

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

## File 5: config/businessConfig.ts

```typescript
export type FilterKey =
  | 'location' | 'item' | 'species' | 'thickness' | 'width' | 'length'
  | 'grade' | 'supplier' | 'finish' | 'moisture' | 'planing' | 'stamping'
  | 'other' | 'category';

export interface BusinessConfig {
  filters: FilterKey[];
  columns: string[];
}

export const BUSINESS_CONFIG: Record<string, BusinessConfig> = {
  CWP_MTL: {
    filters: ['location', 'thickness', 'width', 'length', 'grade', 'supplier'],
    columns: ['width', 'length', 'onHand', 'committed', 'outbound', 'inTransit', 'available'],
  },
  CWP_IND: {
    filters: [
      'location', 'item', 'species', 'thickness', 'width', 'length',
      'grade', 'finish', 'moisture', 'planing', 'stamping', 'other',
    ],
    columns: ['width', 'length', 'onHand', 'committed', 'outbound', 'inTransit', 'available'],
  },
  CWP_ARCH: {
    filters: ['location', 'species', 'thickness', 'category'],
    columns: ['width', 'length', 'onHand', 'committed', 'outbound', 'inTransit', 'available'],
  },
};

export const getBusinessConfig = (subsidiaryName: string): BusinessConfig => {
  const key = subsidiaryName?.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_') || '';
  const match = Object.keys(BUSINESS_CONFIG).find(
    (k) => key.includes(k) || k.includes(key)
  );
  return BUSINESS_CONFIG[match || 'CWP_IND'] || BUSINESS_CONFIG.CWP_IND;
};
```

---

## File 6: context/NetSuiteContext.tsx

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { NetSuiteContext as NSContextType } from '@/types';

const defaultContext: NSContextType = {
  userId: '', userName: '', subsidiaryId: '', subsidiaryName: '',
  accountId: '', restletUrl: '',
};

const NetSuiteContext = createContext<NSContextType>(defaultContext);

interface NSConfig {
  restletUrl?: string;
  userId?: string | number;
  userName?: string;
  userRole?: string;
  accountId?: string;
  subsidiary?: { id: string | number; name: string };
  uomConfig?: Record<string, string[]>;
}

export const NetSuiteProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo(() => {
    const win = typeof window !== 'undefined' ? window : null;
    const mcgi = (win as { MCGI_CONFIG?: NSConfig & NSContextType })?.MCGI_CONFIG;
    const legacyConfig = (win as { __NS_CONFIG__?: NSConfig })?.__NS_CONFIG__;
    const legacyCtx = (win as { __NS_CONTEXT__?: NSContextType })?.__NS_CONTEXT__;
    const raw = mcgi ?? legacyConfig ?? legacyCtx;
    if (raw && typeof raw === 'object' && (raw.restletUrl || (raw as NSContextType).restletUrl)) {
      const r = raw as NSConfig & NSContextType;
      return {
        userId: String(r.userId ?? ''),
        userName: r.userName ?? '',
        subsidiaryId: String(r.subsidiary?.id ?? r.subsidiaryId ?? ''),
        subsidiaryName: r.subsidiary?.name ?? r.subsidiaryName ?? '',
        accountId: String(r.accountId ?? ''),
        restletUrl: r.restletUrl ?? '',
        uomConfig: r.uomConfig,
      } as NSContextType;
    }
    return defaultContext;
  }, []);

  return (
    <NetSuiteContext.Provider value={value}>{children}</NetSuiteContext.Provider>
  );
};

export const useNetSuite = () => {
  const context = useContext(NetSuiteContext);
  if (!context) throw new Error('useNetSuite must be used within NetSuiteProvider');
  return context;
};
```

---

## File 7: hooks/useSummaryData.ts

```typescript
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
      const total = (r.onHand || 0) + (r.committed || 0) + (r.outbound || 0) + (r.onOrder || 0) + (r.inTransit || 0);
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
    if (subsidiaryId) { fetchSummary().catch(() => {}); }
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

  return { allRows, meta, loading, error, fetchSummary, getFilteredRows, getTotals, getFilterOptions };
};
```

---

## File 8: hooks/useDetailData.ts

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import { apiGet } from '@/lib/api';

export type DetailType = 'onHand' | 'committed' | 'outbound' | 'onOrder' | 'inTransit';

export interface DetailPayload {
  onHand?: Record<string, unknown>[];
  committed?: Record<string, unknown>[];
  outbound?: Record<string, unknown>[];
  onOrder?: Record<string, unknown>[];
  inTransit?: Record<string, unknown>[];
}

interface UseDetailDataOptions { resetCacheVersion?: number | null; }

export const useDetailData = (options?: UseDetailDataOptions) => {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, DetailPayload>>(new Map());

  useEffect(() => { cacheRef.current.clear(); }, [options?.resetCacheVersion]);

  const fetchDetail = useCallback(
    async (itemId: string, locationId: string, bucket?: DetailType) => {
      const cacheKey = `${itemId}__${locationId}`;
      const cached = cacheRef.current.get(cacheKey);
      if (cached) { setData(cached); return cached; }
      setLoading(true);
      setError(null);
      try {
        const params: Record<string, string> = { itemId, locationId };
        if (bucket) params.bucket = bucket;
        const result = await apiGet<{ success?: boolean; data?: DetailPayload | Record<string, unknown>[] }>('detail', params);
        const raw = (result as { data?: DetailPayload | Record<string, unknown>[] })?.data ?? result;
        const payload = Array.isArray(raw)
          ? ({ [bucket || 'onHand']: raw } as DetailPayload)
          : (raw as DetailPayload);
        cacheRef.current.set(cacheKey, payload);
        setData(payload);
        return payload;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load detail';
        setError(msg);
        setData(null);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { data, loading, error, fetchDetail };
};
```

---

## File 9: hooks/useRefreshState.ts

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import type { MetaResponse } from '@/lib/api';

export type RefreshState = 'idle' | 'checking' | 'up-to-date' | 'fetching' | 'error';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

function formatLastUpdated(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleString();
  } catch { return iso; }
}

function getLastUpdatedBadgeState(lastUpdated: string | null): 'ok' | 'stale' | 'refresh' {
  if (!lastUpdated) return 'ok';
  try {
    const d = new Date(lastUpdated);
    if (isNaN(d.getTime())) return 'ok';
    const diffHours = (Date.now() - d.getTime()) / 3600000;
    if (diffHours < 1) return 'ok';
    if (diffHours < 2) return 'stale';
    return 'refresh';
  } catch { return 'ok'; }
}

export const useRefreshState = (options: {
  loadedCacheVersion: number | null;
  lastUpdated: string | null;
  onFetchNeeded: () => Promise<void>;
  onFetchComplete: (meta: { cacheVersion: number; lastUpdated: string }) => void;
}) => {
  const { loadedCacheVersion, onFetchNeeded, onFetchComplete } = options;
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkMeta = useCallback(async (): Promise<MetaResponse | null> => {
    try { return await apiGet<MetaResponse>('meta'); }
    catch (e) { throw e instanceof Error ? e : new Error('Meta check failed'); }
  }, []);

  const doRefresh = useCallback(
    async (skipMetaCheck = false) => {
      if (skipMetaCheck) {
        setRefreshState('fetching');
        setError(null);
        try {
          await onFetchNeeded();
          setRefreshState('idle');
          setNewVersionAvailable(false);
        } catch (e) {
          setRefreshState('error');
          setError(e instanceof Error ? e.message : 'Refresh failed');
        }
        return;
      }
      setRefreshState('checking');
      setError(null);
      try {
        const meta = await checkMeta();
        if (!meta?.available) {
          setRefreshState('idle');
          setError('Cache is being rebuilt, try again shortly');
          return;
        }
        if (meta.cacheVersion === loadedCacheVersion) {
          setRefreshState('up-to-date');
          upToDateTimeoutRef.current = setTimeout(() => { setRefreshState('idle'); }, 2000);
          return;
        }
        setRefreshState('fetching');
        await onFetchNeeded();
        if (meta.cacheVersion != null && meta.lastUpdated) {
          onFetchComplete({ cacheVersion: meta.cacheVersion, lastUpdated: meta.lastUpdated });
        }
        setRefreshState('idle');
        setNewVersionAvailable(false);
      } catch (e) {
        setRefreshState('error');
        setError(e instanceof Error ? e.message : 'Refresh failed');
      }
    },
    [checkMeta, loadedCacheVersion, onFetchNeeded, onFetchComplete]
  );

  useEffect(() => {
    const check = async () => {
      if (document.hidden) return;
      try {
        const meta = await checkMeta();
        if (meta?.available && meta.cacheVersion != null && meta.cacheVersion > (loadedCacheVersion ?? 0)) {
          setNewVersionAvailable(true);
        }
      } catch { /* ignore background poll errors */ }
    };
    pollRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (upToDateTimeoutRef.current) clearTimeout(upToDateTimeoutRef.current);
    };
  }, [checkMeta, loadedCacheVersion]);

  const dismissBanner = useCallback(() => setNewVersionAvailable(false), []);

  return { refreshState, newVersionAvailable, error, doRefresh, dismissBanner, formatLastUpdated, getLastUpdatedBadgeState };
};
```

---

## File 10: hooks/useSavedViews.ts

```typescript
import { useState, useCallback } from 'react';
import type { FilterState } from '@/types';

export interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

const STORAGE_KEY = 'trader-views';

export const useSavedViews = (userId: string) => {
  const key = `${STORAGE_KEY}-${userId}`;
  const [views, setViews] = useState<SavedView[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  });

  const saveView = useCallback((name: string, filters: FilterState) => {
    const newView: SavedView = { id: crypto.randomUUID(), name, filters, createdAt: new Date().toISOString() };
    const updated = [...views, newView];
    setViews(updated);
    localStorage.setItem(key, JSON.stringify(updated));
  }, [key, views]);

  const loadView = useCallback((id: string): FilterState | null => {
    return views.find((v) => v.id === id)?.filters ?? null;
  }, [views]);

  const deleteView = useCallback((id: string) => {
    const updated = views.filter((v) => v.id !== id);
    setViews(updated);
    localStorage.setItem(key, JSON.stringify(updated));
  }, [key, views]);

  return { views, saveView, loadView, deleteView };
};
```

---

## File 11: index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --navy: #0F2641;
    --navy-mid: #1A3D63;
    --navy-light: #254E7A;
    --green: #1E6B47;
    --gold: #C8A035;
    --background: #EEF1F6;
    --surface: #FFFFFF;
    --border: #CBD5E1;
    --text: #0D1F33;
    --text-mid: #3D5166;
    --text-light: #7A8FA3;
    --row-hover: #F0F7F4;
    --row-alt: #F8FAFC;
    --expanded-bg: #F0F5FF;
    --qty-hover: #EDF4FF;
    --attr-hover: #E8F5EF;
    --metric-onhand: #1B5E20;
    --metric-committed: #E65100;
    --metric-outbound: #B22222;
    --metric-onorder: #0D47A1;
    --metric-intransit: #4A148C;
    /* ShadCN compatibility variables */
    --background-shadcn: 220 20% 96%;
    --foreground: 220 30% 10%;
    --card: 0 0% 100%;
    --card-foreground: 220 30% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 220 30% 10%;
    --primary: 220 50% 15%;
    --primary-foreground: 210 40% 98%;
    --secondary: 220 15% 95%;
    --secondary-foreground: 220 30% 15%;
    --muted: 220 15% 95%;
    --muted-foreground: 220 15% 45%;
    --accent: 142 45% 28%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border-shadcn: 220 15% 85%;
    --input: 220 15% 85%;
    --ring: 220 50% 15%;
    --radius: 0.5rem;
  }
  .dark {
    --background: #0D1F33;
    --surface: #1A3D63;
    --border: #3D5166;
    --text: #EEF1F6;
    --text-mid: #CBD5E1;
    --text-light: #7A8FA3;
    --row-hover: #1A3D63;
    --row-alt: #0F2641;
    --expanded-bg: #1A3D63;
    --metric-onhand: #4CAF50;
    --metric-committed: #FF9800;
    --metric-outbound: #EF5350;
    --metric-onorder: #42A5F5;
    --metric-intransit: #AB47BC;
    --background-shadcn: 220 30% 8%;
    --foreground: 210 40% 98%;
    --card: 220 30% 12%;
    --card-foreground: 210 40% 98%;
    --popover: 220 30% 12%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 220 50% 15%;
    --secondary: 220 25% 18%;
    --secondary-foreground: 210 40% 98%;
    --muted: 220 25% 18%;
    --muted-foreground: 215 20% 65%;
    --accent: 142 45% 35%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border-shadcn: 220 20% 25%;
    --input: 220 20% 25%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * { border-color: var(--border); }
  body {
    font-family: 'IBM Plex Sans', system-ui, sans-serif;
    background-color: var(--background);
    color: var(--text);
    margin: 0;
    padding: 0;
  }
  .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
}

#react-root {
  display: block;
  margin: 0 !important;
  padding: 0 !important;
  box-sizing: border-box;
  width: 100vw !important;
  max-width: 100vw !important;
  margin-left: calc(-50vw + 50%) !important;
  margin-right: calc(-50vw + 50%) !important;
  position: relative;
  left: 0;
}

@layer utilities {
  .text-metric-onhand { color: var(--metric-onhand); }
  .text-metric-committed { color: var(--metric-committed); }
  .text-metric-outbound { color: var(--metric-outbound); }
  .text-metric-onorder { color: var(--metric-onorder); }
  .text-metric-intransit { color: var(--metric-intransit); }
}

.inventory-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.inventory-table-scroll::-webkit-scrollbar-track { background: var(--background); }
.inventory-table-scroll::-webkit-scrollbar-thumb { background: var(--navy-mid); border-radius: 4px; }
.inventory-table-scroll::-webkit-scrollbar-thumb:hover { background: var(--navy); }
```

---

## File 12: main.tsx

**Path:** `react-app/src/main.tsx`

React entry point. Mounts the `<App />` component to `<div id="react-root">` which is created by the Suitelet HTML shell. Shows an inline error message if mounting fails.

```tsx
/**
 * React Suitelet entry (aligned with CFA revenue_service pattern).
 * Mounts to <div id="react-root"> when DOM is ready; shows in-DOM error on failure.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const CONTAINER_ID = 'react-root';

function init() {
  const rootElement = document.getElementById(CONTAINER_ID);
  if (!rootElement) {
    console.error('[Trader Screen] React root not found. Suitelet must include <div id="react-root"></div>');
    return;
  }
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    rootElement.innerHTML = `<div style="padding: 20px; color: #b22222; font-family: sans-serif;">
      <h2>Trader Screen — Load Error</h2>
      <p>${msg}</p>
      <pre style="font-size: 11px; overflow: auto;">${error instanceof Error ? error.stack : ''}</pre>
    </div>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

---

## File 13: context/ThemeProvider.tsx

**Path:** `react-app/src/context/ThemeProvider.tsx`

Theme context provider supporting light, dark, and system modes. Persists theme choice to localStorage. Listens for system preference changes when in "system" mode.

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem('theme') as Theme) || 'system';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('theme') as Theme;
    if (stored === 'dark') return 'dark';
    if (stored === 'light') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const resolved = theme === 'system' ? systemTheme : theme;

    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    setResolvedTheme(resolved);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        const resolved = mediaQuery.matches ? 'dark' : 'light';
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(resolved);
        setResolvedTheme(resolved);
      }
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeState,
      resolvedTheme,
    }),
    [theme, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
```

---

## File 14: hooks/useFilterOptions.ts

**Path:** `react-app/src/hooks/useFilterOptions.ts`

Hook for fetching filter options from the RESTlet. **Not currently used** — the app derives filter options client-side from loaded summary data via `getFilterOptions` in `useSummaryData.ts`. This hook exists as an alternative for server-side filter option fetching.

```typescript
import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api';

export interface FilterOption {
  value: string;
  label: string;
}

export const useFilterOptions = (
  filterType: string,
  subsidiaryId: string,
  enabled: boolean
) => {
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOptions = useCallback(async () => {
    if (!enabled || !filterType) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<FilterOption[]>('getFilterOptions', {
        filterType,
        subsidiaryId: subsidiaryId || undefined,
      });
      setOptions(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load options');
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [filterType, subsidiaryId, enabled]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  return { options, loading, error, refetch: fetchOptions };
};
```

---

## File 15: hooks/useInventoryData.ts

**Path:** `react-app/src/hooks/useInventoryData.ts`

**Not currently used.** This is a legacy/alternative hook that fetches inventory data via POST to a `getItems` action. The app uses `useSummaryData.ts` instead, which fetches via GET to the `summary` action. This hook exists from an earlier iteration and references the old `ItemsResponse` type from `types/index.ts`.

```typescript
import { useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api';
import type { ItemsResponse, FilterState } from '@/types';

export const useInventoryData = () => {
  const [data, setData] = useState<ItemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async (filters: FilterState, uom = 'FBM') => {
    setLoading(true);
    setError(null);
    try {
      const filtersForApi = {
        subsidiary: filters.subsidiary,
        location: filters.location,
        reload: filters.reload || filters.location,
        item: filters.item,
        species: filters.species,
        thickness: filters.thickness,
        width: filters.width,
        length: filters.length,
        grade: filters.grade,
        supplier: filters.supplier,
        finition: filters.finition,
        humidity: filters.humidity,
        plannage: filters.plannage,
        etampage: filters.etampage,
        autres: filters.autres,
        category: filters.category,
      };
      const result = await apiRequest<ItemsResponse>('getItems', {
        filters: filtersForApi,
        quantityGreaterThanZero: filters.quantityGreaterThanZero !== false,
        uom,
      });
      setData(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load data';
      setError(msg);
      setData(null);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fetchItems };
};
```

---

*End of Part 5. Next: Part 6 — Frontend Components Code*
