/**
 * The sales-team picker's data, the request contract, and the split-fee copy.
 *
 * Every fixture below is a REAL row from the deployed `action=salesTeams` on the
 * MGSL sandbox (2026-09-09), including the two accented team names, because the
 * point of folding the search key is that a trader on an en-US keyboard can find
 * "Christian Labbé" and "Équipe".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSalesTeams,
  fmtContribution,
  teamSplitLabel,
  teamOptionLabel,
  teamWarning,
  sendableTeamId,
  findTeam,
  NO_TEAMS_NOTICE,
  salesTeamWriteEnabled,
  teamWriteNotice,
} from './archSalesTeams.ts';
import { filterTypeahead, resolveTyped } from './archTypeahead.ts';
import {
  splitFeeState,
  splitFeeMarginSentence,
  splitFeeStepSentence,
  splitFeeBadge,
  splitFeeFormulaAmount,
} from './archSplitFeeCopy.ts';
import { createArchOrder } from './archOrderApi.ts';

/** Verbatim from the live endpoint, three of the 44. */
const LIVE = {
  success: true,
  teamCount: 3,
  memberRowCount: 6,
  salesTeams: [
    {
      id: '3303',
      name: 'Alec/Leo',
      declaredSize: 2,
      members: [
        { id: '3296', name: 'Léo Dupuis', nameUnreadable: false, contribution: 0.5, contributionPct: 50, isPrimary: false },
        { id: '3297', name: 'Alec Wolf', nameUnreadable: false, contribution: 0.5, contributionPct: 50, isPrimary: true },
      ],
      memberCount: 2,
      nameUnreadableCount: 0,
      membersUnreadable: false,
      contributionTotal: 1,
    },
    {
      id: '3125',
      name: 'Christian Labbé',
      declaredSize: 1,
      members: [
        { id: '2084', name: 'Christian Labbé', nameUnreadable: false, contribution: 1, contributionPct: 100, isPrimary: true },
      ],
      memberCount: 1,
      nameUnreadableCount: 0,
      membersUnreadable: false,
      contributionTotal: 1,
    },
    {
      id: '3400',
      name: 'Équipe',
      declaredSize: 3,
      members: [
        { id: '2085', name: 'Camil Perrault', nameUnreadable: false, contribution: 0.3333, contributionPct: 33.33, isPrimary: true },
        { id: '2086', name: 'Eryn Genge', nameUnreadable: false, contribution: 0.3333, contributionPct: 33.33, isPrimary: false },
        { id: '2087', name: 'Ilane Slimani', nameUnreadable: false, contribution: 0.3334, contributionPct: 33.34, isPrimary: false },
      ],
      memberCount: 3,
      nameUnreadableCount: 0,
      membersUnreadable: false,
      contributionTotal: 1,
    },
  ],
};

test('parseSalesTeams: the live payload becomes three offerable teams', () => {
  const r = parseSalesTeams(LIVE);
  assert.equal(r.status, 'ok');
  assert.equal(r.teams.length, 3);
  assert.equal(r.notice, null);
  assert.deepEqual(r.teams.map((t) => t.id), ['3303', '3125', '3400']);
  // The percent trap: contributionPct is taken as-is, never multiplied again.
  assert.equal(r.teams[0].members[0].contributionPct, 50);
  assert.equal(r.teams[0].members[0].contribution, 0.5);
});

test('parseSalesTeams: EMPTY and FAILED are not the same state', () => {
  const empty = parseSalesTeams({ success: true, salesTeams: [], teamCount: 0 });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.notice, NO_TEAMS_NOTICE);
  // The measured cause has to be in the sentence, or the trader cannot act on it.
  assert.match(empty.notice, /44/);
  assert.match(empty.notice, /subsidiar/i);

  const failed = parseSalesTeams({ success: false, error: 'Search error occurred.' });
  assert.equal(failed.status, 'failed');
  assert.match(failed.notice, /Search error occurred\./);
  // 🔴 A failure must never be reported as "there are none".
  assert.doesNotMatch(failed.notice, /no sales team came back|there is none to pick/i);

  for (const junk of [null, undefined, {}, { success: true }, 'nope', 42]) {
    assert.equal(parseSalesTeams(junk).status, 'failed');
  }
});

