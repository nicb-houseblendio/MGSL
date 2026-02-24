import { useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api';
import type { DetailResponse } from '@/types';

export type DetailType = 'onHand' | 'committed' | 'outbound' | 'onOrder' | 'inTransit';

const ACTION_MAP: Record<DetailType, string> = {
  onHand: 'getOnHand',
  committed: 'getCommitted',
  outbound: 'getOutbound',
  onOrder: 'getOnOrder',
  inTransit: 'getInTransit',
};

export const useDetailData = () => {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(
    async (type: DetailType, itemId: string, locationId: string) => {
      setLoading(true);
      setError(null);
      try {
        const action = ACTION_MAP[type];
        const result = await apiRequest<DetailResponse>(action, {
          itemId,
          locationId,
        });
        setData(result);
        return result;
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
