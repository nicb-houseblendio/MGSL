/**
 * The Equipment field. Feedback 10 item 1, 2026-09-22.
 *
 * Marc-Antoine: *"Ajout du field : custbody_equipment (entre Ship date et Pmt
 * terms)"*.
 *
 * Nothing had to be created in NetSuite. `custbody_equipment` is internal id 6218
 * in BOTH accounts, already sits on the ARC sales-order form in the Logistics
 * group, and is OPTIONAL there. This was wiring only.
 *
 * 🔴 THE THREE THINGS THAT MAKE THIS DIFFERENT FROM INCOTERMS, which is the
 * obvious thing to copy and the wrong thing to copy wholesale:
 *
 *   1. It is OPTIONAL. Incoterms is mandatory and sits in `headerOk`. Putting
 *      equipment there would refuse orders NetSuite itself accepts: 59 of the 60
 *      form-386 orders in the account saved with it blank.
 *   2. It has NO DEFAULT. `applyIncoterms` has a default arm and the 🔴 note beside
 *      it records the bug that caused on SO-CWP-001371, where a default fired on an
 *      APPEND and overwrote a value the order already had. Equipment is a
 *      per-shipment choice with no customer-level source, so there is nothing
 *      honest to default it to.
 *   3. It renders as a SELECT, not a button row. Incoterms has 6 options, this has
 *      15, and his own mockup shows a dropdown.
 *
 * 🔴 AND IT MUST NEVER BE HARDCODED. Measured 2026-09-22: the list is `isordered`
 * but SuiteQL exposes no sort column at all (`SELECT sortorder FROM CUSTOMLIST1443`
 * returns a 400), so only `getSelectOptions` can return the order MGSL actually
 * see. And the list grows: three of its fifteen values were added 2026-04-24
 * against 2025-03-26 for the rest. That is the argument Marc-Antoine made himself
 * on 2026-09-21 when he WITHDREW the request to hardcode the Incoterms list.
 *
 * ⚠️ Assertions run against the SHIPPED sources, read off disk, with comments
 * stripped before any text search. The source explains each rule in prose directly
 * above the code implementing it, so a raw search matches the explanation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const SRV = read('../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js');
const SL = read('../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_arch_order_create.js');
const WIZ = read('../components/arch/SOWizard.tsx');
const API = read('./archOrderApi.ts');
const TYPES = read('../types/archOrder.ts');

const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
const srv = code(SRV);
const sl = code(SL);
const wiz = code(WIZ);

let fails = 0;
let ran = 0;
const ok = (label, got, want) => {
  ran++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.error(`  FAIL ${label}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`);
  }
};

/* ── 1. the field, and where it is read ──────────────────────────────────── */
console.log('the field and its options');

ok('the field id is custbody_equipment',
  /H_EQUIPMENT\s*=\s*'custbody_equipment'/.test(srv), true);
ok('the options come from getSelectOptions on a real sales order',
  /listEquipment[\s\S]{0,900}getSelectOptions/.test(srv), true);
/* 🔴 The whole point. A SELECT over the custom list would return the values but
 * not MGSL's display order, and would stop reflecting a value they add. */
ok('🔴 the list is NOT read with a query over the custom list',
  /CUSTOMLIST1443/.test(srv), false);
/* Stripped, not raw. The source comment names three of the values on purpose,
 * as the evidence that the list grows, so a raw search matches the explanation
 * and reports the rule broken by the text describing it. */
ok('🔴 and no equipment value is hardcoded in the server CODE',
  /Walking Floor|Conestoga|B-Train|Roll tite/.test(srv), false);
ok('🔴 nor in the bundle CODE',
  /Walking Floor|Conestoga|B-Train|Roll tite/.test(wiz), false);
ok('a missing field is reported rather than silently empty',
  /is not on the[\s\S]{0,80}form this role uses/.test(srv), true);
ok('the reader is exported', /listEquipment: listEquipment/.test(srv), true);

/* ── 2. the endpoint action ──────────────────────────────────────────────── */
console.log('the GET action');