test('parseSalesTeams: the service keeps its own notice when it sent one', () => {
  const r = parseSalesTeams({
    success: true,
    salesTeams: [],
    notice: 'This request ran as MGSL - CWP ARC - Trader.',
  });
  assert.equal(r.status, 'empty');
  assert.match(r.notice, /ran as MGSL - CWP ARC - Trader/);
});

test('parseSalesTeams: a row with no id is not an option', () => {
  const r = parseSalesTeams({
    success: true,
    salesTeams: [{ name: 'Nameless', members: [] }, { id: '7', name: 'Real', members: [] }],
  });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.teams.map((t) => t.id), ['7']);
});

test('parseSalesTeams: an unreadable membership is flagged, not hidden', () => {
  const r = parseSalesTeams({
    success: true,
    salesTeams: [{ id: '9', name: 'Kuhmo/Sam', declaredSize: 2, members: [] }],
  });
  assert.equal(r.teams[0].membersUnreadable, true);
  assert.match(teamSplitLabel(r.teams[0]), /not readable/);
  assert.match(teamWarning(r.teams[0]), /cannot read every member/);
});

test('fmtContribution keeps a third of a team honest', () => {
  assert.equal(fmtContribution(50), '50%');
  assert.equal(fmtContribution(100), '100%');
  assert.equal(fmtContribution(33.33), '33.3%');
  assert.equal(fmtContribution(66.67), '66.7%');
  assert.equal(fmtContribution(NaN), '0%');
});

test('teamSplitLabel puts the primary first and prints real percentages', () => {
  const { teams } = parseSalesTeams(LIVE);
  assert.equal(teamSplitLabel(teams[0]), 'Alec Wolf 50% · Léo Dupuis 50%');
  assert.equal(teamSplitLabel(teams[1]), 'Christian Labbé 100%');
  assert.match(teamSplitLabel(teams[2]), /^Camil Perrault 33\.3%/);
});

test('teamWarning: silent on all 44 live teams, loud on a total that is not 100%', () => {
  const { teams } = parseSalesTeams(LIVE);
  teams.forEach((t) => assert.equal(teamWarning(t), null));
  assert.equal(teamWarning(null), null);
  const bad = parseSalesTeams({
    success: true,
    salesTeams: [
      {
        id: '5',
        name: 'Half',
        declaredSize: 1,
        members: [{ id: '1', name: 'Someone', contribution: 0.5, contributionPct: 50, isPrimary: true }],
        contributionTotal: 0.5,
      },
    ],
  }).teams[0];
  assert.match(teamWarning(bad), /add up to 50%, not 100%/);
});

test('the picker type-aheads on folded team AND member names', () => {
  const { teams } = parseSalesTeams(LIVE);
  const options = teams.map((t) => ({ id: t.id, label: teamOptionLabel(t) }));
  const idsFor = (q) => filterTypeahead(options, q, (o) => o.label).map((o) => o.id);
  // Accents folded: this is why the tested matcher is reused rather than a new one.
  assert.deepEqual(idsFor('labbe'), ['3125']);
  assert.deepEqual(idsFor('equipe'), ['3400']);
  // A rep's name finds the team they are on, which is how traders think of them.
  assert.deepEqual(idsFor('leo dupuis'), ['3303']);
  assert.deepEqual(idsFor('alec'), ['3303']);
  // A blank query is the whole list in the server's order (the caret affordance).
  assert.deepEqual(idsFor(''), ['3303', '3125', '3400']);
  // Nothing matches nothing, and a near match resolves to NOTHING rather than a guess.
  assert.deepEqual(idsFor('zzz'), []);
  assert.equal(resolveTyped(options, 'Alec', (o) => o.label), null);
});

