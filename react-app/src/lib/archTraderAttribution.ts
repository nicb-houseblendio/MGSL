/**
 * Whether the Open Orders tab can be trusted about WHO owns an order.
 *
 * 🔴 THE FAILURE THIS EXISTS FOR IS INVISIBLE. The sales rep on an ARCH order
 * lives on the `transactionsalesteam` sublist, not on the header (`t.employee` is
 * null on 4 of 4 real orders). That sublist is read inside a RESTlet; a RESTlet
 * IGNORES `runasrole` and runs as the CALLER; and `archOrderCreate.js:668`
 * records that an ARCH trader role could not read the `employee` table at all,
 * which is why `listSalesReps` had to move onto a Suitelet. If the sublist read
 * comes back empty under the role a real trader holds, every row prints
 * "Unassigned" and the tab looks like an account with no sales reps on it.
 *
 * That is the EXACT symptom Marc-Antoine reported ("Ils affichent tous a
 * unassigned", 2026-09-08). A fix that can silently regress into the identical
 * symptom is not a fix, so this turns the state into something the tab says.
 *
 * ── What was measured, and what was not ────────────────────────────────────
 * Role 2181 "MGSL - CWP ARC - Trader" (SALESCENTER, subsidiaryoption OWN) does
 * hold the permissions this needs, read from `rolepermissions` on 2026-09-08:
 *   LIST_EMPLOYEE                 level 1 (View)
 *   TRAN_SALESORD                 level 3 (Edit)
 *   ADMI_TEAMSELLINGCONTRIBUTION  level 4 (Full)
 * and its holder, employee 3293 "Trader Hardwood", sits in subsidiary 5 along
 * with every rep on these orders (2084, 2085, 2090, 2094), so OWN scope covers
 * them. So the expectation is that it works. But nobody can log in as that role
 * from here, the note in archOrderCreate is evidence that this role class has
 * surprised us before, and "it should work" is not a measurement. Hence this.
 */

export type ArchAttributionLevel = 'error' | 'warn';

/** What the service says the rep column is worth. */
export interface ArchTraderAttribution {
  orders: number;
  fromSalesTeam: number;
  fromHeader: number;
  unattributed: number;
  namesUnreadable: number;
  salesTeamRead: 'ok' | 'failed' | 'unknown';
  salesTeamError: string;
  /** The role the RESTlet ran as. Only filled when there is something to diagnose. */
  roleLabel: string;
}

/** The label the service uses when no rep could be found at all. */
export const UNASSIGNED = 'Unassigned';

/**
 * The same figures, read off the ORDERS instead of the service's own block.
 *
 * Needed because the deployed ARCH service does not return `traderAttribution`
 * until this change reaches the account, and "the diagnostic only works once the
 * diagnostic is deployed" is not a diagnostic. `traderSource` is preferred where
 * present; where it is absent the only signal is the word the service put in
 * `trader`, so that is what gets counted, and `salesTeamRead` stays 'unknown' so
 * nothing claims to know the read succeeded.
 */
export const deriveTraderAttribution = (
  orders: Array<{ trader?: string; traderSource?: string; traderNameUnreadable?: boolean }>
): ArchTraderAttribution => {
  const list = Array.isArray(orders) ? orders : [];
  const sourceOf = (o: { trader?: string; traderSource?: string }): string => {
    if (o.traderSource === 'salesTeam' || o.traderSource === 'header' || o.traderSource === 'none') {
      return o.traderSource;
    }
    // No per-order source: an order reading "Unassigned" has nothing behind it,
    // and one reading a name came from somewhere we cannot name. 'header' would
    // be a guess, so the readable ones are attributed to the sublist, which is
    // where every real ARCH order's rep actually lives.
    return (o.trader || '').trim() === '' || o.trader === UNASSIGNED ? 'none' : 'salesTeam';
  };
  return {
    orders: list.length,
    fromSalesTeam: list.filter((o) => sourceOf(o) === 'salesTeam').length,
    fromHeader: list.filter((o) => sourceOf(o) === 'header').length,
    unattributed: list.filter((o) => sourceOf(o) === 'none').length,
    namesUnreadable: list.filter((o) => o.traderNameUnreadable === true).length,
    salesTeamRead: 'unknown',
    salesTeamError: '',
    roleLabel: '',
  };
};

