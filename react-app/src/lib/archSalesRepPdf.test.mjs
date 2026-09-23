/**
 * Feedback 17 item 7 (MA, 2026-09-23): « Sales rep pdf : Le workflow ne semble pas
 * rouler », on a screenshot of an SO whose SALES REP was blank while its Sales
 * Team held Alec Wolf.
 *
 * Measured: no NetSuite workflow sends or prints it. The field is
 * `custbody_sales_rep` ("Sales Rep (PDF)", id 9186), free text that client script
 * 3611 (SetSalesRep_CS) fills in the UI with the team's names joined " / ". A
 * client script never runs for an order this endpoint saves, so every
 * screen-created SO printed it blank (SO-ARC-25, 26, 28, 32; the UI ones carry it).
 * The endpoint now writes it on create, in the same format. Source guards: the
 * create path is not runnable here without NetSuite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const oc = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/archOrderCreate.js'), 'utf8');

test('create writes the Sales Rep (PDF) text from the team, " / " joined like SetSalesRep_CS', () => {
  const block = oc.slice(oc.indexOf('Feedback 17 item 7'), oc.indexOf('applyIncoterms(so, h, true);'));
  assert.match(block, /if \(!String\(h\.salesRep \|\| ''\)\.trim\(\)\)/, 'never over a value the request sent');
  assert.match(block, /namedTeam\.members\.map\(\(m\) => String\(m\.name \|\| ''\)\.trim\(\)\)/, 'a named team: every member');
  assert.match(block, /\[employeeName\(repId\)\]/, 'a single rep: that rep');
  assert.match(block, /names\.join\(' \/ '\)/);
  assert.match(block, /setIfPresent\(so, H_SALES_REP,/, 'guarded: a missing field is logged, not fatal');
});

test('the append path does not touch an existing order\'s text', () => {
  const writes = oc.match(/setIfPresent\(so, H_SALES_REP,/g) || [];
  assert.equal(writes.length, 2, 'the request-sent value, and the create-path fill');
  const append = oc.slice(oc.indexOf('🔴 `header.salesRepId` AND `custbody_sales_rep` STAY IGNORED HERE'));
  assert.doesNotMatch(append.slice(0, 4000), /setIfPresent\(so, H_SALES_REP/);
});

test('the freight line reads just Freight (SO-ARC-25)', () => {
  assert.match(oc, /description: 'Freight',/);
  assert.doesNotMatch(oc, /Added automatically: FOB Reload/);
});