test('sendableTeamId only ever sends an id the live list actually holds', () => {
  // The commission latch is a SEPARATE rule, asserted below. Enable it here so this
  // test still measures what it was written to measure: the live-list check.
  globalThis.window = { MCGI_CONFIG: { salesTeamWriteEnabled: true } };
  const { teams } = parseSalesTeams(LIVE);
  assert.equal(sendableTeamId(teams, '3303'), '3303');
  assert.equal(sendableTeamId(teams, ' 3303 '), '3303');
  assert.equal(sendableTeamId(teams, ''), undefined);
  // Stale pick after a reload that no longer offers it, or anything invented.
  assert.equal(sendableTeamId(teams, '9999'), undefined);
  assert.equal(sendableTeamId([], '3303'), undefined);
  assert.equal(findTeam(teams, '3125').name, 'Christian Labbé');
  assert.equal(findTeam(teams, '9999'), null);
  globalThis.window = {};
});

/* ── The request contract ────────────────────────────────────────────────────
 *
 * 🔴 FAILS BEFORE THIS CHANGE. `toRequest` sent `salesRepId` and nothing else,
 * so `header.salesTeamId` was absent from the POST body and the commission split
 * a trader picked could not reach the server at all. The contract is exactly
 * that key, holding the `entitygroup` internal id as a string.
 */
test('toRequest sends header.salesTeamId as the entitygroup id, a string', async () => {
  const posted = [];
  // salesTeamWriteEnabled is ON here on purpose: the commission latch is asserted by
  // its own tests below, and this one measures the CONTRACT SHAPE. Both flags have to
  // sit in the SAME assignment, because a second one replaces the whole object.
  globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: 'https://example.invalid/order', salesTeamWriteEnabled: true } };
  globalThis.fetch = (_url, init) => {
    posted.push(JSON.parse(init.body));
    return Promise.resolve({ json: async () => ({ ok: true, salesOrderId: 1 }) });
  };
  const draft = {
    mode: 'new',
    existingSO: null,
    header: {
      customer: 'Ab Martin Roofing Supply LLC',
      customerId: '1234',
      salesRepId: '3297',
      salesTeamId: '3303',
      customerPO: 'PO-1',
      shipTo: '',
      currency: 'USD',
      shipDate: '2026-09-10',
      incoterms: 'Delivered',
      salesTeam: 'Alec Wolf',
      paymentTerms: '',
    },
    lines: [],
  };
  const r = await createArchOrder(draft, 'ARCH-team-key');
  assert.equal(r.ok, true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].header.salesTeamId, '3303');
  assert.equal(typeof posted[0].header.salesTeamId, 'string');
  // The rep is untouched by this: they are two fields and two facts.
  assert.equal(posted[0].header.salesRepId, '3297');

  // No team picked: the key is ABSENT rather than sent empty, so the server
  // cannot read '' as "clear the team".
  posted.length = 0;
  const noTeam = { ...draft, header: { ...draft.header, salesTeamId: '' } };
  await createArchOrder(noTeam, 'ARCH-no-team');
  assert.equal('salesTeamId' in posted[0].header, false);
});

/* ── The split fee ──────────────────────────────────────────────────────────*/

test('splitFeeState: three states, because the two parameters are independent', () => {
  assert.equal(splitFeeState(false, 0), 'off');
  assert.equal(splitFeeState(false, 200), 'off');
  // Measured live 2026-09-09: fee_on = F and fee_amt EMPTY, so ticking the box
  // alone gives an amount of 0. That is the state this branch exists for.
  assert.equal(splitFeeState(true, 0), 'onWithoutAmount');
  assert.equal(splitFeeState(true, NaN), 'onWithoutAmount');
  assert.equal(splitFeeState(true, 200), 'on');
});

