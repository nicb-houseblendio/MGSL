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