export interface ArchAttributionNotice {
  level: ArchAttributionLevel;
  /** One sentence per line. Rendered as a block; never empty when non-null. */
  lines: string[];
}

export interface ArchAttributionInput {
  source: 'loading' | 'netsuite' | 'fixtures';
  /** Orders in view. */
  orderCount: number;
  /** Of those, how many have no sales rep from either the sublist or the header. */
  unattributedCount: number;
  /** Reps whose employee id resolved but whose NAME the caller's role cannot read. */
  namesUnreadable?: number;
  /**
   * 'failed' when the sublist query threw. 'unknown' when the service predates
   * the diagnostic, which is the case until this change is deployed: the tab
   * still has to report what it can see for itself.
   */
  salesTeamRead?: 'ok' | 'failed' | 'unknown';
  salesTeamError?: string;
  /** The role the RESTlet actually ran as, e.g. "MGSL - CWP ARC - Trader (2181)". */
  roleLabel?: string;
}

const count = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Why a RESTlet's role is the thing to look at first. Only emitted when we know
 * which role it was; a sentence ending in "ran as ." is worse than no sentence.
 */
const roleLine = (roleLabel?: string): string[] =>
  roleLabel && String(roleLabel).trim()
    ? [
        'This request ran as ' + String(roleLabel).trim() +
          '. A RESTlet ignores runasrole and runs as the caller, so a role that cannot read the ' +
          'Sales Team sublist reads Unassigned on every order.',
      ]
    : [];

/** What is still trustworthy while the rep is not. */
const CREATOR_LINE =
  'Created by is read from the transaction itself and is unaffected, so group by that until this is resolved.';

const namesLine = (n: number): string[] =>
  n > 0
    ? [
        n + ' ' + plural(n, 'rep resolves', 'reps resolve') +
          ' to an employee id whose name this role cannot read, and ' +
          plural(n, 'shows', 'show') + ' as "Employee <id>".',
      ]
    : [];

/**
 * A notice, or null when there is nothing worth saying.
 *
 * Silent on fixtures and on an empty tab: both already carry their own banner,
 * and a second one underneath is noise rather than honesty.
 */
export const traderAttributionNotice = (
  input: ArchAttributionInput
): ArchAttributionNotice | null => {
  if (!input || input.source !== 'netsuite') return null;

  const orders = count(input.orderCount);
  if (orders === 0) return null;

  // Clamped, so a service and a front end that disagree cannot render "7 of 2".
  const missing = Math.min(count(input.unattributedCount), orders);
  const unreadable = count(input.namesUnreadable);
  const failed = input.salesTeamRead === 'failed';

  if (failed) {
    const err = String(input.salesTeamError || '').trim();
    return {
      level: 'error',
      lines: [
        'The sales-rep read failed, so the Sales rep column is unread rather than empty.',
        ...(err ? ['NetSuite said: ' + err] : []),
        ...roleLine(input.roleLabel),
        ...namesLine(unreadable),
        CREATOR_LINE,
      ],
    };
  }

  if (missing >= orders) {
    return {
      level: 'error',
      lines: [
        'Not one of these ' + orders + ' ' + plural(orders, 'order', 'orders') +
          ' has a readable sales rep, so the Sales rep column is unread rather than genuinely blank.',
        ...roleLine(input.roleLabel),
        ...namesLine(unreadable),
        CREATOR_LINE,
      ],
    };
  }

  if (missing > 0) {
    return {
      level: 'warn',
      lines: [
        missing + ' of ' + orders + ' orders carry no sales rep on either the Sales Team sublist ' +
          'or the header, and read Unassigned.',
        ...namesLine(unreadable),
      ],
    };
  }

  if (unreadable > 0) return { level: 'warn', lines: namesLine(unreadable) };

  return null;
};
