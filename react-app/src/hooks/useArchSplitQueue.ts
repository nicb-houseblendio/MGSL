import * as React from 'react';
import { getSplitJobs } from '@/lib/archSplit';
import type { ArchSplitJob } from '@/types/archSplit';
import type { ArchUnit } from '@/lib/archUom';
import { decideSplitQueueLoad, isJsonContentType } from '@/lib/archSplitQueueLoad';
import type { SplitQueueFailure } from '@/lib/archSplitQueueLoad';

/**
 * The warehouse split queue: from NetSuite when the page is served by the
 * warehouse Suitelet, from fixtures only in a local preview with no endpoint.
 *
 * 🔴 CHANGED 2026-09-22 (Feedback 11). A refused or failed live load used to
 * fall back to fixtures too, on the theory that someone without permission
 * should "see the layout". In practice Marc-Antoine, refused by the role
 * allowlist, saw two invented orders under "NetSuite unreachable" and went
 * hunting for a NetSuite permission that did not exist. A failed live load is
 * now `source: 'error'` with NO jobs and a message naming who must act. The
 * decision lives in `lib/archSplitQueueLoad.ts`, where it is tested.
 */

export type SplitQueueSource = 'netsuite' | 'fixtures' | 'loading' | 'error';

export interface ArchSplitQueueState {
  jobs: ArchSplitJob[];
  source: SplitQueueSource;
  /** Non-null when the live load failed (`source: 'error'`). Written for the warehouse to read. */
  error: string | null;
  /** Why the live load failed, so the screen can pick its wording. */
  failure: SplitQueueFailure | null;
  /** Split-flagged lines with no lot assigned. They cannot be worked as-is. */
  lotMissingCount: number;
  /**
   * Orders with a pending split that the server held back because the SO is
   * not (yet, or verifiably) Ready to Build. Per Marc-Antoine (Feedback 5,
   * 2026-09-10): the warehouse should not see a split until the order is
   * actually ready, not the moment a trader ticks the split box mid-edit.
   */
  notReadyToBuildCount: number;
  /**
   * False when the server could not even evaluate the Ready to Build gate, so
   * EVERY pending split reads as held back. Lets the screen say "Ready to Build
   * isn't set up yet" instead of implying zero real work is waiting.
   *
   * 🔴 CORRECTED 2026-09-14. This used to assert the field "does not exist in
   * this account yet". It does: `custbody_arch_ready_to_build` is id 14083 and is
   * in use in the sandbox. The flag still earns its place, because production has
   * never had the field and the gate fails closed, but it should no longer be read
   * as "this feature is unbuilt".
   */
  readyToBuildKnown: boolean;
  reload: () => void;
  /**
   * Completes one bundle in NetSuite. Resolves to the server's own account of
   * what happened, or an error message fit to show someone holding a tape
   * measure. Never throws — the caller is a save handler, not a try block.
   */
  completeBundle: (req: CompleteRequest) => Promise<CompleteResult>;
}

export interface CompleteRequest {
  soId: number;
  lineUniqueKey: number;
  lotId: number;
  locationId: number;
  /** Measured, in display units. */
  customerQty: number;
  remainderQty: number;
}

export interface CompleteResult {
  ok: boolean;
  error?: string;
  alreadyDone?: boolean;
  inventoryAdjustmentId?: number;
  parentLot?: string;
  childLot?: string;
  tallyVarianceDisplay?: number;
}

interface QueueBundle {
  lotNo: string;
  lotId: number | null;
  lotMissing: boolean;
  itemDescription: string;
  species: string;
  containerNo: string;
  /** Canonical stock unit from the server — 'BF' | 'SQFT' | 'UNIT' | 'LF'. */
  unit: ArchUnit;
  systemBF: number;
  requestedBF: number;
  lineUniqueKey: number;
  locationId: number;
  itemId: number;
}

interface QueueJob extends Omit<ArchSplitJob, 'bundles'> {
  soId: number;
  bundles: QueueBundle[];
}

interface QueueResponse {
  ok: boolean;
  jobs?: QueueJob[];
  counts?: {
    orders: number; bundles: number; lotMissing: number;
    notReadyToBuild?: number; readyToBuildKnown?: boolean;
  };
  error?: string;
  code?: string;
  role?: number | string;
}

