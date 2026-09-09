/**
 * The 44 real Sales Teams, for the ARCH wizard's commission-split picker.
 *
 * ── What a "sales team" is on this account, measured ────────────────────────
 * Marc-Antoine, 2026-09-08: "Je crois qu'on devrait ajouter le field 'sales
 * rep'. Qui permet d'identifier qui est le owner du SO. Le sales team définit le
 * split commission." So the REP is one employee who owns the order and the TEAM
 * is the commission split, and they are two fields.
 *
 * The named teams he means by Setup > Sales Teams are `entitygroup` rows with
 * `issalesrep = 'T' AND isinactive = 'F'`. Measured in the sandbox 2026-09-08
 * and re-measured through the deployed `action=salesTeams` on 2026-09-09:
 *
 *   44 teams · 82 member rows · member counts 1 to 4 · 0 degraded rows
 *   every team's contributions total exactly 1
 *   names include "Christian Labbé", "Équipe" and "Jean-Philippe Thibault /
 *   Julien Prince"
 *
 * ── 🔴 Two traps this module exists to hold ─────────────────────────────────
 *
 * THE PERCENT TRAP. SuiteQL returns a Percent column as a FRACTION (0.5) while
 * `setValue` on the field takes the typed number (50). That has already cost
 * this project a real bug on the customer rate fields, so the service sends BOTH
 * under names that say which — `contribution` (0.5) and `contributionPct` (50) —
 * and everything here reads `contributionPct` and multiplies by nothing.
 *
 * EMPTY IS NOT THE SAME AS FAILED. A RESTlet ignores `runasrole` and runs as the
 * CALLER. All 44 teams sit in subsidiary 1 (MGSL); role 2181 (MGSL - CWP ARC -
 * Trader) is `subsidiaryoption = OWN` and its holder, employee 3293 Trader
 * Hardwood, is in subsidiary 5 — so the trader may well be served ZERO teams
 * where an administrator is served 44. A picker that renders "no teams" in that
 * state is stating something it does not know. `parseSalesTeams` therefore has
 * three outcomes, not two, and the wizard says which one it is in.
 *
 * Pure on purpose: node cannot load a `.tsx`, so anything here that could be
 * wrong is testable in `archSalesTeams.test.mjs`.
 */

/**
 * Adds the ONE key the create endpoint's contract needs for a commission split.
 *
 * Declared as an augmentation rather than edited into `types/archOrder.ts`
 * because that file is outside this change's file set. Fold it into
 * `ArchOrderHeader` proper when the two land together; nothing else changes.
 *
 * The value is the `entitygroup` internal id AS A STRING, which is exactly what
 * the server side accepts under `header.salesTeamId`.
 */
declare module '@/types/archOrder' {
  interface ArchOrderHeader {
    /**
     * Sales Team (commission split) internal id, `entitygroup.id` as a string.
     * Absent unless the trader picked one from the live list — never inferred
     * from the rep, the customer or a fixture.
     */
    salesTeamId?: string;
  }
}

export interface ArchSalesTeamMember {
  /** Employee internal id. */
  id: string;
  /** "Employee <id>" when the caller's role cannot read the name. */
  name: string;
  nameUnreadable: boolean;
  /** The fraction the service read from SuiteQL, e.g. 0.5. */
  contribution: number;
  /** The same value as a percentage, e.g. 50. NEVER multiply this again. */
  contributionPct: number;
  isPrimary: boolean;
}

export interface ArchSalesTeam {
  /** `entitygroup.id`, as a string, and what `header.salesTeamId` carries. */
  id: string;
  name: string;
  /** What the group record says it holds, so a short member list is visible. */
  declaredSize: number;
  members: ArchSalesTeamMember[];
  /** True when fewer members came back than the group record declares. */
  membersUnreadable: boolean;
  /** Sum of the members' fractions. 1 on all 44 teams as measured. */
  contributionTotal: number;
}

/**
 * 'ok'      teams came back and can be offered
 * 'empty'   the service ANSWERED and returned none. Honest, and usually scope
 * 'failed'  the service could not answer. We do NOT know whether teams exist
 */
export type ArchSalesTeamsStatus = 'loading' | 'ok' | 'empty' | 'failed';

