/**
 * Open ARCH sales orders, live from NetSuite.
 *
 * 🔴 THIS FIXES A BROKEN PATH, not just a demo tab. `getOpenOrders()` is a
 * fixture generator, and the wizard's "add to existing sales order" mode fed the
 * chosen order's NUMBER ("SO-40123") to the write endpoint. That endpoint takes an
 * internal ID and parses it strictly, so every append was refused with "Adding to
 * an existing order needs the internal id of that order" — after the trader had
 * filled in the entire wizard. The fixtures had no internal ids to give.
 *
 * So `internalId` here is the load-bearing field, and `soNo` is for display only.
 *
 * ── Honesty channel, same as every other ARCH hook ──────────────────────────
 * `source` is 'netsuite' or 'fixtures', and the tab says which. Demo orders keep
 * `internalId: null`, which makes them unappendable by construction rather than
 * by remembering to check a flag: nothing can be sent for an order that has no id.
 */

import * as React from 'react';
import { apiGet } from '@/lib/api';
import { fetchOpenOrdersFromEndpoint } from '@/lib/archOrderApi';
import { normalizeUnit } from '@/lib/archUom';
import { getOpenOrders as getFixtureOrders } from '@/lib/archOrderFixtures';
import { deriveTraderAttribution } from '@/lib/archTraderAttribution';
import type { ArchTraderAttribution } from '@/lib/archTraderAttribution';
import type { ArchCartLine, ArchOpenOrder, ArchOrderStatus } from '@/types/archOrder';

/** Selects the ARCH service on the shared RESTlet. Mirrors useArchCustomers. */
const ARCH_SUBSIDIARY_ID = 9;

export type ArchOpenOrdersSource = 'loading' | 'netsuite' | 'fixtures';

/**
 * WHICH LEG answered, which is a different question from whether the data loaded.
 *
 * 'endpoint' is the order Suitelet, running under its own `runasrole` (customrole2184).
 * 'restlet' is the shared RESTlet, which ignores `runasrole` and runs as the CALLER --
 * so on that leg the list is scoped to whatever the viewer's own role can see.
 *
 * 🔴 This exists because two sentences on screen are only true of ONE of the legs.
 * The attribution notice says "a RESTlet ignores runasrole and runs as the caller",
 * which is false on a Suitelet, and the empty-state banner blames a role scoped to
 * its own transactions, which role 2184 is not (it is ACCOUNTCENTER, issalesrole=F).
 * Without knowing the leg, the screen cannot avoid asserting one of them wrongly.
 */
export type ArchOpenOrdersTransport = 'endpoint' | 'restlet';

/**
 * WHY the RESTlet leg was used, when it was. Null on the endpoint leg.
 *
 * The screen has to name this, not guess it: 'unconfigured' means no request was
 * ever sent, and 'refused' means the endpoint answered instantly because the
 * viewer's role is not on its allowlist. Only 'failed' means it was asked and did
 * not come back. Saying "the order endpoint did not answer" covers one of three.
 */
export type ArchOpenOrdersFallbackReason = 'unconfigured' | 'refused' | 'failed';

/**
 * An open order with the fields the live endpoint adds on top of the fixture
 * shape. Everything new is optional so the fixture generator still satisfies it.
 */
export interface ArchLiveOpenOrder extends ArchOpenOrder {
  /** 🔴 What the write endpoint needs. Null on a fixture, which cannot be appended to. */
  internalId: string | null;
  customerId?: string | null;
  /** Sales Team sublist rep (header rep as fallback). What the wizard pre-selects. */
  traderId?: string | null;
  /** More than one rep on the order's Sales Team; `traderTied` when they share evenly. */
  traderShared?: boolean;
  traderTied?: boolean;
  /**
   * WHERE `trader` came from. Absent on a response from a service older than
   * 2026-09-08, which is why `deriveTraderAttribution` has a fallback.
   *
   * 🔴 'none' is the one that matters: it is the difference between "this order
   * has no rep" and "this role could not read the reps", and those look identical
   * on screen. See lib/archTraderAttribution.
   */
  traderSource?: 'salesTeam' | 'header' | 'none';
  /** The rep's id resolved but their NAME did not; shows as "Employee <id>". */
  traderNameUnreadable?: boolean;
  /**
   * Who saved the record.
   *
   * Marc-Antoine asked for exactly this ("devrait être la personne qui a créé le
   * SO", 2026-09-08), so it IS rendered now, in its own labelled column, and it
   * is the default grouping. It is still not what `trader` holds: on 2 of the 4
   * real orders the creator is a developer or integration account ('House Blend
   * 2' saved SO-CWP-001344/001345), so substituting it for the rep would credit
   * the sale to us. Both, labelled. Neither standing in for the other.
   */
  createdBy?: string;
  createdById?: string | null;
  customerPO?: string;
  shipToFull?: string;
  /** NetSuite's own status letter and label, kept because `status` is a projection. */
  nsStatus?: string;
  nsStatusLabel?: string;
}

