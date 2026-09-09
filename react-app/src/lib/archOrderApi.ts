/**
 * Calls the CWP ARCH sales-order endpoint.
 *
 * Deliberately shaped like `useArchSplitQueue`'s `completeBundle`, because that
 * is the sanctioned pattern for writing to NetSuite from this bundle and the
 * traps are identical.
 *
 * ── What is NOT sent, and why ───────────────────────────────────────────────
 * No subsidiary, no department, no form, no insurance rate. Every one of those
 * is resolved server-side from configuration or from the customer. A screen
 * choosing where a transaction posts, or what rate it books at, would be a hole
 * rather than a feature — the same reasoning that removed the GL account from
 * the split endpoint.
 *
 * ⚠️ "No sales rep" used to be in that list and had stopped being true: the rep
 * IS sent (`header.salesRepId`), because the endpoint refuses an order it cannot
 * credit, and the Sales Team is sent beside it (`header.salesTeamId`). Both are
 * PEOPLE decisions the trader owns, not posting decisions.
 *
 * Quantities go up in DISPLAY units, board feet for Lumber. The server converts.
 */

import type { ArchOrderDraft } from '@/types/archOrder';
import { salesTeamWriteEnabled } from '@/lib/archSalesTeams';

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
  /**
   * The server's own verdict on whether anything was written. 'REFUSED' means it
   * declined before saving, so "nothing was written" is safe to say. 'FAILED' means
   * it threw, and the order may already exist. Absent on a client-side refusal.
   */
  code?: 'REFUSED' | 'FAILED' | string;
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
  /** True when any line asked to be split. */
  splitRequested?: boolean;
  /**
   * True when the split MARKER actually reached the SO lines.
   *
   * Same contract as `remanStored` and it carries further: the marker is the
   * only thing that puts a bundle in the warehouse queue, so `splitRequested &&
   * !splitStored` means the stock is committed and nobody will ever be told to
   * cut it. The three `custcol_mgsl_split*` fields exist in the sandbox and in
   * no other environment, so this is false by default in production until they
   * are deployed. `splitLinesQueued` already counts only the lines that landed.
   */
  splitStored?: boolean;
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
    /*
     * The Sales Team (commission split), as the `entitygroup` internal id in a
     * string. Marc-Antoine's model, 2026-09-08: "Le sales team définit le split
     * commission" — so this is the OTHER half of the rep field above, not a
     * rename of it, and the two are sent side by side.
     *
     * Absent rather than '' when nothing is picked, so the server cannot read an
     * empty string as an instruction to clear a team. The wizard only ever sets
     * it from `sendableTeamId`, which refuses any id the live list does not
     * currently hold: a stale or invented `entitygroup` id would attribute
     * somebody's commission, which is the same class of error as resolving a
     * typed customer name onto the wrong account.
     *
     * ⚠️ IGNORED ON AN APPEND. `archOrderCreate.js` wraps the entire header
     * block in `if (!appending)`, the sales-team sublist included, so this key
     * only does anything on a new order. The wizard says so on the field rather
     * than letting the trader believe otherwise.
     */
    /*
     * 🔴 GATED AGAIN HERE, not only in the wizard. `sendableTeamId` already refuses
     * unless the switch is on, but that runs while BUILDING a draft; this is the
     * transport boundary, and a draft can reach it from anywhere (a retry of a draft
     * built earlier, a future caller, a test). The latch belongs at the last point
     * before the bytes leave, because what it prevents is attributing commission on a
     * real sales document. Proved by test: a draft carrying a team id sends nothing
     * while the switch is off.
     */
    salesTeamId: salesTeamWriteEnabled() ? draft.header.salesTeamId || undefined : undefined,
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
export interface SubmitOptions {
  /** Test hook and escape hatch; defaults to SUBMIT_TIMEOUT_MS. */
  timeoutMs?: number;
}

export const validateArchOrder = async (
  draft: ArchOrderDraft,
  idempotencyKey: string,
  opts?: SubmitOptions
): Promise<ArchOrderResult> => submit({ ...toRequest(draft, idempotencyKey), dryRun: true }, opts?.timeoutMs);

export const createArchOrder = async (
  draft: ArchOrderDraft,
  idempotencyKey: string,
  opts?: SubmitOptions
): Promise<ArchOrderResult> => submit(toRequest(draft, idempotencyKey), opts?.timeoutMs);

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

/**
 * How long a create/append may take before we stop waiting.
 *
 * 🔴 300s, NOT 90s. 90 was measured to be BELOW the real server time and was
 * corrected the same day it shipped. From this account's own execution log, a
 * ONE-line, one-lot order (SO-CWP-001354) took 102 seconds end to end: the header
 * assignment, the first save, then `assignLots` reloading and saving the order a
 * second time, which alone was 62 of those seconds. At 90s the trader would have
 * been told "NetSuite did not answer, the order may still have been created" about
 * an order that saved correctly with its lot attached, and per-line work scales it.
 *
 * Still finite, because the confirmation dialog refuses every dismissal while
 * `submitting` is true, so a request that never returns must not strand the trader
 * in a modal. That is now belt and braces rather than the only guard:
 * `handleCreateOrder` clears `submitting` in a `finally`, so even a rejection
 * releases the dialog.
 *
 * Giving up here does NOT cancel the server: the order may still be created, which
 * is why the result is a transportFailure and says so. Most of this window is
 * POST-commit, so an abort here almost never means "nothing happened".
 */
