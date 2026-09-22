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
  /**
   * The currency NetSuite actually stamped on the order, read back after the save.
   *
   * Not the screen's memory of it. The confirmation prints this, so what the trader
   * is told at the end is the order's own answer.
   */
  currency?: string | null;
  /**
   * Set only when the order was created in a different currency from the one it was
   * priced in.
   *
   * 🔴 This is a money defect, not a display one: price, revenue, margin and the
   * low-price check were all computed in `expected` and the customer will be billed
   * in `actual`. It should never appear now that the request carries the currency
   * id; it exists because the one thing worse than a mismatch is a silent one.
   */
  currencyMismatch?: { expected: string; actual: string } | null;
  /**
   * Whether a Sales Team was actually written to the sublist.
   *
   * 🔴 THESE EXIST BECAUSE THE RESPONSE COULD NOT SAY. Until 2026-09-14 a team
   * that was silently ignored and a team that was written cleanly gave the
   * IDENTICAL answer: `salesTeamReplaced: false` with an empty `salesTeamPrevious`.
   * The client latch (`MCGI_CONFIG.salesTeamWriteEnabled`) and the endpoint's own
   * parameter sit on two DIFFERENT script deployments and can disagree, and when
   * they do the trader is shown "the team will be written", gets a success, and no
   * commission is attributed. A control that looks like it sets something and does
   * not is the defect this screen keeps being corrected for.
   */
  salesTeamWritten?: boolean;
  /** Non-null with `salesTeamWritten` false: understood, accepted, not written. */
  salesTeamIgnoredReason?: string | null;
  /** Employee ids the order carried BEFORE an append reattributed commission. */
  salesTeamPrevious?: string[];
  /** True when an append replaced a split that was already on the order. */
  salesTeamReplaced?: boolean;
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
    /*
     * 🔴 THE CURRENCY THE TRADER PRICED IN. Until 2026-09-16 this was not sent at
     * all, so `archOrderCreate`'s `if (currencyId) so.setValue({fieldId:'currency'})`
     * never fired and NetSuite used the customer's PRIMARY currency while the screen
     * quoted, converted and margined in the one that had been clicked. Only a
     * currency the customer record already allows can reach here -- the picker
     * offers that customer's own sublist, Feedback 6 item 13 -- which is exactly why
     * this is safe to send now and was not before.
     */
    currencyId: draft.header.currencyId || undefined,
    /* Feedback 6 item 7b. The server writes it to the order's native memo, which is
     * the field this note already lives in when a trader types one by hand. */
    customerNote: draft.header.customerNote || undefined,
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
    /* THE MEMBERS TRAVEL WITH THE ID, added 2026-09-14.
     *
     * The order endpoint runs as an ACCOUNTCENTER role that cannot read
     * `entitygroup` at all — measured four times, `Record 'entitygroup' was not
     * found`, unchanged by granting it LIST_CRMGROUP. So it can no longer look the
     * team up; it validates what we send against `employee`, which it CAN read.
     *
     * ⚠️ `contribution`, the FRACTION (0.5), never `contributionPct` (50). The
     * server refuses anything above 1 outright rather than guessing, because the
     * two differ by 50x on a commission split. Both live on the same object, which
     * is exactly why the refusal exists.
     *
     * Gated by the same latch as the id, and for the same reason: this is the last
     * point before the bytes leave. */
    salesTeamMembers: salesTeamWriteEnabled() && draft.header.salesTeamId
      ? (draft.header.salesTeamMembers || []).map((m) => ({
          id: m.id,
          name: m.name,
          contribution: m.contribution,
        }))
      : undefined,
    salesTeamName: salesTeamWriteEnabled() ? draft.header.salesTeamName || undefined : undefined,
    customerPO: draft.header.customerPO || undefined,
    incoterms: draft.header.incoterms || undefined,
    // The ID is what the server prefers; the text stays for an older script.
    incotermsId: draft.header.incotermsId || undefined,
    equipment: draft.header.equipment || undefined,
    equipmentId: draft.header.equipmentId || undefined,
    shipDate: draft.header.shipDate || undefined,
  },
  /*
   * Feedback 9 item 10. Sent as its own array, never merged into `lines`: the
   * endpoint's `resolveLines` refuses anything without a lot and a location, and
   * that refusal is what keeps the bundle guards unconditional.
   *
   * Omitted entirely when empty, so an order with no freight sends exactly the
   * payload it sent before this existed.
   */
  charges: draft.charges && draft.charges.length
    ? draft.charges.map((c) => ({
        itemId: c.itemId,
        quantity: c.quantity,
        rate: c.rate,
      }))
    : undefined,
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
export interface ArchIncotermDTO { id: string; name: string }

