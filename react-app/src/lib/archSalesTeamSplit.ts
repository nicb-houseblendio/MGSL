/**
 * Sales rep and Sales Team on an ARCH sales order, kept apart.
 *
 * ── The client's model, verbatim (Marc-Antoine, 2026-09-08) ─────────────────
 * "Je crois qu'on devrait ajouter le field 'sales rep'. Qui permet d'identifier
 * qui est le owner du SO. Le sales team définit le split commission."
 *
 * Two concepts, not one:
 *   SALES REP   one employee, the OWNER of the order. This is what the write path
 *               sends (`header.salesRepId`) and what NetSuite puts on the order's
 *               Sales Team sublist.
 *   SALES TEAM  the commission split. On this account that is the Sales Team
 *               sublist, `transactionsalesteam`, with a `contribution` per member.
 *
 * ── 🔴 The split is REAL DATA, and a previous commit said the opposite ──────
 * 11d1007 (2026-09-08) deleted the commission panel from the Customer step and
 * from Review on the stated grounds that "no NetSuite field carries a split".
 * That claim is false. Measured in the sandbox the same day:
 *
 *   SELECT st.transaction, BUILTIN.DF(st.employee), st.contribution
 *   FROM transactionsalesteam st
 *     -> 126664 (SO-CWP-001352): Justin Loveland 0.5, Samuel Nadon 0.5
 *     -> 126657 (SO-CWP-001348): Justin Loveland 0.5, Philippe Grand Maitre 0.5
 *     -> 125745: Dany Arsenault 1
 *   10,170 rows across the account, `salesrole` = -2 'Sales Rep'.
 *
 * The named teams he means by "Setup > sales team" are `entitygroup` rows with
 * `issalesrep = 'T'` and `grouptype = 'Employee'` (44 active, e.g. "Sam/Justin",
 * "Rettenmeier/James"), and their percentages are `entitygroupmember.contribution`
 * (82 rows). "Sam/Justin" really is Samuel Nadon 0.5 / Justin Loveland 0.5, which
 * is exactly what SO-CWP-001352 stores. So the concept is configuration, not a
 * fixture, and removing it was the wrong correction.
 *
 * ── ⚠️ WHAT THIS SCREEN CAN AND CANNOT REACH TODAY ─────────────────────────
 * The ARCH service exposes `getContext, meta, summary, detail, customers,
 * customerAddresses, salesReps, openOrders` and nothing else, so the wizard has NO
 * way to read the 44 named teams or a customer's default team. It also has no way
 * to WRITE one: `toRequest` in archOrderApi sends `salesRepId` and the endpoint
 * sets one sublist line from it. Two further measurements bound the gap:
 *   - `customersalesteam` holds 370 rows, all on subsidiaries 5 and 7 customers.
 *     ARCH's own customers ARE subsidiary 5, and 5 of the 18 ARCH sales orders'
 *     customers have rows (Ab Martin 2, D L Truss 1, 40 West 1, Myrtle Beach 1).
 *     So a customer default EXISTS for some of them and is simply not served.
 *   - `customer.salesrep` is set on exactly ONE customer in the whole account, so
 *     it is not the source. `custentity_mgsl_sales_rep` ("MGSL Sales Rep") IS
 *     populated, including on ARCH customers, but is likewise not served.
 *
 * So: for an order being EDITED the split is reported and shown. For a NEW order
 * this module says plainly that NetSuite decides it, and invents nothing. Adding
 * a `salesTeams` action to the ARCH service and a `salesTeamId` to the create
 * endpoint is what would close it, and both of those files are outside this
 * change.
 */

/**
 * The Sales Team sublist of one order, as far as `openOrders` reports it.
 *
 * These are the fields `trader_screen_service_arch.js` already sends, computed by
 * `shared/archSalesTeam.js` from `transactionsalesteam`. `shared`/`tied` are
 * derived from the real contributions:
 *   shared  more than one member on the sublist
 *   tied    the top contribution is matched by another member, i.e. an even split
 *
 * ⚠️ NO PERCENTAGES, and that is the honest limit rather than an omission. The
 * service picks ONE rep to group the tab by and reports the shape of the split,
 * not its members. Anything this module printed as a percentage would be invented.
 */
export interface ArchOrderSalesTeam {
  /** The order the split belongs to, for a label that cannot drift. */
  soNo: string;
  /** The member the sublist credits most, or solely. */
  leadRep: string;
  leadRepId: string;
  shared: boolean;
  tied: boolean;
}

/**
 * 'sole'     one member, 100% of the commission
 * 'even'     more than one, top contribution matched: a genuine 50/50 (or 3-way)
 * 'weighted' more than one, one member ahead: e.g. Rettenmeier/Phil at 0.67/0.33
 */
export type ArchSplitKind = 'sole' | 'even' | 'weighted';

export const splitKind = (t: ArchOrderSalesTeam | null): ArchSplitKind | null => {
  if (!t || !t.leadRepId) return null;
  if (!t.shared) return 'sole';
  return t.tied ? 'even' : 'weighted';
};

export interface ArchSplitDescription {
  kind: ArchSplitKind;
  /** One line for the field value. */
  headline: string;
  /** One line under it, saying what is known and what is not. */
  detail: string;
}