export const SUBMIT_TIMEOUT_MS = 300_000;

const submit = async (payload: unknown, timeoutMs: number = SUBMIT_TIMEOUT_MS): Promise<ArchOrderResult> => {
  const url = endpointUrl();
  if (!url) {
    return {
      ok: false,
      error: 'This screen is not connected to NetSuite, so nothing was written.',
    };
  }
  // Both INSIDE the try. Constructed above it, a ReferenceError in a browser with no
  // AbortController would reject rather than return, and every caller treats this
  // function as one that always resolves.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
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
        // 🔴 CARRY THE CODE. The server distinguishes REFUSED (it declined before
        // writing anything) from FAILED (it threw, possibly AFTER the save committed)
        // at mcgi_sl_arch_order_create.js:231-234, and dropping it made every server
        // error read as "nothing was written" - the exact false statement the
        // transportFailure flag exists to prevent. `assignLots` opens with a bare
        // record.load and closes with a bare so.save, so a throw in there leaves a
        // real order behind and comes back as FAILED.
        code: body && body.code,
      };
    }
    return body;
  } catch (e) {
    // A failed fetch does NOT mean the server did nothing. It may have created
    // the order and lost the response, which is exactly what the idempotency key
    // exists for: retrying with the same key is refused rather than duplicated.
    // Our own timeout is the same case: we stopped listening, NetSuite did not
    // necessarily stop working.
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      // The comment above is the whole reason this flag exists: we genuinely do not
      // know the outcome here, so the dialog must not claim nothing was written.
      transportFailure: true,
      error: timedOut
        ? `NetSuite did not answer within ${Math.round(timeoutMs / 1000)} seconds. The order may still have been created: check the sales order list before retrying, and if you retry, use the same order — a duplicate will be refused rather than created twice.`
        : e instanceof Error
          ? `${e.message}. If you retry, use the same order — a duplicate will be refused rather than created twice.`
          : 'NetSuite could not be reached.',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export type OrderOutcomeKind = 'submitting' | 'notConnected' | 'refused' | 'unknown' | 'created';

export interface OrderOutcome {
  kind: OrderOutcomeKind;
  /** The confirmation dialog's headline. */
  title: string;
  /**
   * Why the cart is still on screen after an attempt, or null when it is not
   * (created: the cart is cleared; submitting: nothing to say yet). Shown on the
   * cart bar, which outlives the dialog: after Done the bar was the only thing
   * left and it said nothing about why the order was not created.
   */
  cartReason: string | null;
}

/**
 * The ONE classification of an attempt's outcome. The dialog header, the
 * notice body and the cart bar all read this; until 2026-09-08 the header and
 * the notice each carried their own copy of the four-way branch, which is the
 * divergence the two tally dialogs already paid for once.
 *
 * `unknown` (a dropped or timed-out request) must never say "nothing was
 * written": the SO may exist. That sentence is reserved for `refused`, where
 * the server answered and declined.
 */
export const orderOutcome = (result: ArchOrderResult | null | undefined, submitting: boolean): OrderOutcome => {
  if (submitting) return { kind: 'submitting', title: 'Sending to NetSuite…', cartReason: null };
  if (!result) {
    return {
      kind: 'notConnected',
      title: 'Order assembled — not sent, this screen is not connected to NetSuite',
      cartReason: 'Not sent: this screen is not connected to NetSuite.',
    };
  }
  if (result.ok) {
    // Prefer tranId: "SO-CWP-001346" is the number a trader can actually search
    // for. salesOrderId stays as the fallback rather than showing nothing.
    const ref = result.tranId
      ? ` — ${result.tranId}`
      : result.salesOrderId
        ? ` — internal id ${result.salesOrderId}`
        : '';
    return { kind: 'created', title: `Sales order created${ref}`, cartReason: null };
  }
  // Two different ways of not knowing, and neither may claim nothing was written.
  if (result.transportFailure) {
    return {
      kind: 'unknown',
      title: 'NetSuite did not answer — the order may or may not exist',
      cartReason: 'Outcome unknown: NetSuite did not answer. Check the sales order list before retrying.',
    };
  }
  if (result.code === 'FAILED') {
    return {
      kind: 'unknown',
      title: 'NetSuite reported an error — the order may already exist',
      cartReason:
        'Outcome unknown: NetSuite reported an error after it began saving. Check the sales order list before retrying.',
    };
  }
  return {
    kind: 'refused',
    title: 'NetSuite refused this order — nothing was written',
    cartReason: `Refused by NetSuite: ${result.error || 'no reason given'} Your selection is intact.`,
  };
};
