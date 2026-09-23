/**
 * ARCH auto-refresh: the grid follows the cache on its own (2026-09-23).
 *
 * Until now the ARCH grid NEVER re-read the cache after the first load: no
 * interval, no focus or visibility refetch, only the Refresh button. So a trader
 * who did not click saw nothing new at all, however often the cache rebuilt.
 *
 * The screen now asks the cheap `meta` action every ARCH_POLL_MS while the tab is
 * visible, and re-reads the ~450 KB summary ONLY when the cache's `lastUpdated`
 * differs from the one on screen. Rules, each learned from IND and MTL:
 *
 *  - ARCH's own poll, never the shared useRefreshState: IND and MTL run on that
 *    hook, and it asks `meta` with no subsidiaryId (so, IND's) and compares a
 *    counter with `>`. ARCH's cacheVersion is always 1, so a counter can never
 *    say anything here; `lastUpdated` INEQUALITY can.
 *  - Paused only while the tab is hidden, NEVER on user inactivity: a trader
 *    watching an untouched second monitor must stay current. IND removed exactly
 *    that guard after Julie saw "Updated 7m ago" with nothing offered.
 *  - Held while the SO wizard is open (its prices, lots and coverage come from the
 *    loaded rows) and applied when it closes. IND's requirements suppress their
 *    banner in the same situation.
 *  - Quiet on failure, and backed off on a rate limit (the RESTlet is shared with
 *    IND and MTL).
 */

export const ARCH_POLL_MS = 30 * 1000;
export const ARCH_POLL_BACKOFF_MS = 2 * 60 * 1000;
/** A tab coming back into view checks at once, unless it checked this recently. */
export const ARCH_VISIBILITY_MIN_GAP_MS = 10 * 1000;

export interface ArchMetaPoll {
  available?: boolean;
  reason?: string;
  lastUpdated?: string;
  startedAt?: string | null;
  reconLastRun?: string;
}

/**
 * What one `meta` answer means for the screen.
 *   'reload'  re-read the summary now (or when the wizard closes)
 *   'none'    nothing to do
 */
export const pollVerdict = (
  loadedLastUpdated: string | null | undefined,
  haveLiveRows: boolean,
  m: ArchMetaPoll | null | undefined,
): 'reload' | 'none' => {
  if (!m || m.available !== true || !m.lastUpdated) return 'none';
  // The first load failed (fixtures on screen) and the cache answers now: retry.
  if (!haveLiveRows) return 'reload';
  return m.lastUpdated !== (loadedLastUpdated || '') ? 'reload' : 'none';
};

/** SSS_REQUEST_LIMIT_EXCEEDED or an HTTP 429, however the RESTlet words it. */
export const isRateLimited = (e: unknown): boolean =>
  /SSS_REQUEST_LIMIT_EXCEEDED|\b429\b|rate limit|too many requests/i.test(
    String((e as { message?: unknown })?.message ?? e ?? ''),
  );