export interface ArchEquipmentDTO { id: string; name: string }

/**
 * The logistics equipment options, from NetSuite.
 *
 * ⚠️ Same three states as incoterms, treated differently in one respect: a
 * 'failed' equipment list must NOT stop an order. The field is optional, so the
 * wizard says the list could not be read and carries on, where a failed incoterms
 * list blocks the step because that field is mandatory.
 */
export interface ArchEquipmentResult {
  status: 'ok' | 'failed' | 'offline';
  equipment: ArchEquipmentDTO[];
  error: string | null;
}

export interface ArchIncotermsResult {
  /**
   * 'offline' means there is no endpoint to ask, which is the demo walkthrough.
   * 'failed' means there IS one and it could not answer. The wizard treats them
   * differently on purpose: offline may show the sample list, a real failure must
   * NOT, because showing a value NetSuite will reject is this defect.
   */
  status: 'ok' | 'failed' | 'offline';
  incoterms: ArchIncotermDTO[];
  error: string | null;
}

/**
 * The REAL incoterms options, from NetSuite.
 *
 * 'failed' is distinguished from an empty list on purpose. This picker used to
 * render three hardcoded strings out of `archOrderFixtures.ts`, one of which
 * ("Customer Pick Up") does not exist in the account, against a MANDATORY field --
 * so the wizard could not complete an order at all. Offering nothing and saying why
 * is strictly better than offering a value the write path will refuse.
 *
 * Served by the order Suitelet rather than the RESTlet for the same reason as the
 * sales-rep list: a RESTlet runs as the caller, and the list must be read under the
 * role that validates the write.
 */
/**
 * The customer list, read under the ORDER ENDPOINT's role instead of the caller's.
 *
 * MEASURED 2026-09-09, the same service call under three roles:
 *
 *                        visible   offered to the picker
 *   Administrator          806            465
 *   role 2181 (trader)      25             24
 *   role 2184 (endpoint)   416            397
 *
 * Role 2181 is a SALESCENTER sales role. It holds LIST_CUSTJOB, so nothing errors
 * and the list is not empty -- NetSuite just narrows it to the role's own customers,
 * silently. A trader offered 24 of 806 cannot work.
 *
 * ⚠️ 397 is not 465. Role 2184 is scoped too, so this is a 16x improvement and NOT
 * a fix; do not describe it as one.
 *
 * Returns null on any failure so the caller falls back to the RESTlet, which keeps
 * the deploy order forgiving: a new bundle against an old Suitelet degrades to
 * exactly today's behaviour rather than breaking.
 */
export const fetchCustomersFromEndpoint = async (
  // Numeric in every caller (ARCH_SUBSIDIARY_ID = 9); accepted as either so the
  // call site does not have to stringify a constant.
  subsidiaryId: string | number,
): Promise<{ success?: boolean; customers?: unknown[]; error?: string } | null> => {
  const url = endpointUrl();
  if (!url) return null;
  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(
      url + sep + 'action=customers&subsidiaryId=' + encodeURIComponent(subsidiaryId),
      { method: 'GET', credentials: 'include' },
    );
    // A Suitelet answers 200 to everything, so branch on the payload.
    const body = (await r.json()) as { success?: boolean; customers?: unknown[]; error?: string };
    if (!body || body.success !== true || !Array.isArray(body.customers)) return null;
    return body;
  } catch {
    return null;
  }
};

