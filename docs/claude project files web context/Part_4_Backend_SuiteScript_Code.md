# MGSL Trader Screen — Part 4: Backend SuiteScript Code (Full Source)

> **Purpose:** Complete source code for all NetSuite SuiteScript backend files. These are the files Claude needs to read and modify for backend changes.

---

## File 1: Map/Reduce Cache Builder
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/mr/mcgi_mr_trader_screen_cache.js`

```javascript
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
    'N/search', 'N/cache', 'N/log', 'N/runtime',
    '../../shared/cacheKeys',
    '../../shared/cacheClient',
    '../../shared/urlResolver',
], (search, cache, log, runtime, CacheKeys, CacheClient, UrlResolver) => {
    const { TTL_SUMMARY, TTL_LAST_RUN, buildDetailKey, buildDetailBucketKey, buildChunkKey } = CacheKeys;
    const { getRecordUrl } = UrlResolver;

    const ITEM_DATA_SEARCH_ID = 'customsearch_suitelet_all_items_search';
    const ON_HAND_SEARCH_ID = 'customsearch_mgsl_trader_onhand_tran';
    const COMMITTED_SEARCH_ID = 'customsearch_mgsl_trader_committed';
    const OUTBOUND_SEARCH_ID = 'customsearch_mgsl_trader_outbound';
    const ON_ORDER_SEARCH_ID = 'customsearch_mgsl_trader_onorder';
    const IN_TRANSIT_SEARCH_ID = 'customsearch_mgsl_trader_intransit';

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

    const buildSummaryRow = (result, subsidiaryId) => {
        const formulaValues = {};
        result.columns.forEach((col) => {
            if (col.formula) {
                const label = (col.label || '').toLowerCase();
                if (label === 'onhand') formulaValues.onHand = result.getValue(col);
                if (label === 'commited') formulaValues.commited = result.getValue(col);
                if (label === 'onorder') formulaValues.onOrder = result.getValue(col);
                if (label === 'intransit') formulaValues.inTransit = result.getValue(col);
                if (label === 'available') formulaValues.available = result.getValue(col);
                if (label === 'outbound') formulaValues.outbound = result.getValue(col);
            }
        });

        const onHand = roundToTwoDecimals(parseFloat(formulaValues.onHand) || 0);
        const committed = roundToTwoDecimals(parseFloat(formulaValues.commited) || 0);
        const outbound = roundToTwoDecimals(parseFloat(formulaValues.outbound) || 0);
        const onOrder = roundToTwoDecimals(parseFloat(formulaValues.onOrder) || 0);
        const inTransit = roundToTwoDecimals(parseFloat(formulaValues.inTransit) || 0);
        const available = roundToTwoDecimals(parseFloat(formulaValues.available) || 0);

        const locationId = result.getValue({ name: 'inventorylocation', summary: 'GROUP' });
        const locationName = result.getText({ name: 'inventorylocation', summary: 'GROUP' });
        const itemInternalId = result.getValue({ name: 'internalid', summary: 'MAX' });
        const itemType = result.getValue({ name: 'type', summary: 'MAX' });
        const itemCode = result.getValue({ name: 'itemid', summary: 'GROUP' });

        let widthVal = '';
        let lengthVal = '';
        result.columns.forEach((col) => {
            const name = (col.name || '').toLowerCase();
            const label = (col.label || '').toLowerCase();
            if (name.indexOf('width') >= 0 || label.indexOf('width') >= 0) {
                widthVal = result.getText(col) || result.getValue(col) || widthVal;
            }
            if (name.indexOf('length') >= 0 || label.indexOf('length') >= 0) {
                lengthVal = result.getText(col) || result.getValue(col) || lengthVal;
            }
        });
        if (!widthVal) widthVal = itemCode || '';
        if (!lengthVal) lengthVal = '';

        const recordType = ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem';

        const row = {
            internalId: String(itemInternalId),
            locationId: String(locationId),
            locationName: locationName || '',
            locationUrl: getRecordUrl(locationId, 'location'),
            isReload: false,
            itemType: itemType || 'inventoryitem',
            itemCode: itemCode || '',
            itemName: result.getValue({ name: 'salesdescription', summary: 'GROUP' }) || '',
            itemUrl: getRecordUrl(itemInternalId, recordType),
            species: result.getText({ name: 'custitem_species' }) || '',
            thickness: result.getText({ name: 'custitem_mgsl_thickness' }) || '',
            width: widthVal,
            length: lengthVal,
            grade: result.getText({ name: 'custitem_grade' }) || '',
            finition: result.getText({ name: 'custitem_finition' }) || '',
            humidity: result.getText({ name: 'custitem_humidity' }) || '',
            plannage: result.getText({ name: 'custitem_plannage' }) || '',
            etampage: result.getText({ name: 'custitem_etampage' }) || '',
            autres: result.getText({ name: 'custitem_autres' }) || '',
            quantityFBM: roundToTwoDecimals(
                    parseFloat(result.getValue({ name: 'locationquantityonhand', summary: 'GROUP' })) || 0
            ),
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

    const getInputData = () => {
        const subsidiaryId = getScriptParam('custscript_ts_subsidiary_id', null);
        const forceFull = getScriptParam('custscript_ts_force_full_rebuild', true);
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
            //const filters = mySearch.filterExpression ? mySearch.filterExpression.concat() : [];
            //filters.push('AND', ['subsidiary', 'anyof', subsidiaryId]);
            //mySearch.filterExpression = filters;
            //log.debug('MCGI_MR_TraderScreenCache', filters);
            const fullInput = {};
            log.debug('MCGI_MR_TraderScreenCache', 'Running full search in full mode');
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
            const s = search.load({ id: searchId });
            s.filters.push(
                    search.createFilter({ name: 'item', operator: search.Operator.ANYOF, values: itemId }),
                    search.createFilter({ name: 'location', operator: search.Operator.ANYOF, values: locationId })
            );
            runPagedAll(s).forEach((r) => {
                const row = rowBuilder(r);
                if (row) rows.push(row);
            });
        } catch (e) {
            log.debug('MCGI_MR_TraderScreenCache', 'Detail search ' + searchId + ' error: ' + e.message);
        }
        return rows;
    };

    const buildOnHandRow = (r) => {
        let formulaCol = null;
        r.columns.forEach((col) => {
            if (col.formula && col.label) formulaCol = col;
        });
        const qty = formulaCol ? parseFloat(r.getValue(formulaCol)) || 0 : 0;
        const docType = r.getValue({ name: 'type' });
        const docId = r.getValue({ name: 'internalid' });
        const vendorId = r.getValue({ name: 'mainname' });
        return {
            docType: r.getText({ name: 'type' }),
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, ITEM_RECORD_TYPE_MAPPING[docType] || 'transaction'),
            receiptDate: r.getValue({ name: 'trandate' }),
            vendor: r.getText({ name: 'mainname' }),
            vendorUrl: getRecordUrl(vendorId, 'vendor'),
            lotNo: r.getValue({ name: 'serialnumber' }) || '-',
            packQty: roundToTwoDecimals(qty),
            avgPrice: roundToTwoDecimals(parseFloat(r.getValue({ name: 'locationaveragecost' })) || 0),
        };
    };

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
        const itemId = r.getValue({ name: 'internalid', join: 'item' });
        const itemType = r.getValue({ name: 'type', join: 'item' });
        return {
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, 'salesorder'),
            customerName: r.getText({ name: 'entity' }),
            customerUrl: getRecordUrl(entityId, 'customer'),
            tranDate: r.getValue({ name: 'trandate' }),
            expectedShipDate: r.getValue({ name: 'custbody_ship_week' }),
            itemCode: r.getValue({ name: 'itemid', join: 'item' }),
            itemUrl: getRecordUrl(itemId, ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem'),
            packCommitted: roundToTwoDecimals(parseFloat(formulaValues.commited) || 0),
            openPackQty: roundToTwoDecimals(parseFloat(formulaValues.quantity) || 0),
            rate: roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
            pricePerPiece: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_prixpiece' })) || 0),
        };
    };

    const buildOutboundRow = (r) => {
        const formulaValues = {};
        r.columns.forEach((col) => {
            if (col.formula) {
                if (col.label === 'Invoiced Quantity') formulaValues.invoicedQuantity = r.getValue(col);
                if (col.label === 'Remaining Quantity') formulaValues.remainingQuantity = r.getValue(col);
            }
        });
        const docType = r.getValue({ name: 'type', join: 'item' });
        const docId = r.id;
        const entityId = r.getValue({ name: 'entity' });
        const itemId = r.getValue({ name: 'internalid', join: 'item' });
        const itemType = r.getValue({ name: 'type', join: 'item' });
        return {
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, ITEM_RECORD_TYPE_MAPPING[docType] || 'salesorder'),
            customerName: r.getText({ name: 'entity' }),
            customerUrl: getRecordUrl(entityId, 'customer'),
            dueDate: r.getValue({ name: 'duedate' }) || r.getValue({ name: 'shipdate' }),
            itemCode: r.getValue({ name: 'itemid', join: 'item' }),
            itemUrl: getRecordUrl(itemId, ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem'),
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty' })) || 0),
            invoicedQty: roundToTwoDecimals(parseFloat(formulaValues.invoicedQuantity) || 0),
            remainingQty: roundToTwoDecimals(parseFloat(formulaValues.remainingQuantity) || 0),
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
        const vendorId = r.getValue({ name: 'entity', summary: 'GROUP' });
        const itemId = r.getValue({ name: 'internalid', join: 'item', summary: 'GROUP' });
        const itemType = r.getValue({ name: 'type', join: 'item', summary: 'GROUP' });
        return {
            docNum: r.getValue({ name: 'tranid', summary: 'GROUP' }),
            docUrl: getRecordUrl(docId, 'purchaseorder'),
            vendorName: r.getText({ name: 'entityid', join: 'vendor' }) || r.getValue({ name: 'entity', summary: 'GROUP' }),
            vendorUrl: getRecordUrl(vendorId, 'vendor'),
            shipDate: r.getValue({ name: 'duedate', summary: 'GROUP' }) || r.getValue({ name: 'shipdate', summary: 'GROUP' }),
            itemCode: r.getValue({ name: 'itemid', join: 'item', summary: 'GROUP' }),
            itemUrl: getRecordUrl(itemId, ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem'),
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty', summary: 'GROUP' })) || 0),
            openQty: roundToTwoDecimals(parseFloat(formulaValues.openQuantity) || 0),
            rate: roundToTwoDecimals(parseFloat(formulaValues.price) || parseFloat(r.getValue({ name: 'rate', summary: 'MAX' })) || 0),
        };
    };

    const buildInTransitRow = (r) => {
        const formulaValues = {};
        r.columns.forEach((col) => {
            if (col.formula && (col.label === 'In Transit *Additional' || col.label === 'In Transit * Additional')) {
                formulaValues.quantity = r.getValue(col);
            }
        });
        const docType = r.getValue({ name: 'type' });
        const docId = r.id;
        const vendorId = r.getValue({ name: 'mainname' });
        const itemId = r.getValue({ name: 'internalid', join: 'item' });
        const itemType = r.getValue({ name: 'type', join: 'item' });
        return {
            docNum: r.getValue({ name: 'tranid' }),
            docUrl: getRecordUrl(docId, ITEM_RECORD_TYPE_MAPPING[docType] || 'purchaseorder'),
            tranDate: r.getValue({ name: 'trandate' }),
            vendor: r.getText({ name: 'mainname' }),
            vendorUrl: getRecordUrl(vendorId, 'vendor'),
            itemCode: r.getValue({ name: 'itemid', join: 'item' }),
            itemUrl: getRecordUrl(itemId, ITEM_RECORD_TYPE_MAPPING[itemType] || 'inventoryitem'),
            packQty: roundToTwoDecimals(parseFloat(r.getValue({ name: 'custcol_mgsl_packqty' })) || 0),
            inTransitAdditional: roundToTwoDecimals(parseFloat(formulaValues.quantity) || 0),
            rate: roundToTwoDecimals(parseFloat(r.getValue({ name: 'rate' })) || 0),
        };
    };

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

        const onHand = runDetailSearch(ON_HAND_SEARCH_ID, itemId, locationId, buildOnHandRow);
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

        const chunkKey = buildChunkKey(key);
        myCache.put({
            key: chunkKey,
            value: JSON.stringify([summaryRow]),
            ttl: TTL_SUMMARY,
        });
    };

    const summarize = (context) => {
        const startTime = Date.now();
        const myCache = CacheClient.getCache();

        const allRows = [];
        const chunkPrefix = CacheKeys.TS_SUMMARY_CHUNK_PREFIX;
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
            context.reduceSummary.keys.iterator().each((reduceKey) => {
                reduceKeysCount++;
                const chunkKey = chunkPrefix + reduceKey;
                const val = myCache.get({ key: chunkKey });
                if (val) {
                    keysToDelete.push(chunkKey);
                    try {
                        const rows = JSON.parse(val);
                        if (Array.isArray(rows)) allRows.push(...rows);
                    } catch (e) {
                        log.debug('MCGI_MR_TraderScreenCache', 'Chunk parse error: ' + e.message);
                    }
                } else {
                    log.audit('MCGI_MR_TraderScreenCache', 'summarize: chunk MISS for key=' + reduceKey);
                }
                return true;
            });
        }
        log.audit('MCGI_MR_TraderScreenCache', 'summarize: reduceKeysCount=' + reduceKeysCount + ', allRows.length=' + allRows.length);

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

        myCache.put({
            key: CacheKeys.TS_SUMMARY,
            value: JSON.stringify(mergedRows),
            ttl: TTL_SUMMARY,
        });

        const metaObj = {
            cacheVersion: cacheVersion,
            lastUpdated: nowIso,
            rowCount: mergedRows.length,
            lastRunMode: lastRunMode,
            lastRunTimestamp: nowIso,
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
    };

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize,
    };
});
```

---

## File 2: RESTlet API Gateway
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/rl/mcgi_rl_trader_api.js`

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @description Trader Screen REST API - thin RESTlet delegating to trader_screen_service
 */
