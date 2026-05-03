import { useState, useCallback, useRef, useEffect } from 'react';
import { apiGet } from '@/lib/api';

export type DetailType = 'onHand' | 'committed' | 'outbound' | 'onOrder' | 'inTransit' | 'available';

export interface DetailPayload {
  onHand?: Record<string, unknown>[];
  committed?: Record<string, unknown>[];
  outbound?: Record<string, unknown>[];
  onOrder?: Record<string, unknown>[];
  inTransit?: Record<string, unknown>[];
  available?: Record<string, unknown>[];
}

interface UseDetailDataOptions {
  resetCacheVersion?: number | null;
}

export const useDetailData = (options?: UseDetailDataOptions) => {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, DetailPayload>>(new Map());

  useEffect(() => {
    cacheRef.current.clear();
  }, [options?.resetCacheVersion]);

  const fetchDetail = useCallback(
    async (itemId: string, locationId: string, bucket?: DetailType, subsidiaryId?: string) => {
      const cacheKey = `${subsidiaryId || 'ind'}__${itemId}__${locationId}`;
      setError(null);
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setData(cached);
        return cached;
      }

      setLoading(true);
      try {
        const params: Record<string, string> = { itemId, locationId };
        if (bucket) params.bucket = bucket;
        if (subsidiaryId) params.subsidiaryId = subsidiaryId;
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