/**
 * The open sales orders, read under the ORDER ENDPOINT's role instead of the caller's.
 *
 * Marc-Antoine's item 5.b: under his own role the Open Sales Orders tab returned
 * NO orders at all.
 *
 * MEASURED 2026-09-09/10. Role 2181 is SALESCENTER with issalesrole=T, so NetSuite
 * narrows a transaction search to that role's OWN records. Its only holder, employee
 * 3293, sits on ZERO `transactionsalesteam` rows account-wide and reads
 * issalesrep='F', and every customer on the open ARCH orders has `salesrep` NULL.
 * That role's "own" set is EMPTY BY CONSTRUCTION: the query succeeds, returns
 * nothing, and nothing errors. Same silent-narrowing class as the customer list.
 *
 * Proven on the deployed endpoint 2026-09-10, 2184 against Administrator, identical
 * on all sixteen axes checked: 8 orders, 9 lines, 9 of 9 carrying a lot, thickness
 * ["4/4","8/4"], taggedItemCount 6, and traderAttribution byte-identical
 * (fromSalesTeam 8, unattributed 0, namesUnreadable 0, salesTeamRead "ok").
 *
 * ⚠️ This TRADES one scope for another rather than removing scope. 2184 is
 * subsidiaryoption=SELECTED and cannot see subsidiary 1 or 7 transactions, where
 * 2181 was OWN. It is also deliberately WIDER than the trader's own role: the tab
 * shows every ARCH order in 2184's subsidiaries, not only the trader's. Same trade
 * already accepted for the customer list.
 *
 * 🔴 `success === true` AND an `orders` array are BOTH required, and the second half
 * is load-bearing. An older Suitelet falls through to its health payload, which is
 * `{ok: true, service: 'arch-order-create', ...}` with no `success` and no `orders`;
 * branching on `ok` would read that as an order list of length zero and render an
 * empty tab. That is the defect being fixed, in a new costume.
 *
 * Returns null on any failure so the caller falls back to the RESTlet: a new bundle
 * against an old Suitelet degrades to exactly today's behaviour rather than breaking.
 */
/**
 * WHY THIS IS NOT A BARE `| null`.
 *
 * Three quite different things send the tab to the RESTlet, and the screen has to
 * name them differently or it asserts something false:
 *
 *   'unconfigured'  no order endpoint on this page. NOTHING was sent. Saying "the
 *                   order endpoint did not answer" about a request that never left
 *                   the browser is a claim about an event that did not happen.
 *   'refused'       the endpoint answered, at once, with FORBIDDEN. 🔴 This is the
 *                   COMMON case, not the exotic one: the React screen is deployed
 *                   to all employees while this endpoint permits only [2181, 3], so
 *                   most viewers land here. "Did not answer" is false for them and,
 *                   worse, unactionable -- the actionable fact is that their role is
 *                   not on the allowlist.
 *   'failed'        it was asked and did not come back usable.
 *
 * The first version of this returned bare null and the banner named the third cause
 * for all three.
 */
export type ArchOpenOrdersLeg =
  | { outcome: 'ok'; body: Record<string, unknown> }
  | { outcome: 'unconfigured' | 'refused' | 'failed' };

