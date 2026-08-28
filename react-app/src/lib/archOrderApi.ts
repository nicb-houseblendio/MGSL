/**
 * Calls the CWP ARCH sales-order endpoint.
 *
 * Deliberately shaped like `useArchSplitQueue`'s `completeBundle`, because that
 * is the sanctioned pattern for writing to NetSuite from this bundle and the
 * traps are identical.
 *
 * ── What is NOT sent, and why ───────────────────────────────────────────────
 * No subsidiary, no department, no form, no insurance rate, no sales rep. Every
 * one of those is resolved server-side from configuration or from the customer.
 * A screen choosing where a transaction posts, or what rate it books at, would
 * be a hole rather than a feature — the same reasoning that removed the GL
 * account from the split endpoint.
 *
 * Quantities go up in DISPLAY units, board feet for Lumber. The server converts.
 */

import type { ArchOrderDraft } from '@/types/archOrder';

/**
 * Where the order Suitelet lives. Injected by the trader Suitelet alongside the
 * rest of MCGI_CONFIG, and absent when the bundle is served any other way —
 * which is the signal to refuse rather than guess a URL and POST somewhere.
 */
const endpointUrl = (): string | null => {
  const cfg = (window as unknown as { MCGI_CONFIG?: { orderEndpointUrl?: string } }).MCGI_CONFIG;
  return cfg?.orderEndpointUrl || null;
};

export const orderEndpointConfigured = (): boolean => endpointUrl() !== null;

export interface ArchOrderResult {
  ok: boolean;
  error?: string;
  salesOrderId?: number;
  /**
   * The human sales order number, e.g. "SO-CWP-001346". The server has always sent
   * this; the type dropped it, so the confirmation said "internal id 126654" and a
   * trader had no way to find their own order. Added 2026-08-28.
   */
  tranId?: string;
  /**
   * True when the request never came back, so we do NOT know whether NetSuite saved
   * the order. Distinct from a refusal, where the server answered and declined.
   *
   * This exists because the dialog was printing "Nothing was written" on every
   * failure, which is a false statement on a dropped fetch: the SO may exist. The
   * catch below has always known the difference and simply never reported it.
   */
  transportFailure?: boolean;
  appended?: boolean;
  splitLinesQueued?: number;
  /** Non-empty means the order EXISTS but its bundles are not locked. */
  lotsNotAttributed?: string[];
  assignmentMismatches?: string[];
  /** Set when the order landed on a form that cannot carry a lot. */
  formWarning?: string | null;
  /** Per-line problems from a refusal, so the wizard can show all of them. */
  problems?: string[];
  /** True when any line asked for planing or cutting. */
  remanRequested?: boolean;
  /**
   * True when those instructions were actually written to the SO lines.
   *
   * The server decides this, not the screen. The reman line fields may not be
   * deployed -- objects cannot be pushed from this project -- so the endpoint
   * probes the record and reports what it managed to do. `remanRequested &&
   * !remanStored` is the case that matters: the trader typed instructions that
   * did NOT reach NetSuite and has to pass them on by hand.
   */
  remanStored?: boolean;
}

/**
 * An idempotency key for one submission attempt.
 *
 * 🔴 THIS IS NOT OPTIONAL IN PRACTICE. A retry without the same key creates a
 * SECOND order committing the same stock, and this project has already been
 * bitten by the underlying cause: a client-side fetch timeout does not cancel
 * the server, so the browser can give up on a request that succeeded. Generate
 * one per order and REUSE it on every retry of that order.
 *
 * The server accepts 8 to 64 characters of letters, digits, dash or underscore.
 */