ok('action=equipment exists', /action === 'equipment'/.test(sl), true);
ok('it calls the shared reader, not its own query', /orderLib\.listEquipment\(\)/.test(sl), true);
ok('it reports the count', /count: eq\.equipment\.length/.test(sl), true);

/* ── 3. 🔴 optional, everywhere ──────────────────────────────────────────── */
console.log('optional, and it must stay optional');

/* The gate for this step is `headerOk`, which feeds stepValid.customer. There is
 * no `canContinue` in this file; asserting on that name silently passed. */
const headerOk = (() => {
  const at = wiz.indexOf('const headerOk');
  if (at === -1) throw new Error('headerOk not found, has the step gate been renamed?');
  return wiz.slice(at, wiz.indexOf(');', at) + 2);
})();
ok('the gate was located', /customer &&/.test(headerOk), true);
ok('🔴 equipment is NOT in the step gate', /equipment/.test(headerOk), false);
ok('  but incoterms IS, because that one is mandatory',
  /incoterms/.test(headerOk), true);
ok('  and so is the ship date it sits beside', /shipDate/.test(headerOk), true);
ok('the type marks both fields optional',
  /equipment\?: string;/.test(TYPES) && /equipmentId\?: string;/.test(TYPES), true);
/* A failed list must not stop an order, unlike incoterms where it must. */
ok('a failed read says the order can still be created',
  /The order can still be created/.test(WIZ), true);

/* ── 4. the write ────────────────────────────────────────────────────────── */
console.log('the write');

ok('written with setIfPresent, not setValue',
  /setIfPresent\(so, H_EQUIPMENT/.test(srv), true);
ok('🔴 written ONLY when the request names it',
  /if \(h\.equipmentId\) \{[\s\S]{0,200}setIfPresent\(so, H_EQUIPMENT/.test(srv), true);
/* Both the create and the append path. An append that says nothing about
 * equipment must leave whatever the order already has. */
ok('written on BOTH the create and the append path',
  (srv.match(/setIfPresent\(so, H_EQUIPMENT/g) || []).length, 2);
ok('🔴 and there is NO default arm, unlike incoterms',
  /equipmentDefault|custscript_arch_equipment/.test(srv), false);
ok('  while incoterms still has one, which is correct for a mandatory field',
  /incotermsDefault/.test(srv), true);

/* ── 5. the picker ───────────────────────────────────────────────────────── */
console.log('the picker');

ok('🔴 a select, not the Incoterms button row', /id="arch-equipment"/.test(WIZ) && /<select/.test(WIZ), true);
ok('the empty option is his own wording', /Logistics equipment/.test(WIZ), true);
/* Measured on the STRIPPED source: the raw file mentions "Payment terms" in a
 * field-mapping comment hundreds of lines above the form itself. */
ok('it sits between Ship date and Payment terms',
  wiz.indexOf('Ship date *') < wiz.indexOf('arch-equipment')
  && wiz.indexOf('arch-equipment') < wiz.indexOf('Payment terms'), true);
ok('it is editable, unlike Payment terms beside it',
  /id="arch-equipment"[\s\S]{0,400}readOnly/.test(WIZ), false);
ok('picking a customer clears it, like incoterms',
  /setEquipment\(''\)[\s\S]{0,60}setEquipmentId\(''\)/.test(wiz), true);
ok('it reaches the request payload',
  /equipmentId: equipmentId \|\| undefined/.test(wiz), true);
ok('and the Review step shows it', /\['Equipment', equipment \|\| '—'\]/.test(WIZ), true);

/* ── 6. the client fetcher ───────────────────────────────────────────────── */
console.log('the client fetcher');

ok('fetchEquipment hits action=equipment', /action=equipment/.test(API), true);
ok('it branches on the payload, never on r.status',
  /body\.ok !== true \|\| !Array\.isArray\(body\.equipment\)/.test(API), true);
ok('offline and failed are different states',
  /status: 'offline', equipment: \[\]/.test(API) && /status: 'failed', equipment: \[\]/.test(API), true);

console.log(`\n${ran - fails}/${ran} passed`);
if (fails) process.exit(1);