export const fetchOpenOrdersFromEndpoint = async (
  subsidiaryId: string | number,
): Promise<ArchOpenOrdersLeg> => {
  const url = endpointUrl();
  if (!url) return { outcome: 'unconfigured' };
  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(
      url + sep + 'action=openOrders&subsidiaryId=' + encodeURIComponent(subsidiaryId),
      { method: 'GET', credentials: 'include' },
    );
    // A Suitelet answers 200 to everything, so branch on the payload, never r.status.
    const body = (await r.json()) as Record<string, unknown>;
    /* The allowlist gate runs BEFORE the action dispatch, so a refusal never
     * reaches the openOrders branch at all.
     *
     * ⚠️ And it arrives as HTTP 200. `respond()` in the Suitelet takes a status
     * argument and never applies it: it writes `payload.status = 403` into the JSON
     * body and returns 200 regardless. So `r.status` cannot detect a refusal and
     * `r.ok` is true for one. The body's own `code` is the only signal. */
    if (body && body.code === 'FORBIDDEN') return { outcome: 'refused' };
    if (!body || body.success !== true || !Array.isArray(body.orders)) {
      return { outcome: 'failed' };
    }
    return { outcome: 'ok', body };
  } catch {
    return { outcome: 'failed' };
  }
};

/**
 * The REAL equipment options, from NetSuite, read through the same deployment as
 * incoterms so the screen cannot offer a value the write path would refuse.
 *
 * 🔴 Not hardcoded, and the list itself proves why: three of its fifteen
 * values were added on 2026-04-24 against 2025-03-26 for the rest, so MGSL grow
 * it. That is the argument Marc-Antoine made himself when he withdrew the request
 * to hardcode the Incoterms list on 2026-09-21.
 */
export const fetchEquipment = async (): Promise<ArchEquipmentResult> => {
  const url = endpointUrl();
  if (!url) return { status: 'offline', equipment: [], error: 'No order endpoint is configured.' };
  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(url + sep + 'action=equipment', { method: 'GET', credentials: 'include' });
    // A Suitelet answers 200 to everything, so branch on the payload, never r.status.
    const body = (await r.json()) as { ok?: boolean; equipment?: ArchEquipmentDTO[]; error?: string };
    if (!body || body.ok !== true || !Array.isArray(body.equipment)) {
      return {
        status: 'failed',
        equipment: [],
        error: (body && body.error) || 'The endpoint did not return a list.',
      };
    }
    return { status: 'ok', equipment: body.equipment, error: null };
  } catch (e) {
    return { status: 'failed', equipment: [], error: e instanceof Error ? e.message : String(e) };
  }
};