test('the margin copy never contradicts the margin arithmetic', () => {
  // OFF: today's live state. May say a split costs nothing.
  const off = splitFeeMarginSentence('off', 0, 200);
  assert.match(off, /\$200/);
  assert.match(off, /costs nothing in this margin/);
  assert.match(off, /switched off/);

  // ON: the sentence that did not exist, on a screen whose margin WAS deducting.
  const on = splitFeeMarginSentence('on', 200, 200);
  assert.match(on, /IS applied/);
  assert.match(on, /deducted in this margin/);
  assert.doesNotMatch(on, /costs nothing/);
  assert.doesNotMatch(on, /switched off/);

  // Half-configured: charges nothing, and says why rather than printing "$0".
  const half = splitFeeMarginSentence('onWithoutAmount', 0, 200);
  assert.match(half, /switched ON but no amount is configured/);
  assert.match(half, /costs nothing in this margin/);
  assert.doesNotMatch(half, /\$0/);

  // A configured amount that is not the quote is printed as the configured one.
  assert.match(splitFeeMarginSentence('on', 250, 200), /\$250 per split line is deducted/);
});

test('the split step, badge and formula agree with the state', () => {
  assert.match(splitFeeStepSentence('off', 0, 200), /No split fee is charged yet/);
  assert.match(splitFeeStepSentence('on', 200, 200), /^\$200 per split is charged/);
  assert.match(splitFeeStepSentence('onWithoutAmount', 0, 200), /no amount configured/);

  assert.equal(splitFeeBadge('off', 0), null);
  assert.equal(splitFeeBadge('onWithoutAmount', 0), null);
  assert.equal(splitFeeBadge('on', 200), '+$200');

  assert.equal(splitFeeFormulaAmount('off', 0), 0);
  assert.equal(splitFeeFormulaAmount('onWithoutAmount', 0), 0);
  assert.equal(splitFeeFormulaAmount('on', 200), 200);
});

/* ── Source guards on the wizard's wiring ───────────────────────────────────
 *
 * SOURCE, not behaviour, and said plainly: node cannot load a `.tsx` in this
 * project (no jsdom, no vitest), so what the component RENDERS cannot be
 * asserted here. What can be pinned is that it renders these tested strings
 * rather than its own copy of the branch — which is exactly where the defect
 * was: the sentence was inline and unconditional while the arithmetic was not.
 *
 * Point ARCH_WIZARD_FILE at another copy to run these against it, which is how
 * the failing-before was demonstrated on the pre-change file.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const wizardSrc = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(
    process.env.ARCH_WIZARD_FILE || join(here, '..', 'components', 'arch', 'SOWizard.tsx'),
    'utf8'
  );
};

test('SOURCE: every split-fee sentence comes from the tested module', () => {
  const w = wizardSrc();
  // 🔴 The exact claim that was unconditional. It is TRUE today (the parameter
  // is F, measured) and becomes false the moment MGSL tick the box, on the step
  // that shows the margin. It must not be a literal any more.
  assert.doesNotMatch(w, /stays switched off until they ask for/);
  assert.doesNotMatch(w, /The \$\{splitFee\(\)\} split fee comes from configuration/);
  assert.match(w, /splitFeeMarginSentence\(feeState, splitFee\(\), SPLIT_FEE_PLACEHOLDER\)/);
  assert.match(w, /splitFeeStepSentence\(feeState, splitFee\(\), SPLIT_FEE_PLACEHOLDER\)/);
  assert.match(w, /splitFeeFormulaAmount\(feeState, splitFee\(\)\)/);
  assert.match(w, /const feeState = splitFeeState\(splitFeeEnabled\(\), splitFee\(\)\);/);
});

test('SOURCE: the team picker is the tested combobox over the live list', () => {
  const w = wizardSrc();
  // Reuses ArchCombobox and archTypeahead rather than a second matcher.
  assert.match(w, /options=\{comboTeams\}/);
  assert.match(w, /teamOptionLabel\(t\)/);
  // The three states are distinguished in the render, not collapsed.
  assert.match(w, /teamsResult\.status === 'ok'/);
  assert.match(w, /teamsResult\.notice/);
  // And no fixture teams: the field offers real rows or says why it cannot.
  assert.doesNotMatch(w, /FIXTURE_SALES_TEAMS|SALES_TEAMS\[/);
});


/* ── 🔴 THE COMMISSION LATCH ────────────────────────────────────────────────────
 *
 * Added 2026-09-09 after an adversarial pass found the wizard sending
 * `header.salesTeamId` on EVERY new order with no gate. It was inert only because the
 * `salesTeams` action was not deployed yet, i.e. ONE deploy away from attributing
 * commission nobody had approved, from two halves built the same day by different
 * hands. We have told MGSL in writing, twice, that the team is shown and not written.
 *
 * The latch must fail OFF on anything that is not a literal boolean true, and the
 * live-list check must survive independently of it.
 */
