// archOrderCreate.js sendOrderPdf, loaded through an AMD shim with all eight
// dependencies faked. Pins the two defects the 2026-09-08 audit kept:
//   1. CREATOR must reach a NEGATIVE-id employee (Philippe Dubois is -5), which
//      int() nulled into 'no creator'
//   2. an append must not be mailed 'has been created'
//
// 2026-09-09: SALESREP added, the third clause of Marc-Antoine's item 9 that we had
// marked done on the strength of the first two. `custscript_arch_pdf_email_to` is now
// a COMMA-SEPARATED token list, so `recipients` and the returned `to` are ARRAYS where
// they used to be scalars. Three assertions below moved with that contract; nothing
// consumes `pdfEmail` on the client, so the shape change reaches no UI.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen', 'shared', 'archOrderCreate.js');

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ── fakes ──────────────────────────────────────────────────────────────────────
const params = {};
let currentUser = { id: -5 };
const runtime = {
  getCurrentScript: () => ({ getParameter: ({ name }) => (name in params ? params[name] : null) }),
  getCurrentUser: () => currentUser,
};
const sent = [];
const email = { send: (o) => { sent.push(o); } };
let renderCalls = 0;
let renderThrows = false;
const render = {
  PrintMode: { PDF: 'PDF' },
  transaction: () => { renderCalls++; if (renderThrows) throw new Error('RENDER_FAILED'); return { name: '' }; },
};
const logged = { audit: [], error: [] };
const log = { audit: (t, m) => logged.audit.push(t + ' | ' + m), error: (t, m) => logged.error.push(t + ' | ' + m), debug: () => {} };
const inert = new Proxy({}, { get: (_t, k) => (k === 'Type' ? new Proxy({}, { get: (_x, y) => String(y).toLowerCase() }) : () => { throw new Error('unexpected dependency call: ' + String(k)); }) });

let mod = null;
const define = (deps, factory) => {
  const table = {
    'N/record': inert, 'N/query': inert, 'N/search': inert, 'N/runtime': runtime,
    'N/log': log, 'N/render': render, 'N/email': email, './archSplitExecute': {},
  };
  mod = factory(...deps.map((d) => { if (!(d in table)) throw new Error('unfaked dep ' + d); return table[d]; }));
};
const src = fs.readFileSync(FILE, 'utf8');
new Function('define', src)(define);
ok('module loaded and exports sendOrderPdf for the test runner', !!mod && typeof mod.sendOrderPdf === 'function');

