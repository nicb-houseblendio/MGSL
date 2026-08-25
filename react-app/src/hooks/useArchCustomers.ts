/**
 * The customers an ARCH order can be raised for.
 *
 * Exists because the wizard's customer dropdown was a hardcoded list of invented
 * names, which meant `customerId` was always undefined and the order endpoint
 * refused every submission with "The order needs a customer".
 *
 * ── Why a name is not enough ────────────────────────────────────────────────
 * The write path takes a customer INTERNAL ID, deliberately. Resolving a typed
 * name server-side would be how an order quietly lands on the wrong account —
 * two customers can share a name, and 807 of them is more than enough for a
 * near-match to look right.
 *
 * ── Source, and why it stays a fixture when disconnected ────────────────────
 * `action=customers` on the ARCH service. When the screen is not served by the
 * trader Suitelet there is no RESTlet URL, so this reports `source: 'fixtures'`
 * and the wizard shows the demo names — the same honesty channel the split queue
 * and the summary use. Nothing invents an id, so a fixture customer cannot reach
 * NetSuite and be refused confusingly; it simply cannot be submitted.
 */

import * as React from 'react';
import { apiGet } from '@/lib/api';
import { fetchSalesRepsFromEndpoint } from '@/lib/archOrderApi';
import { CUSTOMERS as FIXTURE_CUSTOMERS } from '@/lib/archOrderFixtures';

export interface ArchCustomer {
  /** NetSuite internal id. Null only for fixture rows, which cannot be ordered. */
  id: string | null;
  name: string;
  currencyId?: string | null;
  /**
   * ISO code, e.g. "USD". This is the one the screen formats money with.
   * `currencyName` is a label only — passing it to Intl throws RangeError and
   * unmounts the whole app.
   */
  currencyCode?: string | null;
  currencyName?: string | null;
  termsId?: string | null;
  termsName?: string | null;
  subsidiaryId?: string | null;
}

export type ArchCustomerSource = 'loading' | 'netsuite' | 'fixtures';

interface CustomersResponse {
  success?: boolean;
  error?: string;
  customers?: ArchCustomer[];
}

export interface ArchCustomersState {
  customers: ArchCustomer[];
  source: ArchCustomerSource;
  /** Set when the live list could not be loaded. The picker says so. */
  error: string | null;
  reload: () => void;
}

/** Selects the ARCH service on the shared RESTlet. Mirrors useArchSummaryData. */
const ARCH_SUBSIDIARY_ID = 9;

const asFixtures = (): ArchCustomer[] =>
  FIXTURE_CUSTOMERS.map((name) => ({ id: null, name }));

export interface ArchCustomerAddress {
  id: string;
  label: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

/**
 * Ship-to addresses for one customer, fetched on selection.
 *
 * 🔴 This exists because making customers real BROKE the ship-to dropdown. The
 * fixture addresses were keyed by fixture customer NAMES, so a real customer
 * matched nothing, the list came back empty, and ship-to is a required field —
 * which blocked the entire wizard. Found by clicking the deployed screen; the
 * types were all still valid.
 *
 * Per customer rather than bundled with the customer list: 3,755 addresses across
 * 778 customers, almost all of which are never looked at.
 *
 * Returns [] on failure rather than throwing. The server resolves ship-to itself
 * when the request omits it, so an empty list must not be fatal.
 */
export const fetchCustomerAddresses = async (customerId: string): Promise<ArchCustomerAddress[]> => {
  if (!customerId) return [];
  try {
    const res = await apiGet<{ success?: boolean; addresses?: ArchCustomerAddress[] }>(
      'customerAddresses',
      { subsidiaryId: ARCH_SUBSIDIARY_ID, customerId }
    );
    return res && res.success && Array.isArray(res.addresses) ? res.addresses : [];
  } catch {
    return [];
  }
};

export interface ArchSalesRep {
  id: string;
  name: string;
  subsidiaryName?: string | null;
}

/**
 * Sales reps the order can be credited to.
 *
 * 🔴 The write path REFUSES without one — NetSuite rejects the save if the
 * sales-team employee is not a real sales rep, and `resolveSalesRep` will not
 * pick one on the trader's behalf because that misattributes commission. So this
 * is not decoration: with an empty list the wizard cannot complete.
 */
export const fetchSalesReps = async (): Promise<ArchSalesRep[]> => {
  /*
   * The ORDER ENDPOINT first, and the RESTlet only as a fallback.
   *
   * 🔴 The RESTlet cannot serve this to the role that needs it. It ignores
   * `runasrole` and runs as the caller, and the ARCH trader role cannot read the
   * employee table ("Record 'employee' was not found"), so this returned an empty
   * list for every real trader while working fine for an administrator. The
   * dropdown was never broken; its source was.
   *
   * The order Suitelet runs as `customrole2184` and is also the role that
   * validates the rep on write, so asking it means the list and the validator
   * agree by construction.
   *
   * The fallback stays for two reasons: an administrator on a build deployed
   * before the Suitelet action exists still gets a list, and nothing here has to
   * know which of the two is deployed.
   */
  const viaEndpoint = await fetchSalesRepsFromEndpoint();
  if (viaEndpoint && viaEndpoint.length) return viaEndpoint;

  try {
    const res = await apiGet<{ success?: boolean; salesReps?: ArchSalesRep[] }>(
      'salesReps',
      { subsidiaryId: ARCH_SUBSIDIARY_ID }
    );
    return res && res.success && Array.isArray(res.salesReps) ? res.salesReps : [];
  } catch {
    return [];
  }
};

export const useArchCustomers = (enabled: boolean): ArchCustomersState => {
  const [customers, setCustomers] = React.useState<ArchCustomer[]>([]);
  const [source, setSource] = React.useState<ArchCustomerSource>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    // Fetched only when something actually needs it — the wizard opening — rather
    // than on every screen mount. 807 rows is small but it is not free, and the
    // majority of trader-screen sessions never create an order.
    if (!enabled) return;

    let cancelled = false;
    setSource('loading');

    // 🔴 subsidiaryId is REQUIRED, not decoration. The RESTlet picks which service
    // handles the request from it, so omitting it routes `customers` to the IND
    // service, which has no such action and answers "Unknown action". Must match
    // the value useArchSummaryData sends.
    apiGet('customers', { subsidiaryId: ARCH_SUBSIDIARY_ID })
      .then((res: unknown) => {
        if (cancelled) return;
        const body = res as CustomersResponse;
        if (!body || body.success !== true || !Array.isArray(body.customers)) {
          setCustomers(asFixtures());
          setSource('fixtures');
          setError(
            (body && body.error) ||
              'The customer list could not be loaded, so these are demo names and cannot be ordered.'
          );
          return;
        }
        setCustomers(body.customers);
        setSource('netsuite');
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCustomers(asFixtures());
        setSource('fixtures');
        setError(
          e instanceof Error
            ? `${e.message}. These are demo names and cannot be ordered.`
            : 'NetSuite could not be reached, so these are demo names and cannot be ordered.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  return { customers, source, error, reload };
};