const withCfg = (v, fn) => {
  const prev = globalThis.window;
  globalThis.window = v === undefined ? {} : { MCGI_CONFIG: { salesTeamWriteEnabled: v } };
  try { fn(); } finally { globalThis.window = prev; }
};
const LATCH_TEAMS = [
  { id: '2805', name: 'Sam/Justin', members: [] },
  { id: '2810', name: 'Chris/Tom', members: [] },
];

test('latch: absent config means OFF, and nothing is sent', () => {
  withCfg(undefined, () => {
    assert.equal(salesTeamWriteEnabled(), false);
    assert.equal(sendableTeamId(LATCH_TEAMS, '2805'), undefined);
  });
});

test('latch: OFF says so on the field instead of looking functional', () => {
  withCfg(undefined, () => {
    assert.match(teamWriteNotice() || '', /not written to the sales order/i);
  });
});

test('latch: only a literal boolean true opens it', () => {
  for (const bad of [false, 'true', 'T', 1, 0, null, {}, []]) {
    withCfg(bad, () => {
      assert.equal(salesTeamWriteEnabled(), false, 'enabled by ' + JSON.stringify(bad));
      assert.equal(sendableTeamId(LATCH_TEAMS, '2805'), undefined, 'sent under ' + JSON.stringify(bad));
    });
  }
});

test('latch: ON sends a live id, and still refuses everything else', () => {
  withCfg(true, () => {
    assert.equal(sendableTeamId(LATCH_TEAMS, '2805'), '2805');
    // A stale or invented entitygroup id would attribute somebody else's commission.
    assert.equal(sendableTeamId(LATCH_TEAMS, '9999'), undefined);
    assert.equal(sendableTeamId(LATCH_TEAMS, ''), undefined);
    // The trader-role case: all 44 teams sit in subsidiary 1 while role 2181 is
    // subsidiaryoption OWN, and neither 2181 nor 2184 holds LIST_GROUP, so an empty
    // list is the likeliest live state.
    assert.equal(sendableTeamId([], '2805'), undefined);
    assert.equal(teamWriteNotice(), null);
  });
});

test('latch: toRequest omits the team entirely while it is OFF', async () => {
  const draft = {
    mode: 'new', existingSO: null,
    header: { customerId: '1', customerPO: 'PO-1', shipTo: '', currency: 'CAD',
              shipDate: '2026-09-10', incoterms: 'Delivered', salesTeam: '',
              paymentTerms: '', salesRepId: '2084', salesTeamId: '2805' },
    lines: [],
  };
  let sent = null;
  const prev = globalThis.window;
  globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: 'https://example.invalid/o' } };
  globalThis.fetch = (_u, init) => { sent = JSON.parse(init.body); return Promise.resolve({ json: async () => ({ ok: true, tranId: 'SO-1', salesOrderId: 1 }) }); };
  await createArchOrder(draft, 'ARCH-latch-key');
  globalThis.window = prev;
  // The DRAFT carried a team id and the request must not, because the switch is off.
  assert.equal(sent.header.salesTeamId, undefined);
});
