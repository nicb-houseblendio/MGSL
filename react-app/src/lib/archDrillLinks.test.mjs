/**
 * Feedback 17 items 9, 10, 11 (MA, 2026-09-23):
 *   9  « Available/On hand : Ajouter 1ère colonne le numéro du PO (et un link vers
 *      la commande dans NS) »
 *   10 « In transit : PO# avec un hyperlink »
 *   11 « On Order/Ready to build/Outbound : Hyperlink sur le numéro du SO »
 *
 * Measured: only 20 of 1,053 on-hand ARC lots in sandbox were RECEIVED on a
 * NetSuite PO; the rest came in by adjustment (the 2026-09-16 re-import), and the
 * PO in their lot number (313989, 316078, ...) is a legacy supplier PO with no
 * NetSuite record. So the PO column links only a real receipt PO and shows the
 * lot-number PO as text otherwise, never a link to nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { purchaseOrderUrl, salesOrderUrl } from './nsRecordUrl.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');
const mr = readFileSync(join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache_arch.js'), 'utf8');

test('PO and SO record URLs', () => {
  assert.equal(purchaseOrderUrl('129877', '9448239_SB1'),
    'https://9448239-sb1.app.netsuite.com/app/accounting/transactions/purchord.nl?id=129877&compid=9448239_SB1');
  assert.equal(purchaseOrderUrl('PO344950'), '', 'a document number is not an id');
  assert.equal(purchaseOrderUrl(''), '');
  assert.match(salesOrderUrl('130305', '9448239_SB1'), /salesord\.nl\?id=130305/);
});

test('the cache carries the ids the links need', () => {
  assert.match(mr, /tl\.createdfrom\s+AS poid/, 'the receiving PO of a lot');
  assert.match(mr, /LEFT JOIN transaction po ON po\.id = tl\.createdfrom AND po\.type = 'PurchOrd'/);
  assert.match(mr, /receiptPoId:\s+\(lotFacts\[String\(l\.lotId\)\] \|\| \{\}\)\.poId \|\| undefined/, 'omitted when none, never an empty string');
  assert.match(mr, /poId:\s+String\(r\.tranid \|\| ''\)/, 'incoming and PO lines carry the PO id');
  assert.match(mr, /poNumber: u\.poNumber, poId: u\.poId \|\| ''/, 'and the unbundled lines');
});

test('drill-downs render the links (source guards)', () => {
  const lot = src('components/arch/ArchLotTable.tsx');
  assert.equal((lot.match(/<SoLinks orders=\{claims\(l\)\} accountId=\{accountId\} \/>/g) || []).length, 2,
    'Outbound, and Reserved / Ready to Build');
  assert.match(lot, /\{isSellableView && <th style=\{headerCellStyle\}>PO<\/th>\}\s*<th style=\{headerCellStyle\}>Lot #<\/th>/, 'PO is the first column');
  assert.match(lot, /purchaseOrderUrl\(lot\.receiptPoId, accountId\)/);
  assert.match(lot, /\(isSellableView \? 1 : 0\)/, 'the tally row spans the new column');
  const po = src('components/arch/ArchPOListView.tsx');
  assert.match(po, /<PoLink number=\{inc\.po\} id=\{inc\.poId \|\| ''\} accountId=\{accountId\} \/>/);
  assert.match(po, /<PoLink number=\{u\.poNumber \|\| '—'\} id=\{u\.poId \|\| ''\} accountId=\{accountId\} \/>/);
  assert.match(po, /poId: lot\.incoming\?\.poNumber \? lot\.incoming\?\.poId \|\| '' : ''/, 'a prefix-only PO is never linked');
});
