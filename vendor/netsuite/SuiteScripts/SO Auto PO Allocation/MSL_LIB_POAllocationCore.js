/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Shared core helpers for SO <-> PO Segment allocation.
 */
define([
    'N/query',
    'N/record',
    '/SuiteScripts/mcgi_services/trader_screen/shared/poAllocationView'
], function (query, record, TraderCacheView) {
    var CFG = {
        SO_SUBLIST: 'item',
        SO_LINE_FIELD_SEGMENT: 'cseg_po_segment_gl',
        SO_LINE_FIELD_COMMITMENT: 'commitmentfirm',
        SO_LINE_FIELD_PO_RECEIVED: 'custcol_po_received',
        SO_LINE_FIELD_SHIP_READY: 'custcol_ship_ready',
        SO_HEADER_READY_TO_SHIP: 'custbody_ready_to_ship'
    };
    var DEBUG_AVAILABILITY = false;

    // Shared availability epsilon. Mirrors the 0.000001 tolerance already used by
    // evaluateLineStatus so pack/MBF float artifacts don't trip the save guard.
    var QTY_EPSILON = 0.000001;

    // Pack-space tolerance for the save guard. The trader reserves whole PACKS, so the guard
    // compares pack counts. This absorbs the rounding residue left by consumption: every
    // commitment and fulfilment rounds independently onto the account's 1e-5 storage grid,
    // so a lot that physically holds N packs can carry a balance a hair under N * factor.
    //
    // Sized from a measured, cleanly BIMODAL distribution. Over all 1,531 in-stock prod lots
    // with an unambiguous factor, distance from the nearest whole pack count:
    //     exactly 0                      1,306 lots
    //     grid noise, up to 0.006069       216 lots   <- physically whole packs
    //     (nothing in between)               0 lots   <- the valley
    //     real partial packs, from 0.010840  9 lots   <- physically fractional, must be refused
    // 0.008 sits in that valley: 1.32x above the largest artefact, 1.36x below the smallest
    // genuine partial. Do NOT "tidy" it to 0.01 or 0.05 — 0.05 would admit a whole extra pack
    // on a lot sitting 0.011-0.05 below an integer, and 1e-6 falsely blocks 216 lots.
    var PACK_EPSILON = 0.008;

    // Trader-screen group-net helpers (ported from MSL_MR_POAllocUnreceivedReconcile
    // buildPOGroupsPort). Named GROUP_*/group* to avoid colliding with the core's
    // own toId/toNumber. round2 rounds to 2 decimals — NOT floored — to match the
    // React trader source exactly.
    var GROUP_DASH = '—';       // em dash '—'
    var GROUP_NO_PO = '__no_po__';
    function groupStr(v) { return (v === null || v === undefined || v === '') ? '' : String(v); }
    function groupNum(v) { return Number(v) || 0; }
    function round2(v) { return Math.round(groupNum(v) * 100) / 100; }
    function traderGroupKey(po, ppp) { return (groupStr(po) || GROUP_NO_PO) + '|' + groupNum(ppp); }
    // AvailableTabMTL pack mode uses Math.round(value).toLocaleString(). Keep
    // formatting deterministic in the Suitelet payload while preserving JS -0,
    // which Trader visibly renders as "-0" for tiny negative group balances.
    function formatTraderPacks(value) {
        var numeric = Number(value);
        if (isNaN(numeric)) numeric = 0;
        var rounded = Math.round(numeric);
        var negative = rounded < 0 || (rounded === 0 && (1 / rounded) === -Infinity);
        var absolute = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (negative ? '-' : '') + absolute;
    }

    function toId(value) {
        if (value === null || value === undefined || value === '') return '';
        return String(value);
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === '') return 0;
        if (typeof value === 'number') return isNaN(value) ? 0 : value;
        var parsed = Number(String(value).replace(/[^0-9.\-]/g, ''));
        return isNaN(parsed) ? 0 : parsed;
    }

    function roundQty(value) {
        return Math.round(toNumber(value) * 1000000) / 1000000;
    }

    // Pack quantities are discrete units — never display or expose fractional packs.
    // Source data (custcol_mgsl_packqty) is integer, but MBF→pack divisions
    // (lotAvailMbf / mbfPerPack) introduce float artifacts that need cleaning.
    function roundPacks(value) {
        return Math.round(toNumber(value));
    }

    function normalizeLineKey(value) {
        if (value === null || value === undefined || value === '') return '';
        var n = Number(value);
        if (!isNaN(n) && isFinite(n)) return String(Math.trunc(n));
        return String(value).trim();
    }

    function isTrueFlag(value) {
        if (value === true || value === 1) return true;
        var text = String(value || '').trim().toUpperCase();
        return text === 'T' || text === 'TRUE' || text === 'Y' || text === 'YES' || text === '1';
    }

    function safeLogError(title, details) {
        try {
            if (typeof log !== 'undefined' && log && typeof log.error === 'function') {
                log.error({ title: title, details: details });
            }
        } catch (_e) {
            // Do not break business flow because of logging.
        }
    }

    function safeLogDebug(title, details) {
        if (!DEBUG_AVAILABILITY) return;
        safeLogError(title, details);
    }

    // AUDIT severity deliberately. These entries must be visible in production without
    // DEBUG_AVAILABILITY, but must NOT join the ERROR stream — the Core/Suitelet ERROR
    // channel is already saturated (the invalid tl.line query alone logs on every call),
    // and burying a rare guard skip in that flood is how it stayed invisible.
    function safeLogAudit(title, details) {
        try {
            if (typeof log !== 'undefined' && log && typeof log.audit === 'function') {
                log.audit({ title: title, details: details });
            }
        } catch (_e) {
            // Do not break business flow because of logging.
        }
    }

    function chunkValues(values, size) {
        var list = Array.isArray(values) ? values : [];
        var chunkSize = Number(size) || 900;
        var chunks = [];
        for (var i = 0; i < list.length; i += chunkSize) {
            chunks.push(list.slice(i, i + chunkSize));
        }
        return chunks;
    }

    function runSuiteQLMapped(sql, params) {
        try {
            return query.runSuiteQL({
                query: sql,
                params: params || []
            }).asMappedResults() || [];
        } catch (e) {
            safeLogError('MSL PO Allocation Core - SuiteQL Failed', {
                query: sql,
                params: params || [],
                name: e.name,
                message: e.message
            });
            throw e;
        }
    }

    function parseDateForSort(value) {
        if (!value) return Number.MAX_SAFE_INTEGER;
        var str = String(value).trim();
        // SuiteQL may return dates as "M/D/YYYY", "D/M/YYYY", "YYYY-MM-DD", or ISO strings.
        // Try ISO / YYYY-MM-DD first (unambiguous), then fall back to new Date().
        var isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (isoMatch) {
            var ts = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])).getTime();
            return isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
        }
        // NetSuite typically returns M/D/YYYY for SuiteQL trandate.
        var slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (slashMatch) {
            var ts2 = new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2])).getTime();
            return isNaN(ts2) ? Number.MAX_SAFE_INTEGER : ts2;
        }
        var parsed = new Date(str);
        var fallbackTs = parsed.getTime();
        return isNaN(fallbackTs) ? Number.MAX_SAFE_INTEGER : fallbackTs;
    }

    function mapLineRows(rows) {
        return (rows || []).map(function (row, index) {
            var lineSeq = normalizeLineKey(row.line_seq || row.line_num || row.line);
            if (!lineSeq) lineSeq = String(index + 1);
            // pack_qty is the canonical allocation unit; fall back to native quantity only when absent
            var packQty = row.pack_qty != null ? toNumber(row.pack_qty) : toNumber(row.quantity);
            return {
                lineId: toId(row.line_id || row.id || lineSeq),
                lineUniqKey: toId(row.line_uniq_key || row.lineuniquekey),
                lineSeq: lineSeq,
                lineNum: lineSeq,
                itemId: toId(row.item_id || row.item),
                location: toId(row.location),
                quantity: roundQty(Math.abs(packQty)),
                mbfQty: roundQty(Math.abs(toNumber(row.mbf_qty || row.mbfQty))),
                volpcfbm: toNumber(row.volpcfbm || row.custcol_mgsl_volpcfbm),
                ppp: toNumber(row.ppp),
                rate: toNumber(row.rate),
                segmentId: toId(row.segment_id || row.cseg_po_segment_gl),
                commitmentConfirmed: isTrueFlag(row.commitment_confirmed || row.custcol_commitment_confirmed),
                fulfilledQty: roundQty(Math.abs(toNumber(row.qty_fulfilled || row.quantityfulfilled)))
            };
        }).filter(function (line) {
            return !!line.itemId && line.quantity > 0;
        });
    }

    function loadSalesOrderLinesFromRecord(soId) {
        var soRec = record.load({
            type: record.Type.SALES_ORDER,
            id: Number(soId),
            isDynamic: false
        });
        var lineCount = soRec.getLineCount({ sublistId: CFG.SO_SUBLIST }) || 0;
        var rows = [];

        for (var i = 0; i < lineCount; i++) {
            var lineNum = '';
            try {
                lineNum = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'line',
                    line: i
                });
            } catch (_eLine) {
                lineNum = String(i + 1);
            }

            var itemId = '';
            try {
                itemId = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'item',
                    line: i
                });
            } catch (_eItem) {
                itemId = '';
            }

            var quantity = 0;
            try {
                quantity = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'custcol_mgsl_packqty',
                    line: i
                });
            } catch (_eQty) {
                quantity = 0;
            }

            var mbfQty = toNumber(getSublistValueSafe(soRec, CFG.SO_SUBLIST, 'quantity', i));
            var volpcfbm = toNumber(getSublistValueSafe(soRec, CFG.SO_SUBLIST, 'custcol_mgsl_volpcfbm', i));

            var location = '';
            try {
                location = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'location',
                    line: i
                });
            } catch (_eLoc) {
                location = '';
            }

            var ppp = 0;
            try {
                ppp = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'custcol_mgsl_ppp',
                    line: i
                });
            } catch (_ePpp) {
                ppp = 0;
            }

            var rate = 0;
            try {
                rate = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'rate',
                    line: i
                });
            } catch (_eRate) {
                rate = 0;
            }

            var segmentId = '';
            try {
                segmentId = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: CFG.SO_LINE_FIELD_SEGMENT,
                    line: i
                });
            } catch (_eSeg) {
                segmentId = '';
            }

            var commitmentConfirmed = false;
            try {
                commitmentConfirmed = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: CFG.SO_LINE_FIELD_COMMITMENT,
                    line: i
                });
            } catch (_eCommit) {
                commitmentConfirmed = false;
            }

            var qtyFulfilled = 0;
            try {
                qtyFulfilled = soRec.getSublistValue({
                    sublistId: CFG.SO_SUBLIST,
                    fieldId: 'quantityfulfilled',
                    line: i
                });
            } catch (_eFulfilled) {
                qtyFulfilled = 0;
            }

            rows.push({
                line_id: lineNum,
                line_seq: lineNum || String(i + 1),
                item_id: itemId,
                location: location,
                pack_qty: quantity,
                mbf_qty: mbfQty,
                volpcfbm: volpcfbm,
                ppp: ppp,
                rate: rate,
                segment_id: segmentId,
                commitment_confirmed: commitmentConfirmed,
                qty_fulfilled: qtyFulfilled
            });
        }

        return mapLineRows(rows);
    }

    // Lot IDs per SO line, read from InventoryAssignment. Used to seed
    // includeLotSet in buildAvailabilityByLine so the SO's existing lot allocation
    // bypasses the PPP filter (RULES.md §1). Without this, an SO line allocated to
    // a specific lot at a different PPP than the line itself would have that lot
    // disappear from the PO allocation table.
    function getLotIdsBySalesOrderLine(soId) {
        var byLineId = {};
        var byLineSeq = {};
        try {
            // NOTE: do NOT select tl.line — it is not a valid SuiteQL TransactionLine
            // column in this account and throws SSS_SEARCH_ERROR_OCCURRED, which used
            // to fail the whole query and leave every line with no lotIds (breaking the
            // RULES §1 lot-level PPP bypass). linesequencenumber covers the line key.
            var rows = runSuiteQLMapped([
                'SELECT',
                '  tl.id AS line_id,',
                '  tl.linesequencenumber AS line_seq,',
                '  ia.inventorynumber AS lot_id',
                'FROM TransactionLine tl',
                'INNER JOIN InventoryAssignment ia',
                '  ON ia.transaction = tl.transaction',
                ' AND ia.transactionline = tl.id',
                'WHERE tl.transaction = ?',
                "  AND tl.mainline = 'F'",
                '  AND ia.inventorynumber IS NOT NULL'
            ].join(' '), [Number(soId)]);
            (rows || []).forEach(function (row) {
                var lotId = toId(row && row.lot_id);
                if (!lotId) return;
                var lineId = toId(row && row.line_id);
                if (lineId) {
                    if (!byLineId[lineId]) byLineId[lineId] = [];
                    if (byLineId[lineId].indexOf(lotId) < 0) byLineId[lineId].push(lotId);
                }
                var lineSeq = normalizeLineKey(row && (row.line_seq || row.line_num));
                if (lineSeq) {
                    if (!byLineSeq[lineSeq]) byLineSeq[lineSeq] = [];
                    if (byLineSeq[lineSeq].indexOf(lotId) < 0) byLineSeq[lineSeq].push(lotId);
                }
            });
        } catch (eLotIds) {
            safeLogError('MSL PO Allocation Core - SO Line Lot ID Query Failed', {
                soId: soId,
                name: eLotIds && eLotIds.name,
                message: eLotIds && eLotIds.message
            });
        }
        return { byLineId: byLineId, byLineSeq: byLineSeq };
    }

    // Per-line, per-lot committed MBF the CURRENT SO already holds, read from its
    // own InventoryAssignment rows. Used by the shared save guard as
    // `priorPacksThisSo` headroom: a lot the SO is re-saving into is not "depleted"
    // just because the SO's existing commit consumed the live available balance.
    function getThisSoCommittedLotBalanceByLine(soId) {
        var byLineSeq = {};
        try {
            // Two separate traps here.
            //
            // 1. tl.line is NOT a valid SuiteQL TransactionLine column in this account. It
            //    does not raise 'Unknown identifier' - the request dies with HTTP 500 /
            //    UNEXPECTED_ERROR, which the catch below cannot tell from a transient fault,
            //    so it silently returned an EMPTY map. Broken in BOTH environments, for every
            //    sales order, from the 2026-08-07 push until 2026-08-27.
            //
            // 2. The key must be tl.id, NOT tl.linesequencenumber. Every consumer resolves its
            //    lookup key from the record sublist 'line' field, which is the transactionline
            //    internal id (MSL_LIB_POAllocationApi.js:147 -> :953; MSL_UE_SO_POAllocation.js
            //    :1653). The two diverge as soon as a line has been deleted: prod SO 134515 has
            //    ids 1,4,7,8 against linesequencenumber 1,2,3,4, so keying by sequence credits
            //    line 4 with line 8's committed lots and drops 7 and 8 entirely - a silent
            //    mis-credit that makes the availability guard too lenient. The returned property
            //    is still named byLineSeq for compatibility, but it has always been keyed by id.
            var rows = runSuiteQLMapped([
                'SELECT',
                '  tl.id AS line_seq,',
                '  tl.item AS item_id,',
                '  tl.location AS location,',
                '  ia.inventorynumber AS lot_id,',
                '  SUM(ABS(ia.quantity)) AS committed_mbf',
                'FROM TransactionLine tl',
                'INNER JOIN InventoryAssignment ia',
                '  ON ia.transaction = tl.transaction',
                ' AND ia.transactionline = tl.id',
                'WHERE tl.transaction = ?',
                "  AND tl.mainline = 'F'",
                '  AND ia.inventorynumber IS NOT NULL',
                'GROUP BY tl.id, tl.item, tl.location, ia.inventorynumber'
            ].join(' '), [Number(soId)]);
            (rows || []).forEach(function (row) {
                var lineSeq = normalizeLineKey(row && row.line_seq);
                var lotId = toId(row && row.lot_id);
                if (!lineSeq || !lotId) return;
                if (!byLineSeq[lineSeq]) byLineSeq[lineSeq] = {};
                byLineSeq[lineSeq][lotId] = {
                    itemId: toId(row.item_id),
                    locationId: toId(row.location),
                    committedMbf: roundQty(toNumber(row.committed_mbf))
                };
            });
        } catch (eCommitted) {
            safeLogError('MSL PO Allocation Core - This SO Committed Lot Balance Query Failed', {
                soId: soId,
                name: eCommitted && eCommitted.name,
                message: eCommitted && eCommitted.message
            });
        }
        return { byLineSeq: byLineSeq };
    }

    function attachLotIdsToLines(lines, soId) {
        var lookup = getLotIdsBySalesOrderLine(soId);
        (lines || []).forEach(function (line) {
            if (!line) return;
            var lineId = toId(line.lineId);
            var lineSeq = normalizeLineKey(line.lineSeq || line.lineNum);
            var lotIds = (lineId && lookup.byLineId[lineId]) || (lineSeq && lookup.byLineSeq[lineSeq]) || [];
            line.lotIds = lotIds.slice();
        });
        return lines;
    }

    function getSalesOrderLines(soId) {
        var rows = [];
        try {
            rows = runSuiteQLMapped([
                'SELECT',
                '  tl.id AS line_id,',
                '  tl.uniquekey AS line_uniq_key,',
                // line_seq MUST be tl.id, not tl.linesequencenumber. The record
                // fallback sets it from getSublistValue('line'), which IS tl.id, and
                // getThisSoCommittedLotBalanceByLine deliberately keys byLineSeq on
                // tl.id too (see the note there). Measured on tx 99898: tl.id = 3,4
                // while linesequencenumber = 1,2 — so using the sequence here would
                // silently break every prior-commitment credit on any order whose
                // lines have been reordered or removed.
                '  tl.id AS line_seq,',
                // tl.line AS line_num deleted: not a valid column (HTTP 500), and
                // redundant — mapLineRows reads line_seq first and then emits
                // lineNum: lineSeq, so every consumer's `lineSeq || lineNum` is
                // unaffected.
                '  tl.item AS item_id,',
                '  tl.location AS location,',
                '  tl.custcol_mgsl_packqty AS pack_qty,',
                '  tl.quantity AS mbf_qty,',
                '  tl.custcol_mgsl_volpcfbm AS volpcfbm,',
                '  tl.custcol_mgsl_ppp AS ppp,',
                '  tl.rate AS rate,',
                '  tl.cseg_po_segment_gl AS segment_id,',
                '  tl.commitmentfirm AS commitment_confirmed,',
                // SuiteQL names this quantityshiprecv; quantityfulfilled is the
                // RECORD-API field name only (still correct at Api:191 / UE:464).
                // This revives the fulfilled-line skip in evaluateLineStatus, which
                // has never fired: measured impact on OPEN orders is 41 lines
                // (36 status-D + 5 status-E), all genuinely already shipped.
                // Pending-Fulfillment — 824 lines, the bulk of live work — is
                // completely unaffected (0 lines change).
                '  tl.quantityshiprecv AS qty_fulfilled',
                'FROM TransactionLine tl',
                'WHERE tl.transaction = ?',
                "  AND tl.mainline = 'F'",
                "  AND (tl.taxline = 'F' OR tl.taxline IS NULL)",
                // tl.shipping is not a valid column and has no equivalent. Dropping
                // the clause is safe here: sales-order lines in this account are only
                // Assembly / InvtPart / NonInvtPart / TaxGroup — there are ZERO
                // ShipItem lines account-wide — and TaxGroup is already excluded by
                // the taxline predicate above.
                "  AND (tl.iscogs = 'F' OR tl.iscogs IS NULL)",
                'ORDER BY tl.linesequencenumber'
            ].join(' '), [Number(soId)]);
        } catch (suiteQLError) {
            safeLogError('MSL PO Allocation Core - SO Query Fallback', {
                soId: soId,
                name: suiteQLError && suiteQLError.name,
                message: suiteQLError && suiteQLError.message
            });
        }

        var mapped = mapLineRows(rows);
        if (mapped.length > 0) return attachLotIdsToLines(mapped, soId);

        var fallbackLines = loadSalesOrderLinesFromRecord(soId);
        if (fallbackLines.length > 0) {
            safeLogError('MSL PO Allocation Core - Using Record Fallback For SO Lines', {
                soId: soId,
                fallbackLineCount: fallbackLines.length
            });
        }
        return attachLotIdsToLines(fallbackLines, soId);
    }

    // For each received segment in `segmentIds`, return an array of per-lot rows
    // shaped { lotId, lotNumber, receivedQty, allocatedQty, availQty, earliestReceipt, ppp }.
    // Pool source: ItemReceipt + InventoryAdjustment lines, filtered by item + segment +
    // optional PPP, joined to inventoryassignment for the lot. Negative-side IA lines
    // (consumption) are excluded — mirrors getCandidateLotsFromInventorySources in
    // MSL_LIB_lotAssignment.js. Allocated-per-lot is summed from inventoryassignment
    // joined to other SO lines on the same segment + lot.
    //
    // includeLotSet: lot IDs that should always be returned even when avail<=0
    // (so the UI can render a row for a lot the current SO is already allocated to).
    function getLotsForReceivedSegments(itemId, currentSoId, segmentIds, ppp, includeLotSet, bypassPppSegmentIds, options) {
        var result = {};
        var ids = (segmentIds || []).map(function (id) { return Number(id); }).filter(function (n) {
            return n && !isNaN(n);
        });
        if (!ids.length) return result;

        var numericItemId = Number(itemId) || 0;
        var numericCurrentSoId = Number(currentSoId) || 0;
        var numericPpp = Number(ppp) || 0;
        var placeholders = ids.map(function () { return '?'; }).join(',');
        var keepLots = includeLotSet || {};
        var keepZeroLotsForDisplay = !!(options && options.displayMode);

        // Lots the SO is already allocated to that bypass the PPP filter. Only the
        // specifically-allocated lotIds bypass — same-segment lots at different PPPs
        // do NOT (per RULES.md §1). The legacy `bypassPppSegmentIds` parameter is
        // ignored at this layer; segment-level bypass is handled in getPoSegmentsForItem
        // for segment rows, not for lot rows. Without this lot-level bypass, a SO line
        // at PPP=294 already allocated to a specific lot received at PPP=305 would
        // see that lot come through ONLY via the SO-only append path (availQty=0),
        // making the row read "Depleted" the moment the user clears the qty cell.
        var bypassLotIds = Object.keys(keepLots || {})
            .map(function (id) { return Number(id); })
            .filter(function (n) { return n && !isNaN(n); });
        // bypassPppSegmentIds is intentionally unused here — kept in the signature for
        // callers that still pass it. See [[lot-level-ppp-bypass]] / RULES.md §1.
        void bypassPppSegmentIds;
        function pppFilter(field) {
            if (!numericPpp) return { sql: '', params: [] };
            if (!bypassLotIds.length) return { sql: '  AND ' + field + ' = ? ', params: [numericPpp] };
            var phs = bypassLotIds.map(function () { return '?'; }).join(',');
            return {
                sql: '  AND (' + field + ' = ? OR ia.inventorynumber IN (' + phs + ')) ',
                params: [numericPpp].concat(bypassLotIds)
            };
        }
        var receivedPpp = pppFilter('txl.custcol_mgsl_ppp');
        var soPpp = pppFilter('sol.custcol_mgsl_ppp');

        // Received per (segment, lot): IR + IA pack qty grouped by segment + lot.
        // IA negative-side lines excluded via txl.quantity > 0 condition for IA only.
        // LEFT JOIN to InventoryNumber so rows still come through if the lookup misses.
        // PPP filter is mandatory: a lot is only usable by an SO line if it was received
        // against a source line with the SO line's PPP.
        //
        // CRITICAL: JOIN to InventoryAssignment MUST use both transaction and transactionline.
        // TransactionLine.id is the line position *within* the transaction (1, 2, 3...),
        // not a globally unique ID. Joining on transactionline alone produces a cross-join
        // where every IR/IA line 1 matches every other transaction's line-1 assignments
        // (including SO and IF rows), exploding the result set and corrupting sums.
        // Per-lot cost columns:
        //   lot_mbf                = MBF received for this (segment, lot), summed over all source IR/IA lines
        //   weighted_txn_rate_sum  = Σ ( txl.rate · ia.quantity / exchangerate ) — divide by lot_mbf in JS
        //                            to get an MBF-weighted average rate in transaction currency
        //   lot_usd_amount         = Σ ( tab.amount · ia.quantity / txl.quantity ) for IA lines only —
        //                            divide by lot_mbf in JS to get USD/MBF for USD-denominated IA lots
        // The TransactionAccountingLine join is per (transaction, line) and does not fan
        // out the row count; the InventoryAssignment pivot does the per-lot split.
        var receivedSql = [
            'SELECT',
            '  NVL(txl.cseg_po_segment_gl, tx.cseg_po_segment_gl) AS segment_id,',
            '  ia.inventorynumber AS lot_id,',
            '  inum.inventorynumber AS lot_number,',
            // PRO-RATED BY LOT SHARE. custcol_mgsl_packqty is a LINE-level column, but this
            // query GROUPs BY (segment, lot) while the InventoryAssignment join above fans
            // each receipt line into one row per lot. Summing a line-level column across
            // that fan-out returns the whole line's packs once per lot, so every lot on a
            // multi-lot receipt was credited with the ENTIRE line.
            //
            // Measured on prod 2026-08-28: 637 receipt lines fan out to more than one lot
            // (worst 18 lots on one line), inflating 78 of 5,235 (segment, item, lot) rows
            // across 10 segments and 10 items by 6,632 phantom packs. Worst single row:
            // segment 658 / item 2251 / lot 28013 credited 218 packs against a true share
            // of 1, on a lot with no InventoryBalance row at all.
            //
            // ABS(ia.quantity) / ABS(txl.quantity) is the lot's fraction of the line's MBF.
            // This is the SAME idiom already used for lot_usd_amount five lines below, and
            // it matches the pro-rated ALLOCATED side, so both halves of
            // availQty = received - allocated are now scaled by the same rule.
            //
            // Verified on prod: a bit-exact no-op on all 13,070 single-lot receipt lines
            // (0 mismatches, worst delta 0), and the per-lot shares sum back to the line
            // total on all 637 multi-lot lines (worst residual 2e-38) - it redistributes,
            // it never changes a total. NULLIF guards division by zero; the population that
            // would hit it is empty (0 receipt lines carry quantity = 0 or NULL with packs).
            '  SUM(ABS(txl.custcol_mgsl_packqty) * ABS(ia.quantity)',
            '      / NULLIF(ABS(txl.quantity), 0)) AS received_qty,',
            '  MIN(tx.trandate) AS earliest_receipt,',
            '  MAX(txl.custcol_mgsl_ppp) AS ppp,',
            '  SUM(ABS(ia.quantity)) AS lot_mbf,',
            '  SUM(ABS(txl.rate) * ABS(ia.quantity) / NULLIF(NVL(tx.exchangerate, 1), 0)) AS weighted_txn_rate_sum,',
            "  SUM(CASE WHEN tx.type = 'InvAdjst' AND tab.amount IS NOT NULL",
            '           THEN ABS(tab.amount) * ABS(ia.quantity) / NULLIF(ABS(txl.quantity), 0)',
            '           ELSE 0 END) AS lot_usd_amount',
            'FROM TransactionLine txl',
            'INNER JOIN Transaction tx ON tx.id = txl.transaction',
            '  INNER JOIN InventoryAssignment ia',
            '    ON ia.transaction = tx.id',
            '   AND ia.transactionline = txl.id',
            '  LEFT JOIN InventoryNumber inum',
            '    ON inum.id = ia.inventorynumber',
            '  LEFT JOIN TransactionAccountingLine tab',
            '    ON tab.transaction = tx.id',
            '   AND tab.transactionline = txl.id',
            '   AND tab.accountingbook = 2',
            "WHERE tx.type IN ('ItemRcpt', 'InvAdjst')",
            "  AND txl.mainline = 'F'",
            '  AND txl.item = ?',
            '  AND NVL(txl.cseg_po_segment_gl, tx.cseg_po_segment_gl) IN (' + placeholders + ')',
            "  AND (tx.type <> 'InvAdjst' OR txl.quantity > 0)",
            '  AND ia.inventorynumber IS NOT NULL',
            receivedPpp.sql,
            'GROUP BY NVL(txl.cseg_po_segment_gl, tx.cseg_po_segment_gl), ia.inventorynumber, inum.inventorynumber'
        ].join(' ');
        var receivedParams = [numericItemId].concat(ids).concat(receivedPpp.params);

        var receivedRows = [];
        try {
            receivedRows = runSuiteQLMapped(receivedSql, receivedParams);
        } catch (eReceived) {
            safeLogError('MSL PO Allocation Core - Lot Received Query Failed', {
                itemId: numericItemId,
                segmentIds: ids,
                name: eReceived && eReceived.name,
                message: eReceived && eReceived.message
            });
            return result;
        }

        safeLogDebug('MSL PO Allocation Core - Lot Received Rows', {
            itemId: numericItemId,
            segmentIds: ids,
            ppp: numericPpp,
            rowCount: receivedRows.length,
            sample: receivedRows.slice(0, 20).map(function (r) {
                return {
                    segment_id: r.segment_id,
                    lot_id: r.lot_id,
                    lot_number: r.lot_number,
                    received_qty: r.received_qty
                };
            })
        });

        // Probe: raw inventoryassignment rows (no grouping, no PPP filter) for the same
        // segments. Helps distinguish "JOIN broken" from "grouped query filters too
        // aggressively". If this returns rows for a segment but the grouped query above
        // returned none for it, the issue is in the grouped query's filter set.
        if (DEBUG_AVAILABILITY) {
            try {
                var probeSql = [
                    'SELECT',
                    '  tx.id AS tx_id,',
                    '  tx.type AS tx_type,',
                    '  tx.tranid AS tranid,',
                    '  txl.id AS txl_id,',
                    '  txl.cseg_po_segment_gl AS line_segment,',
                    '  tx.cseg_po_segment_gl AS hdr_segment,',
                    '  txl.custcol_mgsl_packqty AS pack_qty,',
                    '  txl.custcol_mgsl_ppp AS ppp,',
                    '  ia.inventorynumber AS lot_id,',
                    '  ia.quantity AS ia_qty',
                    'FROM TransactionLine txl',
                    'INNER JOIN Transaction tx ON tx.id = txl.transaction',
                    '  INNER JOIN InventoryAssignment ia',
                    '    ON ia.transaction = tx.id',
                    '   AND ia.transactionline = txl.id',
                    "WHERE tx.type IN ('ItemRcpt', 'InvAdjst')",
                    "  AND txl.mainline = 'F'",
                    '  AND txl.item = ?',
                    '  AND NVL(txl.cseg_po_segment_gl, tx.cseg_po_segment_gl) IN (' + placeholders + ')'
                ].join(' ');
                var probeRows = runSuiteQLMapped(probeSql, [numericItemId].concat(ids));
                safeLogDebug('MSL PO Allocation Core - Lot Probe (raw, no grouping/PPP)', {
                    itemId: numericItemId,
                    segmentIds: ids,
                    rowCount: probeRows.length,
                    sample: probeRows.slice(0, 20)
                });
            } catch (eProbe) {
                safeLogError('MSL PO Allocation Core - Lot Probe Failed', {
                    name: eProbe && eProbe.name,
                    message: eProbe && eProbe.message
                });
            }
        }

        // Allocated per (segment, lot): SO inventoryassignment for other SOs.
        // Joined on TransactionLine sol so we can filter by segment.
        //
        // UNIT NOTE: ia.quantity is in the line's primary unit (MBF in this account).
        // received_qty above uses txl.custcol_mgsl_packqty (packs). To compare on the
        // same unit, convert ia.quantity to its pack-equivalent using the line's own
        // pack/MBF ratio: pack_share = sol.packqty * (ia.qty / sol.quantity).
        // NULLIF guards a zero-MBF line so the division doesn't blow up.
        var allocatedSql = [
            'SELECT',
            '  NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl) AS segment_id,',
            '  ia.inventorynumber AS lot_id,',
            '  SUM(ABS(sol.custcol_mgsl_packqty) * ABS(ia.quantity) / NULLIF(ABS(sol.quantity), 0)) AS allocated_qty',
            'FROM TransactionLine sol',
            'INNER JOIN Transaction so ON so.id = sol.transaction',
            '  INNER JOIN InventoryAssignment ia',
            '    ON ia.transaction = so.id',
            '   AND ia.transactionline = sol.id',
            "WHERE so.type = 'SalesOrd'",
            "  AND sol.mainline = 'F'",
            '  AND sol.item = ?',
            '  AND NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl) IN (' + placeholders + ')',
            '  AND ia.inventorynumber IS NOT NULL',
            '  AND so.id <> ?',
            soPpp.sql,
            'GROUP BY NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl), ia.inventorynumber'
        ].join(' ');
        var allocatedParams = [numericItemId].concat(ids).concat([numericCurrentSoId]).concat(soPpp.params);

        var allocatedBySegLot = {};
        try {
            var allocatedRows = runSuiteQLMapped(allocatedSql, allocatedParams);
            allocatedRows.forEach(function (row) {
                var segId = toId(row.segment_id);
                var lotId = toId(row.lot_id);
                if (!segId || !lotId) return;
                allocatedBySegLot[segId + '|' + lotId] = roundQty(toNumber(row.allocated_qty));
            });
            safeLogDebug('MSL PO Allocation Core - Lot Allocated Rows', {
                itemId: numericItemId,
                segmentIds: ids,
                rowCount: allocatedRows.length,
                sample: allocatedRows.slice(0, 20)
            });
        } catch (eAllocated) {
            safeLogError('MSL PO Allocation Core - Lot Allocated Query Failed', {
                itemId: numericItemId,
                segmentIds: ids,
                name: eAllocated && eAllocated.name,
                message: eAllocated && eAllocated.message
            });
        }

        // Current SO's own allocation per (segment, lot): pulled via SO inventoryassignment.
        // Two uses:
        //  1) soAllocatedBySegLot map → exposed as `soAllocatedQty` on each lot row
        //  2) Lots the SO uses that aren't present in IR/IA receivedRows get APPENDED to
        //     the result so they render even when the IR pool doesn't know about them
        //     (e.g. NetSuite assigned a lot record that isn't tied to any IR for the segment).
        var soAllocatedBySegLot = {};
        var soLotRows = [];
        if (numericCurrentSoId) {
            var soAllocatedSql = [
                'SELECT',
                '  NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl) AS segment_id,',
                '  ia.inventorynumber AS lot_id,',
                '  inum.inventorynumber AS lot_number,',
                '  SUM(ABS(sol.custcol_mgsl_packqty) * ABS(ia.quantity) / NULLIF(ABS(sol.quantity), 0)) AS allocated_qty',
                'FROM TransactionLine sol',
                'INNER JOIN Transaction so ON so.id = sol.transaction',
                '  INNER JOIN InventoryAssignment ia',
                '    ON ia.transaction = so.id',
                '   AND ia.transactionline = sol.id',
                '  LEFT JOIN InventoryNumber inum',
                '    ON inum.id = ia.inventorynumber',
                "WHERE so.type = 'SalesOrd'",
                "  AND sol.mainline = 'F'",
                '  AND sol.item = ?',
                '  AND NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl) IN (' + placeholders + ')',
                '  AND ia.inventorynumber IS NOT NULL',
                '  AND so.id = ?',
                soPpp.sql,
                'GROUP BY NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl), ia.inventorynumber, inum.inventorynumber'
            ].join(' ');
            var soAllocatedParams = [numericItemId].concat(ids).concat([numericCurrentSoId]).concat(soPpp.params);
            try {
                soLotRows = runSuiteQLMapped(soAllocatedSql, soAllocatedParams);
                soLotRows.forEach(function (row) {
                    var segId = toId(row.segment_id);
                    var lotId = toId(row.lot_id);
                    if (!segId || !lotId) return;
                    soAllocatedBySegLot[segId + '|' + lotId] = roundQty(toNumber(row.allocated_qty));
                });
                safeLogDebug('MSL PO Allocation Core - Current SO Allocated Rows', {
                    itemId: numericItemId,
                    soId: numericCurrentSoId,
                    rowCount: soLotRows.length,
                    sample: soLotRows.slice(0, 20)
                });
            } catch (eSoAlloc) {
                safeLogError('MSL PO Allocation Core - Current SO Allocated Query Failed', {
                    itemId: numericItemId,
                    soId: numericCurrentSoId,
                    name: eSoAlloc && eSoAlloc.name,
                    message: eSoAlloc && eSoAlloc.message
                });
            }
        }

        // Track which (segment, lot) pairs are produced from the IR/IA query so we can
        // later append SO-only lots without duplicating.
        var emittedSegLotSet = {};

        receivedRows.forEach(function (row) {
            var segId = toId(row.segment_id);
            var lotId = toId(row.lot_id);
            if (!segId || !lotId) return;
            var receivedQty = roundPacks(toNumber(row.received_qty));
            var allocatedQty = roundPacks(toNumber(allocatedBySegLot[segId + '|' + lotId]));
            var soAllocatedQty = roundPacks(toNumber(soAllocatedBySegLot[segId + '|' + lotId]));
            var availQty = roundPacks(receivedQty - allocatedQty);
            if (availQty < 0) availQty = 0;
            // Keep lots the current SO is already allocated to so the UI can render the
            // existing allocation row, even when other-SO allocations consumed the pool.
            if (availQty <= 0 && soAllocatedQty <= 0 && !keepLots[lotId] && !keepZeroLotsForDisplay) return;
            if (!result[segId]) result[segId] = [];
            // Fall back to the lot internal id when the InventoryNumber join didn't
            // resolve a display value — better than rendering a blank lot column.
            var lotNumber = row.lot_number ? String(row.lot_number) : ('Lot ' + lotId);
            var lotMbf = toNumber(row.lot_mbf);
            var txnRatePerMbf = lotMbf > 0 ? toNumber(row.weighted_txn_rate_sum) / lotMbf : 0;
            var usdRatePerMbf = lotMbf > 0 ? toNumber(row.lot_usd_amount) / lotMbf : 0;
            result[segId].push({
                lotId: lotId,
                lotNumber: lotNumber,
                receivedQty: receivedQty,
                allocatedQty: allocatedQty,
                soAllocatedQty: soAllocatedQty,
                availQty: availQty,
                earliestReceipt: row.earliest_receipt || null,
                ppp: toNumber(row.ppp),
                txnRatePerMbf: txnRatePerMbf,
                usdRatePerMbf: usdRatePerMbf
            });
            emittedSegLotSet[segId + '|' + lotId] = true;
        });

        // For lots the SO uses that didn't appear in the segment-bound IR/IA query,
        // look up each lot's actual received qty + earliest receipt from ANY IR/IA on
        // the same item (no segment filter). This handles cases where NetSuite
        // assigned a lot record whose receiving transaction had a different (or null)
        // cseg_po_segment_gl. Result: the appended row shows real received_qty / date
        // instead of 0.
        var soOnlyLotIds = {};
        soLotRows.forEach(function (row) {
            var segId = toId(row.segment_id);
            var lotId = toId(row.lot_id);
            if (!segId || !lotId) return;
            if (emittedSegLotSet[segId + '|' + lotId]) return;
            soOnlyLotIds[lotId] = true;
        });
        var soOnlyLotMeta = {};
        var soOnlyLotIdList = Object.keys(soOnlyLotIds);
        if (soOnlyLotIdList.length) {
            try {
                var lotPlaceholders = soOnlyLotIdList.map(function () { return '?'; }).join(',');
                var lotMetaSql = [
                    'SELECT',
                    '  ia.inventorynumber AS lot_id,',
                    '  SUM(ABS(txl.custcol_mgsl_packqty) * ABS(ia.quantity) / NULLIF(ABS(txl.quantity), 0)) AS received_qty,',
                    '  MIN(tx.trandate) AS earliest_receipt,',
                    '  MAX(txl.custcol_mgsl_ppp) AS ppp,',
                    '  SUM(ABS(ia.quantity)) AS lot_mbf,',
                    '  SUM(ABS(txl.rate) * ABS(ia.quantity) / NULLIF(NVL(tx.exchangerate, 1), 0)) AS weighted_txn_rate_sum,',
                    "  SUM(CASE WHEN tx.type = 'InvAdjst' AND tab.amount IS NOT NULL",
                    '           THEN ABS(tab.amount) * ABS(ia.quantity) / NULLIF(ABS(txl.quantity), 0)',
                    '           ELSE 0 END) AS lot_usd_amount',
                    'FROM TransactionLine txl',
                    'INNER JOIN Transaction tx ON tx.id = txl.transaction',
                    '  INNER JOIN InventoryAssignment ia',
                    '    ON ia.transaction = tx.id',
                    '   AND ia.transactionline = txl.id',
                    '  LEFT JOIN TransactionAccountingLine tab',
                    '    ON tab.transaction = tx.id',
                    '   AND tab.transactionline = txl.id',
                    '   AND tab.accountingbook = 2',
                    "WHERE tx.type IN ('ItemRcpt', 'InvAdjst')",
                    "  AND txl.mainline = 'F'",
                    '  AND txl.item = ?',
                    '  AND ia.inventorynumber IN (' + lotPlaceholders + ')',
                    "  AND (tx.type <> 'InvAdjst' OR txl.quantity > 0)",
                    'GROUP BY ia.inventorynumber'
                ].join(' ');
                var lotMetaParams = [numericItemId].concat(soOnlyLotIdList.map(function (s) { return Number(s); }));
                var lotMetaRows = runSuiteQLMapped(lotMetaSql, lotMetaParams);
                lotMetaRows.forEach(function (mrow) {
                    var lid = toId(mrow.lot_id);
                    if (!lid) return;
                    var metaLotMbf = toNumber(mrow.lot_mbf);
                    soOnlyLotMeta[lid] = {
                        receivedQty: roundQty(toNumber(mrow.received_qty)),
                        earliestReceipt: mrow.earliest_receipt || null,
                        ppp: toNumber(mrow.ppp),
                        txnRatePerMbf: metaLotMbf > 0 ? toNumber(mrow.weighted_txn_rate_sum) / metaLotMbf : 0,
                        usdRatePerMbf: metaLotMbf > 0 ? toNumber(mrow.lot_usd_amount) / metaLotMbf : 0
                    };
                });
                safeLogDebug('MSL PO Allocation Core - SO-Only Lot Meta', {
                    itemId: numericItemId,
                    lotIdsRequested: soOnlyLotIdList,
                    sample: lotMetaRows.slice(0, 20)
                });
            } catch (eLotMeta) {
                safeLogError('MSL PO Allocation Core - SO-Only Lot Meta Failed', {
                    name: eLotMeta && eLotMeta.name,
                    message: eLotMeta && eLotMeta.message
                });
            }
        }

        // Append SO-only lots with the looked-up received qty / receipt date. Lots
        // the SO uses always render as rows regardless of where they were received.
        soLotRows.forEach(function (row) {
            var segId = toId(row.segment_id);
            var lotId = toId(row.lot_id);
            if (!segId || !lotId) return;
            if (emittedSegLotSet[segId + '|' + lotId]) return;
            if (!result[segId]) result[segId] = [];
            var soOnlyLotNumber = row.lot_number ? String(row.lot_number) : ('Lot ' + lotId);
            var soAllocatedQty = roundPacks(toNumber(row.allocated_qty));
            var meta = soOnlyLotMeta[lotId] || {};
            var receivedQty = roundPacks(toNumber(meta.receivedQty));
            // No "available" is computed for SO-only lots: the IR backing them may be
            // under a different segment, so subtracting other-SO allocations from this
            // segment's pool wouldn't be meaningful. Display 0 — the soAllocatedQty
            // and the SO's own row show what's relevant.
            result[segId].push({
                lotId: lotId,
                lotNumber: soOnlyLotNumber,
                receivedQty: receivedQty,
                allocatedQty: 0,
                soAllocatedQty: soAllocatedQty,
                availQty: 0,
                earliestReceipt: meta.earliestReceipt || null,
                ppp: toNumber(meta.ppp),
                txnRatePerMbf: toNumber(meta.txnRatePerMbf),
                usdRatePerMbf: toNumber(meta.usdRatePerMbf),
                soOnly: true
            });
            emittedSegLotSet[segId + '|' + lotId] = true;
        });

        // FIFO sort within each segment: oldest receipt first.
        Object.keys(result).forEach(function (segId) {
            result[segId].sort(function (left, right) {
                var leftDate = parseDateForSort(left.earliestReceipt);
                var rightDate = parseDateForSort(right.earliestReceipt);
                if (leftDate !== rightDate) return leftDate - rightDate;
                return String(left.lotNumber).localeCompare(String(right.lotNumber));
            });
        });

        return result;
    }

    function getPoSegmentsForItem(itemId, currentSoId, locationId, includeSegmentIds, ppp, options) {
        var numericItemId = Number(itemId);
        var numericCurrentSoId = Number(currentSoId) || 0;
        var numericLocationId = Number(locationId) || 0;
        var numericPpp = Number(ppp) || 0;
        var opts = options || {};
        var displayMode = !!opts.displayMode;
        // skipLots: hybrid path uses the trader-screen cache for received-segment
        // lot data, so callers can skip the live lot/posting/IA queries entirely
        // and just use this function for the unreceived branch. The returned
        // received segments will have lots = null and should be discarded by the
        // caller. See plans/for-po-allocation-sbx-transient.
        var skipLots = !!opts.skipLots;
        // PPP filter: when the SO line has a specific pieces-per-pack value, restrict the
        // pool/cost/receipt/allocation queries to PO lines with the same PPP. PO lines on
        // the same segment but different PPPs would otherwise sum together and misrepresent
        // the qty available for this SO line.
        // PPP clause builder: applies PPP filter, but bypasses it for segments in
        // includeSegs (the SO is already allocated to those segments — show them
        // even when the underlying PO/IR line has a different PPP, e.g. when an
        // allocation was made manually or NetSuite assigned across PPPs).
        function pppClauseFor(field, segExpr) {
            if (!numericPpp) return { sql: '', params: [] };
            if (!numericIncludeIds.length) {
                return { sql: '  AND ' + field + ' = ? ', params: [numericPpp] };
            }
            var phs = numericIncludeIds.map(function () { return '?'; }).join(',');
            return {
                sql: '  AND (' + field + ' = ? OR ' + segExpr + ' IN (' + phs + ')) ',
                params: [numericPpp].concat(numericIncludeIds)
            };
        }
        // tx/txl = purchase order OR inventory adjustment (unified source pool).
        // In-transit Transfer Orders are intentionally NOT in this live cache-miss
        // fallback (source types stay PurchOrd/InvAdjst) — the trader-screen cache is
        // the source for in-transit TOs. Received TOs still appear via the ItemRcpt
        // receipt query below (their receipt lines carry the segment).
        var poSegmentExpr = 'NVL(txl.cseg_po_segment_gl, tx.cseg_po_segment_gl)';
        var irSegmentExpr = 'NVL(irl.cseg_po_segment_gl, ir.cseg_po_segment_gl)';
        var soSegmentExpr = 'NVL(sol.cseg_po_segment_gl, so.cseg_po_segment_gl)';

        // Display-only filter: when the caller passes a location (the SO line's location),
        // restrict the source segment pool to lines at the same location. Validation and
        // auto-allocation paths call without location and see the unfiltered pool.
        // includeSegmentIds: when a SO line is already allocated to a segment whose source
        // line is at a different location, we still want to display its source data (otherwise
        // the UI falls back to a blank "SEG <id>" placeholder). Those segments are unioned in.
        var rawIncludeIds = Array.isArray(includeSegmentIds) ? includeSegmentIds : [];
        var numericIncludeIds = [];
        var includeSet = {};
        for (var ii = 0; ii < rawIncludeIds.length; ii++) {
            var nId = Number(rawIncludeIds[ii]);
            if (nId && !isNaN(nId)) {
                numericIncludeIds.push(nId);
                includeSet[String(nId)] = true;
            }
        }
        var rawIncludeLotIds = Array.isArray(opts.includeLotIds) ? opts.includeLotIds : [];
        var includeLotSet = {};
        rawIncludeLotIds.forEach(function (lotId) {
            var nLot = Number(lotId);
            if (nLot && !isNaN(nLot)) includeLotSet[String(nLot)] = true;
        });

        var pppPoBuilt = pppClauseFor('txl.custcol_mgsl_ppp', poSegmentExpr);
        var pppIrBuilt = pppClauseFor('irl.custcol_mgsl_ppp', irSegmentExpr);
        var pppSoBuilt = pppClauseFor('sol.custcol_mgsl_ppp', soSegmentExpr);
        var pppClausePo = pppPoBuilt.sql;
        var pppClauseIr = pppIrBuilt.sql;
        var pppClauseSo = pppSoBuilt.sql;

        var locationClause = '';
        var locationParams = [];
        if (numericLocationId) {
            if (numericIncludeIds.length) {
                var placeholders = numericIncludeIds.map(function () { return '?'; }).join(',');
                locationClause = '  AND (txl.location = ? OR ' + poSegmentExpr + ' IN (' + placeholders + ')) ';
                locationParams.push(numericLocationId);
                numericIncludeIds.forEach(function (id) { locationParams.push(id); });
            } else {
                locationClause = '  AND txl.location = ? ';
                locationParams.push(numericLocationId);
            }
        }

        var poSqlParams = [numericItemId].concat(locationParams).concat(pppPoBuilt.params);

        var poRows = runSuiteQLMapped([
            'SELECT',
            '  ' + poSegmentExpr + ' AS segment_id,',
            '  MAX(tx.type) AS tx_type,',
            '  MAX(tx.id) AS po_id,',
            '  MAX(tx.tranid) AS po_number,',
            "  MAX(CASE WHEN tx.type = 'InvAdjst' THEN BUILTIN.DF(tx.custbody_lot_supplier) ELSE BUILTIN.DF(tx.entity) END) AS supplier,",
            '  SUM(ABS(txl.custcol_mgsl_packqty)) AS po_qty,',
            '  MAX(txl.custcol_mgsl_ppp) AS ppp,',
            '  MAX(BUILTIN.DF(tx.currency)) AS currency,',
            '  MIN(tx.trandate) AS po_date,',
            '  MAX(txl.rate) AS rate_home_currency,',
            "  MIN(CASE WHEN tx.type = 'InvAdjst' THEN tx.custbody4 END) AS ia_lot_creation_date,",
            "  MAX(CASE WHEN tx.type = 'InvAdjst' THEN tx.custbody_lot_currency END) AS ia_lot_currency_id",
            'FROM TransactionLine txl',
            'INNER JOIN Transaction tx ON tx.id = txl.transaction',
            "WHERE tx.type IN ('PurchOrd', 'InvAdjst')",
            "  AND txl.mainline = 'F'",
            '  AND txl.item = ?',
            locationClause,
            pppClausePo,
            '  AND ' + poSegmentExpr + ' IS NOT NULL',
            'GROUP BY ' + poSegmentExpr
        ].join(' '), poSqlParams);

        var candidateSegmentIds = [];
        var candidateSegmentSet = {};
        poRows.forEach(function (poRow) {
            var segId = Number(poRow && poRow.segment_id);
            if (segId && !isNaN(segId) && !candidateSegmentSet[String(segId)]) {
                candidateSegmentSet[String(segId)] = true;
                candidateSegmentIds.push(segId);
            }
        });

        // Diagnostic probe: when poRows is empty, run the same query progressively
        // stripping filters to identify which filter is dropping the row. Helps debug
        // edge cases where a PO is closed / at a different location / has a different
        // PPP than expected.
        if (!poRows.length && DEBUG_AVAILABILITY) {
            try {
                var probeAllSql = [
                    'SELECT',
                    '  tx.id AS tx_id,',
                    '  tx.type AS tx_type,',
                    '  tx.tranid AS tranid,',
                    '  tx.status AS tx_status,',
                    '  txl.id AS txl_id,',
                    '  txl.mainline AS mainline,',
                    '  txl.isclosed AS is_closed,',
                    '  txl.cseg_po_segment_gl AS line_segment,',
                    '  tx.cseg_po_segment_gl AS hdr_segment,',
                    '  txl.location AS line_location,',
                    '  txl.custcol_mgsl_packqty AS pack_qty,',
                    '  txl.custcol_mgsl_ppp AS ppp',
                    'FROM TransactionLine txl',
                    'INNER JOIN Transaction tx ON tx.id = txl.transaction',
                    "WHERE tx.type IN ('PurchOrd', 'InvAdjst')",
                    '  AND txl.item = ?'
                ].join(' ');
                var allRows = runSuiteQLMapped(probeAllSql, [numericItemId]);
                safeLogError('MSL PO Allocation Core - PO Probe (item-only, NO other filters)', {
                    itemId: numericItemId,
                    targetSegments: numericIncludeIds,
                    targetLocation: numericLocationId,
                    targetPpp: numericPpp,
                    rowCount: allRows.length,
                    sample: allRows.slice(0, 20)
                });
            } catch (eProbeAll) {
                safeLogError('MSL PO Allocation Core - PO Probe Failed', {
                    itemId: numericItemId,
                    name: eProbeAll && eProbeAll.name,
                    message: eProbeAll && eProbeAll.message
                });
            }
        }
        if (!candidateSegmentIds.length) return [];
        var candidatePlaceholders = candidateSegmentIds.map(function () { return '?'; }).join(',');

        // Build IA metadata map from the aggregated poRows result. Lot currency
        // and lot_creation_date (custbody4) are pulled inline above via
        // CASE WHEN tx.type = 'InvAdjst'; the CASE returns NULL for PO rows so
        // they don't pollute the aggregate.
        var iaMetaBySegment = {};
        poRows.forEach(function (poRow) {
            if (String(poRow.tx_type || '') !== 'InvAdjst') return;
            var segId = toId(poRow.segment_id);
            if (!segId) return;
            iaMetaBySegment[segId] = {
                iaLotCurrencyId: Number(poRow.ia_lot_currency_id) || 0,
                iaLotCreationDate: poRow.ia_lot_creation_date || null
            };
        });
        safeLogDebug('MSL PO Allocation Core - IA Metadata From PoRows', {
            itemId: itemId,
            iaSegmentCount: Object.keys(iaMetaBySegment).length,
            metadata: iaMetaBySegment
        });

        // Separate cost query: exchange rate + MBF totals for transaction-currency avg cost.
        // Line rate (home currency) from the main query is divided by exchangerate to get
        // the transaction currency rate. quantity provides MBF for mbf_per_pack.
        // Runs independently so a failure here does not break pool data display.
        var costBySegment = {};
        try {
            // Pre-calculate USD/MBF from the secondary USD accounting book:
            // sum(ABS(US book amount)) / sum(ABS(line MBF quantity)) for IA lines.
            // The lot-currency=USD gating is enforced in JS via iaMetaBySegment.
            var costRows = runSuiteQLMapped([
                'SELECT',
                '  ' + poSegmentExpr + ' AS segment_id,',
                '  MAX(NVL(tx.exchangerate, 1)) AS exchange_rate,',
                '  SUM(ABS(txl.quantity)) AS total_mbf,',
                '  SUM(ABS(txl.custcol_mgsl_packqty)) AS total_packs,',
                "  SUM(CASE WHEN tx.type = 'InvAdjst' AND tab.amount IS NOT NULL",
                '           THEN ABS(tab.amount)',
                '           ELSE 0',
                '      END) AS usd_amount_total,',
                "  SUM(CASE WHEN tx.type = 'InvAdjst' AND ABS(txl.quantity) > 0 AND tab.amount IS NOT NULL",
                '           THEN ABS(txl.quantity)',
                '           ELSE 0',
                '      END) AS usd_qty_total',
                'FROM TransactionLine txl',
                'INNER JOIN Transaction tx ON tx.id = txl.transaction',
                '  LEFT JOIN TransactionAccountingLine tab',
                '    ON tab.transaction = tx.id',
                '   AND tab.transactionline = txl.id',
                '   AND tab.accountingbook = 2',
                "WHERE tx.type IN ('PurchOrd', 'InvAdjst')",
                "  AND txl.mainline = 'F'",
                '  AND txl.item = ?',
                pppClausePo,
                '  AND ' + poSegmentExpr + ' IN (' + candidatePlaceholders + ')',
                '  AND ' + poSegmentExpr + ' IS NOT NULL',
                'GROUP BY ' + poSegmentExpr
            ].join(' '), [numericItemId].concat(pppPoBuilt.params).concat(candidateSegmentIds));
            costRows.forEach(function (row) {
                var segId = toId(row.segment_id);
                if (!segId) return;
                costBySegment[segId] = {
                    exchangeRate: toNumber(row.exchange_rate),
                    totalMbf: toNumber(row.total_mbf),
                    totalPacks: toNumber(row.total_packs),
                    usdRatePerMbf: (function () {
                        var usdQtyTotal = toNumber(row.usd_qty_total);
                        if (usdQtyTotal <= 0) return 0;
                        return toNumber(row.usd_amount_total) / usdQtyTotal;
                    })()
                };
            });
        } catch (_eCost) {
            safeLogError('MSL PO Allocation Core - Cost Query Failed', {
                itemId: itemId,
                name: _eCost && _eCost.name,
                message: _eCost && _eCost.message
            });
        }

        var receiptRows = runSuiteQLMapped([
            'SELECT',
            '  ' + irSegmentExpr + ' AS segment_id,',
            '  SUM(ABS(irl.custcol_mgsl_packqty)) AS received_qty,',
            '  MIN(ir.trandate) AS earliest_receipt',
            'FROM TransactionLine irl',
            'INNER JOIN Transaction ir ON ir.id = irl.transaction',
            "WHERE ir.type = 'ItemRcpt'",
            "  AND irl.mainline = 'F'",
            '  AND irl.item = ?',
            pppClauseIr,
            '  AND ' + irSegmentExpr + ' IN (' + candidatePlaceholders + ')',
            '  AND ' + irSegmentExpr + ' IS NOT NULL',
            'GROUP BY ' + irSegmentExpr
        ].join(' '), [numericItemId].concat(pppIrBuilt.params).concat(candidateSegmentIds));

        var allocatedRows = runSuiteQLMapped([
            'SELECT',
            '  ' + soSegmentExpr + ' AS segment_id,',
            '  SUM(ABS(sol.custcol_mgsl_packqty)) AS allocated_qty',
            'FROM TransactionLine sol',
            'INNER JOIN Transaction so ON so.id = sol.transaction',
            "WHERE so.type = 'SalesOrd'",
            "  AND sol.mainline = 'F'",
            // ── B15: A CLOSED LINE THAT NEVER SHIPPED HOLDS NO STOCK ──
            // receivedQty is a LIFETIME figure, so lifetime consumption must stay netted
            // against it: a fully-shipped line's packs really did leave and MUST keep
            // counting. But a line that was CLOSED without ever shipping consumed nothing
            // and never will, yet its custcol_mgsl_packqty stamp survives the close and
            // goes on drawing segment headroom forever. availQty then decays toward zero
            // as an item accumulates history, and once it drops below a real request the
            // segment-level check in Api rejects the save as INSUFFICIENT_AVAILABILITY,
            // which handlePost turns into stale:true — the "Availability has changed /
            // Refresh" banner. Refreshing can never clear it: nothing is stale, the same
            // wrong number is recomputed every time.
            //
            // Measured in production 2026-09-03: 38 lines / 2,018 packs across 24 items
            // and 20 segments carried phantom draw. Item 2289 on segment 1365 (PO 57974)
            // sat at received 70 - allocated 69 = 1 pack against 10 physically on hand
            // (lot R46622-0004, 26.88 MBF / 2.688), blocking a 3-pack request; 9 of those
            // 69 came from ONE closed, never-shipped, never-billed line on SO-CWP-001641
            // that holds no inventory assignment. With this predicate: 69 -> 60, so
            // availQty = 10, matching inventorybalance exactly.
            //
            // Direction is one-way: allocated only ever falls, so availability only ever
            // rises, and only on those 20 segments — 735 of 764 (item,segment) pairs are
            // unchanged. Reopening a line flips isclosed back to 'F' and its packs count
            // again, automatically.
            //
            // NOT applied to the two lot-level sums above (the allocatedSql / soAllocatedSql
            // pair): both INNER JOIN InventoryAssignment, so they already exclude every
            // closed line except one carrying an orphaned assignment row — a single 2-pack
            // line on SO-CWP-001477 (lot 47975), deliberately left to data repair rather
            // than widening this change into the lot-level math.
            "  AND NOT (sol.isclosed = 'T' AND NVL(sol.quantityshiprecv, 0) = 0)",
            '  AND sol.item = ?',
            pppClauseSo,
            '  AND ' + soSegmentExpr + ' IN (' + candidatePlaceholders + ')',
            '  AND ' + soSegmentExpr + ' IS NOT NULL',
            '  AND so.id <> ?',
            'GROUP BY ' + soSegmentExpr
        ].join(' '), [numericItemId].concat(pppSoBuilt.params).concat(candidateSegmentIds).concat([numericCurrentSoId]));

        var receiptBySegment = {};
        receiptRows.forEach(function (row) {
            var segmentId = toId(row.segment_id);
            if (!segmentId) return;
            receiptBySegment[segmentId] = {
                receivedQty: roundPacks(toNumber(row.received_qty)),
                earliestReceipt: row.earliest_receipt || null
            };
        });

        var allocatedBySegment = {};
        allocatedRows.forEach(function (row) {
            var segmentId = toId(row.segment_id);
            if (!segmentId) return;
            allocatedBySegment[segmentId] = roundPacks(toNumber(row.allocated_qty));
        });

        var segments = [];
        poRows.forEach(function (poRow) {
            var segmentId = toId(poRow.segment_id);
            if (!segmentId) return;

            var poQty = roundPacks(toNumber(poRow.po_qty));
            var isInvAdjst = String(poRow.tx_type || '') === 'InvAdjst';
            var iaMeta = iaMetaBySegment[segmentId] || {};
            var iaLotCurrencyId = Number(iaMeta.iaLotCurrencyId) || 0;
            var iaIsUsd = isInvAdjst && iaLotCurrencyId === 2;
            var receipt = receiptBySegment[segmentId] || { receivedQty: 0, earliestReceipt: null };
            // Inventory Adjustments are already on-hand at post time: treat the adjustment
            // quantity as received. Use lot_creation_date (custbody4) when set on the IA,
            // otherwise fall back to the IA's trandate.
            var receivedQty = isInvAdjst ? poQty : roundPacks(toNumber(receipt.receivedQty));
            var earliestReceipt = isInvAdjst
                ? (iaMeta.iaLotCreationDate || poRow.po_date || null)
                : (receipt.earliestReceipt || null);
            if (isInvAdjst) {
                safeLogDebug('MSL PO Allocation Core - IA Segment Date Resolution', {
                    segmentId: segmentId,
                    poNumber: poRow.po_number,
                    iaMetaPresent: !!iaMetaBySegment[segmentId],
                    iaLotCreationDate: iaMeta.iaLotCreationDate,
                    iaLotCreationDateType: typeof iaMeta.iaLotCreationDate,
                    poDate: poRow.po_date,
                    resolvedEarliestReceipt: earliestReceipt,
                    iaLotCurrencyId: iaLotCurrencyId,
                    iaIsUsd: iaIsUsd
                });
            }
            var isReceived = (isInvAdjst && poQty > 0) || receivedQty > 0;
            var allocatedQty = roundPacks(toNumber(allocatedBySegment[segmentId]));
            var availableBaseQty = isReceived ? receivedQty : poQty;
            var availQty = roundPacks(availableBaseQty - allocatedQty);
            // Always keep segments the current SO line is already allocated to so the
            // UI can render the PO number / metadata. Without this, unreceived POs that
            // are over-allocated across multiple SOs (availQty<=0) drop out of the pool
            // and the UI falls back to a "SEG <id>" placeholder.
            if (availQty <= 0 && !includeSet[String(segmentId)] && !(displayMode && isReceived)) return;
            if (availQty < 0) availQty = 0;

            var rateHomeCurrency = toNumber(poRow.rate_home_currency);
            var costData = costBySegment[segmentId];
            var avgCostPerUnit, mbfPerPack;
            if (costData && costData.exchangeRate > 0) {
                // Convert home-currency rate to transaction currency (e.g. CAD → USD)
                avgCostPerUnit = rateHomeCurrency / costData.exchangeRate;
                mbfPerPack = costData.totalPacks > 0 ? costData.totalMbf / costData.totalPacks : 0;
            } else {
                // Cost query unavailable — fall back to home-currency rate, no MBF/pack
                avgCostPerUnit = rateHomeCurrency;
                mbfPerPack = 0;
            }
            // For IAs whose lot is denominated in USD, use the per-line USD/MBF rate
            // from the secondary USD book (TransactionAccountingLine, accountingbook=2
            // in prod / 6 in sandbox — RULES.md §3,
            // amount / line MBF quantity).
            if (iaIsUsd && costData && costData.usdRatePerMbf > 0) {
                avgCostPerUnit = costData.usdRatePerMbf;
            }
            var currencyDisplay = iaIsUsd ? 'US Dollar' : String(poRow.currency || '');
            segments.push({
                segmentId: segmentId,
                txType: String(poRow.tx_type || ''),
                poId: toId(poRow.po_id),
                poNumber: String(poRow.po_number || ''),
                supplier: String(poRow.supplier || ''),
                currency: currencyDisplay,
                poQty: poQty,
                receivedQty: receivedQty,
                allocatedQty: allocatedQty,
                availQty: availQty,
                isReceived: isReceived,
                earliestReceipt: earliestReceipt,
                poDate: poRow.po_date || null,
                avgCostPerUnit: avgCostPerUnit,
                mbfPerPack: mbfPerPack,
                ppp: toNumber(poRow.ppp),
                iaIsUsd: iaIsUsd
            });
        });

        segments.sort(function (left, right) {
            if (left.isReceived !== right.isReceived) {
                return left.isReceived ? -1 : 1;
            }

            var leftDate = parseDateForSort(left.isReceived ? left.earliestReceipt : left.poDate);
            var rightDate = parseDateForSort(right.isReceived ? right.earliestReceipt : right.poDate);
            if (leftDate !== rightDate) return leftDate - rightDate;

            return String(left.poNumber).localeCompare(String(right.poNumber));
        });

        // For each received segment (or any segment in includeSet — i.e. one the
        // current SO is already allocated to), attach per-lot data. Forcing includes
        // through here lets segments with PPP mismatch (SO at one PPP, IR at another)
        // still surface their SO-bound lots via the soLotRows append path inside
        // getLotsForReceivedSegments.
        var receivedSegmentIds = segments.filter(function (s) {
            return !!s.isReceived || includeSet[String(s.segmentId)];
        }).map(function (s) { return s.segmentId; });
        if (receivedSegmentIds.length && !skipLots) {
            var lotsBySegment = getLotsForReceivedSegments(
                numericItemId,
                numericCurrentSoId,
                receivedSegmentIds,
                numericPpp,
                includeLotSet,
                numericIncludeIds,
                { displayMode: displayMode }
            );
            segments.forEach(function (seg) {
                var isIncluded = !!includeSet[String(seg.segmentId)];
                if (!seg.isReceived && !isIncluded) {
                    seg.lots = null;
                    return;
                }
                var lots = lotsBySegment[seg.segmentId] || [];
                // Per-lot cost: pick USD-book or transaction-currency rate based on the
                // segment-level USD flag (one IA per segment, so the flag applies to all
                // lots in that segment). Fall back to segment avg when the lot query
                // didn't produce a rate (lot received outside any priced source).
                lots.forEach(function (lot) {
                    var perLotRate = seg.iaIsUsd
                        ? toNumber(lot.usdRatePerMbf)
                        : toNumber(lot.txnRatePerMbf);
                    lot.avgCostPerUnit = perLotRate > 0 ? perLotRate : seg.avgCostPerUnit;
                    lot.mbfPerPack = seg.mbfPerPack;
                    lot.currency = seg.currency;
                    if (!lot.ppp) lot.ppp = seg.ppp;
                });
                seg.lots = lots;
                // If we got lots back via the SO-bound append (segment was in includes
                // but not naturally "received" because of PPP mismatch), mark received
                // for display so the UI treats it as a real row rather than the
                // "Not received" placeholder.
                if (!seg.isReceived && isIncluded && lots.length) {
                    seg.isReceived = true;
                }
            });
        }

        safeLogDebug('MSL PO Allocation Core - FIFO Sort Result', {
            itemId: itemId,
            segmentCount: segments.length,
            order: segments.map(function (s) {
                return {
                    poNumber: s.poNumber,
                    segmentId: s.segmentId,
                    isReceived: s.isReceived,
                    earliestReceipt: s.earliestReceipt,
                    poDate: s.poDate,
                    sortKey: parseDateForSort(s.isReceived ? s.earliestReceipt : s.poDate)
                };
            })
        });

        return segments;
    }

    function collectLotIdsFromSegments(lotIdMap, segments) {
        var map = lotIdMap || {};
        (Array.isArray(segments) ? segments : []).forEach(function (seg) {
            (Array.isArray(seg && seg.lots) ? seg.lots : []).forEach(function (lot) {
                var lotId = toId(lot && lot.lotId);
                if (lotId) map[lotId] = true;
            });
        });
        return map;
    }

    function cloneSegmentsForUi(segments) {
        return (Array.isArray(segments) ? segments : []).map(function (seg) {
            var copy = {};
            Object.keys(seg || {}).forEach(function (key) {
                copy[key] = seg[key];
            });
            if (Array.isArray(seg && seg.lots)) {
                copy.lots = seg.lots.map(function (lot) {
                    var lotCopy = {};
                    Object.keys(lot || {}).forEach(function (lotKey) {
                        lotCopy[lotKey] = lot[lotKey];
                    });
                    return lotCopy;
                });
            }
            return copy;
        });
    }

    // Per-lot MBF-per-pack, taken from the lot's OWN additive receipt line as a quotient of
    // two STORED values: ABS(quantity) / ABS(custcol_mgsl_packqty).
    //
    // Never reconstruct this from ppp * volpcfbm / 1000. That expression is what fix A1 was
    // written to remove from the guard, and re-deriving it here (B6 v1) reintroduced the same
    // class of defect: it rounds half-up while the receipt writer truncated, so on a tie factor
    // the divisor came out 1e-5 high and a full-lot request was refused. Worked example,
    // prod lot 46950 (ppp 76, volpcfbm 3.46875, f = 0.263625 exactly): stored 0.26362,
    // reconstructed 0.26363, availPacks 0.999962 — a 1-pack lot became unpickable.
    //
    // Lots whose receipts disagree on the factor (different pack sizes across lines) are
    // OMITTED rather than guessed at; the caller then falls back to the MBF comparison.
    // Measured 2026-08-28: 18 such lots account-wide, 4 of them still holding stock.
    function fetchLotStorageFactors(requestMap) {
        var output = {};
        var pairs = requestMap || {};

        Object.keys(pairs).forEach(function (pairKey) {
            var entry = pairs[pairKey] || {};
            var itemId = Number(entry.itemId) || 0;
            var lotIds = Object.keys(entry.lotIds || {}).map(function (id) {
                return Number(id);
            }).filter(function (id) {
                return id && !isNaN(id);
            });
            var byLotId = {};

            if (!itemId || !lotIds.length) {
                output[pairKey] = byLotId;
                return;
            }

            try {
                chunkValues(lotIds, 900).forEach(function (chunk) {
                    if (!chunk.length) return;
                    var placeholders = chunk.map(function () { return '?'; }).join(',');
                    var rows = runSuiteQLMapped([
                        'SELECT',
                        '  ia.inventorynumber AS lot_id,',
                        '  COUNT(DISTINCT ROUND(ABS(txl.quantity)',
                        '      / NULLIF(ABS(txl.custcol_mgsl_packqty), 0), 6)) AS factor_variants,',
                        '  MIN(ROUND(ABS(txl.quantity)',
                        '      / NULLIF(ABS(txl.custcol_mgsl_packqty), 0), 6)) AS storage_factor,',
                        '  MIN(ABS(txl.quantity)) AS line_mbf,',
                        '  MIN(ABS(txl.custcol_mgsl_packqty)) AS line_packs,',
                        '  MIN(txl.custcol_mgsl_ppp) AS line_ppp,',
                        '  MIN(txl.custcol_mgsl_volpcfbm) AS line_volpcfbm',
                        'FROM InventoryAssignment ia',
                        '  INNER JOIN Transaction tx ON tx.id = ia.transaction',
                        '  INNER JOIN TransactionLine txl',
                        '    ON txl.transaction = ia.transaction',
                        '   AND txl.id = ia.transactionline',
                        'WHERE ia.quantity > 0',
                        "  AND tx.type IN ('ItemRcpt', 'InvAdjst')",
                        "  AND txl.mainline = 'F'",
                        '  AND txl.item = ?',
                        '  AND ia.inventorynumber IN (' + placeholders + ')',
                        '  AND ABS(txl.custcol_mgsl_packqty) > 0',
                        '  AND ABS(txl.quantity) > 0',
                        'GROUP BY ia.inventorynumber'
                    ].join(' '), [itemId].concat(chunk));
                    rows.forEach(function (row) {
                        var lotId = toId(row && row.lot_id);
                        if (!lotId) return;
                        // More than one distinct factor => the lot was receipted at differing
                        // pack sizes. Omit it; the guard falls back to the MBF comparison.
                        if (toNumber(row.factor_variants) !== 1) return;
                        var factor = toNumber(row.storage_factor);
                        if (!(factor > 0)) return;

                        // CONSISTENCY CHECK, not a source. factor_variants === 1 only proves the
                        // receipt lines agree with EACH OTHER; a single line is trivially
                        // self-consistent and can still carry a corrupt packqty. Lot 27417
                        // (IA-CWP-161) stores 222.72 MBF against packqty 86 -> 2.589767, while
                        // the item factor is 2.56 and 222.72 / 2.56 = 87.0 exactly: the packqty
                        // is off by one and 45 draws on that lot all run at 2.56.
                        //
                        // Divide the stored MBF by the ITEM-level factor and require it to land
                        // back on the stored integer packqty. This detects the actual corruption
                        // mode (a wrong pack count) instead of guessing a tolerance on the
                        // factor: measured over 9,122 lots it accepts 9,119 (99.97%) and rejects
                        // exactly the 3 whose pack count cannot be reconstructed. The rejected
                        // lots fall through to the legacy MBF comparison — production's current
                        // behaviour, a safe degrade.
                        //
                        // ppp * volpcfbm / 1000 is used ONLY to validate here. It must never
                        // become the divisor: that is the A1 defect and B6 v1 repeated it.
                        var chkPpp = toNumber(row.line_ppp);
                        var chkVolp = toNumber(row.line_volpcfbm);
                        var chkMbf = toNumber(row.line_mbf);
                        var chkPacks = toNumber(row.line_packs);
                        if (chkPpp > 0 && chkVolp > 0 && chkMbf > 0 && chkPacks > 0) {
                            var itemFactor = roundQty(chkPpp * chkVolp / 1000);
                            if (itemFactor > 0) {
                                var impliedPacks = chkMbf / itemFactor;
                                if (Math.abs(impliedPacks - Math.round(impliedPacks)) < 0.01
                                    && Math.round(impliedPacks) !== Math.round(chkPacks)) {
                                    safeLogAudit('PO Allocation guard - lot factor rejected (packqty inconsistent)', {
                                        lotId: lotId,
                                        storedPackQty: chkPacks,
                                        impliedPackQty: Math.round(impliedPacks),
                                        storedFactor: factor,
                                        itemFactor: itemFactor
                                    });
                                    return;
                                }
                            }
                        }

                        byLotId[lotId] = factor;
                    });
                });
            } catch (eFactor) {
                // Degrade to the MBF comparison rather than block the save. Same posture as
                // fetchLiveLotBalancesByPair below.
                safeLogAudit('PO Allocation guard - lot storage factor query failed', {
                    pairKey: pairKey,
                    itemId: itemId,
                    lotCount: lotIds.length,
                    name: eFactor && eFactor.name,
                    message: eFactor && eFactor.message
                });
            }

            output[pairKey] = byLotId;
        });

        return output;
    }

    function fetchLiveLotBalancesByPair(requestMap) {
        var output = {};
        var pairs = requestMap || {};

        Object.keys(pairs).forEach(function (pairKey) {
            var entry = pairs[pairKey] || {};
            var itemId = Number(entry.itemId) || 0;
            var locationId = Number(entry.locationId) || 0;
            var lotIds = Object.keys(entry.lotIds || {}).map(function (id) {
                return Number(id);
            }).filter(function (id) {
                return id && !isNaN(id);
            });
            var liveByLotId = {};

            if (!itemId || !locationId || !lotIds.length) {
                output[pairKey] = liveByLotId;
                return;
            }

            try {
                chunkValues(lotIds, 900).forEach(function (chunk) {
                    if (!chunk.length) return;
                    var placeholders = chunk.map(function () { return '?'; }).join(',');
                    var rows = runSuiteQLMapped([
                        'SELECT',
                        '  ib.inventorynumber AS lot_id,',
                        '  MAX(inum.inventorynumber) AS lot_number,',
                        '  SUM(NVL(ib.quantityavailable, 0)) AS quantity_available,',
                        '  SUM(NVL(ib.quantityonhand, 0)) AS quantity_on_hand',
                        'FROM InventoryBalance ib',
                        '  LEFT JOIN InventoryNumber inum',
                        '    ON inum.id = ib.inventorynumber',
                        'WHERE ib.item = ?',
                        '  AND ib.location = ?',
                        '  AND ib.inventorynumber IN (' + placeholders + ')',
                        'GROUP BY ib.inventorynumber'
                    ].join(' '), [itemId, locationId].concat(chunk));
                    rows.forEach(function (row) {
                        var lotId = toId(row && row.lot_id);
                        if (!lotId) return;
                        liveByLotId[lotId] = {
                            lotNumber: String(row.lot_number || ''),
                            quantityAvailable: roundQty(row.quantity_available),
                            quantityOnHand: roundQty(row.quantity_on_hand)
                        };
                    });
                });
            } catch (e) {
                safeLogError('MSL PO Allocation Core - Live Lot Balance SuiteQL Failed', {
                    pairKey: pairKey,
                    itemId: itemId,
                    locationId: locationId,
                    lotCount: lotIds.length,
                    name: e && e.name,
                    message: e && e.message
                });
            }

            output[pairKey] = liveByLotId;
        });

        return output;
    }

    function applyLiveLotAvailabilityToSegments(segments, liveByLotId) {
        var liveMap = liveByLotId || {};
        (Array.isArray(segments) ? segments : []).forEach(function (seg) {
            var lots = Array.isArray(seg && seg.lots) ? seg.lots : [];
            var hasLiveReplacement = false;
            lots.forEach(function (lot) {
                var lotId = toId(lot && lot.lotId);
                if (!lotId) return;
                if (!Object.prototype.hasOwnProperty.call(liveMap, lotId)) {
                    lot.calcAvailQty = roundPacks(toNumber(lot.availQty));
                    lot.liveAvailMbf = 0;
                    lot.liveOnHandMbf = 0;
                    lot.availQty = 0;
                    hasLiveReplacement = true;
                    return;
                }
                var live = liveMap[lotId] || {};
                var mbfPerPack = roundQty(toNumber((lot && lot.mbfPerPack) || (seg && seg.mbfPerPack)));
                if (mbfPerPack <= 0) return;

                var liveAvailPacks = roundPacks(toNumber(live.quantityAvailable) / mbfPerPack);
                if (liveAvailPacks < 0) liveAvailPacks = 0;
                lot.calcAvailQty = roundPacks(toNumber(lot.availQty));
                lot.liveAvailMbf = roundQty(toNumber(live.quantityAvailable));
                lot.liveOnHandMbf = roundQty(toNumber(live.quantityOnHand));
                var liveLotNumber = String(live.lotNumber || '');
                var currentLotNumber = String(lot.lotNumber || '');
                if (liveLotNumber && (!currentLotNumber || /^Lot\s+\d+$/i.test(currentLotNumber))) {
                    lot.lotNumber = liveLotNumber;
                }
                lot.availQty = liveAvailPacks;
                hasLiveReplacement = true;
            });
            if (hasLiveReplacement) {
                var segmentAvail = 0;
                lots.forEach(function (lot) {
                    segmentAvail = roundPacks(segmentAvail + roundPacks(toNumber(lot && lot.availQty)));
                });
                seg.availQty = segmentAvail;
            }
        });
    }

    function buildLineAvailabilitySets(line) {
        var includeSegs = [];
        var includeLots = [];
        var includeSegSet = {};
        var includeLotSet = {};
        var allocKeySet = {};

        function addSegment(segId) {
            var sid = toId(segId);
            if (!sid || Object.prototype.hasOwnProperty.call(includeSegSet, sid)) return;
            includeSegSet[sid] = true;
            includeSegs.push(sid);
        }
        function addLot(lotId) {
            var lid = toId(lotId);
            if (!lid || Object.prototype.hasOwnProperty.call(includeLotSet, lid)) return;
            includeLotSet[lid] = true;
            includeLots.push(lid);
        }

        addSegment(line && (
            line.existingSegmentId ||
            line.segmentId ||
            line.segment_id ||
            line.cseg_po_segment_gl
        ));
        (Array.isArray(line && line.allocations) ? line.allocations : []).forEach(function (a) {
            var segId = toId(a && (a.segmentId || a.segment || a.cseg_po_segment_gl));
            var lotId = toId(a && (a.lotId || a.lot_id || a.inventorynumber));
            var qty = roundPacks(toNumber(a && (a.qty || a.quantity || a.packs)));
            if (segId) addSegment(segId);
            if (lotId) addLot(lotId);
            if (segId && qty > 0) {
                allocKeySet[String(segId) + '|' + String(lotId || '')] = true;
                if (!lotId) allocKeySet[String(segId) + '|'] = true;
            }
        });

        return {
            includeSegs: includeSegs,
            includeLots: includeLots,
            includeSegSet: includeSegSet,
            includeLotSet: includeLotSet,
            allocKeySet: allocKeySet
        };
    }

    function filterSegmentsForDisplayLine(segments, line, sets) {
        var pool = Array.isArray(segments) ? segments : [];
        var linePpp = Number(line && (line.ppp || line.custcol_mgsl_ppp)) || 0;
        var includeSegSet = (sets && sets.includeSegSet) || {};
        var includeLotSet = (sets && sets.includeLotSet) || {};
        var allocKeySet = (sets && sets.allocKeySet) || {};
        var keptSegments = [];

        pool.forEach(function (seg) {
            var segId = toId(seg && seg.segmentId);
            if (!segId) {
                keptSegments.push(seg);
                return;
            }

            var lineIncludesSegment = Object.prototype.hasOwnProperty.call(includeSegSet, segId);
            if (!(seg && seg.isReceived)) {
                var segPpp = Number(seg && seg.ppp) || 0;
                if (linePpp > 0 && segPpp > 0 && segPpp !== linePpp && !lineIncludesSegment) return;
                // In-transit rows carry availQty=0 by design (not physically on hand);
                // keep them so the UI can render the in-transit line. PPP already matched.
                if (seg && seg.isInTransit === true) {
                    keptSegments.push(seg);
                    return;
                }
                if (roundPacks(toNumber(seg && seg.availQty)) > 0 || lineIncludesSegment) {
                    keptSegments.push(seg);
                }
                return;
            }

            var lots = Array.isArray(seg && seg.lots) ? seg.lots : [];
            if (!lots.length) {
                if (lineIncludesSegment) keptSegments.push(seg);
                return;
            }

            var keptLots = lots.filter(function (lot) {
                var lotId = toId(lot && lot.lotId);
                var lotAvail = roundPacks(toNumber(lot && lot.availQty));
                var currentSoQty = roundPacks(toNumber(lot && lot.soAllocatedQty));
                var keyWithId = String(segId) + '|' + String(lotId || '');
                var rowPpp = Number((lot && lot.ppp) || (seg && seg.ppp)) || 0;
                var pppMismatch = linePpp > 0 && rowPpp > 0 && rowPpp !== linePpp;
                var exactLineLot = lotId && Object.prototype.hasOwnProperty.call(includeLotSet, lotId);
                var exactLineAlloc = Object.prototype.hasOwnProperty.call(allocKeySet, keyWithId);

                if (pppMismatch && !exactLineLot && !exactLineAlloc) return false;
                if (exactLineLot || exactLineAlloc) return true;
                if (currentSoQty > 0 && !pppMismatch) return true;
                return lotAvail > 0;
            });

            if (keptLots.length) {
                seg.lots = keptLots;
                var segAvail = 0;
                keptLots.forEach(function (lot) {
                    segAvail = roundPacks(segAvail + roundPacks(toNumber(lot && lot.availQty)));
                });
                seg.availQty = segAvail;
                keptSegments.push(seg);
            } else if (lineIncludesSegment) {
                seg.lots = [];
                seg.availQty = 0;
                keptSegments.push(seg);
            }
        });

        pool.length = 0;
        keptSegments.forEach(function (seg) { pool.push(seg); });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  buildTraderGroupNets — trader-exact group net for DISPLAY. Exact port of
    //  MSL_MR_POAllocUnreceivedReconcile buildPOGroupsPort's grouping/netting:
    //  same groupKey(po,ppp) with NO_PO/DASH handling; onHand grouped by
    //  (poNumber||docNumber); onOrder/inTransit by docNumber; committed/outbound by
    //  allocatedPO (skip empty/'—'); Math.abs on committed; round2 (NOT floored).
    //  Returns key -> { po, ppp, netAvailable, onHandSum, onOrderSum, inTransitSum,
    //  committedTotal }. DISPLAY-only — does not touch seg.availQty or lot.availQty.
    // ═══════════════════════════════════════════════════════════════════════════
    function buildTraderGroupNets(detail) {
        var onHand    = Array.isArray(detail && detail.onHand)    ? detail.onHand    : [];
        var committed = Array.isArray(detail && detail.committed) ? detail.committed : [];
        var onOrder   = Array.isArray(detail && detail.onOrder)   ? detail.onOrder   : [];
        var inTransit = Array.isArray(detail && detail.inTransit) ? detail.inTransit : [];
        var outbound  = Array.isArray(detail && detail.outbound)  ? detail.outbound  : [];

        var poMap = {};
        function getOrCreate(po, ppp) {
            var key = traderGroupKey(po, ppp);
            if (!poMap[key]) {
                poMap[key] = { po: groupStr(po) || GROUP_NO_PO, ppp: groupNum(ppp), supplyRows: [], committedRows: [] };
            }
            return poMap[key];
        }

        // On Hand -> group by (poNumber || docNumber, piecesPerPack)
        onHand.forEach(function (r) {
            var rawPo = groupStr(r.poNumber);
            var po = (rawPo && rawPo !== GROUP_DASH) ? rawPo : groupStr(r.docNumber);
            var g = getOrCreate(po, r.piecesPerPack);
            g.supplyRows.push({ rowType: 'onHand', packsAvail: groupNum(r.packsOnHand) });
        });
        // On Order -> group by (docNumber, piecesPerPack)
        onOrder.forEach(function (r) {
            var g = getOrCreate(groupStr(r.docNumber), r.piecesPerPack);
            g.supplyRows.push({ rowType: 'onOrder', packsAvail: groupNum(r.packs) });
        });
        // In Transit -> group by (docNumber, piecesPerPack)
        inTransit.forEach(function (r) {
            var g = getOrCreate(groupStr(r.docNumber), r.piecesPerPack);
            g.supplyRows.push({ rowType: 'inTransit', packsAvail: groupNum(r.packs) });
        });
        // Outbound -> group by (allocatedPO, piecesPerPack); skip dash/empty allocatedPO
        outbound.forEach(function (r) {
            var po = groupStr(r.allocatedPO);
            if (!po || po === GROUP_DASH) return;
            var g = getOrCreate(po, r.piecesPerPack);
            g.committedRows.push({ rowType: 'committed', packsAvail: -groupNum(r.packs) });
        });
        // Committed -> group by (allocatedPO, piecesPerPack); skip dash/empty allocatedPO
        committed.forEach(function (r) {
            var po = groupStr(r.allocatedPO);
            if (!po || po === GROUP_DASH) return;
            var g = getOrCreate(po, r.piecesPerPack);
            g.committedRows.push({ rowType: 'committed', packsAvail: -groupNum(r.packsCommitted) });
        });

        var byKey = {};
        Object.keys(poMap).forEach(function (key) {
            var g = poMap[key];
            if (!g.supplyRows.length && !g.committedRows.length) return;
            var supplyTotal = g.supplyRows.reduce(function (s, r) { return s + r.packsAvail; }, 0);
            var committedTotal = g.committedRows.reduce(function (s, r) { return s + Math.abs(r.packsAvail); }, 0);
            var onHandSum = 0, onOrderSum = 0, inTransitSum = 0;
            g.supplyRows.forEach(function (r) {
                if (r.rowType === 'onHand') onHandSum += r.packsAvail;
                else if (r.rowType === 'onOrder') onOrderSum += r.packsAvail;
                else if (r.rowType === 'inTransit') inTransitSum += r.packsAvail;
            });
            byKey[key] = {
                po: g.po === GROUP_NO_PO ? '' : g.po,
                ppp: g.ppp,
                netAvailable: round2(supplyTotal - committedTotal),
                onHandSum: round2(onHandSum),
                onOrderSum: round2(onOrderSum),
                inTransitSum: round2(inTransitSum),
                committedTotal: round2(committedTotal),
                // AvailableTabMTL formats Packs with Math.round.  Preserve the
                // raw round2 figures above for state/negative checks, but publish
                // Trader-exact whole-pack display values for this consumer.
                availablePacks: Math.round(round2(supplyTotal - committedTotal)),
                resShippedPacks: Math.round(round2(committedTotal)),
                availableText: formatTraderPacks(round2(supplyTotal - committedTotal)),
                resShippedText: formatTraderPacks(round2(committedTotal))
            };
        });
        return byKey;
    }

    // Display projection is independent from the source of the allocatable rows.
    // A cache entry can be valid for Trader totals even when it cannot safely build
    // PO Allocation lot rows (for example, an assigned lot is absent from onHand).
    // Stamp only when the matching cached (PO, PPP) group exists; operational
    // availQty / lot.availQty values are deliberately left untouched.
    function stampTraderGroupDisplay(segments, groupNets) {
        (Array.isArray(segments) ? segments : []).forEach(function (seg) {
            if (!seg) return;
            var key = traderGroupKey(seg.poNumber, seg.ppp);
            var group = groupNets && groupNets[key];
            if (!group) return;

            seg.displayGroupKey = key;
            seg.groupKey = key;
            seg.groupNetAvail = group.netAvailable;
            seg.availablePacks = group.availablePacks;
            seg.resShippedPacks = group.resShippedPacks;
            seg.availableText = group.availableText;
            seg.resShippedText = group.resShippedText;

            (Array.isArray(seg.lots) ? seg.lots : []).forEach(function (lot) {
                if (!lot) return;
                lot.groupKey = key;
                lot.availablePacks = group.availablePacks;
                lot.resShippedPacks = group.resShippedPacks;
                lot.availableText = group.availableText;
                lot.resShippedText = group.resShippedText;
            });
        });
    }

    function getTraderDisplayProjection(itemId, locationId, subsidiaryId) {
        if (!itemId || !locationId || !subsidiaryId) return null;
        try {
            var cached = TraderCacheView.getReceivedDetailByItemLocation(subsidiaryId, itemId, locationId);
            if (!cached) return null;
            return {
                groupNets: buildTraderGroupNets(cached),
                lastUpdated: cached.lastUpdated || '',
                cacheVersion: cached.cacheVersion || 0
            };
        } catch (e) {
            safeLogError('MSL PO Allocation - trader display projection read failed', {
                itemId: itemId,
                locationId: locationId,
                message: e && e.message
            });
            return null;
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    //  validateAllocationAvailability — shared save guard. Cross-checks each
    //  requested per-lot allocation against the LIVE InventoryBalance so a save
    //  can't over-commit a lot that has been physically depleted since the screen
    //  was rendered. priorPacksThisSo is the SO's own existing commit on the lot
    //  (headroom it is entitled to reclaim). Returns errors[]; empty = OK to save.
    // ═══════════════════════════════════════════════════════════════════════════
    function validateAllocationAvailability(soId, requests) {
        var errors = [];
        var list = Array.isArray(requests) ? requests : [];
        // Which arithmetic actually judged each request. Reported once at the end.
        var guardBranchCounts = { packSpace: 0, legacyMbf: 0 };

        // Group by item|location so fetchLiveLotBalancesByPair issues one balance
        // query per (item, location) covering all requested lots.
        var requestMap = {};
        list.forEach(function (req) {
            if (!req) return;
            var itemId = toId(req.itemId);
            var locationId = toId(req.locationId);
            var lotId = toId(req.lotId);
            // IDENTITY ONLY. mbfPerPack was part of this gate, which dropped the request
            // from the balance query as well as from evaluation — and after B2/B3 and B6
            // the comparison does not consult mbfPerPack on the primary path at all.
            // Identity is genuinely required (without item+location+lot there is no
            // balance to fetch), so it stays — but it is now logged instead of silent.
            if (!itemId || !locationId || !lotId) {
                safeLogAudit('PO Allocation guard - request skipped (incomplete identity)', {
                    itemId: req.itemId,
                    locationId: req.locationId,
                    lotId: req.lotId,
                    segmentId: req.segmentId,
                    requestedPacks: req.requestedPacks
                });
                return;
            }
            var pairKey = itemId + '|' + locationId;
            if (!requestMap[pairKey]) {
                requestMap[pairKey] = { itemId: itemId, locationId: locationId, lotIds: {} };
            }
            requestMap[pairKey].lotIds[lotId] = true;
        });

        var live = fetchLiveLotBalancesByPair(requestMap);
        var storageFactors = fetchLotStorageFactors(requestMap);

        list.forEach(function (req) {
            if (!req) return;
            var lotId = toId(req.lotId);
            var mbfPerPack = toNumber(req.mbfPerPack);
            var itemId = toId(req.itemId);
            var locationId = toId(req.locationId);
            var pairKey = itemId + '|' + locationId;

            // ── B8: GATE ON THE DEMAND, NOT ON A FACTOR THE COMPARISON NO LONGER USES ──
            // This gate used to read  if (!lotId || mbfPerPack <= 0) return;  which meant a
            // request the guard could not scale was DROPPED, contributing no error, so both
            // callers (UE throws only when errors.length, Api fails only when
            // liveErrors.length) treated the save as validated. The guard failed OPEN, and
            // there was no logging anywhere in this function to show it had happened.
            //
            // Measured population in prod 2026-08-28: ZERO. 0 of 11,573 SO Assembly lines
            // can produce mbfPerPack <= 0 (min factor 0.0147048, min ppp 5, min volpcfbm
            // 0.1071, no nulls); 0 of 2,288 segment-carrying lines of any itemtype; 0 of
            // 1,861 lot assignments. The register's "262 lines, all status-H" was a
            // transplant from fix A1's quantity==0 population and does not describe this
            // condition. So this change is a fail-safe on a hot path, not a live repair.
            //
            // Three outcomes now, none silent:
            //   identity missing              -> audit + skip (nothing to look up)
            //   demand is genuinely ZERO      -> audit + skip (nothing committed, so
            //                                    nothing can be over-committed)
            //   demand > 0 but unevaluable    -> FAIL CLOSED with GUARD_UNEVALUABLE
            if (!lotId) {
                safeLogAudit('PO Allocation guard - evaluation skipped (no lotId)', {
                    itemId: req.itemId, locationId: req.locationId, segmentId: req.segmentId
                });
                return;
            }

            var reqPacksRaw = toNumber(req.requestedPacks);
            // The lot's own stored per-pack factor, derived above. Absent => ambiguous lot or a
            // failed query => fall back to the MBF comparison (production's behaviour).
            var lotFactor = toNumber((storageFactors[pairKey] || {})[String(lotId)]);
            var hasLotFactor = lotFactor > 0;
            var hasExactMbf = req.requestedMbf !== null && req.requestedMbf !== undefined && req.requestedMbf !== '';
            // Can the demand be expressed at all? Pack space needs only the lot factor; the
            // MBF path needs either an exact figure or a usable per-pack factor.
            var demandEvaluable = hasLotFactor || hasExactMbf || mbfPerPack > 0;
            // Zero demand is checked on the EXACT figure first when one was supplied, so the
            // H6 population (262 prod lines with quantity == 0 and packqty > 0, which commit
            // 0 MBF) is still recognised as committing nothing even in pack space.
            var demandIsZero = hasExactMbf
                ? roundQty(toNumber(req.requestedMbf)) <= 0 && reqPacksRaw <= 0
                : (hasLotFactor
                    ? reqPacksRaw <= 0
                    : (mbfPerPack > 0 ? roundQty(reqPacksRaw * mbfPerPack) <= 0 : reqPacksRaw <= 0));

            if (demandIsZero) {
                safeLogAudit('PO Allocation guard - evaluation skipped (zero demand)', {
                    itemId: itemId, locationId: locationId, lotId: lotId,
                    segmentId: toId(req.segmentId), requestedPacks: reqPacksRaw
                });
                return;
            }
            if (!demandEvaluable) {
                safeLogAudit('PO Allocation guard - FAILED CLOSED (demand not evaluable)', {
                    itemId: itemId, locationId: locationId, lotId: lotId,
                    segmentId: toId(req.segmentId), requestedPacks: reqPacksRaw,
                    mbfPerPack: req.mbfPerPack, lotFactor: lotFactor,
                    requestedMbf: req.requestedMbf
                });
                errors.push({
                    code: 'GUARD_UNEVALUABLE',
                    itemId: itemId,
                    segmentId: toId(req.segmentId),
                    lotId: lotId,
                    requested: reqPacksRaw,
                    available: null,
                    message: 'Lot ' + lotId + ' could not be availability-checked (no usable pack size on the line). '
                        + 'The save was refused rather than committed unverified — check the line\'s PPP and MBF/piece.'
                });
                return;
            }

            var requestedPacks = toNumber(req.requestedPacks);
            // A caller that knows EXACTLY how much MBF the save will commit passes it
            // as requestedMbf, and the reclaimable headroom as priorMbfThisSo, so the
            // guard and the writer agree bit-for-bit. Rebuilding either from a rounded
            // per-pack factor is NOT equivalent: measured 2026-08-28 across 18,675 real
            // (ppp, volpcfbm, packs) points from prod, roundQty(packs * roundQty(ppp *
            // volpcfbm / 1000)) diverges from the writer's roundQty(packs * ppp *
            // volpcfbm / 1000) on 10,271 of them by up to 4e-5 MBF -- 40x QTY_EPSILON --
            // and always in the OVER-stating direction, which is precisely what produces
            // a false "physically depleted" rejection. The packs*factor forms below are
            // kept for legacy callers that pass no override.
            // PRESENCE, not positivity. A supplied ZERO is meaningful: the 262 prod SO
            // lines carrying quantity == 0 with packqty > 0 legitimately commit 0 MBF, and
            // testing `> 0` sent them down the packs*mbfPerPack path where A1's fallback
            // factor is POSITIVE — the guard then checked a draw the writer never makes,
            // producing a false "physically depleted" rejection on exactly the population
            // A1 exists to protect. Measured 2026-08-28: 262 such lines in prod, 3 of them
            // still isclosed=F and therefore editable.
            var hasReqMbf = req.requestedMbf !== null && req.requestedMbf !== undefined && req.requestedMbf !== '';
            var requestedMbf = hasReqMbf
                ? roundQty(toNumber(req.requestedMbf))
                : roundQty(requestedPacks * mbfPerPack);
            var liveMbf = toNumber(((live[pairKey] && live[pairKey][String(lotId)]) || {}).quantityAvailable);
            var hasPriorMbf = req.priorMbfThisSo !== null && req.priorMbfThisSo !== undefined && req.priorMbfThisSo !== '';
            var priorMbf = hasPriorMbf
                ? roundQty(toNumber(req.priorMbfThisSo))
                : roundQty(toNumber(req.priorPacksThisSo) * mbfPerPack);
            // B-2: credit back only what NetSuite ACTUALLY subtracted from the available
            // figure for this SO. quantityavailable is GROSS on hand in this account —
            // measured 2026-08-29: quantityavailable == quantityonhand on all 1,550 prod
            // InventoryBalance rows, and lot 48890 reports committedqtyperseriallotnumber = 0
            // while two OPEN sales orders each hold -25.536 against it. So a lot's own
            // commitment was never removed from liveMbf, and adding priorMbf on top is pure
            // inflation, not reclamation: it permitted up to 3x the physical stock on 133
            // (SO, lot) pairs across 85 open orders, 1,944 MBF in total.
            //
            // Production is immune to this only by accident (its getThisSoCommittedLotBalance
            // query selects the invalid tl.line and returns {}, so the credit is always 0).
            // The tl.id repair in this stack activates it, so the cap must land with it.
            //
            // The cap is self-correcting rather than a flat removal: where NetSuite DOES net
            // commitments out (onHand > available), the difference is exactly what may be
            // reclaimed; where it does not, the difference is 0 and the credit vanishes,
            // matching production. No configuration assumption is baked in.
            var liveOnHandMbf = toNumber(((live[pairKey] && live[pairKey][String(lotId)]) || {}).quantityOnHand);
            var reclaimableMbf = roundQty(Math.max(0, liveOnHandMbf - liveMbf));
            var creditedMbf = roundQty(Math.min(priorMbf, reclaimableMbf));
            var availMbf = roundQty(liveMbf + creditedMbf);

            // ── PACK-SPACE COMPARISON (preferred) ──────────────────────────────────
            // The trader reserves whole PACKS and the lot holds a pack count, so compare
            // pack counts. Comparing in MBF drags in a rounding-convention mismatch that
            // has nothing to do with physical availability: the RECEIPT writer deposited
            // the lot's MBF as ROUND(ROUND(ppp*volpcfbm/1000, 5) * packs, 5) — round the
            // factor, THEN multiply — while the SO writer commits
            // roundQty(packs*ppp*volpcfbm/1000), multiply THEN round. The two disagree by
            // exactly packs * (f - round5(f)), bounded by packs * 5e-6.
            //
            // RETRACTED 2026-08-29: an earlier version of this comment cited a 16,883-pair sweep
            // showing "0 false blocks, 0 over-draws". That sweep derived each request from the same
            // availMbf/factor quotient it then compared against, so its result was structurally
            // determined and could not have come out any other way. It is NOT evidence and has been
            // removed rather than restated. The same flaw invalidated a 1,826-allocation replay:
            // committed <= deposited on 1,825 of 1,826 rows, so that test could not fire either.
            //
            // What DOES support this branch, on independently anchored measurements:
            //   - the divisor is exact on 3,966/3,966 lot rows drawn from MULTI-lot receipt lines,
            //     where lotMbf != lineMbf so the identity is not algebraically forced
            //   - the tolerance sits in a measured empty valley (grid noise <= 0.006069 packs,
            //     genuine partial packs >= 0.010840) over 1,531 in-stock lots
            //   - eight runtime cases against the deployed code, expectations set from lot
            //     balances the guard does not read
            //
            // Widening QTY_EPSILON cannot substitute: the error is pack-count-proportional,
            // so a flat 1e-5 still leaves 91 false blocks, and a relative tolerance of
            // Math.max(QTY_EPSILON, |availMbf| * 1e-9) is a provable NO-OP — its relative
            // term only exceeds the 1e-6 floor above 1000 MBF and the prod availMbf ceiling
            // is ~715, so it changes 0 verdicts.
            //
            // lotFactor is the LOT's OWN per-pack MBF, read off its additive receipt line by
            // fetchLotStorageFactors as ABS(quantity) / ABS(custcol_mgsl_packqty) — a quotient
            // of two stored values, never a reconstruction. Dividing the balance by the very
            // factor the receipt deposited it with makes a whole-pack lot round-trip exactly,
            // while a fractional-pack lot keeps its fraction and still refuses one pack more.
            if (hasLotFactor) {
                guardBranchCounts.packSpace++;
                var availPacks = roundQty(availMbf / lotFactor);
                if (requestedPacks > roundQty(availPacks + PACK_EPSILON)) {
                    errors.push({
                        code: 'INSUFFICIENT_LIVE_AVAILABILITY',
                        itemId: itemId,
                        segmentId: toId(req.segmentId),
                        lotId: lotId,
                        requested: requestedPacks,
                        available: roundPacks(availPacks),
                        message: 'Lot ' + (lotId) + ' is physically depleted — only ' + roundPacks(availPacks) + ' pack(s) available (requested ' + requestedPacks + ').'
                    });
                }
                return;
            }

            // ── LEGACY MBF COMPARISON ─────────────────────────────────────────────
            // Reached when the lot has no unambiguous stored factor — receipted at differing
            // pack sizes, never receipted, or the factor query failed. This is production's
            // current behaviour and is subject to the convention mismatch described above.
            guardBranchCounts.legacyMbf++;
            if (requestedMbf > roundQty(availMbf + QTY_EPSILON)) {
                errors.push({
                    code: 'INSUFFICIENT_LIVE_AVAILABILITY',
                    itemId: itemId,
                    segmentId: toId(req.segmentId),
                    lotId: lotId,
                    requested: requestedPacks,
                    // mbfPerPack is guaranteed > 0 on this branch (the demand gate above
                    // only reaches here via hasExactMbf or mbfPerPack > 0), but guard the
                    // divisor anyway: emitting Infinity/NaN into a trader-facing message is
                    // worse than omitting the number.
                    available: mbfPerPack > 0 ? roundPacks(availMbf / mbfPerPack) : null,
                    message: 'Lot ' + (lotId) + ' is physically depleted — only '
                        + (mbfPerPack > 0 ? roundPacks(availMbf / mbfPerPack) + ' pack(s)' : roundQty(availMbf) + ' MBF')
                        + ' available (requested ' + requestedPacks + ').'
                });
            }
        });

        // ONE line per guard invocation, not per request - enough to answer "which
        // arithmetic judged this save?" without adding to the log flood. Until now the
        // pack-space branch and the legacy MBF fall-through were indistinguishable
        // after the fact, which made every guard incident a reconstruction from first
        // principles. Skips and fail-closed events already emit their own audit lines.
        safeLogAudit('PO Allocation guard - evaluation summary', {
            soId: soId,
            requests: list.length,
            packSpaceBranch: guardBranchCounts.packSpace,
            legacyMbfBranch: guardBranchCounts.legacyMbf,
            errors: errors.length
        });

        return errors;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Trader Screen cache reader — received segments + lots
    // ═══════════════════════════════════════════════════════════════════════════
    //
    // Returns { segments: [...], lastUpdated, cacheVersion, cacheDiagnostics } on hit, or null on
    // miss / fall-through. Caller merges with live unreceived segments from
    // getPoSegmentsForItem({ skipLots: true }). See plans/for-po-allocation-sbx-transient.
    //
    // Fall-through triggers (return null, defer to full live path):
    //   - cached entry absent or empty
    //   - any lotId in includeLots not present in cached onHand rows (SO-only lot
    //     or receipt-reversed lot — cache only carries actual on-hand)

    function getReceivedSegmentsFromTraderCache(itemId, locationId, currentSoId, ppp, includeLots, subsidiaryId, includeSegs) {
        if (!itemId || !locationId) return null;

        var cached;
        try {
            cached = TraderCacheView.getReceivedDetailByItemLocation(subsidiaryId, itemId, locationId);
        } catch (e) {
            safeLogError('MSL PO Allocation - trader cache read failed', {
                itemId: itemId, locationId: locationId, message: e && e.message
            });
            return null;
        }
        if (!cached || !Array.isArray(cached.onHand)) return null;

        var onHand    = cached.onHand;
        var committed = Array.isArray(cached.committed) ? cached.committed : [];
        var outbound  = Array.isArray(cached.outbound)  ? cached.outbound  : [];
        var currentSoIdStr = String(currentSoId || '');
        var numericPpp = Number(ppp) || 0;

        // Trader-exact group nets for DISPLAY. Computed from the raw cached detail
        // (onHand/onOrder/inTransit/committed/outbound) and stamped onto each seg as
        // groupNetAvail. DISPLAY-only: seg.availQty / lot.availQty are left untouched.
        var groupNets = buildTraderGroupNets(cached);

        var includeLotSet = {};
        (Array.isArray(includeLots) ? includeLots : []).forEach(function (lid) {
            var s = toId(lid);
            if (s) includeLotSet[s] = true;
        });

        // Segments the SO line is already allocated to. Per RULES §1.1 these bypass
        // the PPP filter at the SEGMENT level (so the row surfaces with its real PO
        // data even when its stock is at a different PPP); the per-lot PPP filter in
        // filterSegmentsForDisplayLine still hides the mismatched lots, so no cross-
        // PPP lot leak. Without this, an allocated PPP-mismatched segment had all its
        // cache rows dropped here and rendered as a bare "SEG <id>" placeholder.
        var includeSegSet = {};
        (Array.isArray(includeSegs) ? includeSegs : []).forEach(function (sid) {
            var s = toId(sid);
            if (s) includeSegSet[s] = true;
        });

        // A malformed received cache row cannot be offered for allocation because
        // both a segment and a lot internal ID are required to write a safe
        // inventory assignment. Exclude it individually so it cannot hide valid
        // lots at the same item/location, and preserve read-only evidence for a
        // future UI explanation. Empty onHand remains a valid cache hit.
        var excludedOnHandRows = [];
        var excludedOnHandPacks = 0;
        var validOnHand = onHand.filter(function (row, rowIndex) {
            if (!row) return false;
            var hasSegment = !!toId(row.segmentId);
            var hasLotId = !!toId(row.lotInternalId);
            if (hasSegment && hasLotId) return true;

            var reason = !hasSegment && !hasLotId
                ? 'missing-segment-id-and-lot-internal-id'
                : (!hasSegment ? 'missing-segment-id' : 'missing-lot-internal-id');
            var packsOnHand = roundPacks(toNumber(row.packsOnHand));
            excludedOnHandPacks = roundPacks(excludedOnHandPacks + packsOnHand);
            excludedOnHandRows.push({
                reason: reason,
                itemId: toId(itemId),
                locationId: toId(locationId),
                segmentId: toId(row.segmentId),
                lotId: toId(row.lotInternalId),
                lotNumber: String(row.lotNumber || ''),
                poNumber: String(row.poNumber || ''),
                sourceDocNumber: String(row.docNumber || row.docNum || ''),
                sourceTransactionId: toId(row.tranId || row.docId),
                cacheRowIndex: rowIndex,
                ppp: Number(row.piecesPerPack) || 0,
                packsOnHand: packsOnHand
            });
            return false;
        });
        var cacheDiagnostics = {
            excludedOnHandCount: excludedOnHandRows.length,
            excludedOnHandPacks: excludedOnHandPacks,
            excludedOnHandRows: excludedOnHandRows
        };

        // Fall-through if any includeLot is missing from cached onHand — SO-only lot
        // or reversed receipt. Cache only holds rows with actual on-hand inventory.
        if (Object.keys(includeLotSet).length > 0) {
            var cachedLotSet = {};
            validOnHand.forEach(function (r) {
                if (r && r.lotInternalId) cachedLotSet[String(r.lotInternalId)] = true;
            });
            var missingLot = false;
            Object.keys(includeLotSet).forEach(function (lid) {
                if (!cachedLotSet[lid]) missingLot = true;
            });
            if (missingLot) {
                // Preserve the existing live fallback for an SO-only/reversed lot,
                // while retaining any unrelated malformed-row diagnostics gathered
                // above. getAvailabilityByLine recognizes this marker and runs the
                // normal live path instead of treating this as a cache hit.
                return {
                    requiresLiveFallback: true,
                    cacheDiagnostics: cacheDiagnostics,
                    lastUpdated: cached.lastUpdated || '',
                    cacheVersion: cached.cacheVersion || 0
                };
            }
        }

        // PPP filter (RULES §1.2 row 2): keep onHand rows where row PPP matches
        // the SO line OR the lot is in includeLots OR the segment is one the line
        // is already allocated to (includeSegs — segment-level bypass per §1.1).
        // The includeSeg bypass keeps the segment's rows so it builds with its real
        // PO metadata; filterSegmentsForDisplayLine then drops the still-mismatched
        // lots, so no cross-PPP lot leaks (RULES §1) — matching the live path.
        // Mirrors the trader screen: IA-only lots (Reman-sourced, etc.) ARE
        // included; the segment-row mapper below falls back to docNumber when
        // poNumber is empty so the label shows the IA tranid (e.g., "IA1717")
        // instead of the "SEG <id>" placeholder.
        var filteredOnHand = validOnHand.filter(function (r) {
            if (!r) return false;
            var inIncludeLots = r.lotInternalId && includeLotSet[String(r.lotInternalId)];
            var inIncludeSeg = r.segmentId && includeSegSet[String(r.segmentId)];
            var rowPpp = Number(r.piecesPerPack) || 0;
            if (!numericPpp) return true;                              // SO line has no PPP — match live no-filter behaviour
            if (rowPpp > 0 && rowPpp === numericPpp) return true;
            if (inIncludeLots) return true;
            if (inIncludeSeg) return true;                            // allocated segment — surface it even at mismatched PPP
            return false;
        });

        // Different-PPP bucket (ADDITIVE — frozen contract byLineDifferentPpp).
        // Same onHand rows, but keep only rows whose PPP is set and does NOT match
        // the line's PPP. No baseline to differ from when the line has no PPP, so
        // the bucket is empty in that case (mirrors filteredOnHand's no-filter rule).
        var differentPppOnHand = numericPpp > 0
            ? validOnHand.filter(function (r) {
                if (!r) return false;
                var rowPpp = Number(r.piecesPerPack) || 0;
                return rowPpp > 0 && rowPpp !== numericPpp;
            })
            : [];

        // Aggregate other-SO commits per segment, and per (segment, lotNumber) for
        // received-lot rows. Excludes current SO so the user can re-allocate their
        // own commits. Skips multi-lot concatenations from dedupeByLine in lot-level
        // aggregation (best-effort; rare in practice).
        // PPP filter: only count commits at the line's PPP. The live path enforces
        // this via `AND sol.custcol_mgsl_ppp = ?` on the allocatedRows query — the
        // cache path must match or it over-deducts when the segment carries lines
        // at multiple PPPs.
        var segmentAllocated = {};
        var lotAllocated     = {};

        function aggregate(rows, packsField) {
            rows.forEach(function (row) {
                if (!row) return;
                if (String(row.docId) === currentSoIdStr) return;
                if (numericPpp > 0) {
                    var rowPpp = Number(row.piecesPerPack) || 0;
                    if (rowPpp > 0 && rowPpp !== numericPpp) return;
                }
                var segId = toId(row.allocatedSegmentId);
                if (!segId) return;
                var packs = Number(row[packsField]) || 0;
                if (packs <= 0) return;
                segmentAllocated[segId] = (segmentAllocated[segId] || 0) + packs;

                var lotNum = row.lotNumber;
                var isMultiLot = lotNum && String(lotNum).indexOf(',') >= 0;
                if (!isMultiLot && lotNum && lotNum !== '—') {
                    var key = segId + '|' + lotNum;
                    lotAllocated[key] = (lotAllocated[key] || 0) + packs;
                }
            });
        }
        aggregate(committed, 'packsCommitted');
        aggregate(outbound, 'packs');

        // Per-lot tally of the CURRENT SO's commits + outbound. Exposed as
        // `soAllocatedQty` on each lot row so the UI can compute the trader-
        // screen-matching Avail. (= server availQty − soAllocatedQty), while
        // the Max button continues to use the original server availQty for
        // reallocation headroom. Live `getLotsForReceivedSegments` already
        // returns this field — we mirror it here for the cache path.
        var soLotAllocated = {};
        function aggregateCurrentSo(rows, packsField) {
            rows.forEach(function (row) {
                if (!row || String(row.docId) !== currentSoIdStr) return;
                if (numericPpp > 0) {
                    var rowPpp = Number(row.piecesPerPack) || 0;
                    if (rowPpp > 0 && rowPpp !== numericPpp) return;
                }
                var segId = toId(row.allocatedSegmentId);
                if (!segId) return;
                var packs = Number(row[packsField]) || 0;
                if (packs <= 0) return;
                var lotNum = row.lotNumber;
                if (!lotNum || lotNum === '—' || String(lotNum).indexOf(',') >= 0) return;
                soLotAllocated[segId + '|' + lotNum] = (soLotAllocated[segId + '|' + lotNum] || 0) + packs;
            });
        }
        aggregateCurrentSo(committed, 'packsCommitted');
        aggregateCurrentSo(outbound,  'packs');

        // Different-PPP commit/outbound aggregation (ADDITIVE) — mirrors aggregate/
        // aggregateCurrentSo above but does NOT gate rows to numericPpp: a physical
        // lot always carries one fixed PPP, so keying by segId|lotNumber still ties
        // each commit to the right lot even though this bucket spans multiple PPPs.
        var segmentAllocatedDiff = {};
        var lotAllocatedDiff     = {};
        var soLotAllocatedDiff   = {};
        function aggregateDiff(rows, packsField) {
            rows.forEach(function (row) {
                if (!row) return;
                if (String(row.docId) === currentSoIdStr) return;
                var segId = toId(row.allocatedSegmentId);
                if (!segId) return;
                var packs = Number(row[packsField]) || 0;
                if (packs <= 0) return;
                segmentAllocatedDiff[segId] = (segmentAllocatedDiff[segId] || 0) + packs;

                var lotNum = row.lotNumber;
                var isMultiLot = lotNum && String(lotNum).indexOf(',') >= 0;
                if (!isMultiLot && lotNum && lotNum !== '—') {
                    var key = segId + '|' + lotNum;
                    lotAllocatedDiff[key] = (lotAllocatedDiff[key] || 0) + packs;
                }
            });
        }
        function aggregateCurrentSoDiff(rows, packsField) {
            rows.forEach(function (row) {
                if (!row || String(row.docId) !== currentSoIdStr) return;
                var segId = toId(row.allocatedSegmentId);
                if (!segId) return;
                var packs = Number(row[packsField]) || 0;
                if (packs <= 0) return;
                var lotNum = row.lotNumber;
                if (!lotNum || lotNum === '—' || String(lotNum).indexOf(',') >= 0) return;
                soLotAllocatedDiff[segId + '|' + lotNum] = (soLotAllocatedDiff[segId + '|' + lotNum] || 0) + packs;
            });
        }
        aggregateDiff(committed, 'packsCommitted');
        aggregateDiff(outbound, 'packs');
        aggregateCurrentSoDiff(committed, 'packsCommitted');
        aggregateCurrentSoDiff(outbound,  'packs');

        // "Match the trader screen" overlay. buildAvailable (MGSL) already reconciles
        // each on-hand lot's available at the ITEM level — it subtracts committed +
        // ALL outbound, including outbound stranded on a depleted SIBLING lot in the
        // same segment. The raw `onHand − per-lot-commit` derivation below keys
        // commitments to the exact lot, so it MISSES that cross-lot outbound and
        // over-states (e.g. lot 58601 derives 28 while the trader nets it to 1).
        // When the cache carries the reconciled `available` rows (MTL), use their
        // packsAvail so PO Allocation == trader screen by construction. IND has no
        // `available` array yet → reconciledAvailByLot stays null → raw derivation
        // (unchanged) until buildAvailable is ported to the IND MR.
        var reconciledAvailByLot = null;
        if (Array.isArray(cached.available) && cached.available.length) {
            reconciledAvailByLot = {};
            cached.available.forEach(function (ar) {
                if (!ar || ar.status !== 'On Hand') return;
                var aLot = toId(ar.lotInternalId);
                var aSeg = toId(ar.segmentId);
                if (!aLot || !aSeg) return;
                reconciledAvailByLot[aSeg + '|' + aLot] = roundPacks(toNumber(ar.packsAvail));
            });
            // Deploy-order safety: if `available` is present but NO On Hand row carries
            // segmentId+lotInternalId (old MR build, or the cache hasn't rebuilt yet
            // after the buildAvailable key change), the map is empty. Fall back to the
            // raw derivation rather than zeroing every lot's availQty.
            if (!Object.keys(reconciledAvailByLot).length) reconciledAvailByLot = null;
        }

        // Group filtered onHand rows into the PO Allocation segment shape.
        // One allocation segment can legitimately be reused by inventory from
        // multiple source transactions. Keep PO + PPP in the bucket identity so
        // the first cache row's PO metadata cannot bleed onto later lots and
        // stamp them with the wrong Trader group projection.
        var bySegment = {};
        filteredOnHand.forEach(function (r) {
            var segId = toId(r.segmentId);
            if (!segId) return;

            var rowPoNumber = String(r.poNumber || r.docNumber || '');
            var rowPpp = Number(r.piecesPerPack) || 0;
            var receivedBucketKey = segId + '|' + traderGroupKey(rowPoNumber, rowPpp);
            var bucket = bySegment[receivedBucketKey];
            if (!bucket) {
                // Mirror trader-screen label semantics: for IR-from-PO rows
                // poNumber is the PO #; for IR-from-RO it's the RO #; for IA-
                // only lots poNumber is empty and we fall back to docNumber
                // (the IA's tranid, e.g. "IA1717") instead of the "SEG <id>"
                // UI placeholder.
                bucket = bySegment[receivedBucketKey] = {
                    segmentId:       segId,
                    tranType:        r.tranType || '',
                    tranId:          r.tranId || '',
                    poNumber:        rowPoNumber,
                    supplier:        String(r.vendor || ''),
                    currency:        String(r.currency || ''),
                    earliestReceipt: r.date || null,
                    iaIsUsd:         false,
                    lots:            []
                };
            }
            if (r.date && (!bucket.earliestReceipt || String(r.date) < String(bucket.earliestReceipt))) {
                bucket.earliestReceipt = r.date;
            }
            if (r.tranType === 'inventoryadjustment' && r.currency === 'USD') {
                bucket.iaIsUsd = true;
            }

            var lotKey      = segId + '|' + (r.lotNumber || '');
            var lotAllocQty = roundPacks(toNumber(lotAllocated[lotKey] || 0));
            var packsOnHand = roundPacks(toNumber(r.packsOnHand));
            var soAllocOnLot = roundPacks(toNumber(soLotAllocated[lotKey] || 0));
            var availQty;
            if (reconciledAvailByLot) {
                // Trader-reconciled available is the ALL-SO net for this lot. Add
                // back THIS SO's own claim so availQty stays "onHand − OTHER-SO"
                // (the server headroom the Max button uses); the UI re-subtracts
                // soAllocatedQty to render the trader-matching Avail. Lots the
                // trader reconciled to ≤0 are absent from `available` → 0 here.
                var reconciled = roundPacks(toNumber(reconciledAvailByLot[segId + '|' + toId(r.lotInternalId)] || 0));
                availQty = roundPacks(reconciled + soAllocOnLot);
            } else {
                availQty = roundPacks(packsOnHand - lotAllocQty);
            }
            if (availQty < 0) availQty = 0;
            var perLotRate  = Number(r.mbfPrice) || 0;
            var rowCurrency = r.currency || '';

            bucket.lots.push({
                segmentId:      segId,
                lotId:          toId(r.lotInternalId),
                lotNumber:      String(r.lotNumber || ''),
                availQty:       availQty,
                receivedQty:    packsOnHand,
                allocatedQty:   lotAllocQty,
                soAllocatedQty: soAllocOnLot,
                earliestReceipt: r.date || null,
                ppp:            Number(r.piecesPerPack) || 0,
                txnRatePerMbf:  perLotRate,
                usdRatePerMbf:  rowCurrency === 'USD' ? perLotRate : 0,
                avgCostPerUnit: perLotRate,
                mbfPerPack:     0, // caller fills from SO line custcol_mgsl_volpcfbm
                currency:       rowCurrency
            });
        });

        // Build PO Allocation segment array
        var segments = [];
        Object.keys(bySegment).forEach(function (bucketKey) {
            var b = bySegment[bucketKey];
            var segId = b.segmentId;
            var receivedQty  = 0;
            var availQtySum  = 0;
            b.lots.forEach(function (lot) {
                receivedQty += lot.receivedQty || 0;
                availQtySum += lot.availQty || 0;
            });
            var segAllocated = roundPacks(toNumber(segmentAllocated[segId] || 0));
            var avgCost      = b.lots.length > 0 ? b.lots[0].avgCostPerUnit : 0;
            var firstPpp     = b.lots.length > 0 ? b.lots[0].ppp : 0;

            segments.push({
                segmentId:       segId,
                // Emit the NetSuite internal type code (matches the live path's
                // MAX(tx.type) output). The UI compares `po.txType === "InvAdjst"`
                // to route the row link to /invadjst.nl vs /purchord.nl — emitting
                // the human-readable label would route IA rows to /purchord.nl and
                // trigger "incorrect transaction type".
                txType:          b.tranType === 'inventoryadjustment' ? 'InvAdjst'
                                : b.tranType === 'itemreceipt'         ? 'ItemRcpt'
                                : '',
                poId:            toId(b.tranId),           // IA internal id for IA segs; IR internal id for IR-backed
                poNumber:        b.poNumber,
                supplier:        b.supplier,
                currency:        b.currency,
                poQty:           roundPacks(receivedQty),  // operational figure is availQty
                receivedQty:     roundPacks(receivedQty),
                allocatedQty:    segAllocated,
                availQty:        roundPacks(availQtySum),
                isReceived:      true,
                earliestReceipt: b.earliestReceipt,
                poDate:          b.earliestReceipt,        // mirror live: IA trandate / IR trandate
                avgCostPerUnit:  avgCost,
                mbfPerPack:      0,                        // caller fills
                ppp:             firstPpp,
                iaIsUsd:         b.iaIsUsd,
                lots:            b.lots
            });
        });

        // Different-PPP received segments (ADDITIVE) — same shape as bySegment/
        // segments above, sourced from differentPppOnHand and the *Diff commit
        // aggregation maps. Feeds segmentsDifferentPpp in the return value.
        var bySegmentDiff = {};
        differentPppOnHand.forEach(function (r) {
            var segId = toId(r.segmentId);
            if (!segId) return;

            var rowPoNumber = String(r.poNumber || r.docNumber || '');
            var rowPpp = Number(r.piecesPerPack) || 0;
            var receivedBucketKey = segId + '|' + traderGroupKey(rowPoNumber, rowPpp);
            var bucket = bySegmentDiff[receivedBucketKey];
            if (!bucket) {
                bucket = bySegmentDiff[receivedBucketKey] = {
                    segmentId:       segId,
                    tranType:        r.tranType || '',
                    tranId:          r.tranId || '',
                    poNumber:        rowPoNumber,
                    supplier:        String(r.vendor || ''),
                    currency:        String(r.currency || ''),
                    earliestReceipt: r.date || null,
                    iaIsUsd:         false,
                    lots:            []
                };
            }
            if (r.date && (!bucket.earliestReceipt || String(r.date) < String(bucket.earliestReceipt))) {
                bucket.earliestReceipt = r.date;
            }
            if (r.tranType === 'inventoryadjustment' && r.currency === 'USD') {
                bucket.iaIsUsd = true;
            }

            var lotKey       = segId + '|' + (r.lotNumber || '');
            var lotAllocQty  = roundPacks(toNumber(lotAllocatedDiff[lotKey] || 0));
            var packsOnHand  = roundPacks(toNumber(r.packsOnHand));
            var soAllocOnLot = roundPacks(toNumber(soLotAllocatedDiff[lotKey] || 0));
            var availQty;
            if (reconciledAvailByLot) {
                var reconciled = roundPacks(toNumber(reconciledAvailByLot[segId + '|' + toId(r.lotInternalId)] || 0));
                availQty = roundPacks(reconciled + soAllocOnLot);
            } else {
                availQty = roundPacks(packsOnHand - lotAllocQty);
            }
            if (availQty < 0) availQty = 0;
            var perLotRate  = Number(r.mbfPrice) || 0;
            var rowCurrency = r.currency || '';

            bucket.lots.push({
                segmentId:      segId,
                lotId:          toId(r.lotInternalId),
                lotNumber:      String(r.lotNumber || ''),
                availQty:       availQty,
                receivedQty:    packsOnHand,
                allocatedQty:   lotAllocQty,
                soAllocatedQty: soAllocOnLot,
                earliestReceipt: r.date || null,
                ppp:            Number(r.piecesPerPack) || 0,
                txnRatePerMbf:  perLotRate,
                usdRatePerMbf:  rowCurrency === 'USD' ? perLotRate : 0,
                avgCostPerUnit: perLotRate,
                mbfPerPack:     0, // caller fills from SO line custcol_mgsl_volpcfbm
                currency:       rowCurrency
            });
        });

        var segmentsDifferentPpp = [];
        Object.keys(bySegmentDiff).forEach(function (bucketKey) {
            var b = bySegmentDiff[bucketKey];
            var segId = b.segmentId;
            var receivedQty  = 0;
            var availQtySum  = 0;
            b.lots.forEach(function (lot) {
                receivedQty += lot.receivedQty || 0;
                availQtySum += lot.availQty || 0;
            });
            var segAllocated = roundPacks(toNumber(segmentAllocatedDiff[segId] || 0));
            var avgCost      = b.lots.length > 0 ? b.lots[0].avgCostPerUnit : 0;
            var firstPpp     = b.lots.length > 0 ? b.lots[0].ppp : 0;

            segmentsDifferentPpp.push({
                segmentId:       segId,
                txType:          b.tranType === 'inventoryadjustment' ? 'InvAdjst'
                                : b.tranType === 'itemreceipt'         ? 'ItemRcpt'
                                : '',
                poId:            toId(b.tranId),
                poNumber:        b.poNumber,
                supplier:        b.supplier,
                currency:        b.currency,
                poQty:           roundPacks(receivedQty),
                receivedQty:     roundPacks(receivedQty),
                allocatedQty:    segAllocated,
                availQty:        roundPacks(availQtySum),
                isReceived:      true,
                earliestReceipt: b.earliestReceipt,
                poDate:          b.earliestReceipt,
                avgCostPerUnit:  avgCost,
                mbfPerPack:      0,
                ppp:             firstPpp,
                iaIsUsd:         b.iaIsUsd,
                lots:            b.lots
            });
        });
        var receivedSegmentSetDiff = {};
        Object.keys(bySegmentDiff).forEach(function (bucketKey) {
            receivedSegmentSetDiff[bySegmentDiff[bucketKey].segmentId] = true;
        });

        // ── Unreceived segments from cached onOrder + inTransit ──────────────
        // Mirrors the unreceived branch of getPoSegmentsForItem: one row per
        // (segment), availQty = poQty − allocatedQty (allocated already PPP-filtered
        // via the aggregate above). Skips segments that exist in onHand — those are
        // partially received and surface in the received bucket per
        // getPoSegmentsForItem's `isReceived = receivedQty > 0` rule.
        //
        // Two incoming-supply buckets feed this list and are SUMMED per segment.
        // They are disjoint in the trader-screen model (the summary adds
        // onOrder + inTransit), so summing does not double-count:
        //   • On Order   — open, not-yet-billed POs.
        //   • In Transit — billed-but-not-received POs AND Transfer Orders (e.g.
        //     shipped, awaiting receipt). Both now carry the line segment
        //     (TOs stamped by MSL_UE_allocationSegmentSync) so they are allocatable
        //     like on-order; a row that still lacks a segment is skipped. A segment
        //     with any in-transit qty is flagged inTransit:true so the UI can badge
        //     it "In Transit". Note: this cache path is the ONLY source of in-transit
        //     TOs — the live getPoSegmentsForItem fallback stays PO/IA-only.
        var receivedSegmentSet = {};
        Object.keys(bySegment).forEach(function (bucketKey) {
            receivedSegmentSet[bySegment[bucketKey].segmentId] = true;
        });

        // Source preference: cached.available filtered by status is the canonical
        // trader-screen Available data PO Allocation mirrors (MTL). Falls back to the
        // raw cached.onOrder / cached.inTransit arrays when `available` isn't a
        // row-list (IND emits available as a scalar; the raw arrays carry the same
        // per-PO-line detail).
        var hasAvailableRows = Array.isArray(cached.available) && cached.available.length;
        var onOrderRows = hasAvailableRows
            ? cached.available.filter(function (r) { return r && r.status === 'On Order'; })
            : (Array.isArray(cached.onOrder) ? cached.onOrder : []);
        var inTransitRows = hasAvailableRows
            ? cached.available.filter(function (r) { return r && r.status === 'In Transit'; })
            : (Array.isArray(cached.inTransit) ? cached.inTransit : []);

        // The reconciled `available` rows are authoritative for quantities but
        // can omit descriptive fields such as currency. Hydrate only missing
        // metadata from the corresponding raw incoming row; never replace the
        // canonical available quantity/status.
        var incomingMetaByGroup = {};
        function indexIncomingMeta(rows) {
            (Array.isArray(rows) ? rows : []).forEach(function (r) {
                if (!r) return;
                var docNumber = String(r.docNumber || r.docNum || r.poNumber || '');
                var rowPpp = Number(r.piecesPerPack) || 0;
                if (!docNumber) return;
                var key = traderGroupKey(docNumber, rowPpp);
                var old = incomingMetaByGroup[key] || {};
                incomingMetaByGroup[key] = {
                    poId: old.poId || toId(r.poId),
                    supplier: old.supplier || String(r.vendor || r.vendorName || ''),
                    currency: old.currency || String(r.currency || ''),
                    poDate: old.poDate || r.poDate || r.date || null,
                    avgCostPerUnit: old.avgCostPerUnit || toNumber(r.mbfPrice != null ? r.mbfPrice : r.rate)
                };
            });
        }
        indexIncomingMeta(cached.onOrder);
        indexIncomingMeta(cached.inTransit);

        // Aggregate incoming qty per segment (sum on-order + in-transit), tracking
        // whether in-transit contributed and keeping the first row's metadata.
        var unreceivedBySeg = {};
        var unreceivedOrder = [];
        function addUnreceivedRows(rows, isInTransit) {
            (Array.isArray(rows) ? rows : []).forEach(function (r) {
                if (!r) return;
                var segId = toId(r.segmentId);
                if (!segId) return;                       // segment-less row skipped (segmented TOs now flow through)
                if (receivedSegmentSet[segId]) return;    // partially received → received bucket
                var rowPpp = Number(r.piecesPerPack) || 0;
                // PPP filter, with the segment-level bypass for already-allocated
                // segments (RULES §1.1) so a PPP-mismatched allocated PO still surfaces.
                if (numericPpp > 0 && rowPpp > 0 && rowPpp !== numericPpp && !includeSegSet[segId]) return;
                // Field-name reconciliation across buckets/subsidiaries:
                // • available rows use packsAvail / poNumber / vendor
                // • raw onOrder/inTransit use packs|packQty / docNumber|docNum / vendor|vendorName
                // Raw (un-rounded): the segment total must be round-of-sum to match the
                // trader net. Rounding each PO line before summing (round(Σ round)) drifts
                // by up to a pack from the trader on fractional multi-line segments.
                var qty = toNumber(
                    r.packsAvail != null ? r.packsAvail :
                    (r.packs != null ? r.packs : r.packQty)
                );
                if (qty <= 0) return;
                var b = unreceivedBySeg[segId];
                if (!b) {
                    var poNumber = String(r.poNumber || r.docNumber || r.docNum || '');
                    var sourceMeta = incomingMetaByGroup[traderGroupKey(poNumber, rowPpp)] || {};
                    b = unreceivedBySeg[segId] = {
                        segmentId:      segId,
                        poId:           toId(r.poId) || sourceMeta.poId || '',
                        poNumber:       poNumber,
                        supplier:       String(r.vendor || r.vendorName || sourceMeta.supplier || ''),
                        currency:       String(r.currency || sourceMeta.currency || ''),
                        poDate:         r.poDate || sourceMeta.poDate || null,
                        ppp:            rowPpp,
                        avgCostPerUnit: toNumber(r.mbfPrice != null ? r.mbfPrice : (r.rate != null ? r.rate : sourceMeta.avgCostPerUnit)),
                        poQty:          0,
                        inTransit:      false
                    };
                    unreceivedOrder.push(segId);
                }
                b.poQty = toNumber(b.poQty) + qty;   // accumulate raw; rounded once at emit
                if (isInTransit) b.inTransit = true;
            });
        }
        addUnreceivedRows(onOrderRows, false);
        addUnreceivedRows(inTransitRows, true);

        // Different-PPP unreceived segments (ADDITIVE) — mirrors addUnreceivedRows
        // above with the PPP condition INVERTED (keep only mismatched-PPP rows) and
        // gated on receivedSegmentSetDiff instead of receivedSegmentSet.
        var unreceivedBySegDiff = {};
        var unreceivedOrderDiff = [];
        function addUnreceivedRowsDiff(rows, isInTransit) {
            (Array.isArray(rows) ? rows : []).forEach(function (r) {
                if (!r) return;
                var segId = toId(r.segmentId);
                if (!segId) return;
                if (receivedSegmentSetDiff[segId]) return;
                var rowPpp = Number(r.piecesPerPack) || 0;
                if (!(numericPpp > 0 && rowPpp > 0 && rowPpp !== numericPpp)) return;
                // Raw (un-rounded): the segment total must be round-of-sum to match the
                // trader net. Rounding each PO line before summing (round(Σ round)) drifts
                // by up to a pack from the trader on fractional multi-line segments.
                var qty = toNumber(
                    r.packsAvail != null ? r.packsAvail :
                    (r.packs != null ? r.packs : r.packQty)
                );
                if (qty <= 0) return;
                var b = unreceivedBySegDiff[segId];
                if (!b) {
                    var poNumber = String(r.poNumber || r.docNumber || r.docNum || '');
                    var sourceMeta = incomingMetaByGroup[traderGroupKey(poNumber, rowPpp)] || {};
                    b = unreceivedBySegDiff[segId] = {
                        segmentId:      segId,
                        poId:           toId(r.poId) || sourceMeta.poId || '',
                        poNumber:       poNumber,
                        supplier:       String(r.vendor || r.vendorName || sourceMeta.supplier || ''),
                        currency:       String(r.currency || sourceMeta.currency || ''),
                        poDate:         r.poDate || sourceMeta.poDate || null,
                        ppp:            rowPpp,
                        avgCostPerUnit: toNumber(r.mbfPrice != null ? r.mbfPrice : (r.rate != null ? r.rate : sourceMeta.avgCostPerUnit)),
                        poQty:          0,
                        inTransit:      false
                    };
                    unreceivedOrderDiff.push(segId);
                }
                b.poQty = toNumber(b.poQty) + qty;   // accumulate raw; rounded once at emit
                if (isInTransit) b.inTransit = true;
            });
        }
        addUnreceivedRowsDiff(onOrderRows, false);
        addUnreceivedRowsDiff(inTransitRows, true);

        var unreceivedSegmentsDifferentPpp = unreceivedOrderDiff.map(function (segId) {
            var b = unreceivedBySegDiff[segId];
            var allocatedQty = roundPacks(toNumber(segmentAllocatedDiff[segId] || 0));
            // `available[].packsAvail` is already net of commitments. Raw
            // onOrder/inTransit rows are gross and still require the deduction.
            var availQty     = roundPacks(hasAvailableRows ? b.poQty : (b.poQty - allocatedQty));
            if (availQty < 0) availQty = 0;
            return {
                segmentId:       segId,
                txType:          '',
                poId:            b.poId,
                poNumber:        b.poNumber,
                supplier:        b.supplier,
                currency:        b.currency,
                poQty:           roundPacks(b.poQty),
                receivedQty:     0,
                allocatedQty:    allocatedQty,
                availQty:        availQty,
                isReceived:      false,
                inTransit:       b.inTransit,
                earliestReceipt: null,
                poDate:          b.poDate,
                avgCostPerUnit:  b.avgCostPerUnit,
                mbfPerPack:      0,
                ppp:             b.ppp,
                iaIsUsd:         false,
                lots:            null
            };
        });

        var unreceivedSegments = unreceivedOrder.map(function (segId) {
            var b = unreceivedBySeg[segId];
            var allocatedQty = roundPacks(toNumber(segmentAllocated[segId] || 0));
            // `available[].packsAvail` is already net of commitments. Raw
            // onOrder/inTransit rows are gross and still require the deduction.
            var availQty     = roundPacks(hasAvailableRows ? b.poQty : (b.poQty - allocatedQty));
            if (availQty < 0) availQty = 0;
            return {
                segmentId:       segId,
                txType:          '',
                poId:            b.poId,
                poNumber:        b.poNumber,
                supplier:        b.supplier,
                currency:        b.currency,
                poQty:           roundPacks(b.poQty),
                receivedQty:     0,
                allocatedQty:    allocatedQty,
                availQty:        availQty,
                isReceived:      false,
                inTransit:       b.inTransit,   // UI badges "In Transit" when true
                earliestReceipt: null,
                poDate:          b.poDate,
                avgCostPerUnit:  b.avgCostPerUnit,
                mbfPerPack:      0,             // caller fills from SO line custcol_mgsl_volpcfbm
                ppp:             b.ppp,
                iaIsUsd:         false,
                lots:            null
            };
        });

        // Assigned-segment bypass: an SO line with an already-assigned segment
        // must always surface that segment in the PO Allocation table, even when
        // the cache doesn't know about its lots (typical case: lot fully committed
        // by another SO → MR's onHand search drops the 0-on-hand row → segment
        // missing from cached.onHand). Live `getPoSegmentsForItem` honors this
        // via its `includeSet` bypass; the cache reader has no equivalent, so
        // we patch the gap by falling back to a tightly-scoped live call for
        // just the missing assigned segments. Common path (no assignments yet
        // or all assigned segments are in cache) is unaffected — no SQL.
        var representedSegs = {};
        segments.forEach(function (s)           { representedSegs[String(s.segmentId)] = true; });
        unreceivedSegments.forEach(function (s) { representedSegs[String(s.segmentId)] = true; });

        var missingIncludeSegs = (Array.isArray(includeSegs) ? includeSegs : [])
            .map(function (s) { return toId(s); })
            .filter(function (s) { return s && !representedSegs[s]; });

        var _bypassReturnedSegIds = [];
        if (missingIncludeSegs.length) {
            var includeLotIds = Object.keys(includeLotSet);
            var missingSegments = getPoSegmentsForItem(
                itemId,
                currentSoId,
                locationId,
                missingIncludeSegs,
                ppp,
                { displayMode: true, includeLotIds: includeLotIds }
            ).filter(function (s) {
                return s && missingIncludeSegs.indexOf(toId(s.segmentId)) >= 0;
            });
            _bypassReturnedSegIds = missingSegments.map(function (s) { return toId(s.segmentId); });
            missingSegments.forEach(function (s) {
                (s.isReceived ? segments : unreceivedSegments).push(s);
            });
        }

        // Stamp trader-exact display fields onto every seg. Received segs key by
        // (poNumber||docNumber)+'|'+ppp — seg.poNumber already carries
        // poNumber||docNumber; unreceived (onOrder) segs key by docNumber+'|'+ppp —
        // seg.poNumber carries docNumber for those rows. Falls back to seg.availQty
        // when the group key isn't present. Never mutates availQty.
        stampTraderGroupDisplay(segments, groupNets);
        stampTraderGroupDisplay(unreceivedSegments, groupNets);
        stampTraderGroupDisplay(segmentsDifferentPpp, groupNets);
        stampTraderGroupDisplay(unreceivedSegmentsDifferentPpp, groupNets);

        return {
            segments:                       segments,
            unreceivedSegments:             unreceivedSegments,
            groupNets:                      groupNets,
            segmentsDifferentPpp:           segmentsDifferentPpp,
            unreceivedSegmentsDifferentPpp: unreceivedSegmentsDifferentPpp,
            cacheDiagnostics:                cacheDiagnostics,
            lastUpdated:                    cached.lastUpdated  || '',
            cacheVersion:                   cached.cacheVersion || 0
        };
    }

    // Different-PPP bucket helper (ADDITIVE) for the live cache-miss fallback in
    // getAvailabilityByLine: given the ALL-PPP pool from getPoSegmentsForItem(ppp=0),
    // keep only rows whose PPP differs from the line's PPP — mirrors the trader-cache
    // reader's differentPppOnHand filter for the live path. Received segments filter
    // their lots array and recompute the segment-level received/avail sums from the
    // kept lots; unreceived (no lots) segments are kept/dropped at the segment level.
    function buildDifferentPppSegmentsFromPool(allSegments, linePpp) {
        var out = [];
        if (!(linePpp > 0)) return out;
        (Array.isArray(allSegments) ? allSegments : []).forEach(function (seg) {
            if (!seg) return;
            if (seg.isReceived) {
                var lots = Array.isArray(seg.lots) ? seg.lots : [];
                var keptLots = lots.filter(function (lot) {
                    var lotPpp = Number(lot && lot.ppp) || 0;
                    return lotPpp > 0 && lotPpp !== linePpp;
                });
                if (!keptLots.length) return;
                var copy = {};
                Object.keys(seg).forEach(function (k) { copy[k] = seg[k]; });
                var receivedQty = 0;
                var availQtySum = 0;
                keptLots.forEach(function (lot) {
                    receivedQty += lot.receivedQty || 0;
                    availQtySum += lot.availQty || 0;
                });
                copy.lots = keptLots;
                copy.receivedQty = roundPacks(receivedQty);
                copy.poQty = roundPacks(receivedQty);
                copy.availQty = roundPacks(availQtySum);
                out.push(copy);
            } else {
                var segPpp = Number(seg.ppp) || 0;
                if (segPpp > 0 && segPpp !== linePpp) out.push(seg);
            }
        });
        return out;
    }

    function getAvailabilityByLine(soId, lineRows, subsidiaryId, options) {
        // Live-overlay is opt-in (default OFF). When off, the returned availability is
        // the cache-reconciled availQty with no live InventoryBalance cross-check.
        var applyLiveOverlay = !!(options && options.applyLiveOverlay);
        var result = {};
        var resultDiff = {};
        var groups = {};
        var lineMeta = {};
        var groupSegments = {};
        var groupSegmentsDiff = {};
        var groupCacheDiagnostics = {};
        var liveRequests = {};
        var metaInfo = {
            lastUpdated: '',
            cacheVersion: 0,
            source: 'live',
            // Additive diagnostics only. They do not affect pool eligibility or
            // allocation; the Suitelet can later render them as an explanation of
            // inventory that was deliberately excluded because it lacks safe
            // segment/lot assignment identity.
            excludedOnHandCount: 0,
            excludedOnHandPacks: 0,
            excludedOnHandRows: [],
            excludedOnHandByLine: {}
        };
        var excludedOnHandSeen = {};
        var hadCacheHit = false;
        var hadLiveFallback = false;

        function cloneCacheDiagnostics(diagnostics) {
            var rows = (diagnostics && Array.isArray(diagnostics.excludedOnHandRows))
                ? diagnostics.excludedOnHandRows.map(function (row) {
                    var copy = {};
                    Object.keys(row || {}).forEach(function (name) { copy[name] = row[name]; });
                    return copy;
                })
                : [];
            return {
                excludedOnHandCount: Number(diagnostics && diagnostics.excludedOnHandCount) || 0,
                excludedOnHandPacks: roundPacks(toNumber(diagnostics && diagnostics.excludedOnHandPacks)),
                excludedOnHandRows: rows
            };
        }

        function mergeCacheDiagnostics(diagnostics) {
            var copy = cloneCacheDiagnostics(diagnostics);
            if (!copy.excludedOnHandCount) return;
            copy.excludedOnHandRows.forEach(function (row) {
                var key = [
                    row.itemId, row.locationId, row.reason, row.segmentId, row.lotId,
                    row.lotNumber, row.poNumber, row.sourceDocNumber, row.sourceTransactionId, row.cacheRowIndex,
                    row.ppp, row.packsOnHand
                ].join('|');
                if (excludedOnHandSeen[key]) return;
                excludedOnHandSeen[key] = true;
                metaInfo.excludedOnHandRows.push(row);
                metaInfo.excludedOnHandCount += 1;
                metaInfo.excludedOnHandPacks = roundPacks(metaInfo.excludedOnHandPacks + toNumber(row.packsOnHand));
            });
        }

        (lineRows || []).forEach(function (rawLine, index) {
            var line = rawLine || {};
            var key = normalizeLineKey(line.lineSeq || line.lineNum || line.line);
            if (!key) key = String(Number(index) + 1);
            var itemId = toId(line.itemId || line.item_id || line.item);
            if (!key || !itemId) return;
            var locationId = toId(line.location || line.location_id || line.locationId);
            var ppp = Number(line.ppp || line.custcol_mgsl_ppp) || 0;
            var groupKey = itemId + '|' + locationId + '|' + ppp;
            var sets = buildLineAvailabilitySets(line);
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    itemId: itemId,
                    locationId: locationId,
                    ppp: ppp,
                    includeSegs: [],
                    includeLots: [],
                    includeSegSet: {},
                    includeLotSet: {}
                };
            }
            sets.includeSegs.forEach(function (segId) {
                if (!Object.prototype.hasOwnProperty.call(groups[groupKey].includeSegSet, segId)) {
                    groups[groupKey].includeSegSet[segId] = true;
                    groups[groupKey].includeSegs.push(segId);
                }
            });
            sets.includeLots.forEach(function (lotId) {
                if (!Object.prototype.hasOwnProperty.call(groups[groupKey].includeLotSet, lotId)) {
                    groups[groupKey].includeLotSet[lotId] = true;
                    groups[groupKey].includeLots.push(lotId);
                }
            });
            lineMeta[key] = {
                line: line,
                groupKey: groupKey,
                sets: sets
            };
        });

        Object.keys(groups).forEach(function (groupKey) {
            var group = groups[groupKey];

            // Hybrid: try trader-screen cache for received segments. On hit, run
            // the unreceived branch live (skipping the lots query); on miss or
            // missing locationId (auto-allocate path, RULES §1.1 note), fall
            // through to the full live path. Skip cache when subsidiaryId is
            // falsy — used by the Restlet's force=live path for stale-save retry.
            var cacheResult = null;
            if (group.locationId && subsidiaryId) {
                cacheResult = getReceivedSegmentsFromTraderCache(
                    group.itemId,
                    group.locationId,
                    soId,
                    group.ppp,
                    group.includeLots,
                    subsidiaryId,
                    group.includeSegs
                );
            }

            if (cacheResult && cacheResult.cacheDiagnostics) {
                groupCacheDiagnostics[groupKey] = cloneCacheDiagnostics(cacheResult.cacheDiagnostics);
                mergeCacheDiagnostics(cacheResult.cacheDiagnostics);
            }

            var segments;
            if (cacheResult && !cacheResult.requiresLiveFallback) {
                hadCacheHit = true;
                if (cacheResult.lastUpdated && cacheResult.lastUpdated > metaInfo.lastUpdated) {
                    metaInfo.lastUpdated = cacheResult.lastUpdated;
                }
                if (cacheResult.cacheVersion > metaInfo.cacheVersion) {
                    metaInfo.cacheVersion = cacheResult.cacheVersion;
                }

                // Unreceived branch: prefer cached `onOrder` (per-segment rows from
                // the trader-screen MR). Fall back to live SuiteQL only when the
                // cache shim doesn't expose `unreceivedSegments` yet — graceful
                // rollout window before the MR refresh picks up the new fields.
                var unreceived;
                if (Array.isArray(cacheResult.unreceivedSegments)) {
                    unreceived = cacheResult.unreceivedSegments;
                } else {
                    var liveSegments = getPoSegmentsForItem(
                        group.itemId,
                        soId,
                        group.locationId,
                        group.includeSegs,
                        group.ppp,
                        {
                            displayMode:   true,
                            includeLotIds: group.includeLots,
                            skipLots:      true
                        }
                    );
                    unreceived = liveSegments.filter(function (s) {
                        return s && !s.isReceived;
                    });
                }
                segments = cacheResult.segments.concat(unreceived);
                // Same FIFO sort as getPoSegmentsForItem (received first, then
                // by earliest receipt / poDate, ties broken by PO number).
                segments.sort(function (left, right) {
                    if (left.isReceived !== right.isReceived) {
                        return left.isReceived ? -1 : 1;
                    }
                    var leftDate  = left.isReceived  ? left.earliestReceipt  : left.poDate;
                    var rightDate = right.isReceived ? right.earliestReceipt : right.poDate;
                    var l = leftDate  ? String(leftDate)  : '';
                    var r = rightDate ? String(rightDate) : '';
                    if (l !== r) return l < r ? -1 : 1;
                    return String(left.poNumber).localeCompare(String(right.poNumber));
                });

                // Different-PPP bucket (ADDITIVE): the cache reader already produced
                // both received + unreceived diff arrays — concat + sort the same way.
                var segmentsDiff = (Array.isArray(cacheResult.segmentsDifferentPpp) ? cacheResult.segmentsDifferentPpp : [])
                    .concat(Array.isArray(cacheResult.unreceivedSegmentsDifferentPpp) ? cacheResult.unreceivedSegmentsDifferentPpp : []);
                segmentsDiff.sort(function (left, right) {
                    if (left.isReceived !== right.isReceived) {
                        return left.isReceived ? -1 : 1;
                    }
                    var leftDate  = left.isReceived  ? left.earliestReceipt  : left.poDate;
                    var rightDate = right.isReceived ? right.earliestReceipt : right.poDate;
                    var l = leftDate  ? String(leftDate)  : '';
                    var r = rightDate ? String(rightDate) : '';
                    if (l !== r) return l < r ? -1 : 1;
                    return String(left.poNumber).localeCompare(String(right.poNumber));
                });
                groupSegmentsDiff[groupKey] = segmentsDiff;
            } else {
                hadLiveFallback = true;
                segments = getPoSegmentsForItem(
                    group.itemId,
                    soId,
                    group.locationId,
                    group.includeSegs,
                    group.ppp,
                    {
                        displayMode:   true,
                        includeLotIds: group.includeLots
                    }
                );

                // Different-PPP bucket (ADDITIVE): re-run the live query WITHOUT the
                // line's PPP scoping (ppp=0 — getPoSegmentsForItem's existing "no
                // filter" convention) to get all PPPs, then keep only rows whose PPP
                // differs from this line's PPP. Only hit on cache-miss (rare path);
                // does not alter the matching-PPP `segments` call above.
                groupSegmentsDiff[groupKey] = group.ppp > 0
                    ? buildDifferentPppSegmentsFromPool(
                        getPoSegmentsForItem(
                            group.itemId,
                            soId,
                            group.locationId,
                            group.includeSegs,
                            0,
                            {
                                displayMode:   true,
                                includeLotIds: group.includeLots
                            }
                        ),
                        group.ppp
                    )
                    : [];

                // The operational cache-row conversion can reject an otherwise
                // healthy Trader detail entry (missing assigned lot, rolling cache
                // shape, etc.). Keep the safe live rows, but independently recover
                // the exact Trader display projection from that same raw cache.
                var displayProjection = getTraderDisplayProjection(
                    group.itemId,
                    group.locationId,
                    subsidiaryId
                );
                if (displayProjection) {
                    hadCacheHit = true;
                    if (displayProjection.lastUpdated && displayProjection.lastUpdated > metaInfo.lastUpdated) {
                        metaInfo.lastUpdated = displayProjection.lastUpdated;
                    }
                    if (displayProjection.cacheVersion > metaInfo.cacheVersion) {
                        metaInfo.cacheVersion = displayProjection.cacheVersion;
                    }
                    stampTraderGroupDisplay(segments, displayProjection.groupNets);
                    stampTraderGroupDisplay(groupSegmentsDiff[groupKey], displayProjection.groupNets);
                }
            }

            groupSegments[groupKey] = segments;
            if (applyLiveOverlay && group.locationId) {
                liveRequests[groupKey] = {
                    itemId: group.itemId,
                    locationId: group.locationId,
                    lotIds: {}
                };
                collectLotIdsFromSegments(liveRequests[groupKey].lotIds, segments);
            }
        });

        metaInfo.source = hadCacheHit && hadLiveFallback ? 'cache+live'
                        : hadCacheHit                   ? 'cache+live' // unreceived always live
                        : 'live';

        var liveByGroup = applyLiveOverlay ? fetchLiveLotBalancesByPair(liveRequests) : {};
        Object.keys(lineMeta).forEach(function (lineKey) {
            var meta = lineMeta[lineKey];
            var cloned = cloneSegmentsForUi(groupSegments[meta.groupKey] || []);

            // Derive mbfPerPack from the SO line context (cache doesn't carry it)
            // for the UI cost estimate. Line custcol_mgsl_volpcfbm × ppp / 1000 —
            // same formula the summary row's mbfFactor uses.
            var line = meta.line || {};
            var linePpp      = Number(line.ppp || line.custcol_mgsl_ppp) || 0;
            var lineVolpcfbm = Number(line.volpcfbm || line.custcol_mgsl_volpcfbm) || 0;
            // Older UI snapshots did not include volpcfbm, but they did include
            // both the line MBF quantity and pack quantity. Reconstruct the same
            // per-piece volume so estimates remain valid while an old snapshot is
            // still cached: mbfQty / packs = PPP * volpcfbm / 1000.
            if (lineVolpcfbm <= 0 && linePpp > 0) {
                var lineMbfQty = Number(line.mbfQty || line.mbf_qty) || 0;
                var linePackQty = Number(line.quantity || line.pack_qty) || 0;
                if (lineMbfQty > 0 && linePackQty > 0) {
                    lineVolpcfbm = (lineMbfQty / linePackQty) * 1000 / linePpp;
                }
            }
            if (lineVolpcfbm > 0 && linePpp > 0) {
                var derivedMbfPerPack = roundQty((lineVolpcfbm * linePpp) / 1000);
                cloned.forEach(function (seg) {
                    if (!seg) return;
                    if (!seg.mbfPerPack) seg.mbfPerPack = derivedMbfPerPack;
                    (Array.isArray(seg.lots) ? seg.lots : []).forEach(function (lot) {
                        if (lot && !lot.mbfPerPack) lot.mbfPerPack = derivedMbfPerPack;
                    });
                });
            }

            if (applyLiveOverlay && groups[meta.groupKey] && groups[meta.groupKey].locationId) {
                applyLiveLotAvailabilityToSegments(cloned, liveByGroup[meta.groupKey] || {});
            }
            filterSegmentsForDisplayLine(cloned, meta.line, meta.sets);
            result[lineKey] = cloned;

            var lineCacheDiagnostics = groupCacheDiagnostics[meta.groupKey];
            if (lineCacheDiagnostics && lineCacheDiagnostics.excludedOnHandCount) {
                // Keyed by the same normalized line key as byLine so a future UI
                // can explain exclusions for precisely the active SO line.
                metaInfo.excludedOnHandByLine[lineKey] = cloneCacheDiagnostics(lineCacheDiagnostics);
            }

            // Different-PPP bucket (ADDITIVE): shown as-is — filterSegmentsForDisplayLine
            // enforces the matching-PPP + includeSegs/includeLots bypass rules from
            // RULES.md §1, which do not apply to this separate bucket. mbfPerPack for
            // these rows uses EACH ROW'S OWN ppp (not the line's ppp), since a pack at a
            // different PPP has a different board-foot yield — mirrors the direct MBF
            // formula applyLineAllocation uses when saving a different-PPP split.
            var clonedDiff = cloneSegmentsForUi(groupSegmentsDiff[meta.groupKey] || []);
            if (lineVolpcfbm > 0) {
                clonedDiff.forEach(function (seg) {
                    if (!seg) return;
                    var segPpp = Number(seg.ppp) || 0;
                    if (segPpp > 0 && !seg.mbfPerPack) {
                        seg.mbfPerPack = roundQty((lineVolpcfbm * segPpp) / 1000);
                    }
                    (Array.isArray(seg.lots) ? seg.lots : []).forEach(function (lot) {
                        var lotPpp = Number(lot && lot.ppp) || segPpp;
                        if (lot && lotPpp > 0 && !lot.mbfPerPack) {
                            lot.mbfPerPack = roundQty((lineVolpcfbm * lotPpp) / 1000);
                        }
                    });
                });
            }
            resultDiff[lineKey] = clonedDiff;
        });

        return { byLine: result, byLineDifferentPpp: resultDiff, meta: metaInfo };
    }

    function allocateAgainstSegments(line, segments) {
        var remaining = roundQty(toNumber(line && line.quantity));
        var allocations = [];
        var pool = Array.isArray(segments) ? segments : [];

        for (var i = 0; i < pool.length; i++) {
            if (remaining <= 0) break;
            var seg = pool[i];
            var lots = Array.isArray(seg && seg.lots) ? seg.lots : null;

            if (lots && lots.length) {
                // Received segment: allocate per-lot FIFO (lots are already sorted).
                // Emits one allocation entry per lot consumed.
                for (var li = 0; li < lots.length; li++) {
                    if (remaining <= 0) break;
                    var lot = lots[li];
                    var lotAvail = roundQty(toNumber(lot && lot.availQty));
                    if (lotAvail <= 0) continue;
                    var lotTake = roundQty(Math.min(lotAvail, remaining));
                    if (lotTake <= 0) continue;
                    allocations.push({
                        segmentId: toId(seg.segmentId),
                        lotId: toId(lot.lotId),
                        lotNumber: String(lot.lotNumber || ''),
                        poNumber: String(seg.poNumber || ''),
                        supplier: String(seg.supplier || ''),
                        qty: lotTake,
                        isReceived: true,
                        availBefore: lotAvail,
                        receiptDate: lot.earliestReceipt || seg.earliestReceipt || null
                    });
                    remaining = roundQty(remaining - lotTake);
                }
                continue;
            }

            // Unreceived segment: segment-level allocation (unchanged from prior behavior).
            var available = roundQty(toNumber(seg && seg.availQty));
            if (available <= 0) continue;
            var take = roundQty(Math.min(available, remaining));
            if (take <= 0) continue;

            allocations.push({
                segmentId: toId(seg.segmentId),
                poNumber: String(seg.poNumber || ''),
                supplier: String(seg.supplier || ''),
                qty: take,
                isReceived: !!seg.isReceived,
                availBefore: available,
                receiptDate: seg.earliestReceipt || null
            });
            remaining = roundQty(remaining - take);
        }

        return {
            allocations: allocations,
            unallocatedQty: remaining
        };
    }

    function normalizeSourceLine(rawLine, index) {
        var line = rawLine || {};
        var lineSeq = normalizeLineKey(
            line.lineSeq ||
            line.lineNum ||
            line.line ||
            line.line_seq ||
            ''
        );
        if (!lineSeq) lineSeq = String(Number(index) + 1);

        return {
            lineId: toId(
                line.lineId ||
                line.line_id ||
                line.lineUniqKey ||
                line.lineuniquekey ||
                lineSeq
            ),
            lineSeq: lineSeq,
            lineNum: lineSeq,
            itemId: toId(line.itemId || line.item_id || line.item),
            location: toId(line.location || line.location_id || line.locationId),
            quantity: roundQty(Math.abs(toNumber(line.quantity))),
            rate: toNumber(line.rate),
            segmentId: toId(line.segmentId || line.segment_id || line.cseg_po_segment_gl),
            commitmentConfirmed: isTrueFlag(
                line.commitmentConfirmed ||
                line.commitment_confirmed ||
                line.custcol_commitment_confirmed
            )
        };
    }

    function autoAllocateByLines(soId, inputLines, options) {
        var opts = options || {};
        var skipConfirmed = opts.skipConfirmed !== false;
        var commitmentByLine = opts.commitmentByLine || {};
        var segmentPoolByItem = {};
        var lines = (inputLines || []).map(function (line, index) {
            return normalizeSourceLine(line, index);
        }).filter(function (line) {
            return !!line.itemId && line.quantity > 0;
        });
        var results = [];
        var warnings = [];

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (Object.prototype.hasOwnProperty.call(commitmentByLine, line.lineSeq)) {
                line.commitmentConfirmed = !!commitmentByLine[line.lineSeq];
            }
            if (toNumber(line.fulfilledQty) > 0) {
                results.push({
                    lineId: line.lineId,
                    lineSeq: line.lineSeq,
                    lineNum: line.lineNum,
                    itemId: line.itemId,
                    location: line.location,
                    quantity: line.quantity,
                    existingSegmentId: line.segmentId,
                    lotIds: Array.isArray(line.lotIds) ? line.lotIds.slice() : [],
                    skipped: true,
                    skipReason: 'line-fulfilled',
                    allocations: []
                });
                continue;
            }
            if (skipConfirmed && line.commitmentConfirmed) {
                results.push({
                    lineId: line.lineId,
                    lineSeq: line.lineSeq,
                    lineNum: line.lineNum,
                    itemId: line.itemId,
                    location: line.location,
                    quantity: line.quantity,
                    existingSegmentId: line.segmentId,
                    lotIds: Array.isArray(line.lotIds) ? line.lotIds.slice() : [],
                    skipped: true,
                    skipReason: 'line-commitment-confirmed',
                    allocations: []
                });
                continue;
            }

            // Pool keyed by item|ppp because PO lines with different PPPs on the same
            // segment are not interchangeable for the SO line being allocated.
            var linePpp = Number(line.ppp) || 0;
            var poolKey = line.itemId + '|' + linePpp;
            if (!Object.prototype.hasOwnProperty.call(segmentPoolByItem, poolKey)) {
                segmentPoolByItem[poolKey] = getPoSegmentsForItem(line.itemId, soId, 0, [], linePpp).map(function (seg) {
                    // Deep-clone lots so cross-line decrements don't share state.
                    var clonedLots = Array.isArray(seg.lots)
                        ? seg.lots.map(function (lot) {
                            return {
                                lotId: toId(lot.lotId),
                                lotNumber: String(lot.lotNumber || ''),
                                receivedQty: roundQty(toNumber(lot.receivedQty)),
                                allocatedQty: roundQty(toNumber(lot.allocatedQty)),
                                soAllocatedQty: roundQty(toNumber(lot.soAllocatedQty)),
                                availQty: roundQty(toNumber(lot.availQty)),
                                earliestReceipt: lot.earliestReceipt || null,
                                ppp: toNumber(lot.ppp),
                                soOnly: !!lot.soOnly
                            };
                        })
                        : null;
                    return {
                        segmentId: toId(seg.segmentId),
                        poId: toId(seg.poId),
                        poNumber: String(seg.poNumber || ''),
                        supplier: String(seg.supplier || ''),
                        currency: String(seg.currency || ''),
                        poQty: roundQty(toNumber(seg.poQty)),
                        receivedQty: roundQty(toNumber(seg.receivedQty)),
                        allocatedQty: roundQty(toNumber(seg.allocatedQty)),
                        availQty: roundQty(toNumber(seg.availQty)),
                        isReceived: !!seg.isReceived,
                        earliestReceipt: seg.earliestReceipt || null,
                        poDate: seg.poDate || null,
                        avgCostPerUnit: toNumber(seg.avgCostPerUnit),
                        ppp: toNumber(seg.ppp),
                        lots: clonedLots
                    };
                });
            }

            var segmentPool = segmentPoolByItem[poolKey];
            var autoResult = allocateAgainstSegments(line, segmentPool);
            if (!autoResult.allocations.length) {
                warnings.push({
                    lineSeq: line.lineSeq,
                    itemId: line.itemId,
                    message: 'No available PO segments found for item.'
                });
            }

            if (autoResult.allocations.length) {
                // Decrement both segment-level availQty (for unreceived segments) and
                // per-lot availQty (for received segments) so the next line in the
                // batch sees the leftover pool correctly.
                var consumedBySegment = {};
                var consumedByLot = {};
                autoResult.allocations.forEach(function (alloc) {
                    var segmentId = toId(alloc && alloc.segmentId);
                    if (!segmentId) return;
                    var lotKey = alloc.lotId ? (segmentId + '|' + toId(alloc.lotId)) : '';
                    consumedBySegment[segmentId] = roundQty(
                        toNumber(consumedBySegment[segmentId]) + toNumber(alloc.qty)
                    );
                    if (lotKey) {
                        consumedByLot[lotKey] = roundQty(
                            toNumber(consumedByLot[lotKey]) + toNumber(alloc.qty)
                        );
                    }
                });

                segmentPool.forEach(function (seg) {
                    var segmentId = toId(seg && seg.segmentId);
                    if (!segmentId) return;
                    var consumed = roundQty(toNumber(consumedBySegment[segmentId]));
                    if (consumed > 0) {
                        seg.availQty = roundQty(Math.max(0, toNumber(seg.availQty) - consumed));
                    }
                    if (Array.isArray(seg.lots)) {
                        seg.lots.forEach(function (lot) {
                            var consumedLot = roundQty(
                                toNumber(consumedByLot[segmentId + '|' + toId(lot.lotId)])
                            );
                            if (consumedLot > 0) {
                                lot.availQty = roundQty(Math.max(0, toNumber(lot.availQty) - consumedLot));
                            }
                        });
                    }
                });
            }

            results.push({
                lineId: line.lineId,
                lineSeq: line.lineSeq,
                lineNum: line.lineNum,
                itemId: line.itemId,
                location: line.location,
                quantity: line.quantity,
                existingSegmentId: line.segmentId,
                // Carry the SO line's existing inventory-assignment lot IDs through
                // so buildAvailabilityByLine can seed includeLotSet (RULES.md §1).
                lotIds: Array.isArray(line.lotIds) ? line.lotIds.slice() : [],
                skipped: false,
                allocations: autoResult.allocations,
                requiresSplit: autoResult.allocations.length > 1,
                unallocatedQty: autoResult.unallocatedQty
            });
        }

        return {
            soId: Number(soId),
            lines: results,
            warnings: warnings
        };
    }

    function autoAllocateForSO(soId, options) {
        return autoAllocateByLines(soId, getSalesOrderLines(soId), options);
    }

    function autoAllocateFromLines(soId, lines, options) {
        // Lines from a snapshot may not carry inventory-assignment lot IDs — attach
        // them so includeLotSet can bypass PPP for the SO's existing lot.
        return autoAllocateByLines(soId, attachLotIdsToLines(lines || [], soId), options);
    }

    function getReceivedQtyForSegmentItem(segmentId, itemId) {
        var rows = runSuiteQLMapped([
            'SELECT',
            '  SUM(ABS(irl.custcol_mgsl_packqty)) AS received_qty',
            'FROM TransactionLine irl',
            'INNER JOIN Transaction ir ON ir.id = irl.transaction',
            "WHERE ir.type = 'ItemRcpt'",
            "  AND irl.mainline = 'F'",
            '  AND irl.cseg_po_segment_gl = ?',
            '  AND irl.item = ?'
        ].join(' '), [Number(segmentId), Number(itemId)]);

        if (!rows.length) return 0;
        return roundQty(toNumber(rows[0].received_qty));
    }

    function evaluateLineStatus(lineData, receivedQtyCache) {
        var segmentId = toId(lineData && lineData.segmentId);
        var itemId = toId(lineData && lineData.itemId);
        var quantity = roundQty(toNumber(lineData && lineData.quantity));
        if (!segmentId || !itemId || quantity <= 0) {
            return {
                received: false,
                commitmentConfirmed: false,
                shipReady: false,
                partialReceipt: false,
                receivedQty: 0
            };
        }

        var cache = receivedQtyCache || {};
        var cacheKey = segmentId + '|' + itemId;
        if (!Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
            cache[cacheKey] = getReceivedQtyForSegmentItem(segmentId, itemId);
        }

        var receivedQty = roundQty(toNumber(cache[cacheKey]));
        var received = receivedQty >= roundQty(quantity - 0.000001);
        var partialReceipt = !received && receivedQty > 0;
        return {
            received: received,
            commitmentConfirmed: received,
            shipReady: received,
            partialReceipt: partialReceipt,
            receivedQty: receivedQty
        };
    }

    function getSublistValueSafe(rec, sublistId, fieldId, line) {
        try {
            return rec.getSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                line: line
            });
        } catch (_e) {
            return null;
        }
    }

    function setSublistValueSafe(rec, sublistId, fieldId, line, value) {
        try {
            rec.setSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                line: line,
                value: value
            });
            return true;
        } catch (_e) {
            return false;
        }
    }

    // Detaches the inventory detail subrecord entirely and flags the line as
    // no longer commitment-confirmed. Must run before any other mutation on
    // the line so the save doesn't see an empty inventoryassignment sublist.
    function clearLineInventoryDetail(rec, sublistId, lineIndex) {
        var touched = false;
        try {
            var hasSub = rec.hasSublistSubrecord({
                sublistId: sublistId,
                fieldId: 'inventorydetail',
                line: lineIndex
            });
            if (hasSub) {
                rec.removeSublistSubrecord({
                    sublistId: sublistId,
                    fieldId: 'inventorydetail',
                    line: lineIndex
                });
                touched = true;
            }
        } catch (_eRemove) {
            // No subrecord exists on this line (or it is inaccessible).
        }

        setSublistValueSafe(rec, sublistId, CFG.SO_LINE_FIELD_COMMITMENT, lineIndex, false);
        return touched;
    }

    // Distinct lot (inventory number) internal ids currently assigned on a line's
    // inventory detail — read-only sibling of clearLineInventoryDetail. Used by
    // the allocation apply paths to detect a lot re-pick (same segment/qty,
    // different lot), which must count as a change so the old lot is cleared and
    // the picked lot reassigned. Standard-mode record accessor; same sublist and
    // field ids the lot-assignment lib writes ('inventoryassignment' /
    // 'issueinventorynumber'). Returns [] when the line has no inventory detail.
    function getLineAssignedLotIds(rec, sublistId, lineIndex) {
        var lotIds = [];
        try {
            var hasSub = rec.hasSublistSubrecord({
                sublistId: sublistId,
                fieldId: 'inventorydetail',
                line: lineIndex
            });
            if (!hasSub) return lotIds;
            var invDetail = rec.getSublistSubrecord({
                sublistId: sublistId,
                fieldId: 'inventorydetail',
                line: lineIndex
            });
            if (!invDetail) return lotIds;
            var iaCount = invDetail.getLineCount({ sublistId: 'inventoryassignment' }) || 0;
            var seen = {};
            for (var i = 0; i < iaCount; i++) {
                var lotId = toId(invDetail.getSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId: 'issueinventorynumber',
                    line: i
                }));
                if (lotId && !seen[lotId]) {
                    seen[lotId] = true;
                    lotIds.push(lotId);
                }
            }
        } catch (_eRead) {
            // No detail / unreadable — treat as no assigned lots.
        }
        return lotIds;
    }

    function updateLineStatusFields(soRec, lineIndex, status) {
        var lineStatus = status || {};
        setSublistValueSafe(soRec, CFG.SO_SUBLIST, CFG.SO_LINE_FIELD_PO_RECEIVED, lineIndex, !!lineStatus.received);
        setSublistValueSafe(soRec, CFG.SO_SUBLIST, CFG.SO_LINE_FIELD_COMMITMENT, lineIndex, !!lineStatus.commitmentConfirmed);
        setSublistValueSafe(soRec, CFG.SO_SUBLIST, CFG.SO_LINE_FIELD_SHIP_READY, lineIndex, !!lineStatus.shipReady);
    }

    function recomputeAndSetHeaderReadyFlag(soRec) {
        var lineCount = soRec.getLineCount({ sublistId: CFG.SO_SUBLIST }) || 0;
        var allAllocated = lineCount > 0;
        var allReceived = lineCount > 0;
        var allConfirmed = lineCount > 0;

        for (var i = 0; i < lineCount; i++) {
            var itemId = toId(getSublistValueSafe(soRec, CFG.SO_SUBLIST, 'item', i));
            if (!itemId) continue;

            var segmentId = toId(getSublistValueSafe(soRec, CFG.SO_SUBLIST, CFG.SO_LINE_FIELD_SEGMENT, i));
            var received = isTrueFlag(getSublistValueSafe(soRec, CFG.SO_SUBLIST, CFG.SO_LINE_FIELD_PO_RECEIVED, i));
            var confirmed = isTrueFlag(getSublistValueSafe(soRec, CFG.SO_SUBLIST, CFG.SO_LINE_FIELD_COMMITMENT, i));

            if (!segmentId) allAllocated = false;
            if (!received) allReceived = false;
            if (!confirmed) allConfirmed = false;
        }

        var readyToShip = allAllocated && allReceived && allConfirmed;
        try {
            soRec.setValue({
                fieldId: CFG.SO_HEADER_READY_TO_SHIP,
                value: readyToShip
            });
        } catch (_e) {
            // Header field may not be present in all environments.
        }

        return {
            readyToShip: readyToShip,
            allAllocated: allAllocated,
            allReceived: allReceived,
            allConfirmed: allConfirmed
        };
    }

    function buildRecordLineIndexMap(soRec) {
        var lineCount = soRec.getLineCount({ sublistId: CFG.SO_SUBLIST }) || 0;
        var byLineSeq = {};
        var byUniqueKey = {};

        for (var i = 0; i < lineCount; i++) {
            var lineSeq = normalizeLineKey(getSublistValueSafe(soRec, CFG.SO_SUBLIST, 'line', i));
            if (!lineSeq) lineSeq = String(i + 1);
            byLineSeq[lineSeq] = i;

            var uniqueKey = normalizeLineKey(getSublistValueSafe(soRec, CFG.SO_SUBLIST, 'lineuniquekey', i));
            if (uniqueKey) byUniqueKey[uniqueKey] = i;
        }

        return {
            byLineSeq: byLineSeq,
            byUniqueKey: byUniqueKey,
            lineCount: lineCount
        };
    }

    function clearAllLinesInventoryDetail(rec) {
        var sublistId = CFG.SO_SUBLIST;
        var lineCount = rec.getLineCount({ sublistId: sublistId }) || 0;
        var touched = 0;
        for (var i = 0; i < lineCount; i++) {
            if (clearLineInventoryDetail(rec, sublistId, i)) touched++;
        }
        return touched;
    }

    function clearAllLinesSegment(rec) {
        var sublistId = CFG.SO_SUBLIST;
        var lineCount = rec.getLineCount({ sublistId: sublistId }) || 0;
        var touched = 0;
        for (var i = 0; i < lineCount; i++) {
            // Inventory detail and commitmentfirm must be cleared before nulling
            // the segment, otherwise NetSuite refuses the segment write.
            clearLineInventoryDetail(rec, sublistId, i);
            if (setSublistValueSafe(rec, sublistId, CFG.SO_LINE_FIELD_SEGMENT, i, '')) touched++;
        }
        return touched;
    }

    function clearReadyToShipFlag(rec) {
        try {
            rec.setValue({ fieldId: CFG.SO_HEADER_READY_TO_SHIP, value: false });
        } catch (eSet) {
            safeLogError('MSL clearReadyToShipFlag setValue failed', {
                fieldId: CFG.SO_HEADER_READY_TO_SHIP,
                name: eSet && eSet.name,
                message: eSet && eSet.message
            });
            return false;
        }
        // Verify the in-memory write took effect — sourcing/locked fields can silently no-op.
        try {
            var after = rec.getValue({ fieldId: CFG.SO_HEADER_READY_TO_SHIP });
            if (after === true || String(after).toUpperCase() === 'T') {
                safeLogError('MSL clearReadyToShipFlag did not stick', {
                    fieldId: CFG.SO_HEADER_READY_TO_SHIP,
                    afterValue: after
                });
                return false;
            }
        } catch (_eRead) {}
        return true;
    }

    return {
        CFG: CFG,
        toId: toId,
        toNumber: toNumber,
        roundQty: roundQty,
        roundPacks: roundPacks,
        normalizeLineKey: normalizeLineKey,
        isTrueFlag: isTrueFlag,
        runSuiteQLMapped: runSuiteQLMapped,
        getSalesOrderLines: getSalesOrderLines,
        getThisSoCommittedLotBalanceByLine: getThisSoCommittedLotBalanceByLine,
        getPoSegmentsForItem: getPoSegmentsForItem,
        getAvailabilityByLine: getAvailabilityByLine,
        getReceivedSegmentsFromTraderCache: getReceivedSegmentsFromTraderCache,
        buildTraderGroupNets: buildTraderGroupNets,
        fetchLiveLotBalancesByPair: fetchLiveLotBalancesByPair,
        validateAllocationAvailability: validateAllocationAvailability,
        allocateAgainstSegments: allocateAgainstSegments,
        autoAllocateForSO: autoAllocateForSO,
        autoAllocateFromLines: autoAllocateFromLines,
        getReceivedQtyForSegmentItem: getReceivedQtyForSegmentItem,
        evaluateLineStatus: evaluateLineStatus,
        getSublistValueSafe: getSublistValueSafe,
        setSublistValueSafe: setSublistValueSafe,
        clearLineInventoryDetail: clearLineInventoryDetail,
        getLineAssignedLotIds: getLineAssignedLotIds,
        clearAllLinesInventoryDetail: clearAllLinesInventoryDetail,
        clearAllLinesSegment: clearAllLinesSegment,
        clearReadyToShipFlag: clearReadyToShipFlag,
        updateLineStatusFields: updateLineStatusFields,
        recomputeAndSetHeaderReadyFlag: recomputeAndSetHeaderReadyFlag,
        buildRecordLineIndexMap: buildRecordLineIndexMap
    };
});
