/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description CWP MTL Trader Screen cache builder — saved search pattern.
 *              Mirrors IND MR architecture. All SuiteQL replaced with 6 saved searches
 *              to avoid the proxy serialization bug (custcol_mgsl_packqty dropped by
 *              JSON.stringify on Java-backed proxy objects from query.runSuiteQL).
 */
define([
    'N/search', 'N/cache', 'N/log', 'N/runtime', 'N/task',
    '../../shared/cacheKeys_mtl',
    '../../shared/cacheClient',
    '../../shared/urlResolver',
], (search, cache, log, runtime, task, CacheKeysMTL, CacheClient, UrlResolver) => {

    const { getRecordUrl } = UrlResolver;

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    const MTL_SUBSIDIARY_ID = 5;
    const MIN_INTERVAL_MS   = 120000; // 2 minutes — minimum gap between real processing runs

    const SUMMARY_SEARCH_ID    = 'customsearch_suitelet_all_items_search_m';
    const ON_HAND_SEARCH_ID    = 'customsearch_mgsl_trader_onhand_tran_mtl';
    const IN_TRANSIT_SEARCH_ID = 'customsearch_mgsl_trader_intransit_mtl';
    const COMMITTED_SEARCH_ID  = 'customsearch_mgsl_trader_committed_mtl';
    const ON_ORDER_SEARCH_ID   = 'customsearch_mgsl_trader_onorder_mtl';
    const OUTBOUND_SEARCH_ID   = 'customsearch_mgsl_trader_outbound_mtl';
    const LOT_COST_SEARCH_ID    = 'customsearch_ts_lot_cost_mtl';
    const LOT_COST_IA_SEARCH_ID = 'customsearch_ts_lot_cost_ia_mtl';
    // NOTE: Both lot-cost saved searches share the same Account filter (288, 632).
    // If the inventory account list changes in the future, update BOTH searches to
    // avoid drift between IR and IA cost lookups.
    // IDs were shortened from 'customsearch_trader_screen_lot_cost_*' (Apr 2026) to
    // fit NetSuite's ~27-char limit on the user-typed portion of saved search IDs.

    const ITEM_RECORD_TYPE_MAPPING = {
        Assembly:          'assemblyitem',
        InvtPart:          'inventoryitem',
        'Inventory Item':  'inventoryitem',
        inventoryItem:     'inventoryitem',
    };

    // Virtual locations — physical country is irrelevant (no address).
    // Country filter routes these to the "Other" bucket.
    const VIRTUAL_LOCATION_IDS = { '103': true, '104': true, '310': true, '311': true };

    const locationCurrencyMap = {
        '108': 'USD', '217': 'USD', '216': 'USD', '7':   'USD',
        '218': 'USD', '215': 'USD', '220': 'USD', '222': 'USD',
        '219': 'USD', '225': 'USD', '106': 'USD', '221': 'USD',
        '224': 'USD', '223': 'USD',
        '8':   'CAD', '214': 'CAD', '210': 'CAD', '4':   'CAD',
        '18':  'CAD', '11':  'CAD', '105': 'CAD', '103': 'CAD',
        '212': 'CAD', '12':  'CAD', '13':  'CAD', '17':  'CAD',
        '109': 'CAD', '19':  'CAD', '213': 'CAD', '211': 'CAD',
        '107': 'CAD', '14':  'CAD', '104': 'CAD',
    };

    const CURRENCY_TO_ISO = {
        'Canadian Dollar': 'CAD', 'US Dollar': 'USD',
        'CAD': 'CAD', 'USD': 'USD',
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    const roundToTwoDecimals = (num) => Math.round((parseFloat(num) || 0) * 100) / 100;
    const safeGetValue = (r, opts) => { try { return r.getValue(opts); } catch (e) { return ''; } };

    const getScriptParam = (name, defaultValue) => {
        try {
            var val = runtime.getCurrentScript().getParameter({ name: name });
            return (val === null || val === undefined) ? defaultValue : val;
        } catch (e) { return defaultValue; }
    };

    // Dimension parsers — handle plain floats, simple fractions (1/2), mixed (3 1/2)
    const parseDim = (val, fallback) => {
        if (!val) return fallback;
        var s = String(val).trim();
        if (!s) return fallback;
        var mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
        if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
        var simple = s.match(/^(\d+)\/(\d+)$/);
        if (simple) return Number(simple[1]) / Number(simple[2]);
        var n = parseFloat(s);
        return isNaN(n) ? fallback : n;
    };
    const parseTh  = (val) => parseDim(val, 1);
    const parseLen = (val) => parseDim(String(val || '').replace(/[^\d.\s\/]/g, ''), 8);

    // FBM fallback: thickness(in) * width(in) * length(ft) / 12
    const computeFbmFromDims = (thickness, width, length) => {
        var th  = parseTh(thickness);
        var wid = parseDim(width, 0);
        var len = parseLen(length);
        if (th <= 0 || wid <= 0 || len <= 0) return 0;
        return th * wid * len / 12;
    };

    // "Purchase Order #PO344945" → "PO344945"
    const stripPrefix = (raw) => {
        if (!raw) return '';
        return raw.indexOf(' #') !== -1 ? raw.split(' #')[1] : raw;
    };

    const runPagedAll = (searchObj, pageSize) => {
        var results = [];
        var paged = searchObj.runPaged({ pageSize: pageSize || 1000 });
        paged.pageRanges.forEach((pageRange) => {
            paged.fetch({ index: pageRange.index }).data.forEach((result) => {
                results.push(result);
            });
        });
        return results;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  SEARCH CACHES
    // ═══════════════════════════════════════════════════════════════════════════

    // Generic cache for Committed, Outbound, On Order, In Transit searches
    var _detailSearchCache = {};
    function getDetailSearch(searchId) {
        if (!_detailSearchCache[searchId]) {
            var s = search.load({ id: searchId });
            // All MTL searches use consolidationtype:ACCTTYPE which converts rate to base currency (CAD);
            // add exchangerate so row builders can divide rate/exchangerate to get transaction-currency price
            if (searchId === ON_ORDER_SEARCH_ID) {
                s.columns.push(search.createColumn({ name: 'exchangerate', summary: 'MAX' }));
                s.columns.push(search.createColumn({ name: 'currency', summary: 'GROUP' }));
            } else {
                s.columns.push(search.createColumn({ name: 'exchangerate' }));
                s.columns.push(search.createColumn({ name: 'currency' }));
            }
            // Outbound needs the allocated PO segment so we can resolve vendor downstream
            if (searchId === OUTBOUND_SEARCH_ID) {
                s.columns.push(search.createColumn({ name: 'cseg_po_segment_gl' }));
            }
            _detailSearchCache[searchId] = {
                search: s,
                baseFilterLen: s.filters.length,
            };
        }
        var entry = _detailSearchCache[searchId];
        entry.search.filters.length = entry.baseFilterLen;
        return entry.search;
    }

    // On Hand gets its own cache — adds trandate ASC sort column
    var _onHandMtlCache = null;
    function getOnHandSearch() {
        if (!_onHandMtlCache) {
            var s = search.load({ id: ON_HAND_SEARCH_ID });
            s.columns.push(search.createColumn({ name: 'trandate', sort: search.Sort.ASC }));
            s.columns.push(search.createColumn({ name: 'exchangerate' }));
            // For IA-origin lots: lot creation date (custbody4) and lot supplier (custbody_lot_supplier).
            // Both are body-level fields on the IA record; populated only on imported IAs.
            // Used in row construction to display Date and Vendor for IA rows.
            s.columns.push(search.createColumn({ name: 'custbody4' }));
            s.columns.push(search.createColumn({ name: 'custbody_lot_supplier' }));
            _onHandMtlCache = {
                search:        s,
                baseFilterLen: s.filters.length,
            };
        }
        _onHandMtlCache.search.filters.length = _onHandMtlCache.baseFilterLen;
        return _onHandMtlCache;
    }

    // Summary search loader — pushes location country column so country filter
    // can key on physical location country rather than currency proxy.
    const loadSummarySearch = () => {
        var s = search.load({ id: SUMMARY_SEARCH_ID });
        s.columns.push(search.createColumn({
            name:    'country',
            join:    'inventoryLocation',
            summary: 'GROUP',
        }));
        return s;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ROW BUILDERS — formula column refs cached at module scope
    // ═══════════════════════════════════════════════════════════════════════════

    var colPackCommitted       = null;
    var colInTransitAdditional = null;
    var colOpenQty             = null;

    // ── Committed ─────────────────────────────────────────────────────────────
    const buildCommittedRow = (r) => {
        if (!colPackCommitted) {
            r.columns.forEach((col) => {
                if (col.label === 'Pack Committed') colPackCommitted = col;
            });
            if (!colPackCommitted) log.error('MTL Committed', 'Formula column "Pack Committed" not found');
        }
        var packsCommitted = roundToTwoDecimals(
            parseFloat(colPackCommitted ? r.getValue(colPackCommitted) : 0) || 0
        );
        var docId    = r.getValue({ name: 'internalid' });
        var entityId = r.getValue({ name: 'entity' });
        var ppp      = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp' })) ||
                       parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        var rawRate  = parseFloat(r.getValue({ name: 'rate' })) || 0;
        var exchRate = parseFloat(r.getValue({ name: 'exchangerate' })) || 1;
        return {
            docId:          docId,
            lineSeq:        r.getValue({ name: 'linesequencenumber' }),
            docNumber:      r.getValue({ name: 'tranid' }),
            docUrl:         getRecordUrl(docId, 'salesorder'),
            customer:       r.getText({ name: 'entity' }),
            customerUrl:    getRecordUrl(entityId, 'customer'),
            soCreationDate: r.getValue({ name: 'trandate' }),
            shipWeek:       r.getValue({ name: 'custbody_ship_week' }) || '',
            packsCommitted: packsCommitted,
            piecesPerPack:  ppp,
            mbfPrice:       roundToTwoDecimals(rawRate / exchRate),
            currency:       CURRENCY_TO_ISO[r.getText({ name: 'currency' })] || r.getText({ name: 'currency' }) || '',
            allocatedPO:    r.getText({ name: 'line.cseg_po_segment_gl' }) || '\u2014',
            lotNumber:      r.getValue({ name: 'serialnumber' }) || '\u2014',
        };
    };

    // ── In Transit ────────────────────────────────────────────────────────────
    const buildInTransitRow = (r) => {
        if (!colInTransitAdditional) {
            r.columns.forEach((col) => {
                if (col.label === 'In Transit *Additional') colInTransitAdditional = col;
            });
            if (!colInTransitAdditional) log.error('MTL In Transit', 'Formula column "In Transit *Additional" not found');
        }
        var packs    = roundToTwoDecimals(parseFloat(colInTransitAdditional ? r.getValue(colInTransitAdditional) : 0) || 0);
        var docId    = r.id;
        var vendorId = r.getValue({ name: 'mainname' });
        var ppp      = parseFloat(r.getValue({ name: 'custcol_mgsl_ppp' })) ||
                       parseFloat(r.getValue({ name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        var rawRate  = parseFloat(r.getValue({ name: 'rate' })) || 0;
        var exchRate = parseFloat(r.getValue({ name: 'exchangerate' })) || 1;
        return {
            docNumber:     r.getValue({ name: 'tranid' }),
            docUrl:        getRecordUrl(docId, 'purchaseorder'),
            shipWeek:      r.getValue({ name: 'custbody_ship_week' }) || '',
            vendor:        r.getText({ name: 'mainname' }),
            vendorUrl:     getRecordUrl(vendorId, 'vendor'),
            packs:         packs,
            piecesPerPack: ppp,
            mbfPrice:      roundToTwoDecimals(rawRate / exchRate),
            currency:      CURRENCY_TO_ISO[r.getText({ name: 'currency' })] || r.getText({ name: 'currency' }) || '',
        };
    };

    // ── On Order (GROUP BY — every getValue needs summary) ────────────────────
    const buildOnOrderRow = (r) => {
        if (!colOpenQty) {
            r.columns.forEach((col) => {
                if (col.label === 'Open Quantity') colOpenQty = col;
            });
            if (!colOpenQty) log.error('MTL On Order', 'Formula column "Open Quantity" not found');
        }
        var packs    = roundToTwoDecimals(parseFloat(colOpenQty ? r.getValue(colOpenQty) : 0) || 0);
        var docId    = r.getValue({ name: 'internalid', summary: 'GROUP' });
        var vendorId = r.getValue({ name: 'internalid', join: 'vendor', summary: 'GROUP' });
        var ppp      = parseFloat(r.getValue({ name: 'custcol_mgsl_ppp', summary: 'GROUP' })) ||
                       parseFloat(r.getValue({ name: 'custitem_mgsl_ppp', join: 'item', summary: 'GROUP' })) || 0;
        // rate is in base currency (CAD) due to consolidationtype:ACCTTYPE;
        // divide by exchangerate to get transaction-currency price (what the PO shows)
        var rawRate  = parseFloat(r.getValue({ name: 'rate', summary: 'MAX' })) || 0;
        var exchRate = parseFloat(r.getValue({ name: 'exchangerate', summary: 'MAX' })) || 1;
        var price    = roundToTwoDecimals(rawRate / exchRate);
        return {
            docNumber:     r.getValue({ name: 'tranid', summary: 'GROUP' }),
            docUrl:        getRecordUrl(docId, 'purchaseorder'),
            vendor:        r.getValue({ name: 'entityid', join: 'vendor', summary: 'GROUP' }) || '',
            vendorUrl:     getRecordUrl(vendorId, 'vendor'),
            shipWeek:      r.getValue({ name: 'custbody_ship_week', summary: 'GROUP' }) || '',
            packs:         packs,
            piecesPerPack: ppp,
            mbfPrice:      price,
            currency:      CURRENCY_TO_ISO[r.getText({ name: 'currency', summary: 'GROUP' })] || r.getText({ name: 'currency', summary: 'GROUP' }) || '',
        };
    };

    // ── Outbound ──────────────────────────────────────────────────────────────
    // Per Julie's rule (May 2026): a SO line moves to Outbound when its custom
    // carrier field is filled, regardless of shipping/billing status. MGSL does
    // no partial shipments, so the displayed packs = the full line packqty.
    // Reading {custcol_mgsl_packqty} directly is correct; the "Remaining Quantity"
    // formula returns 0 until the line is partially shipped, which would wrongly
    // exclude carrier-filled-but-not-yet-shipped lines from the Outbound bucket.
    const buildOutboundRow = (r) => {
        var packs = roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty' })) || 0);
        if (packs <= 0) return null;

        var docId    = r.getValue({ name: 'internalid' });
        var entityId = r.getValue({ name: 'entity' });
        var ppp      = parseFloat(r.getValue({ name: 'custcol_mgsl_ppp' })) ||
                       parseFloat(r.getValue({ name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        var lotNumber = r.getText({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
        var lotId     = r.getValue({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
        var rawRate   = parseFloat(r.getValue({ name: 'rate' })) || 0;
        var exchRate  = parseFloat(r.getValue({ name: 'exchangerate' })) || 1;
        return {
            docId:         docId,
            lineSeq:       r.getValue({ name: 'linesequencenumber' }),
            docNumber:     r.getValue({ name: 'tranid' }),
            docUrl:        getRecordUrl(docId, 'salesorder'),
            lotNumber:     lotNumber || '\u2014',
            lotUrl:        getRecordUrl(lotId, 'inventorynumber'),
            lotId:         lotId,
            customer:      r.getText({ name: 'entity' }),
            customerUrl:   getRecordUrl(entityId, 'customer'),
            invoicedDate:  r.getValue({ name: 'trandate', join: 'billingTransaction' }) || '',
            packs:         packs,
            piecesPerPack: ppp,
            mbfPrice:      roundToTwoDecimals(rawRate / exchRate),
            currency:      CURRENCY_TO_ISO[r.getText({ name: 'currency' })] || r.getText({ name: 'currency' }) || '',
            allocatedPO:   r.getText({ name: 'cseg_po_segment_gl' }) || '\u2014',
        };
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  runDetailSearch — generic runner for the 4 non-On-Hand searches
    // ═══════════════════════════════════════════════════════════════════════════

    const runDetailSearch = (searchId, itemId, locationId, rowBuilder) => {
        var rows = [];
        var rawCount = 0;
        try {
            var s = getDetailSearch(searchId);
            s.filters.push(
                search.createFilter({ name: 'item',     operator: search.Operator.ANYOF, values: itemId }),
                search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
            );
            s.run().each(function (r) {
                rawCount++;
                var row = rowBuilder(r);
                if (row) rows.push(row);
                return true;
            });
        } catch (e) {
            log.error('MTL runDetailSearch', searchId + ' ERROR for item=' + itemId + ' loc=' + locationId + ': ' + e.message);
        }
        // Log when rows are filtered out by rowBuilder (null returns)
        if (rawCount > 0 && rows.length !== rawCount && reduceInvokeCount <= 5) {
            log.debug('MTL runDetailSearch', searchId + ' item=' + itemId + ' loc=' + locationId +
                ' rawRows=' + rawCount + ' kept=' + rows.length + ' filtered=' + (rawCount - rows.length));
        }
        return rows;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  dedupeByLine — collapses lot-fanout rows into one row per SO line
    // ═══════════════════════════════════════════════════════════════════════════
    //
    //  Saved searches with `serialnumber` / `inventorynumber` columns fan an SO
    //  line into N rows (one per unique reserved lot). The Pack Committed / Open
    //  Pack Quantity formulas evaluate at the LINE level, so every fanned row
    //  carries the same line value. Summing them inflates totals by N.
    //
    //  Dedupe key: (docId, lineSeq). All fanned rows for one line share both.
    //  Distinct sorted lot names are concatenated (capped at 3 + "+N more").
    //  When multi-lot, lotUrl is cleared (no single URL applies).
    //
    //  Defensive: if any row is missing lineSeq, skip dedupe entirely. This lets
    //  the MR keep working safely if the saved search column hasn't been added
    //  yet or NetSuite returns a null value unexpectedly.

    const dedupeByLine = (rows, label) => {
        if (!rows || rows.length === 0) return rows;
        var hasLineSeq = rows.every(function (r) {
            return r && r.lineSeq !== undefined && r.lineSeq !== null && r.lineSeq !== '';
        });
        if (!hasLineSeq) {
            log.audit('MTL dedupeByLine', label + ' missing lineSeq on some rows - skipping dedupe');
            return rows;
        }
        var groups = {};
        var order = [];
        rows.forEach(function (r) {
            var key = String(r.docId) + '__' + String(r.lineSeq);
            if (!groups[key]) {
                groups[key] = {
                    row: r,
                    lots: r.lotNumber && r.lotNumber !== '\u2014' ? [r.lotNumber] : [],
                };
                order.push(key);
            } else if (r.lotNumber && r.lotNumber !== '\u2014' &&
                       groups[key].lots.indexOf(r.lotNumber) < 0) {
                groups[key].lots.push(r.lotNumber);
            }
        });
        return order.map(function (key) {
            var g = groups[key];
            var sortedLots = g.lots.slice().sort();
            var lotDisplay;
            if (sortedLots.length === 0) {
                lotDisplay = '\u2014';
            } else if (sortedLots.length <= 3) {
                lotDisplay = sortedLots.join(', ');
            } else {
                lotDisplay = sortedLots.slice(0, 3).join(', ') + ' (+' + (sortedLots.length - 3) + ' more)';
            }
            var out = {};
            for (var k in g.row) {
                if (Object.prototype.hasOwnProperty.call(g.row, k)) out[k] = g.row[k];
            }
            out.lotNumber = lotDisplay;
            if (sortedLots.length > 1) {
                out.lotUrl = '';
                out.lotId = '';
            }
            return out;
        });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  resolveAllocatedPOVendors — one batched PO search, returns {tranid: {vendor, vendorUrl}}
    // ═══════════════════════════════════════════════════════════════════════════

    const resolveAllocatedPOVendors = (committed, outbound) => {
        var poSet = {};
        committed.forEach(function (r) {
            if (r.allocatedPO && r.allocatedPO !== '\u2014') poSet[r.allocatedPO] = true;
        });
        outbound.forEach(function (r) {
            if (r.allocatedPO && r.allocatedPO !== '\u2014') poSet[r.allocatedPO] = true;
        });
        var poList = Object.keys(poSet);
        var result = {};
        if (poList.length === 0) return result;

        try {
            // tranid is a text field — build an OR expression (not anyof)
            var tranidExpr = [];
            poList.forEach(function (po, idx) {
                if (idx > 0) tranidExpr.push('OR');
                tranidExpr.push(['tranid', 'is', po]);
            });
            var poSearch = search.create({
                type: 'purchaseorder',
                filters: [['mainline', 'is', 'T'], 'AND', tranidExpr],
                columns: [
                    search.createColumn({ name: 'tranid' }),
                    search.createColumn({ name: 'entity' }),
                ],
            });
            poSearch.run().each(function (r) {
                var tranid    = r.getValue({ name: 'tranid' });
                var vendorId  = r.getValue({ name: 'entity' });
                var vendorTxt = r.getText({ name: 'entity' });
                if (tranid) {
                    result[tranid] = {
                        vendor:    vendorTxt || '',
                        vendorUrl: vendorId ? getRecordUrl(vendorId, 'vendor') : '',
                    };
                }
                return true;
            });
        } catch (e) {
            log.error('MTL vendor lookup', 'POs=' + poList.join(',') + ' ERROR: ' + e.message);
        }
        return result;
    };

    const applyVendor = (rows, vendorByPO) => {
        rows.forEach(function (r) {
            var v = vendorByPO[r.allocatedPO];
            r.vendor    = v ? v.vendor    : '';
            r.vendorUrl = v ? v.vendorUrl : '';
        });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  applyLotCost — Option B: lot origin trace + GL aggregation
    // ═══════════════════════════════════════════════════════════════════════════
    //
    //  Per On Hand row:
    //   - Resolve lot's originating transaction (earliest IR/IA with qty > 0)
    //   - For IR origin: sum GL on inventory asset → cost per unit / xr
    //   - Override mbfPrice + currency when origin ≠ row's own transaction (transferred lot)
    //   - For IA origin or lookup miss: lotCost = null (→ dash in UI)
    //   - Legitimate 0 preserved

    const resolveLotOrigins = (lotIds) => {
        var origins = {};  // lotId → {irId, tranType, mbfPrice, currency}
        if (!lotIds || lotIds.length === 0) return origins;
        try {
            var originSearch = search.create({
                type: 'transaction',
                filters: [
                    search.createFilter({
                        name: 'type', operator: search.Operator.ANYOF,
                        values: ['ItemRcpt', 'InvAdjst']
                    }),
                    search.createFilter({
                        name: 'inventorynumber', join: 'inventoryDetail',
                        operator: search.Operator.ANYOF, values: lotIds
                    }),
                    search.createFilter({
                        name: 'quantity', join: 'inventoryDetail',
                        operator: search.Operator.GREATERTHAN, values: 0
                    }),
                ],
                columns: [
                    search.createColumn({ name: 'inventorynumber', join: 'inventoryDetail' }),
                    search.createColumn({ name: 'trandate', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'rate' }),
                    search.createColumn({ name: 'exchangerate' }),
                    search.createColumn({ name: 'currency' }),
                    search.createColumn({ name: 'type' }),
                ],
            });
            originSearch.run().each(function (r) {
                var lotId = r.getValue({ name: 'inventorynumber', join: 'inventoryDetail' });
                if (!lotId || origins[lotId]) return true;  // first-seen wins
                var rate = parseFloat(r.getValue({ name: 'rate' })) || 0;
                var xr   = parseFloat(r.getValue({ name: 'exchangerate' })) || 1;
                origins[lotId] = {
                    irId:     r.getValue({ name: 'internalid' }),
                    tranType: r.recordType,
                    mbfPrice: roundToTwoDecimals(rate / (xr > 0 ? xr : 1)),
                    currency: CURRENCY_TO_ISO[r.getText({ name: 'currency' })] || r.getText({ name: 'currency' }) || '',
                };
                return true;
            });
        } catch (e) {
            log.error('MTL lot origin lookup', 'lots=' + lotIds.join(',') + ' ERROR: ' + e.message);
        }
        return origins;
    };

    const resolveLotCostByOriginIR = (originIrIds) => {
        var result = {};  // `${irId}__${itemId}` → costPerUnit in txn currency
        if (!originIrIds || originIrIds.length === 0) return result;
        try {
            var glSearch = search.load({ id: LOT_COST_SEARCH_ID });
            glSearch.filters.push(search.createFilter({
                name: 'internalid', operator: search.Operator.ANYOF, values: originIrIds
            }));
            glSearch.run().each(function (r) {
                var irId  = r.getValue({ name: 'internalid', summary: 'GROUP' });
                var item  = r.getValue({ name: 'internalid', join: 'item', summary: 'GROUP' });
                var xr    = parseFloat(r.getValue({ name: 'exchangerate', summary: 'MAX' })) || 1;
                var gl    = parseFloat(r.getValue({ name: 'debitamount', summary: 'SUM' })) || 0;
                var qty   = parseFloat(r.getValue({
                    name: 'formulanumeric', summary: 'SUM',
                    formula: 'CASE WHEN {quantity} > 0 THEN {quantity} ELSE 0 END'
                })) || 0;
                if (irId && item && qty > 0) {
                    var perUnit = (gl / qty) / (xr > 0 ? xr : 1);
                    result[irId + '__' + item] = roundToTwoDecimals(perUnit);
                }
                return true;
            });
        } catch (e) {
            log.error('MTL lot cost GL lookup', 'irs=' + originIrIds.join(',') + ' ERROR: ' + e.message);
        }
        return result;
    };

    const resolveLotCostByOriginIA = (originIaIds) => {
        var result = {};  // `${iaId}__${itemId}` → costPerUnit USD (already in USD from book filter)
        if (!originIaIds || originIaIds.length === 0) return result;
        try {
            var glSearch = search.load({ id: LOT_COST_IA_SEARCH_ID });
            glSearch.filters.push(search.createFilter({
                name: 'internalid', operator: search.Operator.ANYOF, values: originIaIds
            }));
            glSearch.run().each(function (r) {
                var iaId = r.getValue({ name: 'internalid', summary: 'GROUP' });
                var item = r.getValue({ name: 'internalid', join: 'item', summary: 'GROUP' });
                // IMPORTANT: 'debitamount' must be JOINED to 'accountingTransaction' to be book-aware.
                // Unjoined 'debitamount' always returns Primary Book amount regardless of book filter.
                // We filter to USD Accounting Book (id=6), so the joined debitamount returns USD values.
                var gl   = parseFloat(r.getValue({
                    name: 'debitamount',
                    join: 'accountingTransaction',
                    summary: 'SUM'
                })) || 0;
                var qty  = parseFloat(r.getValue({
                    name: 'formulanumeric', summary: 'SUM',
                    formula: 'CASE WHEN {quantity} > 0 THEN {quantity} ELSE 0 END'
                })) || 0;
                if (iaId && item && qty > 0) {
                    // USD book amount / qty = USD per unit directly; no xr math needed
                    result[iaId + '__' + item] = roundToTwoDecimals(gl / qty);
                }
                return true;
            });
        } catch (e) {
            log.error('MTL IA lot cost USD lookup', 'ias=' + originIaIds.join(',') + ' ERROR: ' + e.message);
        }
        return result;
    };

    const applyLotCost = (onHand, itemId) => {
        // Collect lot IDs for both IR AND IA origins
        var lotIdSet = {};
        onHand.forEach(function (row) {
            if ((row.tranType === 'itemreceipt' || row.tranType === 'inventoryadjustment') && row.lotInternalId) {
                lotIdSet[row.lotInternalId] = true;
            }
        });
        var lotIds = Object.keys(lotIdSet);
        if (lotIds.length === 0) {
            onHand.forEach(function (row) { row.lotCost = null; });
            return;
        }

        var originMap = resolveLotOrigins(lotIds);

        // Split origin transaction IDs by type — disjoint sets
        var originIrSet = {};
        var originIaSet = {};
        Object.keys(originMap).forEach(function (lotId) {
            var o = originMap[lotId];
            if (!o || !o.irId) return;
            if (o.tranType === 'itemreceipt')              originIrSet[o.irId] = true;
            else if (o.tranType === 'inventoryadjustment') originIaSet[o.irId] = true;
        });

        var costMapIR = resolveLotCostByOriginIR(Object.keys(originIrSet));
        var costMapIA = resolveLotCostByOriginIA(Object.keys(originIaSet));

        onHand.forEach(function (row) {
            if (!row.lotInternalId) { row.lotCost = null; return; }
            var origin = originMap[row.lotInternalId];
            if (!origin) { row.lotCost = null; return; }

            // Transferred lot (origin tx ≠ row's own tx): override mbfPrice + currency to match origin
            if (origin.irId && origin.irId !== row.tranId) {
                row.mbfPrice = origin.mbfPrice;
                row.currency = origin.currency;
            }

            // Lot Cost lookup by origin type
            var key = origin.irId + '__' + itemId;
            if (origin.tranType === 'itemreceipt') {
                row.lotCost = (costMapIR[key] !== undefined) ? costMapIR[key] : null;
            } else if (origin.tranType === 'inventoryadjustment') {
                var iaCost = costMapIA[key];
                row.lotCost = (iaCost !== undefined) ? iaCost : null;
                // For IAs: row construction left mbfPrice=0 / currency=''. After USD lookup,
                // mirror lotCost into mbfPrice and stamp USD currency for consistent display.
                //
                // ASSUMPTION (CWP MTL specific): every IA on this subsidiary posts in CAD primary,
                // USD secondary book. The IA saved search filters to USD book → values are USD by
                // construction. Hardcoding 'USD' is correct for this MR file (mtl variant only).
                // If this code path is ever ported to a different subsidiary or a different
                // secondary book, revisit: read the actual book's currency code or expose it as a
                // config constant.
                if (iaCost !== undefined) {
                    row.mbfPrice = iaCost;
                    row.currency = 'USD';
                }
            } else {
                row.lotCost = null;
            }
        });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  buildAvailable — computed from the 5 detail arrays
    // ═══════════════════════════════════════════════════════════════════════════

    const buildAvailable = (onHand, committed, outbound, onOrder, inTransit) => {
        var available = [];

        // Per-lot commitment index — skip unallocated rows (lotNumber '—')
        var committedByLot = {};
        committed.forEach((row) => {
            if (!row.lotNumber || row.lotNumber === '\u2014') return;
            committedByLot[row.lotNumber] = (committedByLot[row.lotNumber] || 0) + (row.packsCommitted || 0);
        });

        var outboundByLot = {};
        outbound.forEach((row) => {
            if (!row.lotNumber || row.lotNumber === '\u2014') return;
            outboundByLot[row.lotNumber] = (outboundByLot[row.lotNumber] || 0) + (row.packs || 0);
        });

        // On Hand lots — unreserved packs
        onHand.forEach((lot) => {
            var lotKey = lot.lotNumber || '';
            var reserved = (committedByLot[lotKey] || 0) + (outboundByLot[lotKey] || 0);
            var packsAvail = roundToTwoDecimals(lot.packsOnHand - reserved);
            if (packsAvail <= 0) return;
            available.push({
                docType:       lot.docType,
                docNumber:     lot.docNumber,
                docUrl:        lot.docUrl,
                poNumber:      lot.poNumber,
                poUrl:         lot.poUrl,
                date:          lot.date,
                lotNumber:     lot.lotNumber,
                lotUrl:        lot.lotUrl,
                mbfPrice:      lot.mbfPrice,
                vendor:        lot.vendor,
                vendorUrl:     lot.vendorUrl,
                status:        'On Hand',
                packsAvail:    packsAvail,
                piecesPerPack: lot.piecesPerPack,
            });
        });

        // On Order rows — include as-is
        onOrder.forEach((row) => {
            if ((row.packs || 0) <= 0) return;
            available.push({
                poNumber:      row.docNumber,
                poUrl:         row.docUrl,
                vendor:        row.vendor,
                vendorUrl:     row.vendorUrl,
                status:        'On Order',
                packsAvail:    row.packs,
                piecesPerPack: row.piecesPerPack,
                mbfPrice:      row.mbfPrice,
            });
        });

        // In Transit rows — include as-is
        inTransit.forEach((row) => {
            if ((row.packs || 0) <= 0) return;
            available.push({
                poNumber:      row.docNumber,
                poUrl:         row.docUrl,
                vendor:        row.vendor,
                vendorUrl:     row.vendorUrl,
                status:        'In Transit',
                packsAvail:    row.packs,
                piecesPerPack: row.piecesPerPack,
                mbfPrice:      row.mbfPrice,
            });
        });

        // ── Split committed into allocated (has lot) vs unallocated (lot '—') ─
        var allocatedCommittedTotal = 0;
        var unallocatedCommitted = [];
        committed.forEach(function (row) {
            if (!row.lotNumber || row.lotNumber === '\u2014') {
                unallocatedCommitted.push(row);
            } else {
                allocatedCommittedTotal += (row.packsCommitted || 0);
            }
        });

        // ── Reconcile: deduct only ALLOCATED committed + all outbound from On Hand ─
        // Unallocated SOs appear as separate rows so the trader can decide allocation.
        var ohContribTarget = roundToTwoDecimals(Math.max(0,
            onHand.reduce(function (s, r) { return s + (r.packsOnHand || 0); }, 0) -
            allocatedCommittedTotal -
            outbound.reduce(function (s, r) { return s + (r.packs || 0); }, 0)
        ));
        var ohContribActual = roundToTwoDecimals(
            available.filter(function (r) { return r.status === 'On Hand'; })
                .reduce(function (s, r) { return s + (r.packsAvail || 0); }, 0)
        );
        var excess = roundToTwoDecimals(ohContribActual - ohContribTarget);
        if (excess > 0) {
            var onHandAvail = available
                .filter(function (r) { return r.status === 'On Hand'; })
                .sort(function (a, b) { return b.packsAvail - a.packsAvail; });
            var rem = excess;
            for (var i = 0; i < onHandAvail.length && rem > 0; i++) {
                var ded = Math.min(onHandAvail[i].packsAvail, rem);
                onHandAvail[i].packsAvail = roundToTwoDecimals(onHandAvail[i].packsAvail - ded);
                rem = roundToTwoDecimals(rem - ded);
            }
            available = available.filter(function (r) { return r.packsAvail > 0; });
        }

        // ── Unallocated committed SOs — distinct rows with negative packsAvail ──
        // Negative value keeps the Available total unchanged (On Hand↑ offset by deduction).
        unallocatedCommitted.forEach(function (row) {
            if ((row.packsCommitted || 0) <= 0) return;
            available.push({
                docNumber:     row.docNumber,
                docUrl:        row.docUrl,
                status:        'Committed',
                packsAvail:    -(row.packsCommitted || 0),
                piecesPerPack: row.piecesPerPack,
                mbfPrice:      row.mbfPrice,
            });
        });

        return available;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  buildSummaryRow — reads formula columns by label from getInputData search
    // ═══════════════════════════════════════════════════════════════════════════

    const buildSummaryRow = (result) => {
        var formulaValues = {};
        result.columns.forEach((col) => {
            if (col.formula) {
                var label = (col.label || '').toLowerCase();
                if (label === 'onhand')    formulaValues.onHand    = result.getValue(col);
                if (label === 'committed') formulaValues.committed = result.getValue(col);
                if (label === 'outbound')  formulaValues.outbound  = result.getValue(col);
                if (label === 'onorder')   formulaValues.onOrder   = result.getValue(col);
            }
        });

        var locationId   = result.getValue({ name: 'inventorylocation', summary: 'GROUP' });
        var locationName = result.getText({ name: 'inventorylocation', summary: 'GROUP' });
        var itemId       = result.getValue({ name: 'internalid', summary: 'MAX' });
        var itemType     = result.getValue({ name: 'type', summary: 'MAX' });
        var fbmPerPiece  = parseFloat(result.getValue({ name: 'custitem_mgsl_fbm', summary: 'GROUP' })) || 0;
        var piecesPerPack = parseFloat(result.getValue({ name: 'custitem_mgsl_ppp', summary: 'GROUP' })) || 0;
        var recordType   = ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem';

        return {
            internalId:   String(itemId),
            locationId:   String(locationId),
            locationName: locationName,
            locationUrl:  getRecordUrl(locationId, 'location'),
            country:      VIRTUAL_LOCATION_IDS[String(locationId)]
                              ? 'Other'
                              : (result.getValue({ name: 'country', join: 'inventoryLocation', summary: 'GROUP' }) || ''),
            isReload:     result.getValue({ name: 'custrecord_is_reload', join: 'inventoryLocation', summary: 'GROUP' }) === 'T',
            itemType:     itemType || 'inventoryitem',
            itemCode:     result.getValue({ name: 'itemid', summary: 'GROUP' }),
            itemName:     result.getValue({ name: 'salesdescription', summary: 'GROUP' }) || result.getValue({ name: 'displayname', summary: 'GROUP' }) || '',
            itemUrl:      getRecordUrl(itemId, recordType),
            thickness:    result.getText({ name: 'csegseg_thickness', summary: 'GROUP' }) || result.getValue({ name: 'csegseg_thickness', summary: 'GROUP' }) || '',
            width:        result.getText({ name: 'csegwidth',         summary: 'GROUP' }) || result.getValue({ name: 'csegwidth',         summary: 'GROUP' }) || '',
            length:       result.getText({ name: 'cseglength',        summary: 'GROUP' }) || result.getValue({ name: 'cseglength',        summary: 'GROUP' }) || '',
            grade:        result.getText({ name: 'cseggrade',         summary: 'GROUP' }) || result.getValue({ name: 'cseggrade',         summary: 'GROUP' }) || '',
            species:      result.getText({ name: 'custitem_species',  summary: 'GROUP' }) || result.getValue({ name: 'custitem_species',  summary: 'GROUP' }) || '',
            finition:     result.getText({ name: 'custitem_finition', summary: 'GROUP' }) || result.getValue({ name: 'custitem_finition', summary: 'GROUP' }) || '',
            humidity:     result.getText({ name: 'custitem_humidity', summary: 'GROUP' }) || result.getValue({ name: 'custitem_humidity', summary: 'GROUP' }) || '',
            plannage:     result.getText({ name: 'custitem_plannage', summary: 'GROUP' }) || result.getValue({ name: 'custitem_plannage', summary: 'GROUP' }) || '',
            etampage:     result.getText({ name: 'custitem_etampage', summary: 'GROUP' }) || result.getValue({ name: 'custitem_etampage', summary: 'GROUP' }) || '',
            autres:       result.getText({ name: 'custitem_autres',   summary: 'GROUP' }) || result.getValue({ name: 'custitem_autres',   summary: 'GROUP' }) || '',
            quantityFBM:  roundToTwoDecimals(parseFloat(result.getValue({ name: 'locationquantityonhand', summary: 'GROUP' })) || 0),
            averageCost:  roundToTwoDecimals(parseFloat(result.getValue({ name: 'locationaveragecost',    summary: 'GROUP' })) || 0),
            fbmPerPiece:  fbmPerPiece,
            mbfFactor:    Math.round((fbmPerPiece * piecesPerPack) / 1000 * 1000000) / 1000000,
            detailKey:    CacheKeysMTL.detailKey(itemId, locationId),
            onHand:       roundToTwoDecimals(parseFloat(formulaValues.onHand)    || 0),
            committed:    roundToTwoDecimals(parseFloat(formulaValues.committed) || 0),
            outbound:     roundToTwoDecimals(parseFloat(formulaValues.outbound)  || 0),
            onOrder:      roundToTwoDecimals(parseFloat(formulaValues.onOrder)   || 0),
            inTransit:    0,
            available:    0,
            currency:     '',
            vendor:       '',
        };
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  getInputData — loads summary search, returns object keyed by itemId__locationId
    // ═══════════════════════════════════════════════════════════════════════════

    const getInputData = () => {
        var subsidiaryId = getScriptParam('custscript_ts_mtl_subsidiary_id', MTL_SUBSIDIARY_ID);
        var forceFull    = getScriptParam('custscript_ts_mtl_force_full_rebuild', false);
        var deltaThreshold = getScriptParam('custscript_ts_mtl_delta_threshold', 500);

        var myCache    = CacheClient.getCache();
        var lastRunStr = myCache.get({ key: CacheKeysMTL.LAST_RUN });

        // ── Throttle: skip processing if less than MIN_INTERVAL_MS since last run ─
        if (!forceFull && lastRunStr) {
            var elapsed = Date.now() - new Date(lastRunStr).getTime();
            if (!isNaN(elapsed) && elapsed < MIN_INTERVAL_MS) {
                log.debug('MTL Cache', 'getInputData: throttled — ' + Math.round(elapsed / 1000) + 's since last run, min=' + (MIN_INTERVAL_MS / 1000) + 's');
                return {};
            }
        }

        var isFullMode = forceFull || !lastRunStr;
        log.audit('MTL Cache', 'getInputData: forceFull=' + forceFull + ' lastRunStr=' + (lastRunStr || '(empty)') + ' isFullMode=' + isFullMode);

        // ── Full mode ─────────────────────────────────────────────────────────
        if (isFullMode) {
            log.audit('MTL Cache', 'getInputData: FULL mode');
            myCache.put({ key: CacheKeysMTL.LAST_INPUT_MODE, value: 'FULL', ttl: CacheKeysMTL.TTL_LAST_RUN });
            var mySearch = loadSummarySearch();
            var fullInput = {};
            var paged = mySearch.runPaged({ pageSize: 1000 });
            paged.pageRanges.forEach((pageRange) => {
                paged.fetch({ index: pageRange.index }).data.forEach((result) => {
                    var row = buildSummaryRow(result);
                    fullInput[row.internalId + '__' + row.locationId] = JSON.stringify(row);
                });
            });
            log.audit('MTL Cache', 'getInputData: FULL mode rows=' + Object.keys(fullInput).length);
            return fullInput;
        }

        // ── Delta detection ───────────────────────────────────────────────────
        var lastRunDate;
        try {
            lastRunDate = new Date(lastRunStr);
            if (isNaN(lastRunDate.getTime())) lastRunDate = null;
        } catch (e) { lastRunDate = null; }

        if (!lastRunDate) {
            log.audit('MTL Cache', 'getInputData: invalid lastRunDate, falling back to FULL');
            myCache.put({ key: CacheKeysMTL.LAST_INPUT_MODE, value: 'FULL', ttl: CacheKeysMTL.TTL_LAST_RUN });
            var mySearch2 = loadSummarySearch();
            var fullInput2 = {};
            runPagedAll(mySearch2).forEach((result) => {
                var row = buildSummaryRow(result);
                fullInput2[row.internalId + '__' + row.locationId] = JSON.stringify(row);
            });
            return fullInput2;
        }

        var tranTypes = [
            search.Type.PURCHASE_ORDER,
            search.Type.SALES_ORDER,
            search.Type.ITEM_RECEIPT,
            search.Type.ITEM_FULFILLMENT,
            search.Type.INVENTORY_ADJUSTMENT,
        ];
        var pairs = {};
        var pairCount = 0;

        tranTypes.forEach((tranType) => {
            try {
                var txnSearch = search.create({
                    type: tranType,
                    filters: [
                        ['subsidiary', 'anyof', String(subsidiaryId)],
                        'AND',
                        ['lastmodifieddate', 'onorafter', lastRunDate],
                    ],
                    columns: [
                        search.createColumn({ name: 'item' }),
                        search.createColumn({ name: 'location' }),
                    ],
                });
                runPagedAll(txnSearch).forEach((r) => {
                    var itemId = r.getValue({ name: 'item' });
                    var locId  = r.getValue({ name: 'location' });
                    if (itemId && locId) {
                        var k = itemId + '__' + locId;
                        if (!pairs[k]) {
                            pairs[k] = { itemId: itemId, locationId: locId };
                            pairCount++;
                        }
                    }
                });
            } catch (e) {
                log.debug('MTL Cache', 'Delta search error for type ' + tranType + ': ' + e.message);
            }
        });

        log.audit('MTL Cache', 'getInputData: DELTA pairCount=' + pairCount + ' threshold=' + deltaThreshold);

        if (pairCount === 0) {
            // Nothing changed — refresh LAST_RUN so throttle stays current, skip processing
            myCache.put({
                key:   CacheKeysMTL.LAST_RUN,
                value: new Date().toISOString(),
                ttl:   CacheKeysMTL.TTL_LAST_RUN,
            });
            log.audit('MTL Cache', 'getInputData: DELTA 0 changes, LAST_RUN refreshed');
            return {};
        }

        if (pairCount > deltaThreshold) {
            log.audit('MTL Cache', 'getInputData: DELTA->FULL fallback (pairCount=' + pairCount + ')');
            myCache.put({ key: CacheKeysMTL.LAST_INPUT_MODE, value: 'FULL', ttl: CacheKeysMTL.TTL_LAST_RUN });
            var mySearch3 = loadSummarySearch();
            var fullInput3 = {};
            runPagedAll(mySearch3).forEach((result) => {
                var row = buildSummaryRow(result);
                fullInput3[row.internalId + '__' + row.locationId] = JSON.stringify(row);
            });
            return fullInput3;
        }

        // Rebuild summary rows for changed pairs only
        myCache.put({ key: CacheKeysMTL.LAST_INPUT_MODE, value: 'DELTA', ttl: CacheKeysMTL.TTL_LAST_RUN });
        var inputData = {};
        var itemsSearch = loadSummarySearch();
        var baseFilters = itemsSearch.filterExpression ? itemsSearch.filterExpression.concat() : [];

        Object.keys(pairs).forEach((k) => {
            var p = pairs[k];
            var rowFilters = baseFilters.concat([
                'AND',
                ['internalid', 'anyof', p.itemId],
                'AND',
                ['inventorylocation', 'anyof', p.locationId],
            ]);
            itemsSearch.filterExpression = rowFilters;
            var results = runPagedAll(itemsSearch, 5);
            if (results.length > 0) {
                var row = buildSummaryRow(results[0]);
                inputData[k] = JSON.stringify(row);
            }
        });

        log.audit('MTL Cache', 'getInputData: DELTA rows=' + Object.keys(inputData).length);
        return inputData;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  map — pass-through
    // ═══════════════════════════════════════════════════════════════════════════

    var mapInvokeCount = 0;
    const map = (context) => {
        mapInvokeCount++;
        if (mapInvokeCount <= 2 || mapInvokeCount % 200 === 0) {
            log.audit('MTL Cache', 'map: invoke#' + mapInvokeCount + ' key=' + context.key);
        }
        if (context.key && context.value) {
            context.write({ key: context.key, value: context.value });
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  reduce — runs 5 detail searches, builds Available, writes cache
    // ═══════════════════════════════════════════════════════════════════════════

    var reduceInvokeCount = 0;
    const reduce = (context) => {
        reduceInvokeCount++;
        var key = context.key;
        var parts = key.split('__');
        var itemId = parts[0];
        var locationId = parts[1];
        if (!itemId || !locationId) return;

        var reduceStartTime = Date.now();

        // Parse summary row from map output
        var summaryRow = null;
        context.values.forEach((v) => {
            try {
                var parsed = JSON.parse(v);
                if (parsed.internalId && parsed.locationId) summaryRow = parsed;
            } catch (e) {}
        });
        if (!summaryRow) {
            log.debug('MTL reduce', '#' + reduceInvokeCount + ' key=' + key + ' — no valid summaryRow, skipping');
            return;
        }

        // ── On Hand detail (inline — uses separate getOnHandSearch cache) ─────
        //
        // Two-pass design:
        //   Pass 1 — drain the search into rawRows, extracting every field pass 2 needs.
        //            Along the way, latch each lot's authoritative PPP/FBM from the first
        //            additive transaction (IR / +IA / CM) into lotPppMap / lotFbmMap.
        //   Pass 2 — iterate rawRows, computing packs with the now-fully-populated latch
        //            maps and running the existing seenLots aggregation.
        //
        // Why two passes: line-level custcol_mgsl_ppp drifts on IF lines (they inherit
        // the SO's commitment PPP, not the lot's received PPP — e.g. SS2416 lot
        // R46450-0019 received at PPP=216 but fulfilled on lines stamped PPP=240, which
        // under-deducts packs). Single-pass with on-the-fly latching only works when the
        // IR is processed before any IF for the lot — but a SuiteQL audit on 2026-05-11
        // found 2,063 (lot, item, location) combos in CWP MTL where the first same-day
        // transaction is an IF (id < the IR's id), so the single-pass latch would miss
        // those. Two passes eliminate the ordering dependency entirely.
        var onHand = (() => {
            try {
                var cached     = getOnHandSearch();
                var mySearch   = cached.search;
                var seenLots   = {};
                var itemData   = [];
                var _ohRowCount = 0;
                var _ohPppFromLot = 0, _ohPppFromCol = 0, _ohPppZero = 0;
                var _ohFbmFromLot = 0, _ohFbmFromItem = 0, _ohFbmFromDims = 0, _ohFbmZero = 0;
                var colPPPFormula     = null;
                var colPackQtyFormula = null;
                var lotPppMap = {};
                var lotFbmMap = {};
                var rawRows  = [];

                mySearch.filters.push(
                    search.createFilter({ name: 'item',     operator: search.Operator.ANYOF, values: itemId }),
                    search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
                );

                // ── Pass 1: extract + latch ──────────────────────────────────
                mySearch.run().each(function (result) {
                    _ohRowCount++;
                    if (!colPPPFormula) {
                        result.columns.forEach(function (col) {
                            if (col.label === 'Piece per Package (PPP)') colPPPFormula     = col;
                            if (col.label === 'Pack Quantity')           colPackQtyFormula = col;
                        });
                    }

                    var lotNumber = result.getText({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
                    if (!lotNumber) return true;

                    var ppp = colPPPFormula ? (parseFloat(result.getValue(colPPPFormula)) || 0) : 0;
                    if (ppp) { _ohPppFromCol++; } else { _ohPppZero++; }

                    var volPCFBM = parseFloat(result.getValue({ name: 'custitem_mgsl_fbm', join: 'item' })) || 0;
                    var thickness = result.getValue({ name: 'csegseg_thickness', join: 'item' }) || '';
                    var width     = result.getValue({ name: 'csegwidth',         join: 'item' }) || '';
                    var len       = result.getValue({ name: 'cseglength',        join: 'item' }) || '';
                    var fbm = volPCFBM;
                    if (fbm) { _ohFbmFromItem++; }
                    else {
                        fbm = computeFbmFromDims(thickness, width, len);
                        if (fbm) { _ohFbmFromDims++; } else { _ohFbmZero++; }
                    }

                    var itemTranQty = colPackQtyFormula ? (parseFloat(result.getValue(colPackQtyFormula)) || 0) : 0;
                    var tranType    = result.recordType;
                    var isAdditive  = tranType === 'itemreceipt' || tranType === 'creditmemo' ||
                                      (tranType === 'inventoryadjustment' && itemTranQty > 0);

                    // First-additive-wins: capture the lot's authoritative PPP/FBM
                    if (isAdditive && ppp > 0 && !lotPppMap[lotNumber]) {
                        lotPppMap[lotNumber] = ppp;
                        lotFbmMap[lotNumber] = fbm;
                    }

                    // Stash every field pass 2 will need so we don't have to hold the
                    // search Result reference across iterations.
                    rawRows.push({
                        lotNumber:           lotNumber,
                        lotId:               result.getValue({ name: 'inventorynumber', join: 'inventoryDetail' }) || '',
                        invDetailQty:        parseFloat(result.getValue({ name: 'quantity', join: 'inventoryDetail' })) || 0,
                        itemTranQty:         itemTranQty,
                        tranType:            tranType,
                        isAdditive:          isAdditive,
                        ppp:                 ppp,
                        fbm:                 fbm,
                        docType:             result.getText({ name: 'type' }),
                        docNumber:           result.getValue({ name: 'tranid' }),
                        tranInternalId:      result.getValue({ name: 'internalid' }),
                        createdFromText:     result.getText({ name: 'createdfrom' }),
                        createdFromId:       result.getValue({ name: 'createdfrom' }),
                        trandate:            result.getValue({ name: 'trandate' }),
                        custbody4:           safeGetValue(result, { name: 'custbody4' }),
                        mainnameText:        result.getText({ name: 'mainname' }),
                        custbodyLotSupplier: safeGetValue(result, { name: 'custbody_lot_supplier' }),
                        vendorInternalId:    result.getValue({ name: 'internalid', join: 'vendor' }),
                        rate:                parseFloat(result.getValue({ name: 'rate' })) || 0,
                        exchangerate:        parseFloat(result.getValue({ name: 'exchangerate' })) || 1,
                        currencyText:        result.getText({ name: 'currency' }),
                        custcol3:            result.getValue({ name: 'custcol3' }) || '',
                    });
                    return true;
                });

                // ── Pass 2: aggregate with the now-complete lotPppMap ────────
                rawRows.forEach(function (row) {
                    var pppToUse = lotPppMap[row.lotNumber] || row.ppp;
                    var fbmToUse = lotFbmMap[row.lotNumber] || row.fbm;

                    var qty = 0;
                    if (row.tranType === 'itemreceipt' || row.tranType === 'creditmemo' ||
                        (row.tranType === 'inventoryadjustment' && row.itemTranQty > 0)) {
                        qty = row.invDetailQty;
                    } else if (row.tranType === 'itemfulfillment' ||
                               (row.tranType === 'inventoryadjustment' && row.itemTranQty < 0)) {
                        qty = -Math.abs(row.invDetailQty);
                    }

                    var packs = (fbmToUse > 0 && pppToUse > 0) ? (qty * 1000) / (pppToUse * fbmToUse) : 0;

                    if (seenLots[row.lotNumber] !== undefined) {
                        var stored = itemData[seenLots[row.lotNumber]];
                        stored.packsOnHand += packs;
                        // Defensive: if first encounter for this lot wasn't an IR, capture
                        // rate/currency/tranId/tranType from the first IR we see.
                        if (row.tranType === 'itemreceipt' && stored.mbfPrice === 0) {
                            stored.mbfPrice = roundToTwoDecimals(row.rate / (row.exchangerate > 0 ? row.exchangerate : 1));
                            stored.currency = CURRENCY_TO_ISO[row.currencyText] || row.currencyText || '';
                            stored.tranId   = row.tranInternalId;
                            stored.tranType = row.tranType;
                        }
                        return;
                    }

                    // First encounter — build the displayed row. pppToUse here is the
                    // lot-authoritative PPP (latched in pass 1) when available, so the
                    // stored piecesPerPack is always correct regardless of which row
                    // came first.
                    seenLots[row.lotNumber] = itemData.length;
                    itemData.push({
                        docType:       row.docType,
                        docNumber:     row.docNumber,
                        docUrl:        getRecordUrl(row.tranInternalId, row.tranType),
                        poNumber:      stripPrefix(row.createdFromText),
                        poUrl:         (row.tranType === 'itemreceipt' && row.createdFromId) ? getRecordUrl(row.createdFromId, 'purchaseorder') : '',
                        date:          (row.tranType === 'inventoryadjustment'
                                        ? (row.custbody4 || row.trandate)
                                        : row.trandate),
                        vendor:        row.mainnameText || row.custbodyLotSupplier || '',
                        vendorUrl:     getRecordUrl(row.vendorInternalId, 'vendor'),
                        lotNumber:     row.lotNumber,
                        lotUrl:        getRecordUrl(row.lotId, 'inventorynumber'),
                        lotInternalId: row.lotId,
                        tranId:        row.tranInternalId,
                        tranType:      row.tranType,
                        packsOnHand:   packs,
                        piecesPerPack: pppToUse,
                        mbfPrice:      row.tranType === 'itemreceipt'
                            ? roundToTwoDecimals(row.rate / (row.exchangerate > 0 ? row.exchangerate : 1))
                            : 0,
                        currency:      row.tranType === 'itemreceipt'
                            ? (CURRENCY_TO_ISO[row.currencyText] || row.currencyText || '')
                            : '',
                        reloadId:      row.custcol3,
                    });
                });

                // Ghost lot filter
                var filtered = itemData.filter(function (row) { return Math.round(row.packsOnHand) > 0; });
                if (reduceInvokeCount <= 3 || reduceInvokeCount % 50 === 0) {
                    log.debug('MTL reduce', 'OnHand item=' + itemId + ' loc=' + locationId +
                        ' | searchRows=' + _ohRowCount + ' uniqueLots=' + Object.keys(seenLots).length +
                        ' preFilter=' + itemData.length + ' postFilter=' + filtered.length +
                        ' | latched lots=' + Object.keys(lotPppMap).length +
                        ' | PPP: lot=' + _ohPppFromLot + ' col=' + _ohPppFromCol + ' ZERO=' + _ohPppZero +
                        ' | FBM: lot=' + _ohFbmFromLot + ' item=' + _ohFbmFromItem + ' dims=' + _ohFbmFromDims + ' ZERO=' + _ohFbmZero);
                }
                return filtered;
            } catch (e) {
                log.error('MTL Cache', 'On Hand detail error: ' + e.message);
                return [];
            }
        })();

        // ── Run 4 other detail searches ───────────────────────────────────────
        var committed = runDetailSearch(COMMITTED_SEARCH_ID,  itemId, locationId, buildCommittedRow);
        var outbound  = runDetailSearch(OUTBOUND_SEARCH_ID,   itemId, locationId, buildOutboundRow);
        var onOrder   = runDetailSearch(ON_ORDER_SEARCH_ID,   itemId, locationId, buildOnOrderRow);
        var inTransit = runDetailSearch(IN_TRANSIT_SEARCH_ID, itemId, locationId, buildInTransitRow);

        // Collapse lot-fanout rows so each SO line is counted once
        committed = dedupeByLine(committed, 'committed');
        outbound  = dedupeByLine(outbound,  'outbound');

        // ── Resolve allocated-PO vendor for committed + outbound rows ─────────
        var vendorByPO = resolveAllocatedPOVendors(committed, outbound);
        applyVendor(committed, vendorByPO);
        applyVendor(outbound,  vendorByPO);

        // ── Lot Cost: origin trace + GL aggregation (Option B) ────────────────
        applyLotCost(onHand, itemId);

        // ── Compute totals from detail arrays ─────────────────────────────────
        var onHandTotal    = roundToTwoDecimals(onHand.reduce(function (s, r) { return s + (r.packsOnHand || 0); }, 0));
        var committedTotal = roundToTwoDecimals(committed.reduce(function (s, r) { return s + (r.packsCommitted || 0); }, 0));
        var outboundTotal  = roundToTwoDecimals(outbound.reduce(function (s, r) { return s + (r.packs || 0); }, 0));
        var onOrderTotal   = roundToTwoDecimals(onOrder.reduce(function (s, r) { return s + (r.packs || 0); }, 0));
        var inTransitTotal = roundToTwoDecimals(inTransit.reduce(function (s, r) { return s + (r.packs || 0); }, 0));
        var availableTotal = roundToTwoDecimals(onHandTotal - committedTotal - outboundTotal + onOrderTotal + inTransitTotal);

        // ── Override summary row fields from detail totals ─────────────────────
        summaryRow.onHand    = Math.round(onHandTotal);
        summaryRow.committed = committedTotal;
        summaryRow.outbound  = outboundTotal;
        summaryRow.onOrder   = onOrderTotal;
        summaryRow.inTransit = inTransitTotal;
        summaryRow.available = availableTotal;
        summaryRow.vendor    = (onHand.length > 0 && onHand[0].vendor)
            ? onHand[0].vendor
            : (onOrder.length > 0 ? onOrder[0].vendor : '');
        // Collect every distinct vendor across all detail buckets so the vendor
        // filter matches rows whose primary vendor differs from the selected one.
        var vendorSet = {};
        var pushVendor = function (v) {
            if (v && !vendorSet[v]) vendorSet[v] = true;
        };
        onHand.forEach(function (r) { pushVendor(r.vendor); });
        onOrder.forEach(function (r) { pushVendor(r.vendor); });
        committed.forEach(function (r) { pushVendor(r.vendor); });
        outbound.forEach(function (r) { pushVendor(r.vendor); });
        inTransit.forEach(function (r) { pushVendor(r.vendor); });
        summaryRow.vendors = Object.keys(vendorSet);
        summaryRow.currency  = (onHand.length > 0 && onHand[0].currency)
            ? onHand[0].currency
            : (locationCurrencyMap[locationId] || 'CAD');


        // ── DEBUG: detail search row counts + computed totals ─────────────────
        if (reduceInvokeCount <= 5 || reduceInvokeCount % 20 === 0) {
            log.audit('MTL reduce', '#' + reduceInvokeCount + ' key=' + key +
                ' | rows: OH=' + onHand.length + ' CM=' + committed.length +
                ' OB=' + outbound.length + ' OO=' + onOrder.length + ' IT=' + inTransit.length +
                ' | totals: OH=' + onHandTotal + ' CM=' + committedTotal +
                ' OB=' + outboundTotal + ' OO=' + onOrderTotal + ' IT=' + inTransitTotal +
                ' AVAIL=' + availableTotal +
                ' | override: vendor=' + (summaryRow.vendor || '(none)') +
                ' currency=' + summaryRow.currency +
                ' | summaryOnHand(pre)=' + (summaryRow.onHand) +
                ' mbfFactor=' + (summaryRow.mbfFactor || 0));
        }

        // ── Collect unique PO numbers for PO filter ─────────────────────────
        var poSet = {};
        onHand.forEach(function (r) { if (r.poNumber && r.poNumber !== '\u2014') poSet[r.poNumber] = true; });
        onOrder.forEach(function (r) { if (r.docNumber) poSet[r.docNumber] = true; });
        inTransit.forEach(function (r) { if (r.docNumber) poSet[r.docNumber] = true; });
        summaryRow.pos = Object.keys(poSet);

        // ── Resolve Lot # URLs (Committed only — On Hand / Outbound built inline) ──
        try {
            var commitLotNames = {};
            committed.forEach(function (r) { if (r.lotNumber && r.lotNumber !== '\u2014') commitLotNames[r.lotNumber] = true; });
            var uniqueCommitLots = Object.keys(commitLotNames);
            if (uniqueCommitLots.length > 0) {
                var lotFilters = [];
                uniqueCommitLots.forEach(function (name, idx) {
                    if (idx > 0) lotFilters.push('OR');
                    lotFilters.push(['inventorynumber', 'is', name]);
                });
                var lotUrlMap = {};
                search.create({
                    type: 'inventorynumber',
                    filters: lotFilters,
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'inventorynumber' }),
                    ],
                }).run().each(function (r) {
                    var lotName = r.getValue({ name: 'inventorynumber' });
                    if (lotName && !lotUrlMap[lotName]) {
                        lotUrlMap[lotName] = getRecordUrl(r.getValue({ name: 'internalid' }), 'inventorynumber');
                    }
                    return true;
                });
                committed.forEach(function (r) { r.lotUrl = lotUrlMap[r.lotNumber] || ''; });
            }
        } catch (e) {
            log.debug('MTL reduce', 'Committed lot URL resolution error: ' + e.message);
        }

        // ── Resolve Allocated PO # URLs (Committed) ──────────────────────────
        try {
            var poTranIds = {};
            committed.forEach(function (r) { if (r.allocatedPO && r.allocatedPO !== '\u2014') poTranIds[r.allocatedPO] = true; });
            var uniquePOTranIds = Object.keys(poTranIds);
            if (uniquePOTranIds.length > 0) {
                var poFilters = [];
                uniquePOTranIds.forEach(function (tid, idx) {
                    if (idx > 0) poFilters.push('OR');
                    poFilters.push(['tranid', 'is', tid]);
                });
                var poUrlMap = {};
                search.create({
                    type: search.Type.PURCHASE_ORDER,
                    filters: poFilters,
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'tranid' }),
                    ],
                }).run().each(function (r) {
                    var tid = r.getValue({ name: 'tranid' });
                    if (tid && !poUrlMap[tid]) {
                        poUrlMap[tid] = getRecordUrl(r.getValue({ name: 'internalid' }), 'purchaseorder');
                    }
                    return true;
                });
                committed.forEach(function (r) { r.allocatedPOUrl = poUrlMap[r.allocatedPO] || ''; });
            }
        } catch (e) {
            log.debug('MTL reduce', 'Allocated PO URL resolution error: ' + e.message);
        }

        // ── Build Available tab ───────────────────────────────────────────────
        var available = buildAvailable(onHand, committed, outbound, onOrder, inTransit);

        // ── Detail payload — 6 buckets (IND has 5; MTL adds available) ────────
        var detailPayload = {
            onHand:    onHand,
            committed: committed,
            outbound:  outbound,
            onOrder:   onOrder,
            inTransit: inTransit,
            available: available,
        };

        // ── Write detail to cache ─────────────────────────────────────────────
        var myCache   = CacheClient.getCache();
        var detKey    = CacheKeysMTL.detailKey(itemId, locationId);
        var detailJson = JSON.stringify(detailPayload);
        var sizeBytes  = detailJson.length;

        if (sizeBytes > CacheKeysMTL.MAX_CACHE_VALUE_BYTES) {
            // Overflow: split into per-bucket entries
            var buckets = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available'];
            buckets.forEach(function (bucket) {
                if (detailPayload[bucket] && detailPayload[bucket].length > 0) {
                    myCache.put({
                        key:   CacheKeysMTL.buildDetailBucketKey(itemId, locationId, bucket),
                        value: JSON.stringify(detailPayload[bucket]),
                        ttl:   CacheKeysMTL.TTL_SUMMARY,
                    });
                }
            });
            if (reduceInvokeCount <= 5 || reduceInvokeCount % 20 === 0) {
                log.audit('MTL reduce', '#' + reduceInvokeCount + ' OVERFLOW detail write: ' + sizeBytes + ' bytes -> per-bucket split');
            }
        } else {
            myCache.put({
                key:   detKey,
                value: detailJson,
                ttl:   CacheKeysMTL.TTL_SUMMARY,
            });
            if (reduceInvokeCount <= 5 || reduceInvokeCount % 20 === 0) {
                log.debug('MTL reduce', '#' + reduceInvokeCount + ' detail write: key=' + detKey + ' size=' + sizeBytes + 'B avail=' + available.length + ' rows');
            }
        }

        var reduceDuration = Date.now() - reduceStartTime;
        if (reduceInvokeCount <= 5 || reduceInvokeCount % 20 === 0) {
            log.debug('MTL reduce', '#' + reduceInvokeCount + ' done in ' + reduceDuration + 'ms');
        }

        // Write summary row to MR output for summarize phase
        context.write({ key: key, value: JSON.stringify(summaryRow) });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  summarize — merge, chunked summary write, meta, self-reschedule
    // ═══════════════════════════════════════════════════════════════════════════

    const summarize = (context) => {
        var startTime = Date.now();
        var myCache = CacheClient.getCache();

        // Log errors + phase timing
        var mapErrors = 0, reduceErrors = 0;
        if (context.inputSummary.error) {
            log.error({ title: 'MTL Input Error', details: context.inputSummary.error });
        }
        context.mapSummary.errors.iterator().each(function (key, error) {
            mapErrors++;
            log.error({ title: 'MTL Map Error key=' + key, details: error });
            return true;
        });
        context.reduceSummary.errors.iterator().each(function (key, error) {
            reduceErrors++;
            log.error({ title: 'MTL Reduce Error key=' + key, details: error });
            return true;
        });
        log.audit('MTL Cache', 'summarize: phase errors: map=' + mapErrors + ' reduce=' + reduceErrors +
            ' | concurrency: map=' + context.mapSummary.concurrency + ' reduce=' + context.reduceSummary.concurrency);

        // Collect summary rows from reduce output
        var allRows = [];
        var parseErrors = 0;
        context.output.iterator().each(function (key, value) {
            try {
                var row = JSON.parse(value);
                if (row) allRows.push(row);
            } catch (e) {
                parseErrors++;
                log.debug('MTL Cache', 'Output parse error key=' + key + ': ' + e.message);
            }
            return true;
        });
        log.audit('MTL Cache', 'summarize: outputRows=' + allRows.length + ' parseErrors=' + parseErrors);

        // ── Throttled run guard: no data + no errors → preserve cache, just re-queue ─
        if (allRows.length === 0 && !context.inputSummary.error && mapErrors === 0 && reduceErrors === 0) {
            log.debug('MTL Cache', 'summarize: throttled (no-op), duration=' + (Date.now() - startTime) + 'ms');
            try {
                var scriptObj = runtime.getCurrentScript();
                var mrTask = task.create({
                    taskType:     task.TaskType.MAP_REDUCE,
                    scriptId:     scriptObj.id,
                    deploymentId: scriptObj.deploymentId,
                    params: {
                        custscript_ts_mtl_subsidiary_id:      scriptObj.getParameter({ name: 'custscript_ts_mtl_subsidiary_id' }) || MTL_SUBSIDIARY_ID,
                        custscript_ts_mtl_force_full_rebuild:  false,
                        custscript_ts_mtl_delta_threshold:     scriptObj.getParameter({ name: 'custscript_ts_mtl_delta_threshold' }) || 500,
                    },
                });
                var taskId = mrTask.submit();
                log.debug('MTL Cache', 'Self-rescheduled (throttled). taskId=' + taskId);
            } catch (e) {
                log.error('MTL Cache', 'Self-reschedule failed: ' + e.message);
            }
            return;
        }

        // FULL: trust allRows (canonical set from summary search). Merging with existing
        // produces "ghost" rows for items the search no longer returns — their detail
        // expires on TTL but summary keeps them alive forever, causing DETAIL_CACHE_MISS.
        // DELTA: merge required since allRows only contains changed items.
        var lastInputMode = myCache.get({ key: CacheKeysMTL.LAST_INPUT_MODE }) || 'FULL';
        var existingSummary = myCache.get({ key: CacheKeysMTL.SUMMARY });
        log.debug('MTL Cache', 'summarize: lastInputMode=' + lastInputMode +
            ' existingSummary present=' + !!existingSummary +
            (existingSummary ? ' length=' + existingSummary.length : ''));
        var mergedRows = allRows;
        var lastRunMode = 'FULL';

        var lastMeta = myCache.get({ key: CacheKeysMTL.META });
        var cacheVersion = 1;
        if (lastMeta) {
            try { cacheVersion = (JSON.parse(lastMeta).cacheVersion || 0) + 1; } catch (e) {}
        }

        if (lastInputMode === 'DELTA' && existingSummary && allRows.length > 0) {
            try {
                var parsed = JSON.parse(existingSummary);
                var existingRows = null;
                if (parsed && parsed.chunked && parsed.chunkCount) {
                    // Reassemble chunked summary before merging
                    existingRows = [];
                    for (var ci = 0; ci < parsed.chunkCount; ci++) {
                        var chunkStr = myCache.get({ key: CacheKeysMTL.buildSummaryDataKey(ci) });
                        if (chunkStr) {
                            var chunkRows = JSON.parse(chunkStr);
                            if (Array.isArray(chunkRows)) existingRows.push.apply(existingRows, chunkRows);
                        }
                    }
                } else if (Array.isArray(parsed)) {
                    existingRows = parsed;
                }
                if (existingRows && existingRows.length > 0) {
                    var byKey = {};
                    existingRows.forEach(function (r) {
                        if (r && r.internalId && r.locationId) byKey[r.internalId + '__' + r.locationId] = r;
                    });
                    allRows.forEach(function (r) {
                        if (r && r.internalId && r.locationId) byKey[r.internalId + '__' + r.locationId] = r;
                    });
                    mergedRows = Object.values(byKey);
                    lastRunMode = 'DELTA';
                }
            } catch (e) {
                log.debug('MTL Cache', 'Existing summary parse error: ' + e.message);
            }
        } else {
            // Dedupe
            var byKey2 = {};
            mergedRows.forEach(function (r) {
                if (r && r.internalId && r.locationId) byKey2[r.internalId + '__' + r.locationId] = r;
            });
            mergedRows = Object.values(byKey2);
        }

        var now    = new Date();
        var nowIso = now.toISOString();

        // Country distribution — safety net to catch locations with missing country
        var countryDist = { CA: 0, US: 0, Other: 0, empty: 0, unknown: 0 };
        mergedRows.forEach(function (r) {
            var c = (r && r.country) || '';
            if (c === 'CA')         countryDist.CA++;
            else if (c === 'US')    countryDist.US++;
            else if (c === 'Other') countryDist.Other++;
            else if (c === '')      countryDist.empty++;
            else                    countryDist.unknown++;
        });
        log.audit('MTL country distribution', JSON.stringify(countryDist));

        // Chunked summary write
        var fullJson = JSON.stringify(mergedRows);
        var summaryChunkCount = 1;
        if (fullJson.length <= CacheKeysMTL.MAX_CACHE_VALUE_BYTES) {
            myCache.put({ key: CacheKeysMTL.SUMMARY, value: fullJson, ttl: CacheKeysMTL.TTL_SUMMARY });
        } else {
            var chunkSize    = CacheKeysMTL.MAX_CACHE_VALUE_BYTES;
            var rowsPerChunk = Math.max(1, Math.floor(mergedRows.length / Math.ceil(fullJson.length / chunkSize)));
            summaryChunkCount = 0;
            for (var i = 0; i < mergedRows.length; i += rowsPerChunk) {
                var slice = mergedRows.slice(i, i + rowsPerChunk);
                myCache.put({
                    key:   CacheKeysMTL.buildSummaryDataKey(summaryChunkCount),
                    value: JSON.stringify(slice),
                    ttl:   CacheKeysMTL.TTL_SUMMARY,
                });
                summaryChunkCount++;
            }
            myCache.put({
                key:   CacheKeysMTL.SUMMARY,
                value: JSON.stringify({ chunked: true, chunkCount: summaryChunkCount }),
                ttl:   CacheKeysMTL.TTL_SUMMARY,
            });
            log.audit('MTL Cache', 'summarize: wrote ' + summaryChunkCount + ' chunks for ' + mergedRows.length + ' rows');
        }

        // Collect unique PO numbers across all summary rows for the PO filter
        var allPOSet = {};
        mergedRows.forEach(function (r) {
            if (r.pos && Array.isArray(r.pos)) {
                r.pos.forEach(function (po) { allPOSet[po] = true; });
            }
        });
        var uniquePOs = Object.keys(allPOSet).sort();

        // Write meta
        myCache.put({
            key:   CacheKeysMTL.META,
            value: JSON.stringify({
                cacheVersion:      cacheVersion,
                lastUpdated:       nowIso,
                rowCount:          mergedRows.length,
                lastRunMode:       lastRunMode,
                lastRunTimestamp:  nowIso,
                summaryChunkCount: summaryChunkCount,
                deltaCount:        lastRunMode === 'DELTA' ? allRows.length : undefined,
                uniquePOs:         uniquePOs,
            }),
            ttl: CacheKeysMTL.TTL_SUMMARY,
        });

        // Write last-run timestamp
        myCache.put({
            key:   CacheKeysMTL.LAST_RUN,
            value: nowIso,
            ttl:   CacheKeysMTL.TTL_LAST_RUN,
        });

        // ── DEBUG: verify LAST_RUN was actually persisted ─────────────────────
        var lastRunReadBack = myCache.get({ key: CacheKeysMTL.LAST_RUN });
        log.audit('MTL Cache', 'LAST_RUN write verification: wrote=' + nowIso +
            ' readBack=' + (lastRunReadBack || '(null)') +
            ' match=' + (lastRunReadBack === nowIso));

        // ── DEBUG: summary write size ─────────────────────────────────────────
        log.audit('MTL Cache', 'Summary write: totalRows=' + mergedRows.length +
            ' jsonSize=' + fullJson.length + 'B' +
            ' chunked=' + (summaryChunkCount > 1) +
            ' chunkCount=' + summaryChunkCount +
            ' mode=' + lastRunMode +
            ' cacheVersion=' + cacheVersion);

        var duration = Date.now() - startTime;
        log.audit('MTL Cache', 'Completed. allRows=' + allRows.length + ', mergedRows=' + mergedRows.length + ', duration=' + duration + 'ms');

        // Self-reschedule to same deployment
        try {
            var scriptObj = runtime.getCurrentScript();
            var mrTask = task.create({
                taskType:     task.TaskType.MAP_REDUCE,
                scriptId:     scriptObj.id,
                deploymentId: scriptObj.deploymentId,
                params: {
                    custscript_ts_mtl_subsidiary_id:      scriptObj.getParameter({ name: 'custscript_ts_mtl_subsidiary_id' }) || MTL_SUBSIDIARY_ID,
                    custscript_ts_mtl_force_full_rebuild:  false,
                    custscript_ts_mtl_delta_threshold:     scriptObj.getParameter({ name: 'custscript_ts_mtl_delta_threshold' }) || 500,
                },
            });
            var taskId = mrTask.submit();
            log.audit('MTL Cache', 'Self-rescheduled. taskId=' + taskId);
        } catch (e) {
            log.error('MTL Cache', 'Self-reschedule failed: ' + e.message);
        }
    };

    return {
        getInputData: getInputData,
        map:          map,
        reduce:       reduce,
        summarize:    summarize,
    };
});
