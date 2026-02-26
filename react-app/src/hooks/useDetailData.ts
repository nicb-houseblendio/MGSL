import { useState, useCallback } from 'react';
import { apiGet } from '@/lib/api';

export type DetailType = 'onHand' | 'committed' | 'outbound' | 'onOrder' | 'inTransit';

export interface DetailPayload {
  onHand?: Record<string, unknown>[];
  committed?: Record<string, unknown>[];
  outbound?: Record<string, unknown>[];
  onOrder?: Record<string, unknown>[];
  inTransit?: Record<string, unknown>[];
}

export const useDetailData = () => {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(
    async (itemId: string, locationId: string, bucket?: DetailType) => {
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