export const fetchIncoterms = async (): Promise<ArchIncotermsResult> => {
  const url = endpointUrl();
  if (!url) return { status: 'offline', incoterms: [], error: 'No order endpoint is configured.' };
  try {
    // Conditional separator: resolveScript already returns a query string.
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(url + sep + 'action=incoterms', { method: 'GET', credentials: 'include' });
    // A Suitelet answers 200 to everything, so branch on the payload, never r.status.
    const body = (await r.json()) as { ok?: boolean; incoterms?: ArchIncotermDTO[]; error?: string };
    if (!body || body.ok !== true || !Array.isArray(body.incoterms)) {
      return {
        status: 'failed',
        incoterms: [],
        error: (body && body.error) || 'The endpoint did not return a list.',
      };
    }
    return { status: 'ok', incoterms: body.incoterms, error: null };
  } catch (e) {
    return { status: 'failed', incoterms: [], error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * What the Pricing step multiplies costs by to reach the order's currency.
 *
 * Feedback 6 item 10b. `rate` converts FROM the cost currency TO the order's, so
 * it is the number to multiply by; `quotedRate` is its reciprocal, the familiar
 * figure NetSuite prints on the sales order itself (1.3906 CAD per USD today),
 * and is for display only.
 *
 * 🔴 `rate: null` on any failure, never 1. A 1 would silently assert parity and
 * the screen would show a margin it never converted. The caller is expected to
 * say so rather than quietly carry on.
 */
export interface ArchFxResult {
  status: 'ok' | 'failed' | 'offline';
  rate: number | null;
  quotedRate: number | null;
  /** The date the rate was asked FOR, which is the date the order will carry. */
  asOf: string | null;
  /**
   * The date of the rate row itself, when it is known. Null on the `N/currency`
   * path, which answers with a rate but not with the row behind it, so the copy
   * has to say "applies for" rather than "is dated".
   */
  effectiveDate: string | null;
  target: string | null;
  error: string | null;
}

export const fetchFxRate = async (
  currency: string,
  dateIso: string
): Promise<ArchFxResult> => {
  const empty = { rate: null, quotedRate: null, asOf: null, effectiveDate: null, target: currency || null };
  const url = endpointUrl();
  if (!url) return { status: 'offline', ...empty, error: 'No order endpoint is configured.' };
  if (!currency) return { status: 'failed', ...empty, error: 'No order currency yet.' };
  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(
      url + sep + 'action=fxRate&currency=' + encodeURIComponent(currency) +
        '&date=' + encodeURIComponent(dateIso || ''),
      { method: 'GET', credentials: 'include' }
    );
    const body = (await r.json()) as {
      ok?: boolean; rate?: number; quotedRate?: number;
      asOf?: string; effectiveDate?: string; target?: string; error?: string;
    };
    const rate = body && typeof body.rate === 'number' ? body.rate : null;
    if (!body || body.ok !== true || rate === null || !(rate > 0)) {
      return { status: 'failed', ...empty, error: (body && body.error) || 'No rate was returned.' };
    }
    return {
      status: 'ok',
      rate,
      quotedRate: typeof body.quotedRate === 'number' ? body.quotedRate : null,
      asOf: body.asOf || null,
      effectiveDate: body.effectiveDate || null,
      target: body.target || currency,
      error: null,
    };
  } catch (e) {
    return { status: 'failed', ...empty, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * The milling rates as `customrecord_milling_rate` holds them, item 10c.
 *
 * Marc-Antoine asked for the screen to feed from Mo's record "pour que ce soit
 * dynamique". Each rate is optional on purpose: a row that has ended, carries
 * the wrong unit or is not a number is left out by the endpoint, and the caller
 * keeps its own constant for that service rather than losing the charge.
 */
export interface ArchMillingRates {
  status: 'ok' | 'failed' | 'offline';
  planing: number | null;
  cut: number | null;
  split: number | null;
  asOf: string | null;
  error: string | null;
}

export const fetchMillingRates = async (dateIso: string): Promise<ArchMillingRates> => {
  const empty = { planing: null, cut: null, split: null, asOf: null };
  const url = endpointUrl();
  if (!url) return { status: 'offline', ...empty, error: 'No order endpoint is configured.' };
  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(url + sep + 'action=millingRates&date=' + encodeURIComponent(dateIso || ''), {
      method: 'GET',
      credentials: 'include',
    });
    const body = (await r.json()) as {
      ok?: boolean;
      asOf?: string;
      rates?: { planing?: { rate?: number }; cut?: { rate?: number }; split?: { rate?: number } };
      error?: string;
    };
    if (!body || body.ok !== true || !body.rates) {
      return { status: 'failed', ...empty, error: (body && body.error) || 'No rates were returned.' };
    }
    const pick = (v: { rate?: number } | undefined): number | null =>
      v && typeof v.rate === 'number' && isFinite(v.rate) && v.rate >= 0 ? v.rate : null;
    return {
      status: 'ok',
      planing: pick(body.rates.planing),
      cut: pick(body.rates.cut),
      split: pick(body.rates.split),
      asOf: body.asOf || null,
      error: null,
    };
  } catch (e) {
    return { status: 'failed', ...empty, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Can THIS role create an order, asked before the trader fills the wizard in.
 *
 * 🔴 EXISTS BECAUSE ITEMS 5 AND 12 COMBINE BADLY. Item 5 lands three roles on the
 * ARCH screen; item 12 lets all three READ the order endpoint while only the
 * trader role may write. Without this, a logistics or AP/AR user picks bundles,
 * fills a customer, prices every line, presses Create and only then learns their
 * role is not permitted. The endpoint has always been able to answer the question
 * up front: its GET health payload carries `role` and `permittedRoles`.
 *
 * Unknown is treated as ALLOWED. A screen that hides its own button because a
 * health check failed would be a worse failure than the one it prevents, and the
 * server refuses the write anyway.
 */
export interface ArchChargeItem {
  id: string;
  name: string;
}

export interface ArchWriteAuth {
  status: 'ok' | 'unknown';
  allowed: boolean;
  role: number | null;
  permittedRoles: number[];
  /**
   * Non-inventory charge items the Items step may add, Feedback 9 item 10.
   *
   * 🔴 THE SERVER'S ALLOWLIST IS THE AUTHORITY, not this list. The endpoint
   * refuses any item outside it, because the browser can be bypassed and the
   * account holds 31 active non-inventory items including `Temp Migration AP`,
   * `Credit Memo Customer`, `Duty` and `Export Tax`. This is here so the picker
   * shows the live NAMES rather than a hardcoded copy that can drift.
   *
   * Empty when the probe could not read them, which disables the affordance
   * rather than offering an item the server would reject.
   */
  chargeItems: ArchChargeItem[];
}

export const fetchWriteAuth = async (): Promise<ArchWriteAuth> => {
  const unknown: ArchWriteAuth = {
    status: 'unknown', allowed: true, role: null, permittedRoles: [], chargeItems: [],
  };
  const url = endpointUrl();
  if (!url) return unknown;
  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(url + sep + 'action=health', { method: 'GET', credentials: 'include' });
    const body = (await r.json()) as {
      ok?: boolean; role?: number; permittedRoles?: number[];
      chargeItems?: ArchChargeItem[] | { error?: string };
    };
    if (!body || body.ok !== true || typeof body.role !== 'number' || !Array.isArray(body.permittedRoles)) {
      return unknown;
    }
    return {
      status: 'ok',
      allowed: body.permittedRoles.indexOf(body.role) !== -1,
      role: body.role,
      permittedRoles: body.permittedRoles,
      /* 🔴 ARRAY OR NOTHING. `chargeItemList` returns `{ error }` when the read
       * failed, and that object is truthy: spreading it into a list would give
       * the picker an entry with no id that the server would then refuse. An
       * empty list disables the affordance instead, which is the honest state. */
      chargeItems: Array.isArray(body.chargeItems) ? body.chargeItems : [],
    };
  } catch {
    return unknown;
  }
};

/**
 * The sales rep on a customer's own sales team, for prefilling the wizard.
 *
 * 🔴 Marc-Antoine, 2026-09-17: "Sur certains client il est populé automatiquement
 * (ex: The hardwood store). est-ce qu'on peut faire en sorte qu'il suive ce qu'il
 * y a sur la fiche client?" NetSuite's own UI sources the customer's team onto a
 * new order; our endpoint builds the record non-dynamically, so it does not.
 *
 * ⚠️ Returns null for BOTH "the customer has no team" and "the call failed", and
 * that is deliberate rather than lazy: the caller's response to either is the
 * same, leave the field blank and let the trader pick, which is exactly today's
 * behaviour. Nothing here may block the wizard.
 */
export const fetchCustomerSalesRep = async (
  customerId: string
): Promise<{ repId: string; repName: string } | null> => {
  const url = endpointUrl();
  if (!url || !customerId) return null;
  try {
    // Same conditional separator as below: `url.resolveScript` already returns a
    // query string, and hardcoding '?' gets the Suitelet's HTML instead of JSON.
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const r = await fetch(
      `${url + sep}action=customerSalesTeam&customer=${encodeURIComponent(customerId)}`,
      { method: 'GET', credentials: 'include' }
    );
    // A Suitelet answers 200 to everything, so branch on the payload.
    const body = (await r.json()) as { ok?: boolean; repId?: number | string | null; repName?: string };
    if (!body || body.ok !== true || !body.repId) return null;
    return { repId: String(body.repId), repName: String(body.repName || '') };
  } catch {
    return null;
  }
};

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

/**
 * Ticks or unticks Ready to Build on an EXISTING, already-saved order from the
 * Open Sales Orders tab.
 *
 * Deliberately its own small result type rather than reusing `ArchOrderResult`:
 * that type's fields (`splitStored`, `remanStored`, `lotsNotAttributed`, …) are
 * about ORDER CREATION and every one of them would be meaningless noise on a
 * response that only ever changes one checkbox.
 *
 * Same transport contract as `submit`: a Suitelet answers 200 to everything,
 * so branch on the payload and never on `r.status`, and a dropped fetch does
 * NOT mean the write failed — `transportFailure` says so rather than guessing.
 */
export interface ReadyToBuildResult {
  ok: boolean;
  error?: string;
  /**
   * `NOT_STORED` is this file's own, not the server's: NetSuite accepted the
   * save and then read back a different value. See the check below.
   */
  code?: 'REFUSED' | 'FAILED' | 'NOT_STORED' | string;
  readyToBuild?: boolean;
  /** The server re-read the saved record rather than trusting its own write. */
  verified?: boolean;
  /**
   * Whether that re-read MATCHED what was asked for.
   *
   * `verified: true` with this `false` is the one outcome that looks exactly
   * like success and is not — and it was being dropped on the floor here until
   * 2026-09-13, which made the server's whole trust-but-verify step decorative.
   * Absent (an older Suitelet that does not send it) is NOT false: no claim.
   */
  verifiedMatches?: boolean;
  transportFailure?: boolean;
}

export const setReadyToBuild = async (
  soId: string | number,
  value: boolean,
): Promise<ReadyToBuildResult> => {
  const url = endpointUrl();
  if (!url) {
    return { ok: false, error: 'This screen is not connected to NetSuite, so nothing was written.' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ctrl = new AbortController();
    // 30s, not SUBMIT_TIMEOUT_MS: this writes one checkbox on a record that
    // already exists, none of the multi-minute lot-assignment work `submit`
    // has to wait out.
    timer = setTimeout(() => ctrl.abort(), 30_000);
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setReadyToBuild', soId, value }),
      signal: ctrl.signal,
    });
    const body = (await r.json()) as {
      ok?: boolean; error?: string; code?: string; readyToBuild?: boolean;
      verified?: boolean; verifiedMatches?: boolean;
    };
    if (!body || body.ok !== true) {
      return {
        ok: false,
        error: (body && body.error) || 'Ready to Build could not be changed.',
        code: body && body.code,
      };
    }
    /*
     * `ok: true` from the Suitelet means the SAVE did not throw. The server then
     * re-reads the record, and this is where that answer is acted on: a value
     * NetSuite stored as something other than what was asked for is a failure,
     * however cleanly the save returned.
     *
     * `=== false` and not `!== true` deliberately. An older deployed Suitelet
     * that sends no `verifiedMatches` would otherwise have every successful tick
     * reported as a failure — the bundle and the Suitelet deploy separately, so
     * that is a real ordering, not a hypothetical.
     */
    if (body.verified === true && body.verifiedMatches === false) {
      return {
        ok: false,
        code: 'NOT_STORED',
        readyToBuild: body.readyToBuild,
        verified: true,
        verifiedMatches: false,
        error:
          `NetSuite accepted the save but Ready to Build did not stick — reading the order back, ` +
          `it is still ${value ? 'unticked' : 'ticked'}. Open SO ${soId} in NetSuite before acting on it.`,
      };
    }
    return {
      ok: true,
      readyToBuild: body.readyToBuild,
      verified: body.verified,
      verifiedMatches: body.verifiedMatches,
    };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      transportFailure: true,
      error: timedOut
        ? 'NetSuite did not answer within 30 seconds. Reload the tab before retrying — the tick may or may not have landed.'
        : e instanceof Error
          ? e.message
          : 'NetSuite could not be reached.',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
