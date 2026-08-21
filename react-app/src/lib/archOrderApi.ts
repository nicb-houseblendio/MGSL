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
  appended?: boolean;
  splitLinesQueued?: number;
  /** Non-empty means the order EXISTS but its bundles are not locked. */
  lotsNotAttributed?: string[];
  assignmentMismatches?: string[];
  /** Set when the order landed on a form that cannot carry a lot. */
  formWarning?: string | null;
  /** Per-line problems from a refusal, so the wizard can show all of them. */
  problems?: string[];
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
      error:
        e instanceof Error
          ? `${e.message}. If you retry, use the same order — a duplicate will be refused rather than created twice.`
          : 'NetSuite could not be reached.',
    };
  }
};
