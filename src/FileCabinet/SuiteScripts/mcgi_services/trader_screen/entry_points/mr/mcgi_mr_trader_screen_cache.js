/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @description Pre-computes Trader Screen inventory data for CWP Industriel Inc. and writes to N/cache.
 * Runs on schedule (every 15 min). Supports full rebuild and incremental delta modes.
 *
 * @param {number} custscript_ts_subsidiary_id - CWP Industriel Inc. subsidiary internal ID (required)
 * @param {boolean} custscript_ts_force_full_rebuild - Force full rebuild (default: false)
 * @param {number} custscript_ts_delta_fallback_threshold - Fall back to full rebuild if delta pairs > this (default: 500)
 */
define([
    'N/search', 'N/cache', 'N/log', 'N/runtime', 'N/task', 'N/query',
    '../../shared/cacheKeys',
    '../../shared/cacheClient',
    '../../shared/urlResolver',
    '/SuiteScripts/MCGI_LIB_LotCost',
], (search, cache, log, runtime, task, query, CacheKeys, CacheClient, UrlResolver, LotCostLib) => {
    const { TTL_SUMMARY, TTL_DETAIL, TTL_LAST_RUN, buildDetailKey, buildDetailBucketKey } = CacheKeys;

    // Cache-health constants ported from the MTL MR (2026-07-29). The self-
    // reschedule loop spins continuously; the throttle gates real work, and the
    // hourly FULL refreshes quiet keys' detail entries (rewritten only when their
    // key rebuilds) and covers transaction types the delta list can't see.
    const MIN_INTERVAL_MS = 60000;            // 1 minute between real processing runs
    const FULL_REFRESH_MS = 60 * 60 * 1000;   // force a FULL at least hourly
    const { getRecordUrl } = UrlResolver;

    const ITEM_DATA_SEARCH_ID = 'customsearch_suitelet_all_items_search_n';
    const ON_HAND_SEARCH_ID = 'customsearch_mgsl_trader_onhand_tran_nts';
    const COMMITTED_SEARCH_ID = 'customsearch_mgsl_trader_committed_nts';
    const OUTBOUND_SEARCH_ID = 'customsearch_mgsl_trader_outbound_nts';
    const ON_ORDER_SEARCH_ID = 'customsearch_mgsl_trader_onorder_nts';
    const IN_TRANSIT_SEARCH_ID = 'customsearch_mgsl_trader_intransit_nts';

    // --- Search caching: load each saved search once per MR batch (~200 invocations) ---
    // Module-level state resets automatically on MR re-queue (module reload).
    var _detailSearchCache = {};

    /**
     * Returns a cached Search object for the given searchId.
     * Resets filters to their original state before returning so
     * per-invocation item/location filters don't accumulate.
     */
    function getDetailSearch(searchId) {
        if (!_detailSearchCache[searchId]) {
            var s = search.load({ id: searchId });
            // PROD bug fix: in-transit detail saved search has hardcoded
            // location.internalid=7 / tolocation.internalid=7 filter that excludes
            // all locations except 7. Strip it; runDetailSearch adds a dynamic
            // location formula filter that mirrors the count formula's logic.
            if (searchId === IN_TRANSIT_SEARCH_ID) {
                s.filters = s.filters.filter(function(f) {
                    var formula = f.formula || '';
                    return formula.indexOf('tolocation.internalid') === -1;
                });
            }
            // PO Allocation needs the line-level PO segment on committed/outbound rows
            // so it can match SO commits to a specific PO segment without running its
            // own SuiteQL — see plans/for-po-allocation-sbx-transient.
            // In-transit too: it lets PO Allocation pre-commit against billed-but-not-
            // received rows. PO and (now) Transfer Order lines both carry the segment
            // (TOs stamped by MSL_UE_allocationSegmentSync); segment-less rows are skipped.
            if (searchId === COMMITTED_SEARCH_ID || searchId === OUTBOUND_SEARCH_ID || searchId === IN_TRANSIT_SEARCH_ID) {
                s.columns.push(search.createColumn({ name: 'line.cseg_po_segment_gl' }));
            }
            // Lot (inventoryDetail.inventorynumber) + source `location` let
            // buildInTransitRow price a Transfer Order row from its transferred lot's
            // cost (TO lines have rate=0). PO in-transit rows have no lot → unaffected.
            if (searchId === IN_TRANSIT_SEARCH_ID) {
                s.columns.push(search.createColumn({ name: 'inventorynumber', join: 'inventoryDetail' }));
                s.columns.push(search.createColumn({ name: 'location' }));
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

    /**
     * Cached onHand search with pre-pushed custom columns.
     * Columns are added once; only filters are reset per invocation.
     */
    var _onHandCache = null;
    function getOnHandSearch() {
        if (!_onHandCache) {
            var s = search.load({ id: ON_HAND_SEARCH_ID });
            s.columns.push(
                search.createColumn({ name: 'trandate', sort: search.Sort.ASC })
            );
            var colAdjValue = search.createColumn({
                name: 'formulanumeric',
                formula: "CASE WHEN {type} = 'Inventory Adjustment' THEN CASE WHEN {quantity} > 0 THEN ABS(NVL({custcol_mgsl_packqty}, 0)) WHEN {quantity} < 0 THEN -ABS(NVL({custcol_mgsl_packqty}, 0)) ELSE 0 END WHEN {type} = 'Item Receipt' THEN ABS(NVL({custcol_mgsl_packqty}, 0)) WHEN {type} = 'Item Fulfillment' THEN -ABS(NVL({custcol_mgsl_packqty}, 0)) WHEN {type} = 'Credit Memo' THEN ABS(NVL({custcol_mgsl_packqty}, 0)) ELSE 0 END",
            });
            s.columns.push(colAdjValue);
            // PO segment on the source transaction line. Present on IRs (copied from
            // the originating PO line) and on IAs (set directly). Used by PO Allocation
            // to match received-segment availability without running its own SuiteQL —
            // see plans/for-po-allocation-sbx-transient.
            s.columns.push(search.createColumn({ name: 'cseg_po_segment_gl' }));
            // PPP sources, read as PLAIN columns so line-level and item-level stay
            // distinguishable. Deliberately NOT the saved search's 'Piece per Package
            // (PPP)' formula column: that formula collapses the two
            // (custcol_mgsl_ppp → NVL → item.custitem_mgsl_ppp), so when the line
            // value is empty it hands back the item's nominal PPP with no way to tell
            // — and the item nominal then silently outranks the lot name. Lot
            // SO-IND-246357-2.625-308 is exactly that case: 308 pieces/pack per the
            // lot name, item nominal 342, and trusting the collapsed value turned a
            // clean 3.00 packs into 2.70 (prod audit, 2026-07-31). Reading them apart
            // also drops the dependency on that column's label.
            s.columns.push(search.createColumn({ name: 'custcol_mgsl_ppp' }));
            s.columns.push(search.createColumn({ name: 'custitem_mgsl_ppp', join: 'item' }));
            _onHandCache = {
                search: s,
                colAdjValue: colAdjValue,
                baseFilterLen: s.filters.length,
            };
        }
        _onHandCache.search.filters.length = _onHandCache.baseFilterLen;
        return _onHandCache;
    }

    /**
     * SuiteQL lookup: PO line pricing for a given item.
     * Returns map keyed by "poId_ppp" → { rate, prixPiece }.
     * Cached per itemId across reduce invocations within the same MR batch.
     */
    var _poPricingCache = {};
    function getPoPricingForItem(itemId) {
        if (_poPricingCache[itemId]) return _poPricingCache[itemId];
        try {
            var results = query.runSuiteQL({
                query: "SELECT t.id AS po_id, tl.custcol_mgsl_ppp AS ppp, tl.rate, tl.custcol_prixpiece " +
                       "FROM transactionline tl " +
                       "JOIN transaction t ON t.id = tl.transaction " +
                       "WHERE tl.item = ? " +
                       "AND t.type = 'PurchOrd' " +
                       "AND tl.mainline = 'F' " +
                       "AND tl.custcol_mgsl_ppp IS NOT NULL",
                params: [itemId]
            }).asMappedResults();
            var map = {};
            results.forEach(function (r) {
                map[r.po_id + '_' + parseFloat(r.ppp)] = {
                    rate: parseFloat(r.rate) || 0,
                    prixPiece: parseFloat(r.custcol_prixpiece) || 0,
                };
            });
            _poPricingCache[itemId] = map;
            return map;
        } catch (e) {
            log.error('getPoPricingForItem', 'SuiteQL error for item ' + itemId + ': ' + e.message);
            return {};
        }
    }

    const ITEM_RECORD_TYPE_MAPPING = {
        InvAdjst: 'inventoryadjustment',
        Assembly: 'assemblyitem',
        inventoryItem: 'inventoryitem',
        InvtPart: 'inventoryitem',
        ItemRcpt: 'itemreceipt',
        TrnfrOrd: 'transferorder',
        'Transfer Order': 'transferorder',
        Build: 'assemblybuild',
        invwksht: 'inventoryworksheet',
        'Inventory Item': 'inventoryitem',
        'Sales Order': 'salesorder',
        SalesOrd: 'salesorder',
        salesorder: 'salesorder',
        purchaseorder: 'purchaseorder',
        PurchOrd: 'purchaseorder',
        'purchase order': 'purchaseorder',
        workorder: 'workorder',
        ItemShip: 'itemfulfillment',
        ItemFulfillment: 'itemfulfillment',
        vendor: 'vendor',
        CustCred: 'creditmemo',
    };

    const roundToTwoDecimals = num => Math.round((parseFloat(num) || 0) * 100) / 100;

    // Smallest on-hand pack quantity still worth showing. Guards the ghost-lot
    // filter against float residue (1 - 1 = 1e-16) without rounding real partial
    // packs away — see the On Hand builder's filter comment.
    const PACK_EPSILON = 0.005;

    /**
     * Legacy PPP source, kept as a last-resort fallback: NetSuite-generated lot
     * names end in the pack's piece count ('Remanufacturing Order
     * #RO-IND-499-1-14552' → 14552). Vendor-named lots ('347516-Dion') don't
     * match — those must come from the saved search's PPP column instead.
     * Returns 0 (not 1) on no match; a bogus PPP of 1 turns packs into pieces.
     */
    const pppFromLotName = (lotName) => {
        const m = String(lotName || '').match(/-(\d+(?:\.\d+)?)$/);
        return m ? Number(m[1]) : 0;
    };

    const getScriptParam = (name, defaultValue) => {
        try {
            const script = runtime.getCurrentScript();
            const val = script.getParameter({ name: name });
            if (val === null || val === undefined) return defaultValue;
            return val;
        } catch (e) {
            return defaultValue;
        }
    };

    /**
     * Run a search with runPaged() and collect all results into an array.
     * @param {search.Search} searchObj - loaded or created search
     * @param {number} [pageSize=1000] - page size (5-1000)
     * @returns {search.Result[]} all results
     */
    const runPagedAll = (searchObj, pageSize) => {
        const results = [];
        const paged = searchObj.runPaged({ pageSize: pageSize || 1000 });
        paged.pageRanges.forEach((pageRange) => {
            paged.fetch({ index: pageRange.index }).data.forEach((result) => {
                results.push(result);
            });
        });
        return results;
    };

    /**
     * Build summary row from search result. Matches TS_SUMMARY schema per requirements §3.4.
     */
    const buildSummaryRow = (result, subsidiaryId) => {
        const formulaValues = {};
        result.columns.forEach((col) => {
            if (col.formula) {
                const label = (col.label || '').toLowerCase();
                if (label === 'onhand') formulaValues.onHand = result.getValue(col);
                if (label === 'commited') formulaValues.commited = result.getValue(col);
                if (label === 'onorder') formulaValues.onOrder = result.getValue(col);
                if (label === 'intransit') formulaValues.inTransit = result.getValue(col);
                if (label === 'outbound') formulaValues.outbound = result.getValue(col);
            }
        });

        const onHand = roundToTwoDecimals(parseFloat(formulaValues.onHand) || 0);
        const committed = roundToTwoDecimals(parseFloat(formulaValues.commited) || 0);
        const outbound = roundToTwoDecimals(parseFloat(formulaValues.outbound) || 0);
        const onOrder = roundToTwoDecimals(parseFloat(formulaValues.onOrder) || 0);
        const inTransit = roundToTwoDecimals(parseFloat(formulaValues.inTransit) || 0);
        const available = roundToTwoDecimals(onHand - committed - outbound + onOrder + inTransit);

        const locationId = result.getValue({ name: 'inventorylocation', summary: 'GROUP' });
        const locationName = result.getText({ name: 'inventorylocation', summary: 'GROUP' });
        const itemInternalId = result.getValue({ name: 'internalid', summary: 'MAX' });
        const itemType = result.getValue({ name: 'type', summary: 'MAX' });
        const itemCode = result.getValue({ name: 'itemid', summary: 'GROUP' });

        const recordType = ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem';

        const row = {
            internalId: String(itemInternalId),
            locationId: String(locationId),
            locationName: locationName || '',
            locationUrl: getRecordUrl(locationId, 'location'),
            isReload: result.getValue({ name: 'custrecord_is_reload', join: 'inventoryLocation', summary: 'GROUP' }) === 'T',
            itemType: itemType || 'inventoryitem',
            itemCode: itemCode || '',
            itemName: result.getValue({ name: 'salesdescription', summary: 'GROUP' }) || '',
            itemUrl: getRecordUrl(itemInternalId, recordType),
            species: result.getText({ name: 'custitem_species', summary: 'GROUP' }) || result.getValue({ name: 'custitem_species', summary: 'GROUP' }) || '',
            thickness: result.getText({ name: 'custitem_mgsl_thickness', summary: 'GROUP' }) || result.getValue({ name: 'custitem_mgsl_thickness', summary: 'GROUP' }) || '',
            width: result.getText({ name: 'custitem_mgsl_width', summary: 'GROUP' }) || result.getValue({ name: 'custitem_mgsl_width', summary: 'GROUP' }) || '',
            length: result.getText({ name: 'custitem_mgsl_length', summary: 'GROUP' }) || result.getValue({ name: 'custitem_mgsl_length', summary: 'GROUP' }) || '',
            grade: result.getText({ name: 'custitem_grade', summary: 'GROUP' }) || result.getValue({ name: 'custitem_grade', summary: 'GROUP' }) || '',
            finition: result.getText({ name: 'custitem_finition', summary: 'GROUP' }) || result.getValue({ name: 'custitem_finition', summary: 'GROUP' }) || '',
            humidity: result.getText({ name: 'custitem_humidity', summary: 'GROUP' }) || result.getValue({ name: 'custitem_humidity', summary: 'GROUP' }) || '',
            plannage: result.getText({ name: 'custitem_plannage', summary: 'GROUP' }) || result.getValue({ name: 'custitem_plannage', summary: 'GROUP' }) || '',
            etampage: result.getText({ name: 'custitem_etampage', summary: 'GROUP' }) || result.getValue({ name: 'custitem_etampage', summary: 'GROUP' }) || '',
            autres: result.getText({ name: 'custitem_autres', summary: 'GROUP' }) || result.getValue({ name: 'custitem_autres', summary: 'GROUP' }) || '',
            quantityFBM: roundToTwoDecimals(
                parseFloat(result.getValue({ name: 'locationquantityonhand', summary: 'GROUP' })) || 0
            ),
            mbfFactor: (() => {
                const fbmPerPiece = parseFloat(
                    result.getValue({ name: 'custitem_mgsl_fbm', summary: 'GROUP' })
                ) || 0;
                const piecesPerPack = parseFloat(
                    result.getValue({ name: 'custitem_mgsl_ppp', summary: 'GROUP' })
                ) || 0;
                return Math.round((fbmPerPiece * piecesPerPack) / 1000 * 1000000) / 1000000;
            })(),
            onHand: onHand,
            committed: committed,
            outbound: outbound,
            onOrder: onOrder,
            inTransit: inTransit,
            available: available,
            averageCost: roundToTwoDecimals(
                    parseFloat(result.getValue({ name: 'locationaveragecost', summary: 'GROUP' })) || 0
            ),
            detailKey: buildDetailKey(itemInternalId, locationId),
        };

        return row;
    };

    /**
     * getInputData: Returns search for full rebuild, or array of {key, value} for delta.
     */
    const getInputData = () => {
        const subsidiaryId = getScriptParam('custscript_ts_subsidiary_id', null);
        // Normalize to a real boolean — getParameter can surface the checkbox as
        // the STRING 'false' (truthy!), which forced a FULL rebuild every run and
        // disabled throttling on the MTL MR until 2026-07-28. Same bug here.
        const forceFullRaw = getScriptParam('custscript_ts_force_full_rebuild', false);
        const forceFull = forceFullRaw === true || forceFullRaw === 'T' || forceFullRaw === 'true';
        // Default 150, not 500. Above this many changed pairs, one paged FULL is both
        // faster and safer than N sequential per-pair searches — the crossover for
        // prod IND is ~100 pairs (a full's getInputData measured ~19s vs ~0.19s per
        // pair). Measured real traffic is 22-41 pairs per delta window, so this only
        // ever fires on an abnormal burst (bulk import, migration), which is exactly
        // when an unbounded loop in a non-yielding phase must not be reachable.
        // Hardcoded rather than left to the script parameter because the parameter
        // lives on the script RECORD (an SDF object) and prod has only ever received
        // scoped file:uploads — so it may not exist there. If it does exist and is
        // set, it still wins.
        const deltaThreshold = getScriptParam('custscript_ts_delta_fallback_threshold', 150);

        if (!subsidiaryId) {
            log.error('MCGI_MR_TraderScreenCache', 'custscript_ts_subsidiary_id is required');
            return [];
        }

        const myCache = CacheClient.getCache();
        const lastRunStr = myCache.get({ key: CacheKeys.TS_LAST_RUN_TIMESTAMP });

        // Throttle: skip processing if less than MIN_INTERVAL_MS since last run.
        if (!forceFull && lastRunStr) {
            const elapsed = Date.now() - new Date(lastRunStr).getTime();
            if (!isNaN(elapsed) && elapsed < MIN_INTERVAL_MS) {
                log.debug('MCGI_MR_TraderScreenCache', 'getInputData: throttled — ' + Math.round(elapsed / 1000) + 's since last run, min=' + (MIN_INTERVAL_MS / 1000) + 's');
                return {};
            }
        }

        // Hourly FULL backstop — missing/invalid LAST_FULL counts as due, so the
        // first run after deploy refreshes every detail key.
        const lastFullStr = myCache.get({ key: CacheKeys.TS_LAST_FULL_TIMESTAMP });
        const sinceFullMs = lastFullStr ? (Date.now() - new Date(lastFullStr).getTime()) : NaN;
        const fullDue = isNaN(sinceFullMs) || sinceFullMs > FULL_REFRESH_MS;

        const isFullMode = forceFull || !lastRunStr || fullDue;
        log.audit('MCGI_MR_TraderScreenCache', 'getInputData: forceFull=' + forceFull + ' (raw=' + forceFullRaw + ':' + (typeof forceFullRaw) + ') fullDue=' + fullDue + ' isFullMode=' + isFullMode);

        if (isFullMode) {
            myCache.put({ key: CacheKeys.TS_LAST_FULL_TIMESTAMP, value: new Date().toISOString(), ttl: TTL_LAST_RUN });
            const mySearch = search.load({ id: ITEM_DATA_SEARCH_ID });
            const filters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            filters.push('AND', ['inventorylocation.subsidiary', 'anyof', subsidiaryId]);
            mySearch.filterExpression = filters;
            log.debug('MCGI_MR_TraderScreenCache', 'getInputData(full): applied subsidiary filter=' + subsidiaryId);
            const fullInput = {};
            const searchResultCount = mySearch.runPaged().count;
            log.audit('MCGI_MR_TraderScreenCache', 'getInputData(full): searchResultCount=' + searchResultCount);
            const searchResultsPaged = mySearch.runPaged({ pageSize: 1000 });
            let rowsProcessed = 0;
            if (searchResultsPaged && searchResultsPaged.count > 0 && searchResultsPaged.pageRanges) {
                log.audit('MCGI_MR_TraderScreenCache', 'getInputData(full): pageRanges=' + (searchResultsPaged.pageRanges ? searchResultsPaged.pageRanges.length : 0));
                searchResultsPaged.pageRanges.forEach((pageRange, rangeIdx) => {
                    const searchPage = searchResultsPaged.fetch({ index: pageRange.index });
                    const pageDataCount = searchPage.data ? searchPage.data.length : 0;
                    if (rangeIdx === 0) {
                        log.audit('MCGI_MR_TraderScreenCache', 'getInputData(full): first page data.length=' + pageDataCount);
                    }
                    searchPage.data.forEach((result) => {
                        const row = buildSummaryRow(result, subsidiaryId);
                        const k = row.internalId + '__' + row.locationId;
                        fullInput[k] = JSON.stringify(row);
                        rowsProcessed++;
                    });
                });
            } else {
                log.audit('MCGI_MR_TraderScreenCache', 'getInputData(full): no pageRanges or empty; count=' + (searchResultsPaged ? searchResultsPaged.count : 'N/A'));
            }
            const inputKeysCount = Object.keys(fullInput).length;
            log.audit('MCGI_MR_TraderScreenCache', 'getInputData(full): rowsProcessed=' + rowsProcessed + ', fullInputKeys=' + inputKeysCount + ', returnType=Object');
            if (inputKeysCount > 0) {
                const sampleKeys = Object.keys(fullInput).slice(0, 3);
                log.audit('MCGI_MR_TraderScreenCache', 'getInputData(full): sampleKeys=' + JSON.stringify(sampleKeys));
            }
            return fullInput;
        }

        let lastRunDate;
        try {
            lastRunDate = new Date(lastRunStr);
            if (isNaN(lastRunDate.getTime())) lastRunDate = null;
        } catch (e) {
            lastRunDate = null;
        }
        if (!lastRunDate) {
            myCache.put({ key: CacheKeys.TS_LAST_FULL_TIMESTAMP, value: new Date().toISOString(), ttl: TTL_LAST_RUN });
            const mySearch = search.load({ id: ITEM_DATA_SEARCH_ID });
            const flbkFilters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            flbkFilters.push('AND', ['inventorylocation.subsidiary', 'anyof', subsidiaryId]);
            mySearch.filterExpression = flbkFilters;
            const fullInput = {};
            runPagedAll(mySearch).forEach((result) => {
                const row = buildSummaryRow(result, subsidiaryId);
                const k = row.internalId + '__' + row.locationId;
                fullInput[k] = JSON.stringify(row);
            });
            return fullInput;
        }

        const tranTypes = [
            search.Type.PURCHASE_ORDER,
            search.Type.SALES_ORDER,
            search.Type.ITEM_RECEIPT,
            search.Type.ITEM_FULFILLMENT,
            search.Type.INVENTORY_ADJUSTMENT,
            search.Type.TRANSFER_ORDER,
        ];

        const pairs = {};
        let pairCount = 0;
        // Collected so a failing delta search is reported ONCE per run at error level
        // rather than six times at debug. Every one of these six searches has been
        // throwing since inception and nobody saw it, because the catch below logged
        // at debug: 2,118 failures in prod on 2026-08-05 alone (= 6 x 353 runs).
        const deltaFailures = [];

        // A plain ['lastmodifieddate','onorafter', <value>] filter errors on this
        // tenant for BOTH Date objects and formatted strings — every delta type
        // search had failed silently since inception (root-caused on the MTL MR,
        // 2026-07-28). Formula filter with an explicit TO_DATE mask instead,
        // rendered at fixed UTC-8 minus a 3h buffer so timezone skew can only
        // WIDEN the window, never push it forward.
        const winDate = new Date(lastRunDate.getTime() - 3 * 60 * 60 * 1000 - 8 * 60 * 60 * 1000);
        const pad2 = (n) => (n < 10 ? '0' : '') + n;
        const winStr = winDate.getUTCFullYear() + '-' + pad2(winDate.getUTCMonth() + 1) + '-' + pad2(winDate.getUTCDate()) +
                       ' ' + pad2(winDate.getUTCHours()) + ':' + pad2(winDate.getUTCMinutes());
        const deltaWindowFilter = [
            "formulanumeric: CASE WHEN {lastmodifieddate} >= TO_DATE('" + winStr + "','YYYY-MM-DD HH24:MI') THEN 1 ELSE 0 END",
            'equalto', '1',
        ];

        tranTypes.forEach((tranType) => {
            try {
                const tranSearch = search.create({
                    type: tranType,
                    filters: [
                        ['subsidiary', 'anyof', subsidiaryId],
                        'AND',
                        deltaWindowFilter,
                    ],
                    columns: [
                        search.createColumn({ name: 'item', join: 'item' }),
                        search.createColumn({ name: 'location' }),
                    ],
                });
                runPagedAll(tranSearch).forEach((r) => {
                    const itemId = r.getValue({ name: 'item', join: 'item' });
                    const locId = r.getValue({ name: 'location' });
                    if (itemId && locId) {
                        const k = itemId + '__' + locId;
                        if (!pairs[k]) {
                            pairs[k] = { itemId: itemId, locationId: locId };
                            pairCount++;
                        }
                    }
                });
            } catch (e) {
                deltaFailures.push(tranType + ' (' + (e.name || 'no name') + ': ' + (e.message || 'no message') + ')');
                log.debug('MCGI_MR_TraderScreenCache', 'Delta search error for type ' + tranType + ': ' + e.message);
            }
        });

        // One aggregated error line per run instead of six debug lines. A delta search
        // that throws is not a debug-level event: it silently drops every change of that
        // transaction type until the next hourly FULL, and if ALL of them fail the cache
        // stops updating entirely while still reporting healthy "DELTA 0 changes" runs.
        // AUDIT, not ERROR, deliberately. This currently fires on EVERY run (all six
        // searches fail), so error level would add ~353 lines/day to prod's error log —
        // and if the deployment has "Notify Owner on Error" set, that is ~353 emails/day.
        // NetSuite does not expose notifyowner via SuiteQL, so it cannot be ruled out.
        // Nothing is lost: AUDIT is fully queryable
        //   SELECT ... FROM scriptnote WHERE detail LIKE '%DELTA SEARCHES FAILED%'
        // and debug level was already queryable — what hid this bug was that nobody
        // looked, not the level. Once the join:'item' column is fixed and failures become
        // rare rather than constant, promoting this to error would be appropriate.
        if (deltaFailures.length > 0) {
            log.audit('MCGI_MR_TraderScreenCache',
                'getInputData: ' + deltaFailures.length + '/' + tranTypes.length +
                ' DELTA SEARCHES FAILED — changes of these types are invisible until the ' +
                'hourly FULL: ' + deltaFailures.join(' | '));
        }

        // Unconditional, so a delta path that finds nothing is distinguishable from one
        // that never ran. IND previously logged pairCount ONLY inside the DELTA->FULL
        // fallback branch, which is exactly why all six searches could fail forever
        // without anyone noticing.
        log.audit('MCGI_MR_TraderScreenCache',
            'getInputData: DELTA pairCount=' + pairCount + ' threshold=' + deltaThreshold +
            ' searchFailures=' + deltaFailures.length + '/' + tranTypes.length);

        if (pairCount === 0) {
            // Nothing changed — refresh LAST_RUN so the throttle stays current and
            // skip processing. (Previously 0 pairs fell back to a FULL rebuild,
            // which — combined with the broken delta filter above — meant every
            // "delta" run was actually a full. Quiet keys' detail entries are
            // protected by TTL_DETAIL + the hourly FULL backstop.)
            myCache.put({
                key: CacheKeys.TS_LAST_RUN_TIMESTAMP,
                value: new Date().toISOString(),
                ttl: TTL_LAST_RUN,
            });
            log.audit('MCGI_MR_TraderScreenCache', 'getInputData: DELTA 0 changes, LAST_RUN refreshed');
            return {};
        }

        if (pairCount > deltaThreshold) {
            log.audit('MCGI_MR_TraderScreenCache', 'getInputData: DELTA->FULL fallback (pairCount=' + pairCount + ')');
            myCache.put({ key: CacheKeys.TS_LAST_FULL_TIMESTAMP, value: new Date().toISOString(), ttl: TTL_LAST_RUN });
            const mySearch = search.load({ id: ITEM_DATA_SEARCH_ID });
            const threshFilters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            threshFilters.push('AND', ['inventorylocation.subsidiary', 'anyof', subsidiaryId]);
            mySearch.filterExpression = threshFilters;
            const fullInput = {};
            runPagedAll(mySearch).forEach((result) => {
                const row = buildSummaryRow(result, subsidiaryId);
                const k = row.internalId + '__' + row.locationId;
                fullInput[k] = JSON.stringify(row);
            });
            return fullInput;
        }

        const inputData = {};
        const itemsSearch = search.load({ id: ITEM_DATA_SEARCH_ID });
        const baseFilters = itemsSearch.filterExpression ? itemsSearch.filterExpression.concat() : [];
        baseFilters.push('AND', ['inventorylocation.subsidiary', 'anyof', subsidiaryId]);

        Object.keys(pairs).forEach((k) => {
            const p = pairs[k];
            const rowFilters = baseFilters.concat([
                'AND',
                ['internalid', 'anyof', p.itemId],
                'AND',
                ['inventorylocation', 'anyof', p.locationId],
            ]);
            itemsSearch.filterExpression = rowFilters;
            const results = runPagedAll(itemsSearch, 5);
            if (results.length > 0) {
                const row = buildSummaryRow(results[0], subsidiaryId);
                inputData[k] = JSON.stringify(row);
            }
        });

        return inputData;
    };

    /**
     * map: Pass through key = itemId__locationId, value = summary row JSON.
     */
    let mapInvokeCount = 0;
    const map = (context) => {
        mapInvokeCount++;
        const key = context.key;
        const value = context.value;
        if (mapInvokeCount <= 2 || mapInvokeCount % 200 === 0) {
            log.audit('MCGI_MR_TraderScreenCache', 'map: invoke#' + mapInvokeCount + ' key=' + key + ' valueLen=' + (value ? String(value).length : 0));
        }
        if (key && value) {
            context.write({ key: key, value: value });
        } else {
            log.audit('MCGI_MR_TraderScreenCache', 'map: SKIPPED (missing key or value) key=' + key + ', hasValue=' + !!value);
        }
    };

    const runDetailSearch = (searchId, itemId, locationId, rowBuilder) => {
        const rows = [];
        try {
            const s = getDetailSearch(searchId);
            s.filters.push(
                    search.createFilter({ name: 'item', operator: search.Operator.ANYOF, values: itemId })
            );
            if (searchId === IN_TRANSIT_SEARCH_ID) {
                // Mirror count formula's location attribution: Transfer Order →
                // destination (tolocation), Purchase Order → line location.
                var locId = parseInt(locationId, 10);
                s.filters.push(
                        search.createFilter({
                            name: 'formulanumeric',
                            operator: search.Operator.EQUALTO,
                            values: '1',
                            formula: "CASE " +
                                     "WHEN {type}='Transfer Order' AND {tolocation.internalid}=" + locId + " THEN 1 " +
                                     "WHEN {type}='Purchase Order' AND {location.internalid}=" + locId + " THEN 1 " +
                                     "ELSE 0 END"
                        })
                );
            } else {
                s.filters.push(
                        search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
                );
            }
            s.run().each(function (r) {
                const row = rowBuilder(r);
                if (row) rows.push(row);
                return true;
            });
        } catch (e) {
            log.debug('MCGI_MR_TraderScreenCache', 'Detail search ' + searchId + ' error for item=' + itemId + ' loc=' + locationId + ': ' + e.message);
        }
        return rows;
    };

    const safeGetValue = (r, opts) => { try { return r.getValue(opts); } catch (e) { return ''; } };
    const safeGetText = (r, opts) => { try { return r.getText(opts); } catch (e) { return ''; } };

    const buildCommittedRow = (r) => {
        const formulaValues = {};
        r.columns.forEach((col) => {
            if (col.formula) {
                if (col.label === 'Pack Committed') formulaValues.commited = r.getValue(col);
                if (col.label === 'Open Pack Quantity') formulaValues.quantity = r.getValue(col);
            }
        });
        const docId = r.getValue({ name: 'internalid' });
        const entityId = r.getValue({ name: 'entity' });
        const ppp = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp' })) || parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        return {
            docId: docId,
            lineSeq: safeGetValue(r, { name: 'linesequencenumber' }),
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, 'salesorder'),
            customerName: r.getText({ name: 'entity' }),
            customerUrl: getRecordUrl(entityId, 'customer'),
            tranDate: r.getValue({ name: 'trandate' }),
            expectedShipDate: r.getValue({ name: 'custbody_ship_week' }),
            packCommitted: roundToTwoDecimals(parseFloat(formulaValues.commited) || 0),
            piecesPerPack: ppp,
            pricePerPiece: roundToTwoDecimals(parseFloat(safeGetValue(r, { name: 'custcol_prixpiece' })) || 0),
            rate: roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
            lotNumber: safeGetValue(r, { name: 'serialnumber' }) || '-',
            allocatedPO: safeGetText(r, { name: 'line.cseg_po_segment_gl' }) || '-',
            allocatedSegmentId: safeGetValue(r, { name: 'line.cseg_po_segment_gl' }) || '',
        };
    };

    const buildOutboundRow = (r) => {
        const docId = r.id;
        const entityId = r.getValue({ name: 'entity' });
        const ppp = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp' })) || parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        const lotId = safeGetValue(r, { name: 'inventorynumber', join: 'inventoryDetail' }) || '';
        return {
            docId: docId,
            lineSeq: safeGetValue(r, { name: 'linesequencenumber' }),
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, 'salesorder'),
            customerName: r.getText({ name: 'entity' }),
            customerUrl: getRecordUrl(entityId, 'customer'),
            dueDate: safeGetValue(r, { name: 'trandate', join: 'billingTransaction' }) || '',
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty' })) || 0),
            piecesPerPack: ppp,
            pricePerPiece: roundToTwoDecimals(parseFloat(safeGetValue(r, { name: 'custcol_prixpiece' })) || 0),
            rate: roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
            lotNumber: safeGetText(r, { name: 'inventorynumber', join: 'inventoryDetail' }) || '-',
            lotId: lotId,
            allocatedPO: safeGetText(r, { name: 'line.cseg_po_segment_gl' }) || '-',
            allocatedSegmentId: safeGetValue(r, { name: 'line.cseg_po_segment_gl' }) || '',
        };
    };

    const buildOnOrderRow = (r) => {
        const formulaValues = {};
        r.columns.forEach((col) => {
            if (col.formula) {
                if (col.label === 'Open Quantity') formulaValues.openQuantity = r.getValue(col);
                if (col.label === 'Price') formulaValues.price = r.getValue(col);
            }
        });
        const docId = r.getValue({ name: 'internalid', summary: 'GROUP' });
        const vendorId = safeGetValue(r, { name: 'internalid', join: 'vendor', summary: 'GROUP' }) || '';
        const ppp = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp', summary: 'GROUP' })) || parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item', summary: 'GROUP' })) || 0;
        const rate = roundToTwoDecimals(parseFloat(formulaValues.price) || parseFloat(r.getValue({ name: 'rate', summary: 'MAX' })) || 0);
        return {
            docNum: r.getValue({ name: 'tranid', summary: 'GROUP' }),
            docUrl: getRecordUrl(docId, 'purchaseorder'),
            vendorName: safeGetValue(r, { name: 'entityid', join: 'vendor', summary: 'GROUP' }) || '',
            vendorUrl: getRecordUrl(vendorId, 'vendor'),
            shipDate: safeGetValue(r, { name: 'custbody_ship_week', summary: 'GROUP' }) || '',
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty', summary: 'GROUP' })) || 0),
            piecesPerPack: ppp,
            pricePerPiece: roundToTwoDecimals(parseFloat(safeGetValue(r, { name: 'custcol_prixpiece', summary: 'GROUP' })) || 0),
            rate: rate,
            // PO Allocation consumes the cache for unreceived segments. segmentId
            // is the cseg_po_segment_gl internal id on the PO line — join key back
            // to the SO line. poId + poDate drive PO Allocation's FIFO sort.
            segmentId: safeGetValue(r, { name: 'internalid', join: 'line.cseg_po_segment_gl', summary: 'GROUP' }) || '',
            poId: docId,
            poDate: safeGetValue(r, { name: 'trandate', summary: 'GROUP' }) || '',
        };
    };

    const buildInTransitRow = (r) => {
        // Read in-transit portion from saved search formula column.
        // Formula: (packqty * billed/qty) - (packqty * shipReceived/qty)
        // This matches the main grid count attribution so totals reconcile.
        const formulaValues = {};
        r.columns.forEach((col) => {
            if (col.formula && col.label === 'In Transit *Additional') {
                formulaValues.inTransit = r.getValue(col);
            }
        });
        const docType = r.getValue({ name: 'type' });
        const docId = r.id;
        const vendorId = r.getValue({ name: 'mainname' });
        const ppp = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp' })) || parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        // Cost: PO in-transit rows carry the PO line rate (core lib uses `rate` as
        // avgCostPerUnit). Transfer Order lines have rate=0, so price the row from the
        // transferred lot's cost (rule: lot → lot cost, no lot → $0), looked up at the
        // lot's SOURCE location (`location` = from side). Same shared engine the MTL
        // on-hand path uses.
        let rate = roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0);
        const lotId = safeGetValue(r, { name: 'inventorynumber', join: 'inventoryDetail' }) || '';
        if (lotId) {
            const srcLoc = safeGetValue(r, { name: 'location' }) || '';
            let lotCost = null;
            if (srcLoc) {
                try {
                    const costs = LotCostLib.getLotCostsAtLocation([lotId], srcLoc);
                    if (costs && costs[lotId] != null) lotCost = costs[lotId];
                } catch (e) {
                    log.error('IND In Transit lot cost', 'lot=' + lotId + ' loc=' + srcLoc + ': ' + e.message);
                }
            }
            rate = roundToTwoDecimals(lotCost != null ? lotCost : 0);
        }
        return {
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, ITEM_RECORD_TYPE_MAPPING[docType] || 'purchaseorder'),
            shipWeek: r.getValue({ name: 'custbody_ship_week' }) || '',
            vendor: r.getText({ name: 'mainname' }),
            vendorUrl: getRecordUrl(vendorId, 'vendor'),
            packQty: roundToTwoDecimals(parseFloat(formulaValues.inTransit) || 0),
            piecesPerPack: ppp,
            pricePerPiece: roundToTwoDecimals(parseFloat(safeGetValue(r, { name: 'custcol_prixpiece' })) || 0),
            rate: rate,
            // PO Allocation pre-commits against in-transit rows (billed, not yet
            // received) the same way it does on-order — but only when the row carries
            // a segment. `line.cseg_po_segment_gl` is pushed onto the search in
            // getDetailSearch (same as committed/outbound). Transfer Order lines now
            // carry the segment too (stamped by MSL_UE_allocationSegmentSync), so their
            // in-transit stock is allocatable like a PO. Any row still lacking a segment
            // is skipped downstream in the core lib (addUnreceivedRows).
            segmentId: safeGetValue(r, { name: 'line.cseg_po_segment_gl' }) || '',
            poId: docId,
            poDate: safeGetValue(r, { name: 'trandate' }) || '',
        };
    };

    /**
     * reduce: For each key, run 5 detail searches, write TS_DETAIL, append summary to chunk, write chunk.
     */
    let reduceInvokeCount = 0;
    const reduce = (context) => {
        reduceInvokeCount++;
        const key = context.key;
        if (reduceInvokeCount <= 2 || reduceInvokeCount % 200 === 0) {
            log.audit('MCGI_MR_TraderScreenCache', 'reduce: invoke#' + reduceInvokeCount + ' key=' + key + ' valuesCount=' + (context.values ? context.values.length : 0));
        }
        const parts = key.split('__');
        const itemId = parts[0];
        const locationId = parts[1];
        if (!itemId || !locationId) return;

        let summaryRow = null;
        context.values.forEach((v) => {
            try {
                const parsed = JSON.parse(v);
                if (parsed.internalId && parsed.locationId) {
                    summaryRow = parsed;
                }
            } catch (e) {
            }
        });
        if (!summaryRow) return;

        // On Hand: derived from MCGI_SSU_OnHand.js (v1). Uses
        // inventoryDetail.inventorynumber (getText) for lot name,
        // inventoryDetail.quantity for per-lot base unit qty, converts to packs
        // via: (qty * 1000) / (PPP * FBM_per_piece), aggregates by lot name.
        //
        // PPP source corrected 2026-07-31. v1 mined PPP out of the lot NAME and
        // defaulted to 1 when the name didn't end in a number. NS-generated reman
        // lots do end in the pack's piece count, but vendor-named lots don't:
        // '347516-Dion' fell through to PPP=1, so packs came out as pieces —
        // CHW6683+GRO/Prevost showed 37 packs for a 1-pack lot (Marc-Antoine).
        // The line's own custcol_mgsl_ppp is authoritative (37 there), and it's what
        // every other tab already reads (buildCommittedRow et al). The lot name is
        // kept as the next fallback, not discarded — a prod audit of all 1,554
        // stocked IND lot/locations found the two sources agree everywhere except
        // this one lot, so the corrected chain moves exactly one row.
        //
        // Two passes, because PPP must be latched per LOT, not read per row:
        // line-level custcol_mgsl_ppp drifts on IF lines (they inherit the SO's
        // commitment PPP, not the lot's received PPP), which would under-deduct
        // packs. v1's lot-name scrape was immune by construction; the latch
        // restores that. Latching on the fly in one pass isn't enough — an IF can
        // sort before its lot's IR (2,063 such combos found on MTL, 2026-05-11).
        const onHand = (() => {
            try {
                var cached = getOnHandSearch();
                var mySearch = cached.search;
                var colAdjValue = cached.colAdjValue;
                mySearch.filters.push(
                    search.createFilter({ name: 'item', operator: search.Operator.ANYOF, values: itemId }),
                    search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
                );

                var poPricing = getPoPricingForItem(itemId);
                var seenLots = {};
                var itemData = [];
                var rawRows = [];
                var lotPppMap = {};

                // ── Pass 1: drain the search, latch each lot's PPP ────────────
                mySearch.run().each(function (result) {
                    var lotNumber = result.getText({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
                    if (!lotNumber) return true; // skip rows without lot number

                    var itemTranQty = parseFloat(result.getValue(colAdjValue)) || 0;
                    var tranType = result.recordType;
                    var linePpp = parseFloat(safeGetValue(result, { name: 'custcol_mgsl_ppp' })) || 0;
                    var isAdditive = tranType === 'itemreceipt' || tranType === 'creditmemo' ||
                                     (tranType === 'inventoryadjustment' && itemTranQty > 0);

                    // First-additive-wins: the lot's authoritative PPP is the one
                    // it was received/adjusted IN at, never an outbound line's.
                    if (isAdditive && linePpp > 0 && !lotPppMap[lotNumber]) {
                        lotPppMap[lotNumber] = linePpp;
                    }

                    rawRows.push({
                        lotNumber: lotNumber,
                        lotId: result.getValue({ name: 'inventorynumber', join: 'inventoryDetail' }) || '',
                        volPCFBM: parseFloat(result.getValue({ name: 'custitem_mgsl_fbm', join: 'item' })) || 0,
                        itemTranQty: itemTranQty,
                        invDetailQty: parseFloat(result.getValue({ name: 'quantity', join: 'inventoryDetail' })) || 0,
                        tranType: tranType,
                        linePpp: linePpp,
                        itemPpp: parseFloat(safeGetValue(result, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0,
                        docType: result.getValue({ name: 'type' }),
                        docTypeText: result.getText({ name: 'type' }),
                        docId: result.getValue({ name: 'internalid' }),
                        docNum: result.getValue({ name: 'tranid' }),
                        reloadId: safeGetValue(result, { name: 'custcol3' }) || '',
                        createdFromId: safeGetValue(result, { name: 'createdfrom' }) || '',
                        createdFromText: safeGetText(result, { name: 'createdfrom' }) || '',
                        trandate: result.getValue({ name: 'trandate' }),
                        vendorId: result.getValue({ name: 'mainname' }),
                        vendorText: result.getText({ name: 'mainname' }),
                        rate: parseFloat(result.getValue({ name: 'rate' })) || 0,
                        segmentId: safeGetValue(result, { name: 'cseg_po_segment_gl' }) || '',
                    });
                    return true;
                });

                // ── Pass 2: aggregate with the complete latch map ─────────────
                var zeroPppLots = {};
                rawRows.forEach(function (row) {
                    // Latched lot PPP → this line's PPP → lot-name suffix → item
                    // nominal. The lot name outranks the item field deliberately: it
                    // describes THIS pack, the item field is only a nominal default. For
                    // a reman lot the suffix IS the pack ('…-1-14552') where the item
                    // nominal is 1 (14552× inflation), and on
                    // SO-IND-246357-2.625-308 the suffix is 308 against a nominal 342.
                    // Every fallback is constant per lot, so a lot's rows stay coherent
                    // with each other even if the latch never populated.
                    var piecesPerPack = lotPppMap[row.lotNumber] || row.linePpp ||
                                        pppFromLotName(row.lotNumber) || row.itemPpp;
                    if (!piecesPerPack) zeroPppLots[row.lotNumber] = true;

                    // Determine signed qty from inventoryDetail base units (v1 logic)
                    var qty = 0;
                    if (row.tranType === 'itemreceipt' || (row.tranType === 'inventoryadjustment' && row.itemTranQty > 0) || row.tranType === 'creditmemo') {
                        qty = row.invDetailQty;
                    } else if (row.tranType === 'itemfulfillment' || (row.tranType === 'inventoryadjustment' && row.itemTranQty < 0)) {
                        qty = -Math.abs(row.invDetailQty);
                    }

                    // Convert base units to packs
                    var packs = (row.volPCFBM > 0 && piecesPerPack > 0) ? (qty * 1000) / (piecesPerPack * row.volPCFBM) : 0;

                    // Aggregate by lot
                    if (seenLots[row.lotNumber] !== undefined) {
                        itemData[seenLots[row.lotNumber]].packQty += packs;
                        return;
                    }
                    seenLots[row.lotNumber] = itemData.length;

                    // PO pricing: look up via createdfrom + PPP match
                    var poData = row.createdFromId ? poPricing[row.createdFromId + '_' + piecesPerPack] : null;
                    var price, piecePrice;
                    if (poData && poData.rate > 0) {
                        price = roundToTwoDecimals(poData.rate);
                        piecePrice = poData.prixPiece > 0
                            ? roundToTwoDecimals(poData.prixPiece)
                            : (row.volPCFBM > 0 ? roundToTwoDecimals(price * row.volPCFBM / 1000) : 0);
                    } else {
                        price = roundToTwoDecimals(row.rate);
                        piecePrice = row.volPCFBM > 0 ? roundToTwoDecimals(price * row.volPCFBM / 1000) : 0;
                    }

                    itemData.push({
                        docType: row.docTypeText,
                        docNum: row.docNum,
                        docUrl: getRecordUrl(row.docId, ITEM_RECORD_TYPE_MAPPING[row.docType] || 'transaction'),
                        reloadId: row.reloadId,
                        poWoNumber: row.createdFromText || row.createdFromId || '',
                        poWoUrl: getRecordUrl(row.createdFromId, 'purchaseorder'),
                        receiptDate: row.trandate,
                        vendor: row.vendorText,
                        vendorUrl: getRecordUrl(row.vendorId, 'vendor'),
                        lotNo: row.lotNumber || '-',
                        lotInternalId: row.lotId,
                        packQty: packs,
                        piecesPerPack: piecesPerPack,
                        pricePerPiece: piecePrice,
                        avgPrice: price,
                        segmentId: row.segmentId,
                    });
                });

                // A lot with no PPP from any source computes 0 packs and drops out
                // below — loud, because it means both the line column and the item
                // field are empty and the lot name carries no suffix.
                var zeroPppNames = Object.keys(zeroPppLots);
                if (zeroPppNames.length) {
                    log.audit('MCGI_MR_TraderScreenCache',
                        'On Hand: PPP unresolved for item=' + itemId + ' loc=' + locationId +
                        ' lots=' + JSON.stringify(zeroPppNames.slice(0, 5)));
                }

                // Drop lots whose net on-hand is gone. Epsilon, not Math.round():
                // rounding silently hid every partially-shipped lot with under half
                // a pack left. Reman lots are exactly 1 pack by construction (the
                // lot name's PPP is the whole pack), so RO-IND-499-1-14552 — 3.054
                // of its 14.552 MBF left, 0.21 pack — never appeared at all
                // (Marc-Antoine 2026-07-31).
                return itemData.filter(function (row) { return row.packQty > PACK_EPSILON; });
            } catch (e) {
                log.error('MCGI_MR_TraderScreenCache', 'On Hand detail error: ' + e.message);
                return [];
            }
        })();
        if (onHand.length > 0) {
            // roundToTwoDecimals, not Math.round: an item whose only stock is a
            // partial pack would otherwise report On Hand 0 in the grid while the
            // drawer lists the lot (2026-07-31).
            const fbmOnHand = roundToTwoDecimals(
                onHand.reduce(function (sum, row) { return sum + row.packQty; }, 0)
            );
            summaryRow.onHand = fbmOnHand;
            summaryRow.available = roundToTwoDecimals(
                fbmOnHand - summaryRow.committed - summaryRow.outbound + summaryRow.onOrder + summaryRow.inTransit
            );
        }
        const committed = runDetailSearch(COMMITTED_SEARCH_ID, itemId, locationId, buildCommittedRow);
        const outbound = runDetailSearch(OUTBOUND_SEARCH_ID, itemId, locationId, buildOutboundRow);
        const onOrder = runDetailSearch(ON_ORDER_SEARCH_ID, itemId, locationId, buildOnOrderRow);
        const inTransit = runDetailSearch(IN_TRANSIT_SEARCH_ID, itemId, locationId, buildInTransitRow);

        const detailPayload = {
            onHand: onHand,
            committed: committed,
            outbound: outbound,
            onOrder: onOrder,
            inTransit: inTransit,
        };

        const myCache = CacheClient.getCache();
        const detailKey = buildDetailKey(itemId, locationId);
        const detailJson = JSON.stringify(detailPayload);
        const sizeBytes = detailJson.length;

        if (sizeBytes > 450 * 1024) {
            log.audit('MCGI_MR_TraderScreenCache', 'Detail payload >450KB for ' + detailKey + ': ' + sizeBytes + ' bytes');
        }

        if (sizeBytes > 500 * 1024) {
            const buckets = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit'];
            buckets.forEach((bucket) => {
                if (detailPayload[bucket] && detailPayload[bucket].length > 0) {
                    myCache.put({
                        key: buildDetailBucketKey(itemId, locationId, bucket),
                        value: JSON.stringify(detailPayload[bucket]),
                        ttl: TTL_DETAIL,
                    });
                }
            });
        } else {
            // TTL_DETAIL, not TTL_SUMMARY: detail is rewritten only when this key
            // is rebuilt; under real DELTA mode quiet keys go hours between
            // rebuilds and a 30-min TTL kills their drawers (MTL, 2026-07-28).
            myCache.put({
                key: detailKey,
                value: detailJson,
                ttl: TTL_DETAIL,
            });
        }

        context.write({ key: key, value: JSON.stringify(summaryRow) });
    };

    /**
     * summarize: Merge chunks, write TS_SUMMARY, TS_META, TS_LAST_RUN_TIMESTAMP; delete chunks.
     */
    const summarize = (context) => {
        const startTime = Date.now();
        const myCache = CacheClient.getCache();

        const allRows = [];
        const keysToDelete = [];

        if (context.inputSummary.error) {
            log.error({ title: 'Input Error', details: context.inputSummary.error });
        }
        let mapErrorCount = 0, reduceErrorCount = 0;
        context.mapSummary.errors.iterator().each(function (key, error) {
            mapErrorCount++;
            log.error({ title: `Map Error for key: ${key}`, details: error });
            return true;
        });
        context.reduceSummary.errors.iterator().each(function (key, error) {
            reduceErrorCount++;
            log.error({ title: `Reduce Error for key: ${key}`, details: error });
            return true;
        });

        let reduceKeysCount = 0;
        if (context.reduceSummary && context.reduceSummary.keys) {
            context.reduceSummary.keys.iterator().each(() => { reduceKeysCount++; return true; });
        }

        // Read summary rows from reduce's context.write() output (MR framework storage, not N/cache)
        context.output.iterator().each(function (key, value) {
            try {
                var row = JSON.parse(value);
                if (row) allRows.push(row);
            } catch (e) {
                log.debug('MCGI_MR_TraderScreenCache', 'Output parse error for key=' + key + ': ' + (e.message || e));
            }
            return true;
        });
        log.audit('MCGI_MR_TraderScreenCache', 'summarize: reduceKeysCount=' + reduceKeysCount + ', outputRows=' + allRows.length);

        // Zero-output guard: preserve the cache untouched and just re-queue the loop.
        // Without this, an empty run falls into the NO-MERGE branch below and
        // overwrites TS_SUMMARY with an empty array — the screen then shows zero
        // rows, which reads as "no inventory" rather than "cache unavailable".
        //
        // Deliberately does NOT require an error-free run (2026-07-31). The ported
        // MTL version also demanded no map/reduce/input errors, which meant the one
        // case that most needs protecting — a run that produced nothing BECAUSE it
        // threw — sailed past the guard and blanked the summary. A getInputData
        // failure (e.g. the per-pair delta loop exceeding governance on a bulk-import
        // day) would take the trader screen to zero rows until the next successful
        // FULL. Errors are still counted and logged above; they just no longer license
        // an empty write. Zero output is never a legitimate reason to blank a
        // non-empty summary.
        if (allRows.length === 0) {
            // A throttled/no-change run is routine and stays at debug. Zero output
            // *after errors* is the case the guard was widened to cover — say so
            // loudly, or a failing delta loop hides behind a benign "no-op" line.
            if (context.inputSummary.error || mapErrorCount > 0 || reduceErrorCount > 0) {
                log.error('MCGI_MR_TraderScreenCache',
                    'summarize: zero output AFTER ERRORS — cache PRESERVED, not blanked' +
                    ' (inputError=' + !!context.inputSummary.error +
                    ' mapErrors=' + mapErrorCount +
                    ' reduceErrors=' + reduceErrorCount + ')');
            } else {
                log.debug('MCGI_MR_TraderScreenCache', 'summarize: throttled/no-change (no-op), duration=' + (Date.now() - startTime) + 'ms');
            }
            try {
                const mrTaskNoop = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: runtime.getCurrentScript().id,
                    deploymentId: runtime.getCurrentScript().deploymentId,
                    params: {
                        custscript_ts_subsidiary_id: getScriptParam('custscript_ts_subsidiary_id', null),
                        custscript_ts_force_full_rebuild: false,
                        custscript_ts_delta_fallback_threshold: getScriptParam('custscript_ts_delta_fallback_threshold', 500),
                    },
                });
                const noopTaskId = mrTaskNoop.submit();
                log.debug('MCGI_MR_TraderScreenCache', 'Self-rescheduled (throttled). taskId=' + noopTaskId);
            } catch (e) {
                log.error('MCGI_MR_TraderScreenCache', 'Self-reschedule (throttled) failed: ' + e.message);
            }
            return;
        }

        const existingSummary = myCache.get({ key: CacheKeys.TS_SUMMARY });
        log.audit('MCGI_MR_TraderScreenCache', 'summarize: existingSummary present=' + !!existingSummary + ', existingSummaryLen=' + (existingSummary ? existingSummary.length : 0));
        let mergedRows = allRows;
        const lastMeta = myCache.get({ key: CacheKeys.TS_META });
        let cacheVersion = 1;
        let lastRunMode = 'FULL';
        if (lastMeta) {
            try {
                const meta = JSON.parse(lastMeta);
                cacheVersion = (meta.cacheVersion || 0) + 1;
            } catch (e) {
            }
        }

        if (existingSummary && allRows.length > 0) {
            try {
                const existingRows = JSON.parse(existingSummary);
                log.audit('MCGI_MR_TraderScreenCache', 'summarize: MERGE branch, existingRows.length=' + (Array.isArray(existingRows) ? existingRows.length : 'not-array'));
                if (Array.isArray(existingRows)) {
                    const byKey = {};
                    existingRows.forEach((r) => {
                        if (r && r.internalId && r.locationId) {
                            byKey[r.internalId + '__' + r.locationId] = r;
                        }
                    });
                    allRows.forEach((r) => {
                        if (r && r.internalId && r.locationId) {
                            byKey[r.internalId + '__' + r.locationId] = r;
                        }
                    });
                    mergedRows = Object.values(byKey);
                    lastRunMode = 'DELTA';
                    log.audit('MCGI_MR_TraderScreenCache', 'summarize: after merge byKey.size=' + Object.keys(byKey).length + ', mergedRows.length=' + mergedRows.length);
                }
            } catch (e) {
                log.debug('MCGI_MR_TraderScreenCache', 'Existing summary parse error: ' + e.message);
            }
        } else {
            log.audit('MCGI_MR_TraderScreenCache', 'summarize: NO-MERGE branch (existingSummary=' + !!existingSummary + ', allRows.length=' + allRows.length + ')');
            const byKey = {};
            mergedRows.forEach((r) => {
                if (r && r.internalId && r.locationId) {
                    byKey[r.internalId + '__' + r.locationId] = r;
                }
            });
            mergedRows = Object.values(byKey);
            log.audit('MCGI_MR_TraderScreenCache', 'summarize: after dedupe byKey.size=' + Object.keys(byKey).length + ', mergedRows.length=' + mergedRows.length);
        }

        const now = new Date();
        const nowIso = now.toISOString();

        const fullJson = JSON.stringify(mergedRows);
        let summaryChunkCount = 1;
        if (fullJson.length <= CacheKeys.MAX_CACHE_VALUE_BYTES) {
            myCache.put({
                key: CacheKeys.TS_SUMMARY,
                value: fullJson,
                ttl: TTL_SUMMARY,
            });
        } else {
            const chunkSize = CacheKeys.MAX_CACHE_VALUE_BYTES;
            const rowsPerChunk = Math.floor(mergedRows.length / Math.ceil(fullJson.length / chunkSize));
            summaryChunkCount = 0;
            for (let i = 0; i < mergedRows.length; i += rowsPerChunk) {
                const slice = mergedRows.slice(i, i + rowsPerChunk);
                myCache.put({
                    key: CacheKeys.buildSummaryDataKey(summaryChunkCount),
                    value: JSON.stringify(slice),
                    ttl: TTL_SUMMARY,
                });
                summaryChunkCount++;
            }
            myCache.put({
                key: CacheKeys.TS_SUMMARY,
                value: JSON.stringify({ chunked: true, chunkCount: summaryChunkCount }),
                ttl: TTL_SUMMARY,
            });
            log.audit('MCGI_MR_TraderScreenCache', 'summarize: wrote ' + summaryChunkCount + ' summary chunks for ' + mergedRows.length + ' rows (' + fullJson.length + ' bytes total)');
        }

        const metaObj = {
            cacheVersion: cacheVersion,
            lastUpdated: nowIso,
            rowCount: mergedRows.length,
            lastRunMode: lastRunMode,
            lastRunTimestamp: nowIso,
            summaryChunkCount: summaryChunkCount,
        };
        if (lastRunMode === 'DELTA') {
            metaObj.deltaCount = allRows.length;
        }
        myCache.put({
            key: CacheKeys.TS_META,
            value: JSON.stringify(metaObj),
            ttl: TTL_SUMMARY,
        });

        myCache.put({
            key: CacheKeys.TS_LAST_RUN_TIMESTAMP,
            value: nowIso,
            ttl: TTL_LAST_RUN,
        });

        keysToDelete.forEach((k) => {
            try {
                myCache.remove({ key: k });
            } catch (e) {
            }
        });

        const duration = Date.now() - startTime;
        log.audit('MCGI_MR_TraderScreenCache', 'Completed. reduceKeysCount=' + reduceKeysCount + ', allRows=' + allRows.length + ', mergedRows=' + mergedRows.length + ', duration=' + duration + 'ms');

        // Self-reschedule to same deployment. Oracle docs confirm: when a MR script
        // resubmits itself, the resubmit waits until current execution completes.
        // taskId=null is expected — it means the task is deferred, not failed.
        try {
            const scriptId = runtime.getCurrentScript().id;
            const deployId = runtime.getCurrentScript().deploymentId;
            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: scriptId,
                deploymentId: deployId,
                params: {
                    custscript_ts_subsidiary_id: getScriptParam('custscript_ts_subsidiary_id', null),
                    custscript_ts_force_full_rebuild: false,
                    custscript_ts_delta_fallback_threshold: getScriptParam('custscript_ts_delta_fallback_threshold', 500),
                },
            });
            var taskId = mrTask.submit();
            log.audit('MCGI_MR_TraderScreenCache', 'Self-rescheduled. taskId=' + taskId);
        } catch (e) {
            log.error('MCGI_MR_TraderScreenCache', 'Self-reschedule failed: ' + e.message);
        }
    };

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize,
    };
});
