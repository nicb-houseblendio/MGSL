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
import { normalizeUnit } from '@/lib/archUom';
import { getOpenOrders as getFixtureOrders } from '@/lib/archOrderFixtures';
import { deriveTraderAttribution } from '@/lib/archTraderAttribution';
import type { ArchTraderAttribution } from '@/lib/archTraderAttribution';
import type { ArchCartLine, ArchOpenOrder, ArchOrderStatus } from '@/types/archOrder';

/** Selects the ARCH service on the shared RESTlet. Mirrors useArchCustomers. */
const ARCH_SUBSIDIARY_ID = 9;

export type ArchOpenOrdersSource = 'loading' | 'netsuite' | 'fixtures';

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

export const useArchOpenOrders = (enabled = true): ArchOpenOrdersState => {
  const [orders, setOrders] = React.useState<ArchLiveOpenOrder[]>([]);
  const [source, setSource] = React.useState<ArchOpenOrdersSource>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [taggedItemCount, setTaggedItemCount] = React.useState<number | null>(null);
  const [traderAttribution, setTraderAttribution] =
    React.useState<ArchTraderAttribution | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSource('loading');

    // 🔴 subsidiaryId is REQUIRED. The RESTlet picks which service handles the
    // request from it, so omitting it routes `openOrders` to the IND service,
    // which answers "Unknown action".
    apiGet('openOrders', { subsidiaryId: ARCH_SUBSIDIARY_ID })
      .then((res: unknown) => {
        if (cancelled) return;
        const body = res as OpenOrdersResponse;
        if (!body || body.success !== true || !Array.isArray(body.orders)) {
          setOrders(asFixtures());
          setSource('fixtures');
          setTraderAttribution(null);
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
        setTaggedItemCount(
          body.taggedItemCount === null || body.taggedItemCount === undefined
            ? null
            : Number(body.taggedItemCount)
        );
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOrders(asFixtures());
        setSource('fixtures');
        setTraderAttribution(null);
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

  return { orders, source, error, taggedItemCount, traderAttribution, reload };
};
