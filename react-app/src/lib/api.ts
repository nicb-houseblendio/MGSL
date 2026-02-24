import type { NetSuiteContext } from '@/types';

const getRestletUrl = (): string => {
  const win = typeof window !== 'undefined' ? window : null;
  const ctx = (win as { __NS_CONTEXT__?: NetSuiteContext })?.__NS_CONTEXT__;
  return (ctx && typeof ctx === 'object' ? ctx.restletUrl : '') || '';
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `Request failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Request failed');
  }
  return data.data as T;
};