// source guards for the call sites the test cannot reach without a real record
ok('no call site still narrows the current user through int()', !/int\(runtime\.getCurrentUser\(\)\.id\)/.test(src));
// The call now also hands over the lots and the reman outcome, which only the
// call site knows, so it spans lines. `appending` must still reach the mail.
ok('the create path passes `appending` into the mail', /sendOrderPdf\(soId, tranId, currentUserId\(\), appending, \{/.test(src));
ok('the rep fallback and its diagnosis both use currentUserId()', (src.match(/currentUserId\(\), customerId\)/g) || []).length === 2);

const { sendOrderPdf } = mod;
const reset = () => { sent.length = 0; renderCalls = 0; renderThrows = false; logged.audit.length = 0; logged.error.length = 0; };

// ── not configured ─────────────────────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = '';
let r = sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('empty parameter: not sent, reason not configured', r.sent === false && r.reason === 'not configured', r);
ok('empty parameter: nothing rendered, nothing sent', renderCalls === 0 && sent.length === 0);

// ── CREATOR to a negative-id Administrator (the reported defect) ───────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR';
r = sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('CREATOR with creator -5: sent', r.sent === true && r.to.length === 1 && /creator \(-5\)/.test(r.to[0]), r);
ok('CREATOR with creator -5: author and the one recipient are both -5', sent.length === 1 && sent[0].author === -5 && Array.isArray(sent[0].recipients) && sent[0].recipients.length === 1 && sent[0].recipients[0] === -5, sent[0]);
ok('CREATOR: subject names the SO', sent[0].subject === 'Sales order SO-CWP-001354', sent[0].subject);
ok('CREATOR: the PDF is attached under the SO number', Array.isArray(sent[0].attachments) && sent[0].attachments[0].name === 'SO-CWP-001354.pdf', sent[0].attachments);

// ── CREATOR with no resolvable creator ────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR';
r = sendOrderPdf(126868, 'SO-CWP-001354', null, false);
// The reason wording changed with the token model: it now names WHICH token
// resolved to nobody, which matters once a value can carry more than one.
ok('CREATOR with null creator: not sent, the reason names the creator, audited not errored', r.sent === false && /creator/i.test(r.reason) && sent.length === 0 && logged.error.length === 0 && logged.audit.length === 1, { r, logged });

// ── explicit address ──────────────────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'someone@mcgillstlaurent.com';
r = sendOrderPdf(126868, 'SO-CWP-001354', 3293, false);
ok('address: recipient is the address, author is the creator', sent[0].recipients.length === 1 && sent[0].recipients[0] === 'someone@mcgillstlaurent.com' && sent[0].author === 3293 && r.to[0] === 'someone@mcgillstlaurent.com', sent[0]);

// ── wording follows what happened ─────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR';
sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('create: body says created', /has been created from the CWP ARCH trader screen/.test(sent[0].body) && !/has been updated/.test(sent[0].body), sent[0].body);
reset();
sendOrderPdf(126868, 'SO-CWP-001354', -5, true);
ok('append: body says updated, not created', /has been updated from the CWP ARCH trader screen/.test(sent[0].body) && !/has been created/.test(sent[0].body), sent[0].body);
/*
 * REPLACED 2026-09-09. This used to assert the reman caveat was ALWAYS present.
 * That was the defect: it printed on every order, hedged as "if any were
 * entered", when the server knows whether any were. The caveat is now
 * conditional, so its ABSENCE here, on a call passing no reman, is correct.
 */
ok('append: no reman caveat when no reman was entered', !/[Rr]eman/.test(sent[0].body), sent[0].body);

// ── never fatal ───────────────────────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR'; renderThrows = true;
r = sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('render failure: returns not sent with the message, logs an error, does not throw', r.sent === false && /RENDER_FAILED/.test(r.reason) && logged.error.length === 1 && sent.length === 0, { r, logged });

// ── parameter access that throws ──────────────────────────────────────────────
reset();
runtime.getCurrentScript = () => ({ getParameter: () => { throw new Error('SSS_INVALID_SCRIPT_PARAMETER'); } });
r = sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('a throwing getParameter is swallowed: not sent, reason not configured or not deployed', r.sent === false && /not configured|parameter not deployed/.test(r.reason) && sent.length === 0, r);


/* ════ SALESREP — his item 9's third clause ════════════════════════════════
 *
 * « Je crois qu'on devrait ajouter le field "sales rep". Qui permet d'identifier
 *   qui est le owner du SO. Le sales team definit le split commission.
 *   LE COURRIEL POURRAIT S'ENVOYER AU SALES REP. »
 *
 * The first two clauses shipped and the item was closed; this is the third.
 *
 * The rep is read from the SAVED order's sales team sublist, not re-derived from
 * the request. Two measured reasons: `transaction.salesrep` is empty on every ARCH
 * order in this account (the same fact behind the tab's old "Unassigned"), and an
 * APPEND carries no rep in its request yet the order still has one.
 *
 * These cases need a working N/query, so the module is re-loaded per case with a
 * controllable one. The top-of-file harness fakes N/query as `inert`, which throws
 * on any call — useful, and exercised below as the unreadable-sublist case.
 */
const loadWith = (rows) => {
  // rows: array of arrays, returned in order, one per runSuiteQL call.
  const calls = [];
  let i = 0;
  const q = {
    runSuiteQL: ({ query, params }) => {
      calls.push({ query, params });
      const next = rows[i++];
      if (next instanceof Error) throw next;
      return { asMappedResults: () => (next || []) };
    },
  };
  const sentHere = [];
  const loggedHere = { audit: [], error: [] };
  let m = null;
  const def = (deps, factory) => {
    const table = {
      'N/record': inert, 'N/query': q, 'N/search': inert,
      'N/runtime': {
        getCurrentScript: () => ({ getParameter: ({ name }) => (name in params ? params[name] : null) }),
        getCurrentUser: () => ({ id: -5 }),
      },
      'N/log': {
        audit: (t, x) => loggedHere.audit.push(t + ' | ' + x),
        error: (t, x) => loggedHere.error.push(t + ' | ' + x),
        debug: () => {},
      },
      'N/render': { PrintMode: { PDF: 'PDF' }, transaction: () => ({ name: '' }) },
      'N/email': { send: (o) => sentHere.push(o) },
      './archSplitExecute': {},
    };
    m = factory(...deps.map((d) => table[d]));
  };
  new Function('define', src)(def);
  return { mod: m, sent: sentHere, logged: loggedHere, calls };
};

const TEAM = [{ employee: '3297', contribution: '1' }];
const MAILABLE = [{ id: '3297', email: 'alec@cwpwood.com' }];

// ── one rep on the order ──────────────────────────────────────────────────
{
  params.custscript_arch_pdf_email_to = 'SALESREP';
  const h = loadWith([TEAM, MAILABLE]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('SALESREP: sent to the rep credited on the order', res.sent === true &&
    h.sent.length === 1 && h.sent[0].recipients.length === 1 && h.sent[0].recipients[0] === 3297, res);
  ok('SALESREP: the AUTHOR is still the creator, not the rep',
    h.sent[0].author === -5, h.sent[0].author);
  ok('SALESREP: the log names who it went to', h.logged.audit.some((a) => /sales rep \(3297\)/.test(a)), h.logged.audit);
  ok('SALESREP: it reads the SAVED order by id, not the request',
    h.calls[0].query.indexOf('transactionsalesteam') !== -1 && h.calls[0].params[0] === 126906, h.calls[0]);
  ok('SALESREP: the member check requires an active, flagged rep',
    /issalesrep = 'T'/.test(h.calls[1].query) && /isinactive = 'F'/.test(h.calls[1].query), h.calls[1].query);
}

// ── a split team: every mailable rep gets it, none is invented ────────────
{
  params.custscript_arch_pdf_email_to = 'SALESREP';
  const h = loadWith([
    [{ employee: '2085', contribution: '0.5' }, { employee: '3297', contribution: '0.5' }],
    [{ id: '2085', email: 'a@x.com' }, { id: '3297', email: 'b@x.com' }],
  ]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('SALESREP: a two-way split mails BOTH reps rather than picking one',
    res.sent === true && h.sent[0].recipients.length === 2 &&
    h.sent[0].recipients.indexOf(2085) !== -1 && h.sent[0].recipients.indexOf(3297) !== -1,
    h.sent[0].recipients);
  ok('SALESREP: one email, not one per rep', h.sent.length === 1, h.sent.length);
}

// ── a member who cannot receive is SKIPPED and NAMED, never substituted ───
{
  params.custscript_arch_pdf_email_to = 'SALESREP';
  const h = loadWith([
    [{ employee: '2085', contribution: '0.5' }, { employee: '9999', contribution: '0.5' }],
    [{ id: '2085', email: 'a@x.com' }],   // 9999 is inactive / not a rep: absent
  ]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('SALESREP: an unmailable member is left out, the mailable one still goes',
    res.sent === true && h.sent[0].recipients.length === 1 && h.sent[0].recipients[0] === 2085,
    h.sent[0].recipients);
  ok('SALESREP: and the skipped member is NAMED in the log, not silently dropped',
    h.logged.audit.some((a) => /9999/.test(a) && /skipped/.test(a)), h.logged.audit);

  // A rep row with NO email key at all. NULL columns are omitted from a SuiteQL
  // row, so an absent key is an absent address — not an empty string.
  const h2 = loadWith([[{ employee: '3297', contribution: '1' }], [{ id: '3297' }]]);
  const r2 = h2.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('SALESREP: a rep with no address on file is not mailed and nothing is invented',
    r2.sent === false && h2.sent.length === 0, r2);
  ok('SALESREP: and that refusal is AUDIT, not ERROR — it is config, not a fault',
    h2.logged.error.length === 0 && h2.logged.audit.length > 0, h2.logged);
}

// ── an unreadable sublist must NOT become "no reps", and must not fall back ─
{
  params.custscript_arch_pdf_email_to = 'SALESREP';
  const h = loadWith([new Error('Record "transactionsalesteam" was not found')]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('SALESREP: an unreadable sales team sends NOTHING rather than guessing',
    res.sent === false && h.sent.length === 0, res);
  ok('SALESREP: it never falls back to the creator, who is the wrong person',
    h.sent.length === 0, h.sent);
  ok('SALESREP: the log says the team could not be READ, not that there were none',
    h.logged.audit.some((a) => /could not read/i.test(a)), h.logged.audit);
  ok('SALESREP: unreadable is AUDIT, not ERROR', h.logged.error.length === 0, h.logged.error);
}

// ── an order with no sales team at all ────────────────────────────────────
{
  params.custscript_arch_pdf_email_to = 'SALESREP';
  const h = loadWith([[], []]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('SALESREP: no team on the order means no mail and a stated reason',
    res.sent === false && /no mailable sales rep/.test(res.reason) && h.sent.length === 0, res);
  ok('SALESREP: nothing was rendered for a mail with no recipient',
    h.sent.length === 0, h.sent.length);
}

// ── CREATOR,SALESREP does both, and dedupes when they are the same person ─
{
  params.custscript_arch_pdf_email_to = 'CREATOR,SALESREP';
  const h = loadWith([TEAM, MAILABLE]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('CREATOR,SALESREP: both are mailed in one email',
    res.sent === true && h.sent.length === 1 && h.sent[0].recipients.length === 2 &&
    h.sent[0].recipients.indexOf(-5) !== -1 && h.sent[0].recipients.indexOf(3297) !== -1,
    h.sent[0].recipients);

  // The trader who created the order IS its rep, which is the normal case.
  const h2 = loadWith([[{ employee: '3297', contribution: '1' }], MAILABLE]);
  const r2 = h2.mod.sendOrderPdf(126906, 'SO-CWP-001356', 3297, false);
  ok('CREATOR,SALESREP: the same person is not mailed twice',
    r2.sent === true && h2.sent[0].recipients.length === 1 && h2.sent[0].recipients[0] === 3297,
    h2.sent[0].recipients);
}

// ── mixed tokens, whitespace, case, and a literal address alongside ───────
{
  params.custscript_arch_pdf_email_to = ' salesrep , ops@mcgillstlaurent.com ';
  const h = loadWith([TEAM, MAILABLE]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, false);
  ok('tokens are trimmed and case-insensitive, and mix with a literal address',
    res.sent === true && h.sent[0].recipients.length === 2 &&
    h.sent[0].recipients.indexOf(3297) !== -1 &&
    h.sent[0].recipients.indexOf('ops@mcgillstlaurent.com') !== -1,
    h.sent[0].recipients);
}

// ── an append: the request has no rep, the ORDER does ─────────────────────
{
  params.custscript_arch_pdf_email_to = 'SALESREP';
  const h = loadWith([TEAM, MAILABLE]);
  const res = h.mod.sendOrderPdf(126906, 'SO-CWP-001356', -5, true);
  ok('append: SALESREP still resolves, because it reads the order not the request',
    res.sent === true && h.sent[0].recipients[0] === 3297, res);
  ok('append: and the body still says updated rather than created',
    /has been updated/.test(h.sent[0].body) && !/has been created/.test(h.sent[0].body), h.sent[0].body);
}

// ── the parameter's own documentation must describe what the code does ────
{
  const xml = fs.readFileSync(join(here, '..', '..', '..', 'src', 'Objects', 'scripts', 'sl',
    'customscript_mcgi_sl_arch_order_create.xml'), 'utf8');
  ok('the SDF parameter documents SALESREP, so whoever sets it knows it exists',
    /SALESREP/.test(xml), false);
  ok('and documents that the value is a comma-separated list',
    /COMMA-SEPARATED/i.test(xml), false);
  ok('the parameter still ships EMPTY, so the feature stays off until asked for',
    /<scriptcustomfield scriptid="custscript_arch_pdf_email_to">[\s\S]*?<defaultvalue><\/defaultvalue>/.test(xml), false);
}


/* ════ the body and subject ════════════════════════════════════════════════
 *
 * Andrei, seeing a delivered one: "how would you make this more elegant and clean?"
 *
 * Two faults behind the terseness. The subject was `Sales order SO-CWP-001366`, so
 * two orders in an inbox were indistinguishable without opening them. And the reman
 * caveat was printed on EVERY order hedged as "if any were entered", when the server
 * computes remanRequested and remanStored a few lines from the call site.
 *
 * Everything reported is read back from the SAVED order. That is the point: the body
 * says it describes what NetSuite holds, so it must not assemble figures of its own.
 */
const SUMMARY = [{
  customer: '84 Lumber Company',
  incoterms: 'Delivered',
  shipdate: '9/9/2026',
  total: '38950',
  iso: 'USD',
}];
const FACTS = { lots: ['315643-18'], remanRequested: false, remanStored: false };

{
  params.custscript_arch_pdf_email_to = 'ops@mcgillstlaurent.com';
  const h = loadWith([SUMMARY]);        // an ADDRESS token, so the summary is query #1
  h.mod.sendOrderPdf(127517, 'SO-CWP-001366', -5, false, FACTS);
  const m = h.sent[0];

  ok('subject: names the customer, so an inbox can be triaged',
    m.subject === 'Sales order SO-CWP-001366 for 84 Lumber Company', m.subject);
  ok('body: carries the customer', /Customer\s+84 Lumber Company/.test(m.body), m.body);
  ok('body: the total is formatted with its ISO code and separators',
    /Total\s+USD 38,950\.00/.test(m.body), m.body);
  ok('body: incoterms and ship date', /Incoterms\s+Delivered/.test(m.body) && /Ship date\s+9\/9\/2026/.test(m.body), m.body);
  ok('body: the bundle, singular when there is one',
    /Bundle\s+315643-18/.test(m.body) && !/Bundles/.test(m.body), m.body);
  ok('body: still says what happened and that the PDF is attached',
    /has been created from the CWP ARCH trader screen/.test(m.body) &&
    /The PDF is attached and shows what NetSuite holds/.test(m.body), m.body);
  ok('body: says NOTHING about reman when none was entered',
    !/[Rr]eman/.test(m.body), m.body);
}

// Reman entered AND stored: mentioned, and only then.
{
  params.custscript_arch_pdf_email_to = 'ops@mcgillstlaurent.com';
  const h = loadWith([SUMMARY]);
  h.mod.sendOrderPdf(127517, 'SO-CWP-001366', -5, false,
    { lots: ['315643-18', '316027-2'], remanRequested: true, remanStored: true });
  const b = h.sent[0].body;
  ok('reman stored: the email says so', /were entered and are stored on the order/.test(b), b);
  ok('reman stored: and still warns it is not in the PDF', /NOT part of the printed PDF/.test(b), b);
  ok('body: two lots read as Bundles, plural', /Bundles\s+315643-18, 316027-2/.test(b), b);
}

// Requested but NOT stored: the one case genuinely worth an email.
{
  params.custscript_arch_pdf_email_to = 'ops@mcgillstlaurent.com';
  const h = loadWith([SUMMARY]);
  h.mod.sendOrderPdf(127517, 'SO-CWP-001366', -5, false,
    { lots: ['315643-18'], remanRequested: true, remanStored: false });
  const b = h.sent[0].body;
  ok('reman lost: says it did NOT reach the order', /did NOT reach the order/.test(b), b);
  ok('reman lost: and that it needs entering by hand', /entering by hand/.test(b), b);
}

// An unknown value is OMITTED, never printed blank. A blank Total would read as zero.
{
  params.custscript_arch_pdf_email_to = 'ops@mcgillstlaurent.com';
  const h = loadWith([[{ customer: 'Ab Martin Roofing Supply LLC', incoterms: null, shipdate: null, total: null, iso: null }]]);
  h.mod.sendOrderPdf(127517, 'SO-CWP-001366', -5, false, { lots: [], remanRequested: false });
  const b = h.sent[0].body;
  ok('omission: the customer row is there', /Customer\s+Ab Martin/.test(b), b);
  ok('omission: no empty Total row rather than a blank or a zero',
    !/Total/.test(b), b);
  ok('omission: no Bundle row when no lot is known', !/Bundle/.test(b), b);
}

// An unreadable summary must still send, with the bare subject.
{
  params.custscript_arch_pdf_email_to = 'ops@mcgillstlaurent.com';
  const h = loadWith([new Error('Search error occurred')]);
  const r = h.mod.sendOrderPdf(127517, 'SO-CWP-001366', -5, false, FACTS);
  ok('unreadable summary: the email is still SENT', r.sent === true && h.sent.length === 1, r);
  ok('unreadable summary: the subject falls back to the bare form',
    h.sent[0].subject === 'Sales order SO-CWP-001366', h.sent[0].subject);
  ok('unreadable summary: and no half-built block is printed',
    !/Customer/.test(h.sent[0].body), h.sent[0].body);
  ok('unreadable summary: audited, not errored', h.logged.error.length === 0, h.logged.error);
}

// An append still says updated, with the summary.
{
  params.custscript_arch_pdf_email_to = 'ops@mcgillstlaurent.com';
  const h = loadWith([SUMMARY]);
  h.mod.sendOrderPdf(127517, 'SO-CWP-001366', -5, true, FACTS);
  const b = h.sent[0].body;
  ok('append: says updated, not created',
    /has been updated/.test(b) && !/has been created/.test(b), b);
  ok('append: and still carries the summary', /Customer\s+84 Lumber/.test(b), b);
}

console.log(fail ? ('# FAIL ' + fail) : '# archOrderEmail ok');
process.exit(fail ? 1 : 0);