export interface ArchSalesTeamsResult {
  status: ArchSalesTeamsStatus;
  teams: ArchSalesTeam[];
  /**
   * What to tell the trader, or null when there is nothing to say. On 'ok' this
   * is only set when the service reported the list as incomplete.
   */
  notice: string | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Said when the service answered with nothing. States the measurement rather
 * than guessing: 44 teams exist, they are all in subsidiary 1, and a RESTlet
 * runs as the caller.
 */
export const NO_TEAMS_NOTICE =
  'NetSuite returned no sales team for your role, so there is none to pick. ' +
  'This account had 44 of them under Setup > Sales Teams when this was measured ' +
  '(2026-09-09) and all 44 sit in the MGSL subsidiary, so a role scoped to its own ' +
  'subsidiary sees none of them. The order still credits the sales rep above.';

/** Said when the request itself failed, where "none exist" would be a claim. */
export const TEAMS_UNREACHABLE_NOTICE =
  'The sales team list could not be loaded, so none can be offered. This is not the ' +
  'same as there being none: the order still credits the sales rep above, and the ' +
  'commission split stays whatever NetSuite decides.';

/**
 * Turns whatever `action=salesTeams` answered into the three states.
 *
 * ⚠️ The shape is the DEPLOYED one, verified against the live endpoint rather
 * than read off the source: `{ success, salesTeams[], teamCount, notice? }`,
 * with each team carrying `members[]` of `{ id, name, contribution,
 * contributionPct, isPrimary, nameUnreadable }`. On failure the service sends
 * `{ success: false, error }` and NO `salesTeams` key at all, deliberately, so
 * that a failure can never be mistaken for an empty list.
 */
export const parseSalesTeams = (body: unknown): ArchSalesTeamsResult => {
  const b = (body || {}) as {
    success?: boolean;
    error?: string;
    notice?: string;
    salesTeams?: unknown;
  };
  if (!body || b.success !== true || !Array.isArray(b.salesTeams)) {
    return {
      status: 'failed',
      teams: [],
      // The server's own sentence when it sent one; it names the role that ran.
      notice: b.error ? b.error + ' ' + TEAMS_UNREACHABLE_NOTICE : TEAMS_UNREACHABLE_NOTICE,
    };
  }
  const teams: ArchSalesTeam[] = [];
  (b.salesTeams as unknown[]).forEach((raw) => {
    const t = (raw || {}) as Record<string, unknown>;
    const id = str(t.id).trim();
    // No id means nothing that could be sent, so the row is not an option.
    // Dropping it beats offering a team the write path cannot name.
    if (!id) return;
    const rawMembers = Array.isArray(t.members) ? (t.members as unknown[]) : [];
    const members: ArchSalesTeamMember[] = [];
    rawMembers.forEach((rm) => {
      const m = (rm || {}) as Record<string, unknown>;
      const mid = str(m.id).trim();
      if (!mid) return;
      members.push({
        id: mid,
        name: str(m.name).trim() || 'Employee ' + mid,
        nameUnreadable: m.nameUnreadable === true || !str(m.name).trim(),
        contribution: num(m.contribution),
        contributionPct: num(m.contributionPct),
        isPrimary: m.isPrimary === true,
      });
    });
    const declared = num(t.declaredSize);
    teams.push({
      id,
      name: str(t.name).trim() || 'Team ' + id,
      declaredSize: declared > 0 ? declared : 0,
      members,
      // Trust the server's own verdict when it sent one, and fall back to the
      // same comparison it makes rather than assuming the list is complete.
      membersUnreadable:
        t.membersUnreadable === true || (declared > 0 && members.length < declared),
      contributionTotal:
        t.contributionTotal === undefined
          ? members.reduce((s, m) => s + m.contribution, 0)
          : num(t.contributionTotal),
    });
  });
  if (!teams.length) {
    return { status: 'empty', teams: [], notice: str(b.notice).trim() || NO_TEAMS_NOTICE };
  }
  return { status: 'ok', teams, notice: str(b.notice).trim() || null };
};

/**
 * A percentage as a person writes it: 50, 66.7, 33.3. No trailing zeroes, and
 * NOT rounded to whole numbers — a 2/3 split is 66.7 and printing 67 there would
 * make three of these teams read as though they summed to 101%.
 */
export const fmtContribution = (pct: number): string => {
  if (!Number.isFinite(pct)) return '0%';
  const r = Math.round(pct * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '%';
};

/**
 * The split as one line: "Samuel Nadon 50% · Justin Loveland 50%".
 *
 * Primary first, then the order the service sent (it sorts by employee), so the
 * lead of a weighted team reads first. Members are never invented: a team whose
 * members the role cannot read says so instead.
 */
export const teamSplitLabel = (team: ArchSalesTeam): string => {
  if (!team.members.length) {
    return team.declaredSize > 0
      ? team.declaredSize + ' member(s), names not readable by your role'
      : 'No members readable';
  }
  const ordered = team.members
    .map((m, i) => ({ m, i }))
    .sort((a, b) =>
      a.m.isPrimary === b.m.isPrimary ? a.i - b.i : a.m.isPrimary ? -1 : 1
    )
    .map((x) => x.m);
  return ordered.map((m) => m.name + ' ' + fmtContribution(m.contributionPct)).join(' · ');
};

/**
 * The combobox label, and the reason it carries the member names is the
 * type-ahead: `filterTypeahead` searches this string, so typing "labbe" or
 * "equipe" finds the team, and so does typing a REP's name — which is how a
 * trader actually thinks about "Sam/Justin". Diacritics fold, which matters on
 * this data: two of the 44 names are accented.
 */
export const teamOptionLabel = (team: ArchSalesTeam): string =>
  team.name + ' (' + teamSplitLabel(team) + ')';

/**
 * What to print under the picker for a team that is chosen.
 *
 * ⚠️ Flags a total that is not 100%. All 44 total exactly 1 today, so this is
 * not reachable on current data — and it is the case that would silently
 * misattribute commission if it ever were, which is why it is stated rather
 * than assumed away.
 */
export const teamWarning = (team: ArchSalesTeam | null): string | null => {
  if (!team) return null;
  if (team.membersUnreadable) {
    return (
      'Your role cannot read every member of this team, so the split shown may be ' +
      'incomplete. NetSuite applies the whole team whatever this screen can see.'
    );
  }
  if (team.members.length && Math.abs(team.contributionTotal - 1) > 0.005) {
    return (
      'This team’s contributions add up to ' +
      fmtContribution(team.contributionTotal * 100) +
      ', not 100%. Check it under Setup > Sales Teams before relying on the split.'
    );
  }
  return null;
};

/**
 * The team id that may be SENT, given what the live list actually holds.
 *
 * 🔴 THE GUARD, and it is the same rule as `pickCustomerById`: only an id that
 * is a real option right now may reach the request. A team picked before a
 * reload that no longer appears, or anything a fixture ever put in this state,
 * resolves to undefined rather than being posted at an `entitygroup` id nobody
 * offered.
 */
/**
 * 🔴 IS THE COMMISSION WRITE TURNED ON? It is not, and that is deliberate.
 *
 * Writing a multi-member sales team ATTRIBUTES COMMISSION ON A REAL SALES DOCUMENT.
 * Marc-Antoine asked for the teams to come from Setup > Sales Teams, and we have told
 * him in writing, twice, that the team is shown but not written until he says go. So
 * the picker and the `salesTeams` read are live on purpose, and this gates the WRITE.
 *
 * ⚠️ WHY A SWITCH AND NOT JUST "WE HAVEN'T WIRED IT". Because both halves were built,
 * on the same day, by different hands. The screen offered the picker and sent the id
 * on every new order, and it was inert ONLY because the service action was not
 * deployed yet, i.e. one deploy away from writing commission nobody had approved. A
 * latch that fails OFF is the difference between a decision and an accident.
 *
 * Same shape as `splitFeeEnabled` in archOrderPricing: absent config means off. The
 * server has its OWN latch (`custscript_arch_salesteam_write_on`) and also fails off,
 * so neither end can start writing on its own.
 */
export const salesTeamWriteEnabled = (): boolean => {
  const cfg = (window as unknown as { MCGI_CONFIG?: { salesTeamWriteEnabled?: boolean } })
    .MCGI_CONFIG;
  return cfg?.salesTeamWriteEnabled === true;
};

/**
 * The team id it is safe to SEND, or undefined.
 *
 * Two independent conditions, and both must hold. The id has to be one the live list
 * currently holds, because a stale or invented `entitygroup` id would attribute
 * somebody else's commission, the same class of error as resolving a typed customer
 * name onto the wrong account. And the write has to be switched on at all.
 */
export const sendableTeamId = (
  teams: readonly ArchSalesTeam[],
  picked: string
): string | undefined => {
  if (!salesTeamWriteEnabled()) return undefined;
  const id = str(picked).trim();
  if (!id) return undefined;
  return teams.some((t) => t.id === id) ? id : undefined;
};

/**
 * What the field says about whether the pick will be written. Never silent: a control
 * that looks like it sets something and does not is the defect this whole screen keeps
 * being corrected for.
 */
export const teamWriteNotice = (): string | null =>
  salesTeamWriteEnabled()
    ? null
    : 'Shown for reference. The commission split is not written to the sales order yet, so picking a team here changes nothing in NetSuite.';

export const findTeam = (
  teams: readonly ArchSalesTeam[],
  picked: string
): ArchSalesTeam | null => {
  const id = str(picked).trim();
  if (!id) return null;
  const hit = teams.find((t) => t.id === id);
  return hit === undefined ? null : hit;
};