interface RawLine {
  key: string;
  internalId: string;
  itemCode: string;
  description: string;
  thickness?: string;
  locationName: string;
  locationId: string;
  lotNo: string;
  lotId: string;
  containerNo: string;
  /** RAW NetSuite unit name, e.g. "Square Feet". Normalised here, not on the server. */
  unitName?: string;
  bf: number;
  /** NetSuite's own line amount, in the order's currency. */
  amount?: number;
  costPerBF: number | null;
  costSource?: 'rowAverage' | 'unknown';
  pricePerBF?: number;
  bucket: ArchCartLine['bucket'];
  existing?: boolean;
  lineStatus?: ArchOrderStatus;
  /** True when the quantity is real but no lot could be attributed to it. */
  unattributed?: boolean;
}

interface RawOrder extends Omit<ArchLiveOpenOrder, 'lines'> {
  lines: RawLine[];
}

interface OpenOrdersResponse {
  success?: boolean;
  error?: string;
  /**
   * The order Suitelet merges this into every response and the RESTlet never
   * sends it, so it is how the hook knows which leg answered. MEASURED
   * 2026-09-10: the two bodies' top-level key sets are disjoint on this field.
   */
  service?: string;
  orders?: RawOrder[];
  /** How many items carry the Hardwood segment. Explains an empty tab. */
  taggedItemCount?: number | null;
  /**
   * Whether the rep column can be trusted. ABSENT from any service deployed
   * before 2026-09-08, hence the derivation below.
   */
  traderAttribution?: Partial<ArchTraderAttribution>;
}

export interface ArchOpenOrdersState {
  orders: ArchLiveOpenOrder[];
  source: ArchOpenOrdersSource;
  error: string | null;
  /**
   * Why the tab can be legitimately empty. Only six items in the sandbox carry
   * the Hardwood segment, and every other CWP order runs on untagged SKUs, so a
   * blank table is usually a tagging gap rather than a quiet day.
   */
  taggedItemCount: number | null;
  /**
   * Whether the SALES REP column is worth reading, which is a separate question
   * from whether the orders loaded.
   *
   * 🔴 Null only while loading or on fixtures. On live data it is always
   * populated: from the service when it sends it, derived from the orders when it
   * does not. See `deriveTraderAttribution` for why that fallback exists.
   */
  traderAttribution: ArchTraderAttribution | null;
  /**
   * Which leg served this list. Null while loading and on fixtures.
   *
   * The discriminator is the Suitelet's own `service` key, which it merges into
   * every response and the RESTlet never sends. MEASURED 2026-09-10: the two
   * bodies' top-level key sets are disjoint on exactly that field.
   */
  transport: ArchOpenOrdersTransport | null;
  /** Why the RESTlet served it. Null on the endpoint leg and while loading. */
  fallbackReason: ArchOpenOrdersFallbackReason | null;
  /**
   * Ways this answer is known to be incomplete, in words, for a tab that IS
   * populated. Empty when nothing is known to be wrong.
   *
   * 🔴 Why this is not just `success`. `handleGetOpenOrders` carries ONE
   * `success: false` against three swallowed catches: a failed cost lookup, a
   * failed sales-team read and a failed tagged-item count all return
   * `success: true` with a populated `orders` array. So the endpoint-first chain,
   * which falls back only when the endpoint TOTAL-fails, would accept every one of
   * them and suppress the RESTlet leg with nothing on screen saying so.
   *
   * ⚠️ ROW-LEVEL narrowing is NOT in here and cannot be. `OPEN_ORDERS_SQL` has no
   * subsidiary predicate of its own, the order DTO carries no subsidiary, and
   * nothing counts orders scoped away, so an order the executing role cannot see is
   * indistinguishable from an order that does not exist. Recorded rather than
   * papered over; detecting it needs a field on the server DTO.
   */
  degraded: string[];
  reload: () => void;
}

/**
 * The server sends the raw NetSuite unit name; `normalizeUnit` already exists on
 * this side and the builder's copy carries a note against pasting a fourth one.
 */