/**
 * What to print for an order that already has a Sales Team.
 *
 * Says "and at least one other" rather than a count: `memberCount` is computed by
 * archSalesTeam.js and is NOT among the fields the service sends, so a number here
 * would be a guess. Says where to see the rest instead.
 */
export const describeOrderSalesTeam = (
  t: ArchOrderSalesTeam | null
): ArchSplitDescription | null => {
  const kind = splitKind(t);
  if (!kind || !t) return null;
  if (kind === 'sole') {
    return {
      kind,
      headline: t.leadRep + ' (100%)',
      detail: 'One rep on ' + t.soNo + ', so the whole commission is theirs.',
    };
  }
  if (kind === 'even') {
    return {
      kind,
      headline: t.leadRep + ' and at least one other, split evenly',
      detail:
        'The Sales Team on ' + t.soNo + ' credits more than one rep in equal shares. ' +
        'Open the order in NetSuite for the per-rep percentages.',
    };
  }
  return {
    kind,
    headline: t.leadRep + ' holds the largest share',
    detail:
      'The Sales Team on ' + t.soNo + ' credits more than one rep in unequal shares. ' +
      'Open the order in NetSuite for the per-rep percentages.',
  };
};

/**
 * What to say on a NEW order, where no split can be read or sent.
 *
 * Deliberately states the mechanism rather than apologising for it: NetSuite puts
 * the rep this screen sends on the order's Sales Team, and any wider split comes
 * from the Sales Team configured under Setup, not from this wizard.
 */
export const NEW_ORDER_SPLIT_HEADLINE = 'Set by NetSuite when the order is saved';

export const NEW_ORDER_SPLIT_DETAIL =
  'The commission split lives on the order’s Sales Team sublist. This screen sends the ' +
  'sales rep above and NetSuite credits them. A wider split comes from the team set up ' +
  'under Setup > Sales > Sales Teams, ' +
  'which this screen cannot read or change yet. Nothing here overrides it.';

/* ── Rep / team state ──────────────────────────────────────────────────────*/

/**
 * The wizard's rep-and-team state.
 *
 * 🔴 THREE FIELDS BECAUSE ONE WAS THE BUG. The wizard held a single `salesTeam`
 * string whose value was a rep INTERNAL ID on the live path and a fixture TEAM
 * NAME on the offline path, and the commission panel was rendered from
 * `SALES_TEAMS[salesTeam]`. So picking a rep wrote an employee id over the team
 * name, the fixture lookup missed, and the panel vanished. That is Marc-Antoine's
 * "Quand je change de rep, le split disparaît", exactly.
 *
 * The team therefore lives in its own field that no rep change touches. See
 * `repPicked`.
 */
export interface ArchRepTeamState {
  /** Employee internal id of the OWNER. '' when none chosen. Drives the write. */
  salesRepId: string;
  /**
   * Offline placeholder pick, used only when NetSuite served no rep list. Never
   * sent: the endpoint refuses without a real employee id.
   */
  offlineRep: string;
  /** The split carried by the order being edited. Null on a new order. */
  team: ArchOrderSalesTeam | null;
}

export const emptyRepTeam = (): ArchRepTeamState => ({
  salesRepId: '',
  offlineRep: '',
  team: null,
});

/**
 * The trader picked a rep.
 *
 * `isLiveRepId` says whether the value is a real employee id (the live list) or an
 * offline placeholder name. Only one of the two fields is ever populated, so a
 * placeholder left over from a disconnected session cannot satisfy a required
 * field once the live list arrives.
 *
 * 🔴 `team` IS CARRIED THROUGH UNTOUCHED. This one line is the fix for "quand je
 * change de rep, le split disparaît", and the test pins it.
 */
export const repPicked = (
  s: ArchRepTeamState,
  value: string,
  isLiveRepId: boolean
): ArchRepTeamState => ({
  salesRepId: isLiveRepId ? value : '',
  offlineRep: isLiveRepId ? '' : value,
  team: s.team,
});

/**
 * An existing order was opened for editing: adopt its rep AND its split.
 *
 * The rep arrives as an id because that is what the live dropdown is keyed on.
 * Passing a blank id leaves the field empty rather than falling through to a
 * fixture team name, which is the defect the comment in `applyExistingOrder`
 * records: the field looked empty while validation thought it was filled.
 */
export const orderOpened = (
  repId: string,
  team: ArchOrderSalesTeam | null
): ArchRepTeamState => ({
  salesRepId: repId || '',
  offlineRep: '',
  team: team && team.leadRepId ? team : null,
});

/**
 * A different customer was picked on a NEW order.
 *
 * Clears the rep, because a rep chosen for one customer is not a choice for
 * another, and clears the team, because a new order has no Sales Team until
 * NetSuite gives it one. NOT used on the edit path: the customer is locked there.
 */
export const customerPicked = (): ArchRepTeamState => emptyRepTeam();

/**
 * Is the sales-rep field satisfied?
 *
 * Live list: the ID is required, because that is what the endpoint validates and
 * refuses without. No live list: the placeholder is enough to walk the wizard, and
 * the step says outright that no order can be created that way.
 *
 * Replaces `salesTeam && (liveReps.length === 0 || !!salesRepId)`, which was true
 * whenever a leftover team name sat in `salesTeam` and no live rep had been chosen.
 */
export const salesRepOk = (s: ArchRepTeamState, hasLiveReps: boolean): boolean =>
  hasLiveReps ? !!s.salesRepId : !!s.offlineRep;
