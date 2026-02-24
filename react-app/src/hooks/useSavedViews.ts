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
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  });

  const saveView = useCallback(
    (name: string, filters: FilterState) => {
      const newView: SavedView = {
        id: crypto.randomUUID(),
        name,
        filters,
        createdAt: new Date().toISOString(),
      };
      const updated = [...views, newView];
      setViews(updated);
      localStorage.setItem(key, JSON.stringify(updated));
    },
    [key, views]
  );

  const loadView = useCallback(
    (id: string): FilterState | null => {
      const view = views.find((v) => v.id === id);
      return view?.filters ?? null;
    },
    [views]
  );

  const deleteView = useCallback(
    (id: string) => {
      const updated = views.filter((v) => v.id !== id);
      setViews(updated);
      localStorage.setItem(key, JSON.stringify(updated));
    },
    [key, views]
  );

  return { views, saveView, loadView, deleteView };
};