define(['../../service/trader_screen_service_factory'], ServiceFactory => {
    const serviceName = 'traderScreen';

    const getParamsFromGet = requestParams => {
        const p = requestParams || {};
        return {
            action: p.action,
            itemId: p.itemId,
            locationId: p.locationId,
            bucket: p.bucket,
            subsidiaryId: p.subsidiaryId,
            location: p.location,
            item: p.item,
            greaterThanZero: p.greaterThanZero !== 'false',
            species: p.species,
            thickness: p.thickness,
            width: p.width,
            length: p.length,
            grade: p.grade,
            finition: p.finition,
            humidity: p.humidity,
            plannage: p.plannage,
            etampage: p.etampage,
            autres: p.autres,
        };
    };

    const getParamsFromPost = requestBody => {
        if (!requestBody) return {};
        if (typeof requestBody === 'object') return requestBody;
        try {
            return JSON.parse(requestBody);
        } catch (e) {
            return {};
        }
    };

    const get = requestParams => {
        const params = getParamsFromGet(requestParams);
        if (!params.action) params.action = 'get';
        const svc = ServiceFactory.getService(serviceName);
        const result = svc.getRouter(params);
        return (result && typeof result === 'object') ? JSON.stringify(result) : result;
    };

    const post = requestBody => {
        const params = getParamsFromPost(requestBody);
        if (!params.action) params.action = 'post';
        const svc = ServiceFactory.getService(serviceName);
        const result = svc.postRouter(params);
        return (result && typeof result === 'object') ? JSON.stringify(result) : result;
    };

    return { get: get, post: post };
});
```

---

## File 3: Trader Screen Service (Business Logic)
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service.js`

