import type { NetSuiteContext } from '@/types';

const getRestletUrl = (): string => {
  const win = typeof window !== 'undefined' ? window : null;
  const config = (win as { __NS_CONFIG__?: { restletUrl?: string } })?.__NS_CONFIG__;
  const ctx = (win as { __NS_CONTEXT__?: NetSuiteContext })?.__NS_CONTEXT__;
  return (config?.restletUrl ?? (ctx && typeof ctx === 'object' ? ctx.restletUrl : '')) || '';
};

function buildUrl(action: string, params: Record<string, unknown> = {}): string {
  const baseUrl = getRestletUrl();
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
  if (response.status === 503) {
    throw new Error(data.message || data.error || 'Cache unavailable');
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed: ${response.status}`);
  }
  return data as T;
};

export const apiRequest = async <T>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> => {
  const baseUrl = getRestletUrl();
  if (!baseUrl) {
    return Promise.reject(new Error('RESTlet URL not configured. Run from NetSuite.'));
  }

  const url = new URL(baseUrl);
  url.searchParams.set('action', action);

  const body = JSON.stringify({
    action,
    ...params,
  });

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    credentials: 'include',
  });

  const data = await response.json();
  if (response.status === 503) {
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
