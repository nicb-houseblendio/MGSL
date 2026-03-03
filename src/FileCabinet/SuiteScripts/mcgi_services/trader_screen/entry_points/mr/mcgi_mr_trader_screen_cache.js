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

    /**
     * getInputData: Returns search for full rebuild, or array of {key, value} for delta.
     */
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
            //const resultSet = mySearch.run();
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

    /**
     * summarize: Merge chunks, write TS_SUMMARY, TS_META, TS_LAST_RUN_TIMESTAMP; delete chunks.
     */
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