/**
 * Where the split Suitelet lives. Injected by the warehouse Suitelet alongside
 * the rest of MCGI_CONFIG; absent when the bundle is served any other way, which
 * is the signal to stay on fixtures rather than guess a URL.
 */
const endpointUrl = (): string | null => {
  const cfg = (window as unknown as { MCGI_CONFIG?: { splitEndpointUrl?: string } }).MCGI_CONFIG;
  return cfg?.splitEndpointUrl || null;
};

export const useArchSplitQueue = (): ArchSplitQueueState => {
  const [jobs, setJobs] = React.useState<ArchSplitJob[]>([]);
  const [source, setSource] = React.useState<SplitQueueSource>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<SplitQueueFailure | null>(null);
  const [lotMissingCount, setLotMissingCount] = React.useState(0);
  // true (not held back) while on fixtures or before the first live response —
  // only a live answer of `false` means the field genuinely isn't set up yet.
  const [notReadyToBuildCount, setNotReadyToBuildCount] = React.useState(0);
  const [readyToBuildKnown, setReadyToBuildKnown] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;

    const clearCounts = () => {
      setLotMissingCount(0);
      setNotReadyToBuildCount(0);
      setReadyToBuildKnown(true);
    };

    const url = endpointUrl();
    if (!url) {
      // Not served by the warehouse Suitelet: a local preview. Fixtures are the point here.
      setJobs(getSplitJobs());
      setSource('fixtures');
      setError(null);
      setFailure(null);
      clearCounts();
      return;
    }

    const fail = (d: { failure: SplitQueueFailure | null; message: string | null }) => {
      if (cancelled) return;
      setJobs([]);
      setSource('error');
      setError(d.message);
      setFailure(d.failure);
      clearCounts();
    };

    setSource('loading');
    fetch(`${url}${url.indexOf('?') === -1 ? '?' : '&'}action=queue`, { credentials: 'include' })
      .then(async (r) => {
        const contentType = r.headers.get('content-type');
        // A page instead of JSON means NetSuite answered before the script did.
        let body: QueueResponse | null = null;
        if (isJsonContentType(contentType)) {
          try { body = (await r.json()) as QueueResponse; } catch { body = null; }
        }
        return { contentType, body };
      })
      .then(({ contentType, body }) => {
        if (cancelled) return;
        const d = decideSplitQueueLoad({ hasEndpoint: true, contentType, body });
        if (d.source !== 'netsuite' || !body) {
          fail(d);
          return;
        }
        setJobs((body.jobs || []) as unknown as ArchSplitJob[]);
        setLotMissingCount(body.counts?.lotMissing || 0);
        setNotReadyToBuildCount(body.counts?.notReadyToBuild || 0);
        setReadyToBuildKnown(body.counts?.readyToBuildKnown !== false);
        setSource('netsuite');
        setError(null);
        setFailure(null);
      })
      .catch((e: unknown) => {
        fail(decideSplitQueueLoad({
          hasEndpoint: true,
          networkError: e instanceof Error ? e.message : 'unknown error',
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  /**
   * Note what is NOT sent: subsidiary, department, and the GL account. Those are
   * resolved server-side from the order and from script configuration. A screen
   * choosing where an inventory adjustment posts would be a hole, not a feature.
   */
  const completeBundle = React.useCallback(async (req: CompleteRequest): Promise<CompleteResult> => {
    const url = endpointUrl();
    if (!url) {
      return { ok: false, error: 'This screen is not connected to NetSuite, so nothing was written.' };
    }
    try {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      // The Suitelet answers 200 to everything — NetSuite gives no way to set a
      // status code — so branch on the payload, never on r.status.
      if (!isJsonContentType(r.headers.get('content-type'))) {
        return { ok: false, error: 'NetSuite refused this request before the split script ran, so nothing was written. Reload the page; if it happens again your role is not in the deployment audience.' };
      }
      const body = await r.json();
      if (!body || body.ok !== true) {
        return { ok: false, error: (body && body.error) || 'The split could not be completed.' };
      }
      return body as CompleteResult;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'NetSuite could not be reached.' };
    }
  }, []);

  return {
    jobs, source, error, failure, lotMissingCount, notReadyToBuildCount, readyToBuildKnown,
    reload, completeBundle,
  };
};
