import * as React from 'react';
import { getSplitJobs } from '@/lib/archSplit';
import type { ArchSplitJob } from '@/types/archSplit';

/**
 * The warehouse split queue, from NetSuite when it is reachable and from
 * fixtures when it is not.
 *
 * The screen was built against `getSplitJobs()` and every control was audited
 * against the client prototype using it, so the fixtures stay as the fallback
 * rather than being deleted. Two reasons that is worth keeping:
 *
 *  - The endpoint is behind a role allowlist. Someone opening the screen without
 *    permission should see the layout and an explanatory banner, not an empty
 *    page that looks broken.
 *  - Until real orders carry split flags the live queue is legitimately empty,
 *    and an empty screen is indistinguishable from a failed one.
 *
 * `source` is returned so the screen can say which it is showing. Silently
 * serving demo data as if it were real is the failure mode to avoid.
 */

export type SplitQueueSource = 'netsuite' | 'fixtures' | 'loading';

export interface ArchSplitQueueState {
  jobs: ArchSplitJob[];
  source: SplitQueueSource;
  /** Non-null when the live fetch failed and fixtures are standing in. */
  error: string | null;
  /** Split-flagged lines with no lot assigned. They cannot be worked as-is. */
  lotMissingCount: number;
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
  counts?: { orders: number; bundles: number; lotMissing: number };
  error?: string;
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
  const [lotMissingCount, setLotMissingCount] = React.useState(0);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;

    const fallback = (why: string | null) => {
      if (cancelled) return;
      setJobs(getSplitJobs());
      setSource('fixtures');
      setError(why);
      setLotMissingCount(0);
    };

    const url = endpointUrl();
    if (!url) {
      // Not served by the warehouse Suitelet — a local preview or a storybook.
      fallback(null);
      return;
    }

    setSource('loading');
    fetch(`${url}${url.indexOf('?') === -1 ? '?' : '&'}action=queue`, { credentials: 'include' })
      .then((r) => r.json() as Promise<QueueResponse>)
      .then((body) => {
        if (cancelled) return;
        if (!body.ok) {
          fallback(body.error || 'The split queue could not be loaded.');
          return;
        }
        setJobs((body.jobs || []) as unknown as ArchSplitJob[]);
        setLotMissingCount(body.counts?.lotMissing || 0);
        setSource('netsuite');
        setError(null);
      })
      .catch((e: unknown) => {
        fallback(e instanceof Error ? e.message : 'The split queue could not be reached.');
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
      const body = await r.json();
      if (!body || body.ok !== true) {
        return { ok: false, error: (body && body.error) || 'The split could not be completed.' };
      }
      return body as CompleteResult;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'NetSuite could not be reached.' };
    }
  }, []);

  return { jobs, source, error, lotMissingCount, reload, completeBundle };
};