const toCartLine = (l: RawLine): ArchCartLine & { unattributed?: boolean; costSource?: string } => ({
  key: l.key,
  internalId: l.internalId,
  itemCode: l.itemCode,
  description: l.description,
  thickness: l.thickness,
  locationName: l.locationName,
  locationId: l.locationId,
  lotNo: l.lotNo,
  lotId: l.lotId,
  containerNo: l.containerNo,
  unit: normalizeUnit(l.unitName),
  // The wire field is still `bf` so the deployed service needs no coordinated
  // redeploy; the TS name says which of the two quantities it is.
  preSplitQty: Number(l.bf) || 0,
  amount: l.amount === undefined ? undefined : Number(l.amount),
  costPerBF: l.costPerBF === null || l.costPerBF === undefined ? null : Number(l.costPerBF),
  bucket: l.bucket,
  existing: true,
  lineStatus: l.lineStatus,
  pricePerBF: l.pricePerBF === undefined ? undefined : Number(l.pricePerBF),
  unattributed: l.unattributed,
  costSource: l.costSource,
});

const asFixtures = (): ArchLiveOpenOrder[] =>
  getFixtureOrders().map((o) => ({ ...o, internalId: null }));

/**
 * The service's own block where it sends one, the orders' own testimony where it
 * does not. Never a partial object: the notice builder reads every field.
 */
const attributionFrom = (
  orders: ArchLiveOpenOrder[],
  raw?: Partial<ArchTraderAttribution>
): ArchTraderAttribution => {
  const derived = deriveTraderAttribution(orders);
  if (!raw || typeof raw !== 'object') return derived;
  const n = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const read = raw.salesTeamRead;
  return {
    orders: n(raw.orders, derived.orders),
    fromSalesTeam: n(raw.fromSalesTeam, derived.fromSalesTeam),
    fromHeader: n(raw.fromHeader, derived.fromHeader),
    unattributed: n(raw.unattributed, derived.unattributed),
    namesUnreadable: n(raw.namesUnreadable, derived.namesUnreadable),
    salesTeamRead: read === 'ok' || read === 'failed' ? read : 'unknown',
    salesTeamError: String(raw.salesTeamError || ''),
    roleLabel: String(raw.roleLabel || ''),
  };
};

/**
 * The ways a POPULATED answer is known to be incomplete, in words.
 *
 * 🔴 THE GAP THIS CLOSES. The endpoint-first chain falls back to the RESTlet only
 * when the endpoint TOTAL-fails, and `handleGetOpenOrders` is built never to
 * total-fail: it carries ONE `success: false` against three swallowed catches. A
 * failed cost lookup, a failed sales-team read and a failed tagged-item count each
 * log and carry on, returning `success: true` with a full `orders` array. So the
 * guard accepts all three, the RESTlet leg is suppressed, and the trader reads a
 * confident order count over data that quietly lost a column.
 *
 * That is the same shape as item 5.b itself, which is why it is surfaced rather
 * than left to the deploy-day diff: "nothing errored and nothing said so" is the
 * defect, not the symptom.
 *
 * Every field read here is ALREADY on the wire. This needs no server change, which
 * is deliberate: the alternative was a new `complete` flag on the service DTO, and
 * a flag nobody sets correctly is worse than a measurement taken here.
 *
 * ⚠️ Row-level narrowing is absent from this list and cannot be added from here.
 * See the `degraded` field's own note.
 */
export const degradationsIn = (
  /* The RAW orders, not the mapped ones: `costSource` is carried on `RawLine` and
   * deliberately not on `ArchCartLine`, which is the cart's own shape. */
  orders: RawOrder[],
  body: OpenOrdersResponse
): string[] => {
  const out: string[] = [];

  /* The rep column. The service already reports this one, and the attribution
   * notice already renders it, so it is listed for completeness of the reason set
   * rather than to be shown twice; the view suppresses whichever it duplicates. */
  if (body.traderAttribution && body.traderAttribution.salesTeamRead === 'failed') {
    out.push('the sales-team read failed, so every rep would read Unassigned');
  }

  /* The cost column.
   *
   * 🔴 SAY WHAT THE SCREEN DOES, not what sounds bad. An earlier version of this
   * line read "so est. profit is understated", and it was wrong twice over:
   *   - the screen does not print an understated figure, it prints nothing.
   *     `costKnown` blanks Est. profit to a dash on the line, the order, the group
   *     subtotal and the header stat the moment any line lacks a cost, and it has
   *     done since before this change.
   *   - the direction was backwards anyway. `lineProfit` computes
   *     `revenue - qty * (costPerBF ?? 0)`, so an unknown cost would OVERstate
   *     profit, which is precisely why the cell is blanked. `types/archOrder.ts`
   *     says so in as many words.
   * A notice inside the honesty mechanism that contradicts the cells beside it is
   * the exact defect this file exists to stop.
   *
   * What is genuinely missing is not the figure but the REASON: a reader sees a
   * dash and cannot tell a zero-margin order from an unreadable cost. That is what
   * this says, and `costSource` is what makes it sayable -- it reaches the client
   * on every line and nothing renders it. */
  const noCost = orders.reduce(
    (n, o) => n + (o.lines || []).filter((l) => l.costSource === 'unknown').length,
    0
  );
  if (noCost > 0) {
    out.push(
      `${noCost} line${noCost === 1 ? '' : 's'} could not be costed, so est. profit is shown ` +
        `as a dash rather than a number`
    );
  }

  return out;
};

