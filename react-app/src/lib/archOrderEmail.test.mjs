// archOrderCreate.js sendOrderPdf, loaded through an AMD shim with all eight
// dependencies faked. Pins the two defects the 2026-09-08 audit kept:
//   1. CREATOR must reach a NEGATIVE-id employee (Philippe Dubois is -5), which
//      int() nulled into 'no creator'
//   2. an append must not be mailed 'has been created'
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
ok('the create path passes `appending` into the mail', /sendOrderPdf\(soId, tranId, currentUserId\(\), appending\)/.test(src));
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
ok('CREATOR with creator -5: sent', r.sent === true && r.to === 'creator', r);
ok('CREATOR with creator -5: author and recipient are -5', sent.length === 1 && sent[0].author === -5 && sent[0].recipients === -5, sent[0]);
ok('CREATOR: subject names the SO', sent[0].subject === 'Sales order SO-CWP-001354', sent[0].subject);
ok('CREATOR: the PDF is attached under the SO number', Array.isArray(sent[0].attachments) && sent[0].attachments[0].name === 'SO-CWP-001354.pdf', sent[0].attachments);

// ── CREATOR with no resolvable creator ────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR';
r = sendOrderPdf(126868, 'SO-CWP-001354', null, false);
ok('CREATOR with null creator: not sent, reason no creator, audited not errored', r.sent === false && r.reason === 'no creator' && sent.length === 0 && logged.error.length === 0 && logged.audit.length === 1, { r, logged });

// ── explicit address ──────────────────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'someone@mcgillstlaurent.com';
r = sendOrderPdf(126868, 'SO-CWP-001354', 3293, false);
ok('address: recipient is the address, author is the creator', sent[0].recipients === 'someone@mcgillstlaurent.com' && sent[0].author === 3293 && r.to === 'someone@mcgillstlaurent.com', sent[0]);

// ── wording follows what happened ─────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR';
sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('create: body says created', /has been created from the CWP ARCH trader screen/.test(sent[0].body) && !/has been updated/.test(sent[0].body), sent[0].body);
reset();
sendOrderPdf(126868, 'SO-CWP-001354', -5, true);
ok('append: body says updated, not created', /has been updated from the CWP ARCH trader screen/.test(sent[0].body) && !/has been created/.test(sent[0].body), sent[0].body);
ok('append: body still carries the reman caveat', /Reman instructions/.test(sent[0].body));

// ── never fatal ───────────────────────────────────────────────────────────────
reset(); params.custscript_arch_pdf_email_to = 'CREATOR'; renderThrows = true;
r = sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('render failure: returns not sent with the message, logs an error, does not throw', r.sent === false && /RENDER_FAILED/.test(r.reason) && logged.error.length === 1 && sent.length === 0, { r, logged });

// ── parameter access that throws ──────────────────────────────────────────────
reset();
runtime.getCurrentScript = () => ({ getParameter: () => { throw new Error('SSS_INVALID_SCRIPT_PARAMETER'); } });
r = sendOrderPdf(126868, 'SO-CWP-001354', -5, false);
ok('a throwing getParameter is swallowed: not sent, reason not configured or not deployed', r.sent === false && /not configured|parameter not deployed/.test(r.reason) && sent.length === 0, r);

console.log(fail ? ('# FAIL ' + fail) : '# archOrderEmail ok');
process.exit(fail ? 1 : 0);
