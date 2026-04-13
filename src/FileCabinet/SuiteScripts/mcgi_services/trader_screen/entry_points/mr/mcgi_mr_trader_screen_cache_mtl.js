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

    const SUMMARY_SEARCH_ID    = 'customsearch_suitelet_all_items_search_m';
    const ON_HAND_SEARCH_ID    = 'customsearch_mgsl_trader_onhand_tran_mtl';
    const IN_TRANSIT_SEARCH_ID = 'customsearch_mgsl_trader_intransit_mtl';
    const COMMITTED_SEARCH_ID  = 'customsearch_mgsl_trader_committed_mtl';
    const ON_ORDER_SEARCH_ID   = 'customsearch_mgsl_trader_onorder_mtl';
    const OUTBOUND_SEARCH_ID   = 'customsearch_mgsl_trader_outbound_mtl';

    const ITEM_RECORD_TYPE_MAPPING = {
        Assembly:          'assemblyitem',
        InvtPart:          'inventoryitem',
        'Inventory Item':  'inventoryitem',
        inventoryItem:     'inventoryitem',
    };

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

    // Lot name format: {PO#}-{FBM_per_piece}-{PPP}  e.g. "PO344996-6-240"
    const parseFbmFromLot = (lotNumber) => {
        if (!lotNumber) return 0;
        var parts = String(lotNumber).split('-');
        if (parts.length < 3) return 0;
        var fbm = parseFloat(parts[parts.length - 2]);
        return isNaN(fbm) || fbm <= 0 ? 0 : fbm;
    };

    const parsePppFromLot = (lotNumber) => {
        if (!lotNumber) return 0;
        var match = String(lotNumber).match(/-(\d+(?:\.\d+)?)$/);
        if (!match) return 0;
        var val = parseFloat(match[1]);
        return isNaN(val) || val <= 0 ? 0 : val;
    };

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
            _onHandMtlCache = {
                search:        s,
                baseFilterLen: s.filters.length,
            };
        }
        _onHandMtlCache.search.filters.length = _onHandMtlCache.baseFilterLen;
        return _onHandMtlCache;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ROW BUILDERS — formula column refs cached at module scope
    // ═══════════════════════════════════════════════════════════════════════════

    var colPackCommitted       = null;
    var colInTransitAdditional = null;
    var colOpenQty             = null;
    var colShippedPacks        = null;

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
        return {
            docNumber:      r.getValue({ name: 'tranid' }),
            docUrl:         getRecordUrl(docId, 'salesorder'),
            customer:       r.getText({ name: 'entity' }),
            customerUrl:    getRecordUrl(entityId, 'customer'),
            soCreationDate: r.getValue({ name: 'trandate' }),
            shipWeek:       r.getValue({ name: 'custbody_ship_week' }) || '',
            packsCommitted: packsCommitted,
            piecesPerPack:  ppp,
            mbfPrice:       roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
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
        return {
            docNumber:     r.getValue({ name: 'tranid' }),
            docUrl:        getRecordUrl(docId, 'purchaseorder'),
            shipWeek:      r.getValue({ name: 'custbody_ship_week' }) || '',
            vendor:        r.getText({ name: 'mainname' }),
            vendorUrl:     getRecordUrl(vendorId, 'vendor'),
            packs:         packs,
            piecesPerPack: ppp,
            mbfPrice:      roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
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
        return {
            docNumber:     r.getValue({ name: 'tranid', summary: 'GROUP' }),
            docUrl:        getRecordUrl(docId, 'purchaseorder'),
            vendor:        r.getValue({ name: 'entityid', join: 'vendor', summary: 'GROUP' }) || '',
            vendorUrl:     getRecordUrl(vendorId, 'vendor'),
            shipWeek:      r.getValue({ name: 'custbody_ship_week', summary: 'GROUP' }) || '',
            packs:         packs,
            piecesPerPack: ppp,
            mbfPrice:      roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate', summary: 'MAX' })) || 0),
        };
    };

    // ── Outbound ──────────────────────────────────────────────────────────────
    const buildOutboundRow = (r) => {
        if (!colShippedPacks) {
            r.columns.forEach((col) => {
                if (col.label === 'Invoiced Quantity') colShippedPacks = col;
            });
            if (!colShippedPacks) log.error('MTL Outbound', 'Formula column "Invoiced Quantity" not found');
        }
        var packs = roundToTwoDecimals(parseFloat(colShippedPacks ? r.getValue(colShippedPacks) : 0) || 0);
        if (packs <= 0) return null;

        var docId    = r.getValue({ name: 'internalid' });
        var entityId = r.getValue({ name: 'entity' });
        var ppp      = parseFloat(r.getValue({ name: 'custcol_mgsl_ppp' })) ||
                       parseFloat(r.getValue({ name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        var lotNumber = r.getValue({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
        return {
            docNumber:     r.getValue({ name: 'tranid' }),
            docUrl:        getRecordUrl(docId, 'salesorder'),
            lotNumber:     lotNumber || '\u2014',
            customer:      r.getText({ name: 'entity' }),
            customerUrl:   getRecordUrl(entityId, 'customer'),
            invoicedDate:  r.getValue({ name: 'trandate', join: 'billingTransaction' }) || '',
            packs:         packs,
            piecesPerPack: ppp,
            mbfPrice:      roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
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
                poNumber:      lot.poNumber,
                date:          lot.date,
                lotNumber:     lot.lotNumber,
                mbfPrice:      lot.mbfPrice,
                vendor:        lot.vendor,
                status:        'On Hand',
                packsAvail:    packsAvail,
                piecesPerPack: lot.piecesPerPack,
            });
        });

        // On Order rows — include as-is
        onOrder.forEach((row) => {
            if ((row.packs || 0) <= 0) return;
            available.push({
                docNumber:     row.docNumber,
                vendor:        row.vendor,
                status:        'On Order',
                packsAvail:    row.packs,
                piecesPerPack: row.piecesPerPack,
            });
        });

        // In Transit rows — include as-is
        inTransit.forEach((row) => {
            if ((row.packs || 0) <= 0) return;
            available.push({
                docNumber:     row.docNumber,
                vendor:        row.vendor,
                status:        'In Transit',
                packsAvail:    row.packs,
                piecesPerPack: row.piecesPerPack,
            });
        });

        // ── Reconcile: deduct unmatched committed/outbound from On Hand lots ─
        // Per-lot allocation misses outbound/committed rows whose lot numbers
        // are '—' or don't match any On Hand lot.  Compute the aggregate
        // On Hand contribution target and trim the largest lots to match.
        var ohContribTarget = roundToTwoDecimals(Math.max(0,
            onHand.reduce(function (s, r) { return s + (r.packsOnHand || 0); }, 0) -
            committed.reduce(function (s, r) { return s + (r.packsCommitted || 0); }, 0) -
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
        var isFullMode = forceFull || !lastRunStr;
        log.audit('MTL Cache', 'getInputData: forceFull=' + forceFull + ' lastRunStr=' + (lastRunStr || '(empty)') + ' isFullMode=' + isFullMode);

        // ── Full mode ─────────────────────────────────────────────────────────
        if (isFullMode) {
            log.audit('MTL Cache', 'getInputData: FULL mode');
            var mySearch = search.load({ id: SUMMARY_SEARCH_ID });
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
            var mySearch2 = search.load({ id: SUMMARY_SEARCH_ID });
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

        if (pairCount > deltaThreshold || pairCount === 0) {
            log.audit('MTL Cache', 'getInputData: DELTA->FULL fallback');
            var mySearch3 = search.load({ id: SUMMARY_SEARCH_ID });
            var fullInput3 = {};
            runPagedAll(mySearch3).forEach((result) => {
                var row = buildSummaryRow(result);
                fullInput3[row.internalId + '__' + row.locationId] = JSON.stringify(row);
            });
            return fullInput3;
        }

        // Rebuild summary rows for changed pairs only
        var inputData = {};
        var itemsSearch = search.load({ id: SUMMARY_SEARCH_ID });
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

                mySearch.filters.push(
                    search.createFilter({ name: 'item',     operator: search.Operator.ANYOF, values: itemId }),
                    search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
                );

                mySearch.run().each(function (result) {
                    _ohRowCount++;
                    // Discover formula columns on first row
                    if (!colPPPFormula) {
                        result.columns.forEach(function (col) {
                            if (col.label === 'Piece per Package (PPP)') colPPPFormula     = col;
                            if (col.label === 'Pack Quantity')           colPackQtyFormula = col;
                        });
                    }

                    var lotNumber    = result.getValue({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
                    if (!lotNumber) return true;

                    var invDetailQty = parseFloat(result.getValue({ name: 'quantity', join: 'inventoryDetail' })) || 0;
                    var itemTranQty  = colPackQtyFormula ? (parseFloat(result.getValue(colPackQtyFormula)) || 0) : 0;
                    var volPCFBM     = parseFloat(result.getValue({ name: 'custitem_mgsl_fbm', join: 'item' })) || 0;
                    var tranType     = result.recordType;

                    var thickness = result.getValue({ name: 'csegseg_thickness', join: 'item' }) || '';
                    var width     = result.getValue({ name: 'csegwidth',         join: 'item' }) || '';
                    var len       = result.getValue({ name: 'cseglength',        join: 'item' }) || '';

                    // Signed MBF qty — use invDetailQty, NOT Pack Quantity
                    var qty = 0;
                    if (tranType === 'itemreceipt' || tranType === 'creditmemo' ||
                        (tranType === 'inventoryadjustment' && itemTranQty > 0)) {
                        qty = invDetailQty;
                    } else if (tranType === 'itemfulfillment' ||
                               (tranType === 'inventoryadjustment' && itemTranQty < 0)) {
                        qty = -Math.abs(invDetailQty);
                    }

                    // PPP fallback chain
                    var ppp = parsePppFromLot(lotNumber);
                    if (ppp) { _ohPppFromLot++; }
                    else {
                        if (colPPPFormula) ppp = parseFloat(result.getValue(colPPPFormula)) || 0;
                        if (ppp) { _ohPppFromCol++; } else { _ohPppZero++; }
                    }

                    // FBM fallback chain
                    var fbm = parseFbmFromLot(lotNumber);
                    if (fbm) { _ohFbmFromLot++; }
                    else {
                        fbm = volPCFBM;
                        if (fbm) { _ohFbmFromItem++; }
                        else {
                            fbm = computeFbmFromDims(thickness, width, len);
                            if (fbm) { _ohFbmFromDims++; } else { _ohFbmZero++; }
                        }
                    }

                    var packs = (fbm > 0 && ppp > 0) ? (qty * 1000) / (ppp * fbm) : 0;

                    // Aggregate branch — lot already seen
                    if (seenLots[lotNumber] !== undefined) {
                        itemData[seenLots[lotNumber]].packsOnHand += packs;
                        // Defensive: capture rate/currency if first encounter was IF
                        if (tranType === 'itemreceipt' && itemData[seenLots[lotNumber]].mbfPrice === 0) {
                            itemData[seenLots[lotNumber]].mbfPrice  = parseFloat(result.getValue({ name: 'rate' })) || 0;
                            itemData[seenLots[lotNumber]].currency  = CURRENCY_TO_ISO[result.getText({ name: 'currency' })] || result.getText({ name: 'currency' }) || '';
                        }
                        return true;
                    }

                    // First encounter — full row
                    seenLots[lotNumber] = itemData.length;
                    itemData.push({
                        docType:       result.getText({ name: 'type' }),
                        docNumber:     result.getValue({ name: 'tranid' }),
                        docUrl:        getRecordUrl(result.getValue({ name: 'internalid' }), tranType),
                        poNumber:      stripPrefix(result.getText({ name: 'createdfrom' })),
                        date:          result.getValue({ name: 'trandate' }),
                        vendor:        result.getText({ name: 'mainname' }),
                        vendorUrl:     getRecordUrl(result.getValue({ name: 'internalid', join: 'vendor' }), 'vendor'),
                        lotNumber:     lotNumber,
                        packsOnHand:   packs,
                        piecesPerPack: ppp,
                        mbfPrice:      tranType === 'itemreceipt' ? (parseFloat(result.getValue({ name: 'rate' })) || 0) : 0,
                        currency:      tranType === 'itemreceipt'
                            ? (CURRENCY_TO_ISO[result.getText({ name: 'currency' })] || result.getText({ name: 'currency' }) || '')
                            : '',
                        reloadId:      result.getValue({ name: 'custcol3' }) || '',
                    });
                    return true;
                });

                // Ghost lot filter
                var filtered = itemData.filter(function (row) { return Math.round(row.packsOnHand) > 0; });
                if (reduceInvokeCount <= 3 || reduceInvokeCount % 50 === 0) {
                    log.debug('MTL reduce', 'OnHand item=' + itemId + ' loc=' + locationId +
                        ' | searchRows=' + _ohRowCount + ' uniqueLots=' + Object.keys(seenLots).length +
                        ' preFilter=' + itemData.length + ' postFilter=' + filtered.length +
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

        // Read existing summary for delta merge (handles chunked summaries)
        var existingSummary = myCache.get({ key: CacheKeysMTL.SUMMARY });
        log.debug('MTL Cache', 'summarize: existingSummary key present=' + !!existingSummary +
            (existingSummary ? ' length=' + existingSummary.length : ''));
        var mergedRows = allRows;
        var lastRunMode = 'FULL';

        var lastMeta = myCache.get({ key: CacheKeysMTL.META });
        var cacheVersion = 1;
        if (lastMeta) {
            try { cacheVersion = (JSON.parse(lastMeta).cacheVersion || 0) + 1; } catch (e) {}
        }

        if (existingSummary && allRows.length > 0) {
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

        // Self-reschedule — DISABLED for initial testing.
        // Uncomment once delta mode and cache read/write are confirmed stable.
        // try {
        //     var scriptObj = runtime.getCurrentScript();
        //     var mrTask = task.create({
        //         taskType:     task.TaskType.MAP_REDUCE,
        //         scriptId:     scriptObj.id,
        //         deploymentId: scriptObj.deploymentId,
        //         params: {
        //             custscript_ts_mtl_subsidiary_id:     scriptObj.getParameter({ name: 'custscript_ts_mtl_subsidiary_id' }) || MTL_SUBSIDIARY_ID,
        //             custscript_ts_mtl_force_full_rebuild: false,
        //             custscript_ts_mtl_delta_threshold:    scriptObj.getParameter({ name: 'custscript_ts_mtl_delta_threshold' }) || 500,
        //         },
        //     });
        //     var taskId = mrTask.submit();
        //     log.audit('MTL Cache', 'Self-rescheduled. taskId=' + taskId);
        // } catch (e) {
        //     log.error('MTL Cache', 'Self-reschedule failed: ' + e.message);
        // }
        log.audit('MTL Cache', 'Self-reschedule DISABLED — manual trigger only');
    };

    return {
        getInputData: getInputData,
        map:          map,
        reduce:       reduce,
        summarize:    summarize,
    };
});
