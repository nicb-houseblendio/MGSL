import { useState, useCallback, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import type { MetaResponse } from '@/lib/api';

export type RefreshState = 'idle' | 'checking' | 'up-to-date' | 'fetching' | 'error';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_COOLDOWN_MS = 2 * 60 * 1000;

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
  } catch {
    return iso;
  }
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
  } catch {
    return 'ok';
  }
}

export const useRefreshState = (options: {
  loadedCacheVersion: number | null;
  lastUpdated: string | null;
  onFetchNeeded: () => Promise<void>;
  onFetchComplete: (meta: { cacheVersion: number; lastUpdated: string }) => void;
}) => {
  const {
    loadedCacheVersion,
    onFetchNeeded,
    onFetchComplete,
  } = options;

  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPollRef = useRef<number>(Date.now());

  const checkMeta = useCallback(async (): Promise<MetaResponse | null> => {
    try {
      return await apiGet<MetaResponse>('meta');
    } catch (e) {
      throw e instanceof Error ? e : new Error('Meta check failed');
    }
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
          upToDateTimeoutRef.current = setTimeout(() => {
            setRefreshState('idle');
          }, 2000);
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
      lastPollRef.current = Date.now();
      try {
        const meta = await checkMeta();
        if (meta?.available && meta.cacheVersion != null && meta.cacheVersion > (loadedCacheVersion ?? 0)) {
          setNewVersionAvailable(true);
        }
      } catch {
        // ignore background poll errors
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastPollRef.current >= VISIBILITY_COOLDOWN_MS) {
        void check();
      }
    };

    pollRef.current = setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (upToDateTimeoutRef.current) clearTimeout(upToDateTimeoutRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkMeta, loadedCacheVersion]);

  const dismissBanner = useCallback(() => setNewVersionAvailable(false), []);

  return {
    refreshState,
    newVersionAvailable,
    error,
    doRefresh,
    dismissBanner,
    formatLastUpdated,
    getLastUpdatedBadgeState,
  };
};
