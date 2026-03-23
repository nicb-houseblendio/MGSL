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
        quantityGreaterThanZero: true,
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
