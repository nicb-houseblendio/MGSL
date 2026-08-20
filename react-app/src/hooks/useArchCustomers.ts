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
import { CUSTOMERS as FIXTURE_CUSTOMERS } from '@/lib/archOrderFixtures';

export interface ArchCustomer {
  /** NetSuite internal id. Null only for fixture rows, which cannot be ordered. */
  id: string | null;
  name: string;
  currencyId?: string | null;
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