export const newIdempotencyKey = (): string => {
  const c = (window as unknown as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return 'ARCH-' + c.randomUUID();
  // Fallback for any context without randomUUID. Not cryptographic, and does not
  // need to be — it only has to be unique among this user's open attempts.
  const rand = Math.random().toString(36).slice(2, 12);
  return 'ARCH-' + Date.now().toString(36) + '-' + rand;
};

/** Maps the wizard's draft onto the endpoint's contract. */
const toRequest = (draft: ArchOrderDraft, idempotencyKey: string) => ({
  mode: draft.mode,
  existingSO: draft.existingSO || undefined,
  idempotencyKey,
  header: {
    // Ids, not names. The wizard currently holds `customer` as a display string,
    // so this is null until the customer picker returns an internal id — the
    // server refuses with "The order needs a customer" rather than guessing.
    customerId: draft.header.customerId || undefined,
    shipAddressId: draft.header.shipAddressId || undefined,
    salesRepId: draft.header.salesRepId || undefined,
    customerPO: draft.header.customerPO || undefined,
    incoterms: draft.header.incoterms || undefined,
    shipDate: draft.header.shipDate || undefined,
  },
  lines: draft.lines.map((l) => ({
    itemId: l.itemId,
    locationId: l.locationId,
    lotId: l.lotId,
    // On a split line the ORDER carries the target, and the server reads
    // splitTargetQty for it. Sending both would make the two fields disagree
    // about intent, which the server refuses outright rather than guessing.
    qty: l.isSplit ? undefined : l.orderedQty,
    splitTargetQty: l.isSplit ? l.orderedQty : undefined,
    isSplit: l.isSplit,
    pricePerUnit: l.pricePerBF,
    /*
     * Reman intent, sent per line because that is where Marc-Antoine put it:
     * "Sur la ligne du SO ca devrait peut etre un sublist field" (2026-08-21).
     *
     * Sent only when a service is actually ticked. An untouched reman step
     * would otherwise post four empty strings on every line of every order,
     * which reads in the logs as though somebody asked for reman and it failed.
     * The server drops a spec whose checkbox is clear, so the two agree.
     */
    reman:
      l.reman && (l.reman.planing || l.reman.cutting)
        ? {
            planing: l.reman.planing,
            planingSpec:
              l.reman.planingSpec === 'other' ? l.reman.planingOther : l.reman.planingSpec,
            cutting: l.reman.cutting,
            cutLength: l.reman.cutLength,
          }
        : undefined,
  })),
});

/**
 * Validates against live stock without writing. Worth calling before showing a
 * confirm step, because it catches a cart that went stale while the trader was
 * pricing it — and because a dry run that passes means the write will get past
 * the same checks.
 */
export const validateArchOrder = async (
  draft: ArchOrderDraft,
  idempotencyKey: string
): Promise<ArchOrderResult> => submit({ ...toRequest(draft, idempotencyKey), dryRun: true });

export const createArchOrder = async (
  draft: ArchOrderDraft,
  idempotencyKey: string
): Promise<ArchOrderResult> => submit(toRequest(draft, idempotencyKey));

export interface ArchSalesRepDTO {
  id: string;
  name: string;
  subsidiaryName?: string | null;
}

/**
 * The sales-rep list, read from the ORDER endpoint rather than the trader-screen
 * RESTlet.
 *
 * 🔴 Why it moved. A RESTlet ignores `runasrole` and runs as the CALLER, and the
 * ARCH trader role cannot read the employee table at all. So the wizard's rep
 * dropdown — which was built, rendered and working — came back empty for the
 * only role that actually needs it, and the order was then refused for having no
 * rep to credit. This Suitelet runs as `customrole2184`, which can read
 * employees, and is the same role that validates the rep on write. One role for
 * both halves means the list can no longer offer a rep the write path refuses.
 *
 * Returns null rather than [] on any failure, so the caller can fall back to the
 * RESTlet. That keeps the deploy order forgiving: a new bundle against an old
 * Suitelet degrades to exactly today's behaviour instead of breaking.
 */
export const fetchSalesRepsFromEndpoint = async (): Promise<ArchSalesRepDTO[] | null> => {
  const url = endpointUrl();
  if (!url) return null;
  try {
    // `url.resolveScript` already returns a query string, so the separator has
    // to be conditional. Hardcoding '?' produced a URL NetSuite answers with the
    // Suitelet's own HTML rather than JSON.
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(url + sep + 'action=salesReps', {
      method: 'GET',
      credentials: 'include',
    });
    // Same rule as `submit`: a Suitelet answers 200 to everything, so branch on
    // the payload and never on r.status.
    const body = (await r.json()) as { ok?: boolean; salesReps?: ArchSalesRepDTO[] };
    if (!body || body.ok !== true || !Array.isArray(body.salesReps)) return null;
    return body.salesReps;
  } catch {
    return null;
  }
};

const submit = async (payload: unknown): Promise<ArchOrderResult> => {
  const url = endpointUrl();
  if (!url) {
    return {
      ok: false,
      error: 'This screen is not connected to NetSuite, so nothing was written.',
    };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // ⚠️ A Suitelet answers 200 to everything — NetSuite gives no way to set a
    // status code — so branch on the payload and NEVER on r.status. The server
    // does send a `status` field, and it is advisory only.
    const body = (await r.json()) as ArchOrderResult;
    if (!body || body.ok !== true) {
      return {
        ok: false,
        error: (body && body.error) || 'The order could not be created.',
        problems: body && body.problems,
      };
    }
    return body;
  } catch (e) {
    // A failed fetch does NOT mean the server did nothing. It may have created
    // the order and lost the response, which is exactly what the idempotency key
    // exists for: retrying with the same key is refused rather than duplicated.
    return {
      ok: false,
      // The comment above is the whole reason this flag exists: we genuinely do not
      // know the outcome here, so the dialog must not claim nothing was written.
      transportFailure: true,
      error:
        e instanceof Error
          ? `${e.message}. If you retry, use the same order — a duplicate will be refused rather than created twice.`
          : 'NetSuite could not be reached.',
    };
  }
};
