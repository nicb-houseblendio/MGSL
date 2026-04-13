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
], (search, cache, log, runtime, task, query, CacheKeys, CacheClient, UrlResolver) => {
    const { TTL_SUMMARY, TTL_LAST_RUN, buildDetailKey, buildDetailBucketKey } = CacheKeys;
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
        const forceFull = getScriptParam('custscript_ts_force_full_rebuild', false);
        const deltaThreshold = getScriptParam('custscript_ts_delta_fallback_threshold', 500);

        if (!subsidiaryId) {
            log.error('MCGI_MR_TraderScreenCache', 'custscript_ts_subsidiary_id is required');
            return [];
        }

        const myCache = CacheClient.getCache();
        const lastRunStr = myCache.get({ key: CacheKeys.TS_LAST_RUN_TIMESTAMP });

        const isFullMode = forceFull || !lastRunStr;

        if (isFullMode) {
            const mySearch = search.load({ id: ITEM_DATA_SEARCH_ID });
            const filters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            filters.push('AND', ['subsidiary', 'anyof', subsidiaryId]);
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
            const mySearch = search.load({ id: ITEM_DATA_SEARCH_ID });
            const flbkFilters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            flbkFilters.push('AND', ['subsidiary', 'anyof', subsidiaryId]);
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

        tranTypes.forEach((tranType) => {
            try {
                const tranSearch = search.create({
                    type: tranType,
                    filters: [
                        ['subsidiary', 'anyof', subsidiaryId],
                        'AND',
                        ['lastmodifieddate', 'onorafter', lastRunDate],
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
                log.debug('MCGI_MR_TraderScreenCache', 'Delta search error for type ' + tranType + ': ' + e.message);
            }
        });

        if (pairCount > deltaThreshold || pairCount === 0) {
            const mySearch = search.load({ id: ITEM_DATA_SEARCH_ID });
            const threshFilters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            threshFilters.push('AND', ['subsidiary', 'anyof', subsidiaryId]);
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
        baseFilters.push('AND', ['subsidiary', 'anyof', subsidiaryId]);

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
                    search.createFilter({ name: 'item', operator: search.Operator.ANYOF, values: itemId }),
                    search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
            );
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
        };
    };

    const buildOutboundRow = (r) => {
        const docId = r.id;
        const entityId = r.getValue({ name: 'entity' });
        const ppp = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp' })) || parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        return {
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, 'salesorder'),
            customerName: r.getText({ name: 'entity' }),
            customerUrl: getRecordUrl(entityId, 'customer'),
            dueDate: safeGetValue(r, { name: 'trandate', join: 'billingTransaction' }) || '',
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty' })) || 0),
            piecesPerPack: ppp,
            pricePerPiece: roundToTwoDecimals(parseFloat(safeGetValue(r, { name: 'custcol_prixpiece' })) || 0),
            rate: roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
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
        };
    };

    const buildInTransitRow = (r) => {
        const docType = r.getValue({ name: 'type' });
        const docId = r.id;
        const vendorId = r.getValue({ name: 'mainname' });
        const ppp = parseFloat(safeGetValue(r, { name: 'custcol_mgsl_ppp' })) || parseFloat(safeGetValue(r, { name: 'custitem_mgsl_ppp', join: 'item' })) || 0;
        return {
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, ITEM_RECORD_TYPE_MAPPING[docType] || 'purchaseorder'),
            shipWeek: r.getValue({ name: 'custbody_ship_week' }) || '',
            vendor: r.getText({ name: 'mainname' }),
            vendorUrl: getRecordUrl(vendorId, 'vendor'),
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty' })) || 0),
            piecesPerPack: ppp,
            pricePerPiece: roundToTwoDecimals(parseFloat(safeGetValue(r, { name: 'custcol_prixpiece' })) || 0),
            rate: roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
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

        // On Hand: replicates MCGI_SSU_OnHand.js (v1) logic exactly.
        // Uses inventoryDetail.inventorynumber (getText) for lot name,
        // inventoryDetail.quantity for per-lot base unit qty,
        // converts to packs via: (qty * 1000) / (PPP * FBM_per_piece).
        // Aggregates by lot name, filters qty > 0.
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
                mySearch.run().each(function (result) {
                    var lotNumber = result.getText({ name: 'inventorynumber', join: 'inventoryDetail' }) || '';
                    var volPCFBM = parseFloat(result.getValue({ name: 'custitem_mgsl_fbm', join: 'item' })) || 0;
                    var itemTranQty = parseFloat(result.getValue(colAdjValue)) || 0;
                    var invDetailQty = parseFloat(result.getValue({ name: 'quantity', join: 'inventoryDetail' })) || 0;
                    var tranType = result.recordType;

                    // Determine signed qty from inventoryDetail base units (v1 logic)
                    var qty = 0;
                    if (tranType === 'itemreceipt' || (tranType === 'inventoryadjustment' && itemTranQty > 0) || tranType === 'creditmemo') {
                        qty = invDetailQty;
                    } else if (tranType === 'itemfulfillment' || (tranType === 'inventoryadjustment' && itemTranQty < 0)) {
                        qty = -Math.abs(invDetailQty);
                    }

                    // Extract PPP from lot number string (last number after last hyphen)
                    var piecesPerPack = 1;
                    if (lotNumber) {
                        var match = lotNumber.match(/-(\d+(?:\.\d+)?)$/);
                        if (match) piecesPerPack = Number(match[1]);
                    } else {
                        return true; // skip rows without lot number
                    }

                    // Convert base units to packs
                    var packs = (volPCFBM > 0 && piecesPerPack > 0) ? (qty * 1000) / (piecesPerPack * volPCFBM) : 0;

                    // Aggregate by lot
                    if (lotNumber && seenLots[lotNumber] !== undefined) {
                        itemData[seenLots[lotNumber]].packQty += packs;
                        return true;
                    }
                    if (lotNumber) {
                        seenLots[lotNumber] = itemData.length;
                    }

                    var docType = result.getValue({ name: 'type' });
                    var docId = result.getValue({ name: 'internalid' });
                    var vendorId = result.getValue({ name: 'mainname' });

                    // PO pricing: look up via createdfrom + PPP match
                    var createdfromId = result.getValue({ name: 'createdfrom' }) || '';
                    var poData = createdfromId ? poPricing[createdfromId + '_' + piecesPerPack] : null;
                    var price, piecePrice;
                    if (poData && poData.rate > 0) {
                        price = roundToTwoDecimals(poData.rate);
                        piecePrice = poData.prixPiece > 0
                            ? roundToTwoDecimals(poData.prixPiece)
                            : (volPCFBM > 0 ? roundToTwoDecimals(price * volPCFBM / 1000) : 0);
                    } else {
                        price = roundToTwoDecimals(parseFloat(result.getValue({ name: 'rate' })) || 0);
                        piecePrice = volPCFBM > 0 ? roundToTwoDecimals(price * volPCFBM / 1000) : 0;
                    }

                    itemData.push({
                        docType: result.getText({ name: 'type' }),
                        docNum: result.getValue({ name: 'tranid' }),
                        docUrl: getRecordUrl(docId, ITEM_RECORD_TYPE_MAPPING[docType] || 'transaction'),
                        reloadId: safeGetValue(result, { name: 'custcol3' }) || '',
                        poWoNumber: safeGetText(result, { name: 'createdfrom' }) || safeGetValue(result, { name: 'createdfrom' }) || '',
                        poWoUrl: getRecordUrl(safeGetValue(result, { name: 'createdfrom' }), 'purchaseorder'),
                        receiptDate: result.getValue({ name: 'trandate' }),
                        vendor: result.getText({ name: 'mainname' }),
                        vendorUrl: getRecordUrl(vendorId, 'vendor'),
                        lotNo: lotNumber || '-',
                        packQty: packs,
                        piecesPerPack: piecesPerPack,
                        pricePerPiece: piecePrice,
                        avgPrice: price,
                    });
                    return true;
                });
                // Filter out lots with net qty <= 0 (v1 line 255-257)
                return itemData.filter(function (row) { return Math.round(row.packQty) > 0; });
            } catch (e) {
                log.error('MCGI_MR_TraderScreenCache', 'On Hand detail error: ' + e.message);
                return [];
            }
        })();
        if (onHand.length > 0) {
            const fbmOnHand = Math.round(
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
                        ttl: TTL_SUMMARY,
                    });
                }
            });
        } else {
            myCache.put({
                key: detailKey,
                value: detailJson,
                ttl: TTL_SUMMARY,
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
        context.mapSummary.errors.iterator().each(function (key, error) {
            log.error({ title: `Map Error for key: ${key}`, details: error });
            return true;
        });
        context.reduceSummary.errors.iterator().each(function (key, error) {
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