This is the core business logic layer. The RESTlet delegates all GET and POST actions to this service. Contains handlers for: `getContext`, `meta`, `summary`, `detail`, and `createOrder`. Also contains `applyFilters` (server-side filtering) and `computeTotals`.

**Key observations:**
- Line 252: `const rows` then `rows = []` — const reassignment bug (GAP-SVC-01)
- Lines 348-378: createOrder only sets entity, location, item, quantity, date, memo — missing department, class, subsidiary fields (GAP-SVC-02)
- Lines 380-381: reads `tranid` from the in-memory record after `save()` which may not work (GAP-SVC-03)
- `applyFilters` duplicates client-side filtering logic from `useSummaryData.ts` — applied server-side on RESTlet GET
- `DEFAULT_UOM_CONFIG` duplicated here and in App.tsx

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Trader Screen service - handlers for meta, summary, detail, getContext, createOrder.
 * Logic moved from MCGI_RL_TraderAPI.js; used by thin RESTlet.
 */
define([
    'N/url', 'N/runtime', 'N/record', 'N/log',
    '../shared/cacheKeys',
    '../shared/cacheClient',
], (url, runtime, record, log, CacheKeys, CacheClient) => {

    const toIdArray = value => {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(Number).filter(function (n) {
            return !isNaN(n);
        });
        return value.toString().split(',').map(function (v) {
            return Number(String(v).trim());
        }).filter(function (n) {
            return !isNaN(n);
        });
    };

    const toValueList = value => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return value.toString().split(',').map(function (v) {
            return String(v).trim();
        }).filter(Boolean);
    };

    const getMyCache = () => CacheClient.getCache();

    const applyFilters = (rows, params) => {
        let filtered = rows;
        if (params.location && toIdArray(params.location).length > 0) {
            const locIds = toIdArray(params.location);
            filtered = filtered.filter(function (r) {
                return locIds.indexOf(Number(r.locationId)) >= 0;
            });
        }
        if (params.item && toIdArray(params.item).length > 0) {
            const itemIds = toIdArray(params.item);
            filtered = filtered.filter(function (r) {
                return itemIds.indexOf(Number(r.internalId)) >= 0;
            });
        }
        if (params.species && toValueList(params.species).length > 0) {
            const spVals = toValueList(params.species);
            filtered = filtered.filter(function (r) {
                const rv = String(r.species || '').trim();
                return spVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.thickness && toValueList(params.thickness).length > 0) {
            const thVals = toValueList(params.thickness);
            filtered = filtered.filter(function (r) {
                const rv = String(r.thickness || '').trim();
                return thVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.width && toValueList(params.width).length > 0) {
            const wVals = toValueList(params.width);
            filtered = filtered.filter(function (r) {
                const rv = String(r.width || '').trim();
                return wVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.length && toValueList(params.length).length > 0) {
            const lenVals = toValueList(params.length);
            filtered = filtered.filter(function (r) {
                const rv = String(r.length || '').trim();
                return lenVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.grade && toValueList(params.grade).length > 0) {
            const grVals = toValueList(params.grade);
            filtered = filtered.filter(function (r) {
                const rv = String(r.grade || '').trim();
                return grVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.finition && toValueList(params.finition).length > 0) {
            const finVals = toValueList(params.finition);
            filtered = filtered.filter(function (r) {
                const rv = String(r.finition || '').trim();
                return finVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.humidity && toValueList(params.humidity).length > 0) {
            const humVals = toValueList(params.humidity);
            filtered = filtered.filter(function (r) {
                const rv = String(r.humidity || '').trim();
                return humVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.plannage && toValueList(params.plannage).length > 0) {
            const planVals = toValueList(params.plannage);
            filtered = filtered.filter(function (r) {
                const rv = String(r.plannage || '').trim();
                return planVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.etampage && toValueList(params.etampage).length > 0) {
            const etVals = toValueList(params.etampage);
            filtered = filtered.filter(function (r) {
                const rv = String(r.etampage || '').trim();
                return etVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.autres && toValueList(params.autres).length > 0) {
            const autVals = toValueList(params.autres);
            filtered = filtered.filter(function (r) {
                const rv = String(r.autres || '').trim();
                return autVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.greaterThanZero !== false) {
            filtered = filtered.filter(function (r) {
                const total = (parseFloat(r.onHand) || 0) + (parseFloat(r.committed) || 0) + (parseFloat(r.outbound) || 0) +
                        (parseFloat(r.onOrder) || 0) + (parseFloat(r.inTransit) || 0);
                return total > 0;
            });
        }
        return filtered;
    };

    const computeTotals = rows => {
        const totals = { onHand: 0, committed: 0, outbound: 0, onOrder: 0, inTransit: 0, available: 0 };
        rows.forEach(function (r) {
            totals.onHand += parseFloat(r.onHand) || 0;
            totals.committed += parseFloat(r.committed) || 0;
            totals.outbound += parseFloat(r.outbound) || 0;
            totals.onOrder += parseFloat(r.onOrder) || 0;
            totals.inTransit += parseFloat(r.inTransit) || 0;
            totals.available += parseFloat(r.available) || 0;
        });
        return totals;
    };

    const getHandler = dataIn => {
        const action = (dataIn && dataIn.action) || 'get';
        const handler = TraderScreenService.getHandler[action];
        if (!handler) {
            return { success: false, error: 'Unknown action: ' + action };
        }
        return handler(dataIn);
    };

    const postHandler = dataIn => {
        const action = (dataIn && dataIn.action) || 'post';
        const handler = TraderScreenService.postHandler[action];
        if (!handler) {
            return { success: false, error: 'Unknown action: ' + action };
        }
        return handler(dataIn);
    };

    const DEFAULT_UOM_CONFIG = {
        'CWP IND': ['MBF', 'Packs'],
        'CWP MTL': ['MBF', 'Packs', 'TL'],
        'CWP ARCH': ['MBF', 'Cubic meters (m\u00B3)', 'Packs'],
    };

    const handleGetContext = () => {
        const user = runtime.getCurrentUser();
        let subsidiaryName = '';
        if (user.subsidiary) {
            try {
                const subRec = record.load({ type: 'subsidiary', id: user.subsidiary });
                subsidiaryName = subRec.getValue({ fieldId: 'name' }) || '';
            } catch (e) {
                subsidiaryName = String(user.subsidiary);
            }
        }

        let uomConfig = DEFAULT_UOM_CONFIG;
        try {
            const uomJson = runtime.getCurrentScript().getParameter({ name: 'custscript_ts_uom_config_json' });
            if (uomJson) {
                const parsed = JSON.parse(uomJson);
                if (parsed && typeof parsed === 'object') {
                    uomConfig = parsed;
                }
            }
        } catch (e) {
            log.debug('trader_screen_service', 'UOM config parse error, using defaults: ' + e.message);
        }

        return {
            success: true,
            data: {
                userId: user.id,
                userName: user.name,
                subsidiaryId: user.subsidiary,
                subsidiaryName: subsidiaryName,
                accountId: runtime.accountId,
                uomConfig: uomConfig,
            },
        };
    };

    const handleGetMeta = () => {
        try {
            const myCache = getMyCache();
            const metaStr = myCache.get({ key: CacheKeys.TS_META });
            if (!metaStr) {
                return { available: false, reason: 'CACHE_MISS' };
            }
            const meta = JSON.parse(metaStr);
            return {
                available: true,
                cacheVersion: meta.cacheVersion,
                lastUpdated: meta.lastUpdated,
                rowCount: meta.rowCount,
            };
        } catch (e) {
            log.error('trader_screen_service', 'getMeta: ' + e.message);
            return { available: false, reason: 'ERROR' };
        }
    };

    const handleGetSummary = params => {
        try {
            const myCache = getMyCache();
            const summaryStr = myCache.get({ key: CacheKeys.TS_SUMMARY });
            if (!summaryStr) {
                return { error: 'CACHE_MISS', message: 'Cache is being refreshed. Try again shortly.' };
            }
            const rows = JSON.parse(summaryStr);
            if (!Array.isArray(rows)) rows = [];

            const filtered = applyFilters(rows, params || {});
            const totals = computeTotals(filtered);

            const metaStr = myCache.get({ key: CacheKeys.TS_META });
            let meta = { lastUpdated: '', cacheVersion: 0, rowCount: 0 };
            if (metaStr) {
                try {
                    meta = JSON.parse(metaStr);
                } catch (e) {
                }
            }

            return {
                success: true,
                rows: filtered,
                totals: totals,
                meta: {
                    lastUpdated: meta.lastUpdated,
                    cacheVersion: meta.cacheVersion,
                    rowCount: filtered.length,
                },
            };
        } catch (e) {
            log.error('trader_screen_service', 'getSummary: ' + e.message);
            return { error: 'CACHE_MISS', message: 'Cache error. Try again shortly.' };
        }
    };

    const handleGetDetail = dataIn => {
        const itemId = dataIn && dataIn.itemId;
        const locationId = dataIn && dataIn.locationId;
        const bucket = dataIn && dataIn.bucket;
        if (!itemId || !locationId) {
            return { success: false, error: 'itemId and locationId required' };
        }
        try {
            const myCache = getMyCache();
            const key = CacheKeys.buildDetailKey(itemId, locationId);
            const detailStr = myCache.get({ key: key });
            let detail;
            if (detailStr) {
                detail = JSON.parse(detailStr);
            } else {
                const bucketNames = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit'];
                const merged = {};
                let anyFound = false;
                bucketNames.forEach(b => {
                    const bKey = CacheKeys.buildDetailBucketKey(itemId, locationId, b);
                    const bStr = myCache.get({ key: bKey });
                    if (bStr) {
                        anyFound = true;
                        try { merged[b] = JSON.parse(bStr); } catch (e) { merged[b] = []; }
                    } else {
                        merged[b] = [];
                    }
                });
                if (!anyFound) {
                    return { error: 'DETAIL_CACHE_MISS', message: 'Data unavailable, please wait for next cache refresh.' };
                }
                detail = merged;
            }
            if (bucket && detail[bucket] !== undefined) {
                return { success: true, data: detail[bucket] };
            }
            return { success: true, data: detail };
        } catch (e) {
            log.error('trader_screen_service', 'getDetail: ' + e.message);
            return { error: 'DETAIL_CACHE_MISS', message: 'Data unavailable.' };
        }
    };

    const handleCreateOrder = params => {
        const type = params.type;
        const itemId = params.itemId;
        const locationId = params.locationId;
        const partyId = params.partyId;
        const quantity = parseFloat(params.quantity);
        const dateStr = params.date;
        const notes = params.notes || '';

        const errors = [];
        if (!type || (type !== 'PO' && type !== 'SO')) {
            errors.push({ field: 'type', message: 'type must be PO or SO' });
        }
        if (!itemId) errors.push({ field: 'itemId', message: 'itemId required' });
        if (!locationId) errors.push({ field: 'locationId', message: 'locationId required' });
        if (!partyId) errors.push({ field: 'partyId', message: 'partyId (vendor/customer) required' });
        if (isNaN(quantity) || quantity <= 0) errors.push({ field: 'quantity', message: 'quantity must be a positive number' });
        if (!dateStr) errors.push({ field: 'date', message: 'date required (ISO 8601)' });

        if (errors.length > 0) {
            return { success: false, error: JSON.stringify(errors) };
        }

        try {
            let rec;
            if (type === 'PO') {
                rec = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });
                rec.setValue({ fieldId: 'entity', value: partyId });
                rec.setValue({ fieldId: 'location', value: locationId });
                rec.selectNewLine({ sublistId: 'item' });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId });
                if (dateStr) {
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) rec.setValue({ fieldId: 'duedate', value: d });
                }
                if (notes) rec.setValue({ fieldId: 'memo', value: notes });
                rec.commitLine({ sublistId: 'item' });
            } else {
                rec = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
                rec.setValue({ fieldId: 'entity', value: partyId });
                rec.setValue({ fieldId: 'location', value: locationId });
                rec.selectNewLine({ sublistId: 'item' });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId });
                if (dateStr) {
                    const d2 = new Date(dateStr);
                    if (!isNaN(d2.getTime())) rec.setValue({ fieldId: 'shipdate', value: d2 });
                }
                if (notes) rec.setValue({ fieldId: 'memo', value: notes });
                rec.commitLine({ sublistId: 'item' });
            }

            const docId = rec.save();
            const docNum = rec.getValue({ fieldId: 'tranid' });
            const docUrl = url.resolveRecord({
                recordType: type === 'PO' ? 'purchaseorder' : 'salesorder',
                recordId: docId,
                isEditMode: false,
            });

            return {
                success: true,
                docId: docId,
                docNum: docNum,
                docUrl: docUrl,
            };
        } catch (e) {
            log.error('trader_screen_service', 'createOrder: ' + e.message);
            return { success: false, error: e.message || 'Failed to create order' };
        }
    };

    const TraderScreenService = {
        getHandler: {
            getContext: handleGetContext,
            meta: handleGetMeta,
            summary: handleGetSummary,
            detail: handleGetDetail,
        },
        postHandler: {
            createOrder: handleCreateOrder,
        },
        getRouter: function (dataIn) {
            if (!dataIn || !dataIn.action) {
                return { success: false, error: 'action parameter required' };
            }
            return getHandler(dataIn);
        },
        postRouter: function (dataIn) {
            if (!dataIn || !dataIn.action) {
                return { success: false, error: 'action parameter required' };
            }
            if (dataIn.action === 'createOrder') {
                return postHandler(dataIn);
            }
            return { success: false, error: 'Unknown action: ' + dataIn.action };
        },
    };

    return TraderScreenService;
});
```

---

## File 4: Service Factory
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/service/trader_screen_service_factory.js`

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Service factory for Trader Screen RESTlet API
 */
define(['./trader_screen_service'], TraderScreenService => {
  const serviceMap = {
    traderScreen: TraderScreenService,
  };

  return {
    getService: serviceName => {
      if (!serviceMap[serviceName]) {
        throw new Error('Service not found: ' + serviceName);
      }
      return serviceMap[serviceName];
    },
  };
});
```

---

## File 5: Cache Keys
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/cacheKeys.js`

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Centralized cache key constants for Trader Screen.
 */
define([], () => {
    const CACHE_NAME = 'MGSL_TRADERSCREEN_CACHE';
    const TS_META = 'TS_META';
    const TS_SUMMARY = 'TS_SUMMARY';
    const TS_DETAIL_PREFIX = 'TS_DETAIL__';
    const TS_LAST_RUN_TIMESTAMP = 'TS_LAST_RUN_TIMESTAMP';
    const TS_SUMMARY_CHUNK_PREFIX = 'TS_SUMMARY_CHUNK__';
    const TTL_SUMMARY = 1800;
    const TTL_LAST_RUN = 86400;

    const buildDetailKey = (itemId, locationId) =>
        TS_DETAIL_PREFIX + itemId + '__' + locationId;

    const buildDetailBucketKey = (itemId, locationId, bucket) =>
        TS_DETAIL_PREFIX + itemId + '__' + locationId + '__' + bucket;

    const buildChunkKey = (reduceKey) =>
        TS_SUMMARY_CHUNK_PREFIX + reduceKey;

    return {
        CACHE_NAME, TS_META, TS_SUMMARY, TS_DETAIL_PREFIX,
        TS_LAST_RUN_TIMESTAMP, TS_SUMMARY_CHUNK_PREFIX,
        TTL_SUMMARY, TTL_LAST_RUN,
        buildDetailKey, buildDetailBucketKey, buildChunkKey,
    };
});
```

---

## File 6: Cache Client
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/cacheClient.js`

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Centralized N/cache client for Trader Screen (PUBLIC scope).
 */
define(['N/cache', './cacheKeys'], (cache, CacheKeys) => {
    const getCache = () => cache.getCache({
        name: CacheKeys.CACHE_NAME,
        scope: cache.Scope.PUBLIC,
    });

    return { getCache };
});
```

---

## File 7: Schemas
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/schemas.js`

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Schema constants for TS_META, TS_SUMMARY, and TS_DETAIL contracts.
 */
define([], () => {
    const SUMMARY_FIELDS = [
        'internalId', 'locationId', 'locationName', 'locationUrl', 'isReload',
        'itemType', 'itemCode', 'itemName', 'itemUrl',
        'species', 'thickness', 'width', 'length', 'grade',
        'finition', 'humidity', 'plannage', 'etampage', 'autres',
        'onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available',
        'quantityFBM', 'averageCost', 'detailKey',
    ];

    const META_FIELDS = [
        'cacheVersion', 'lastUpdated', 'rowCount',
        'lastRunMode', 'deltaCount', 'lastRunTimestamp',
    ];

    const DETAIL_BUCKETS = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit'];

    const DETAIL_ROW_SCHEMAS = {
        onHand: ['docType', 'docNum', 'docUrl', 'receiptDate', 'vendor', 'vendorUrl', 'lotNo', 'packQty', 'avgPrice'],
        committed: ['docNum', 'docUrl', 'customerName', 'customerUrl', 'tranDate', 'expectedShipDate', 'itemCode', 'itemUrl', 'packCommitted', 'openPackQty', 'rate', 'pricePerPiece'],
        outbound: ['docNum', 'docUrl', 'customerName', 'customerUrl', 'dueDate', 'itemCode', 'itemUrl', 'packQty', 'invoicedQty', 'remainingQty', 'rate'],
        onOrder: ['docNum', 'docUrl', 'vendorName', 'vendorUrl', 'shipDate', 'itemCode', 'itemUrl', 'packQty', 'openQty', 'rate'],
        inTransit: ['docNum', 'docUrl', 'tranDate', 'vendor', 'vendorUrl', 'itemCode', 'itemUrl', 'packQty', 'inTransitAdditional', 'rate'],
    };

    return { SUMMARY_FIELDS, META_FIELDS, DETAIL_BUCKETS, DETAIL_ROW_SCHEMAS };
});
```

---

## File 8: URL Resolver
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/shared/urlResolver.js`

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Thin wrapper around N/url.resolveRecord for reuse across Trader Screen scripts.
 */
define(['N/url'], (url) => {
    const getRecordUrl = (recordId, recordType) => {
        if (!recordId || !recordType) return '';
        try {
            return url.resolveRecord({
                recordType: recordType,
                recordId: String(recordId),
                isEditMode: false,
            });
        } catch (e) {
            return '';
        }
    };

    return { getRecordUrl };
});
```

---

## File 9: Suitelet HTML Shell
**Path:** `src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/entry_points/sl/mcgi_sl_trader_screen_react.js`

Serves the React app as an inline HTML page within a NetSuite Suitelet form. Loads `bundle.js` and `bundle.css` from the File Cabinet and injects them inline (not as external script/link tags). Injects `window.MCGI_CONFIG` with RESTlet URL, user context, and subsidiary info.

**Key observations:**
- Uses `serverWidget.createForm` + `INLINEHTML` field approach to serve full HTML
- `fullBleedScript` on line 101 is a self-executing function that forces the Suitelet iframe content to full width by removing NetSuite chrome margins
- Line 96: `log.debug('Config Object', configObj)` — `log` is not imported in the `define()` call. This will throw a ReferenceError in production. The `define` imports `serverWidget, runtime, url, file, record` but NOT `N/log`.
- Loads subsidiary name by loading the subsidiary record (1 record load, zero searches)
- Bundle is inlined in a `<script>` tag, not loaded as an external resource

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description Serves React Trader Screen: HTML shell with bundle.js and bundle.css from File Cabinet. Injects MCGI_CONFIG.
 *
 * Data loading: The React app calls the RESTlet (RESTLET_SCRIPT_ID) for summary data. The RESTlet reads from
 * cache key TS_SUMMARY, which is populated by the Map/Reduce script MCGI_MR_TraderScreenCache. If no data loads,
 * (1) ensure the RESTlet script/deploy IDs below match your deployed RESTlet, and (2) run or schedule the
 * Map/Reduce script to populate the cache.
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/url', 'N/file', 'N/record'], (serverWidget, runtime, url, file, record) => {

    // Must match the deployed RESTlet. If using mcgi_rl_trader_api.js, script id is often customscript_mcgi_rl_trader_api.
    const RESTLET_SCRIPT_ID = 'customscript_mcgi_rl_traderapi';
    const RESTLET_DEPLOY_ID = 'customdeploy_mcgi_rl_traderapi';

    /**
     * Resolve RESTlet URL for API calls
     * @returns {string} RESTlet URL
     */
    const getRestletUrl = () => url.resolveScript({
        scriptId: RESTLET_SCRIPT_ID,
        deploymentId: RESTLET_DEPLOY_ID,
    });

    /**
     * Load file content from File Cabinet by path. Zero searches.
     * @param {string} fileName - e.g. 'bundle.js' or 'bundle.css'
     * @returns {string} File contents or empty string
     */
    const loadBundleFile = (fileName) => {
        const pathByPath = '/SuiteScripts/mcgi_services/trader_screen/react-app/dist/' + fileName;
        try {
            const f = file.load({ id: pathByPath });
            return f.getContents() || '';
        } catch (e) {
            return '';
        }
    };

    /**
     * Get React bundle script tag (inline script with bundle.js content)
     * @returns {string} <script>...</script> or fallback message script
     */
    const getReactBundleScript = () => {
        const content = loadBundleFile('bundle.js');
        if (content && content.trim().length > 0) {
            return '<script>' + content + '</script>';
        }
        return '<script>document.getElementById("react-root").innerHTML="<p style=\\"padding:20px;font-family:sans-serif;\\">Bundle not found. Run <code>npm run build</code> from react-app and deploy dist/bundle.js to File Cabinet at SuiteScripts/mcgi_services/trader_screen/react-app/dist/.</p>";</script>';
    };

    /**
     * Get React CSS content (raw CSS for bundle.css)
     * @returns {string} Raw CSS or empty string
     */
    const getReactCSS = () => loadBundleFile('bundle.css');

    /**
     * Build HTML shell with fonts, styles, react-root, MCGI_CONFIG, and bundle script
     * @returns {string} Full HTML string
     */
    const getReactHTMLShell = () => {
        let restletUrl;
        try {
            restletUrl = getRestletUrl();
        } catch (e) {
            restletUrl = null;
        }

        const user = runtime.getCurrentUser();
        let subsidiaryName = 'CWP Industriel Inc.';
        if (user.subsidiary) {
            try {
                const subRec = record.load({ type: 'subsidiary', id: user.subsidiary });
                subsidiaryName = subRec.getValue({ fieldId: 'name' }) || subsidiaryName;
            } catch (err) {
                subsidiaryName = String(user.subsidiary);
            }
        }

        const suiteletUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
        });

        const reactCss = getReactCSS();
        const configObj = {
            restletUrl: restletUrl,
            suiteletUrl: suiteletUrl,
            userId: String(user.id),
            userName: user.name || '',
            accountId: runtime.accountId,
            subsidiary: { id: user.subsidiary, name: subsidiaryName },
        };
        log.debug('Config Object', configObj)
        const configJson = JSON.stringify(configObj)
                .replace(/</g, '\\u003c')
                .replace(/>/g, '\\u003e');

        const fullBleedScript = '<script>(function(){function fullWidth(el){el.style.setProperty("width","100%","important");el.style.setProperty("max-width","100%","important");el.style.setProperty("margin","0","important");el.style.setProperty("padding","0","important");el.style.setProperty("box-sizing","border-box","important");}function go(){var el=document.getElementById("react-root");if(!el)return;fullWidth(el);el.style.setProperty("margin-top","-65px","important");var p=el.parentElement;while(p){fullWidth(p);p=p.parentElement;}fullWidth(document.body);fullWidth(document.documentElement);document.body.style.setProperty("overflow-x","hidden","important");}function run(){go();setTimeout(go,50);setTimeout(go,200);}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();})();<\/script>';
        return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>Trader Screen</title>' +
                '<link rel="preconnect" href="https://fonts.googleapis.com">' +
                '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
                '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' +
                (reactCss ? '<style>' + reactCss + '</style>' : '') +
                '</head><body><div id="react-root"></div>' +
                fullBleedScript +
                '<script>window.MCGI_CONFIG=' + configJson + ';window.__NS_CONFIG__=window.MCGI_CONFIG;</script>' +
                getReactBundleScript() +
                '</body></html>';
    };

    const onRequest = context => {
        if (context.request.method !== 'GET') {
            context.response.write(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        const form = serverWidget.createForm({ title: 'Trader Screen' });
        const reactField = form.addField({
            id: 'custpage_trader_react',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
        });
        reactField.defaultValue = getReactHTMLShell();
        context.response.writePage(form);
    };

    return { onRequest: onRequest };
});
```

---

*End of Part 4. Next: Part 5 — Frontend Core Code (Hooks, API, Types, Config, Context, CSS)*