export const useArchOpenOrders = (enabled = true): ArchOpenOrdersState => {
  const [orders, setOrders] = React.useState<ArchLiveOpenOrder[]>([]);
  const [source, setSource] = React.useState<ArchOpenOrdersSource>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [taggedItemCount, setTaggedItemCount] = React.useState<number | null>(null);
  const [traderAttribution, setTraderAttribution] =
    React.useState<ArchTraderAttribution | null>(null);
  const [transport, setTransport] = React.useState<ArchOpenOrdersTransport | null>(null);
  const [fallbackReason, setFallbackReason] =
    React.useState<ArchOpenOrdersFallbackReason | null>(null);
  const [degraded, setDegraded] = React.useState<string[]>([]);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSource('loading');

    // 🔴 subsidiaryId is REQUIRED on BOTH legs. The RESTlet picks which service
    // handles the request from it, so omitting it routes `openOrders` to the IND
    // service, which answers "Unknown action".
    /*
     * The ORDER ENDPOINT first, the RESTlet second.
     *
     * 🔴 A RESTlet ignores runasrole and runs as the CALLER, and under the real ARCH
     * trader role this tab returned NO orders at all -- Marc-Antoine's item 5.b.
     * Role 2181 is SALESCENTER with issalesrole=T, so NetSuite narrows a transaction
     * search to that role's OWN records, and employee 3293 owns none: zero
     * `transactionsalesteam` rows account-wide, issalesrep='F', and no customer on
     * any open ARCH order carries a salesrep. The query succeeded, returned nothing,
     * and nothing errored. Same silent-narrowing class as the customer list.
     *
     * The order Suitelet runs as customrole2184 (ACCOUNTCENTER, issalesrole=F) and
     * returned, measured against Administrator on the deployed endpoint 2026-09-10,
     * an IDENTICAL body on all sixteen axes checked.
     *
     * Falling back keeps the deploy order forgiving, and the fixture path below still
     * catches the case where neither answers.
     */
    let legReason: ArchOpenOrdersFallbackReason | null = null;
    fetchOpenOrdersFromEndpoint(ARCH_SUBSIDIARY_ID)
      .then((leg) => {
        if (leg.outcome === 'ok') return leg.body;
        legReason = leg.outcome;
        return apiGet('openOrders', { subsidiaryId: ARCH_SUBSIDIARY_ID });
      })
      .then((res: unknown) => {
        if (cancelled) return;
        const body = res as OpenOrdersResponse;
        if (!body || body.success !== true || !Array.isArray(body.orders)) {
          setOrders(asFixtures());
          setSource('fixtures');
          setTraderAttribution(null);
          setTransport(null);
          setFallbackReason(null);
          setDegraded([]);
          setError(
            (body && body.error) ||
              'Open orders could not be loaded, so these are demo orders.'
          );
          return;
        }
        const live: ArchLiveOpenOrder[] = body.orders.map((o) => ({
          ...o,
          internalId: o.internalId ? String(o.internalId) : null,
          lines: (o.lines || []).map(toCartLine),
        }));
        setOrders(live);
        setTraderAttribution(attributionFrom(live, body.traderAttribution));
        setSource('netsuite');
        const tagged =
          body.taggedItemCount === null || body.taggedItemCount === undefined
            ? null
            : Number(body.taggedItemCount);
        setTaggedItemCount(tagged);
        const leg = body.service === 'arch-order-create' ? 'endpoint' : 'restlet';
        setTransport(leg);
        setFallbackReason(leg === 'restlet' ? legReason : null);
        setDegraded(degradationsIn(body.orders, body));
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOrders(asFixtures());
        setSource('fixtures');
        setTraderAttribution(null);
        setTransport(null);
        setFallbackReason(null);
        setDegraded([]);
        setError(
          e instanceof Error
            ? `${e.message}. These are demo orders.`
            : 'NetSuite could not be reached, so these are demo orders.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  return {
    orders, source, error, taggedItemCount, traderAttribution,
    transport, fallbackReason, degraded, reload,
  };
};
