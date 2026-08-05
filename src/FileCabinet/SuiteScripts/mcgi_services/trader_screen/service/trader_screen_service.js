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
                // Previously a SILENT return. This is the exact path that renders the
                // "Cache is being refreshed" banner, so when a trader reports an empty
                // screen there was no server-side record that it had even happened.
                log.error('trader_screen_service', 'getSummary: CACHE_MISS — TS_SUMMARY absent');
                return { error: 'CACHE_MISS', message: 'Cache is being refreshed. Try again shortly.' };
            }
            const parsed = JSON.parse(summaryStr);
            let rows;
            let chunkCount = 0;
            let chunksMissing = 0;
            if (parsed && parsed.chunked && parsed.chunkCount) {
                chunkCount = parsed.chunkCount;
                rows = [];
                for (let i = 0; i < parsed.chunkCount; i++) {
                    const chunkStr = myCache.get({ key: CacheKeys.buildSummaryDataKey(i) });
                    if (chunkStr) {
                        const chunkRows = JSON.parse(chunkStr);
                        if (Array.isArray(chunkRows)) rows.push.apply(rows, chunkRows);
                    } else {
                        chunksMissing++;
                    }
                }
            } else {
                rows = Array.isArray(parsed) ? parsed : [];
            }

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

            // One line per request describing what the screen was actually served. The
            // service used to log only inside catch blocks, so a healthy-but-wrong
            // response left no trace at all — prod had logged literally zero lines when
            // a trader reported seeing only 3-4 items (2026-08-05), making the report
            // impossible to diagnose after the fact.
            const svcState = 'rowsInCache=' + rows.length + ' rowsServed=' + filtered.length +
                ' metaRowCount=' + (meta.rowCount || 0) + ' chunks=' + chunkCount +
                ' chunksMissing=' + chunksMissing + ' cacheVersion=' + (meta.cacheVersion || 0) +
                ' greaterThanZero=' + ((params || {}).greaterThanZero !== false);
            // Mirrors every discriminating key applyFilters() acts on. greaterThanZero is
            // deliberately excluded: it defaults to true on every request, so counting it
            // would mean no request is ever "unfiltered". Keep this list in sync with
            // applyFilters — a key added there but missed here reintroduces false errors.
            const p = params || {};
            const isUnfiltered = ['location', 'item', 'species', 'thickness', 'width', 'length',
                'grade', 'finition', 'humidity', 'plannage', 'etampage', 'autres', 'country',
                'vendor', 'po'].every(function (k) { return !p[k]; });
            // NOTE ON LEVELS: this deployment runs at loglevel=ERROR
            // (customdeploy_mcgi_rl_traderapi), so log.audit/log.debug are DISCARDED —
            // which is why this service had logged literally zero lines in production.
            // Anything that must survive has to be log.error. The audit line below is
            // kept for the day the deployment's log level is raised to AUDIT, but do not
            // rely on it: raising it needs a change to the deployment record, and prod
            // has only ever received scoped file:upload, which never touches objects.
            //
            // A chunk that failed to read, or a reassembled row count well under what the
            // MR says it wrote, means the screen is being served a truncated dataset.
            if (chunksMissing > 0 || (meta.rowCount && rows.length < meta.rowCount * 0.5)) {
                log.error('trader_screen_service', 'getSummary: TRUNCATED READ — ' + svcState);
            } else if (isUnfiltered && rows.length > 100 && filtered.length < 10) {
                // The reported-but-undiagnosed case: an UNFILTERED request against a healthy
                // cache that still yields almost nothing. Marc-Antoine 2026-08-05 ("on voit
                // juste 3-4 items") could not be explained after the fact precisely because
                // this path was silent — the cache held 1,195 rows and every cache-side
                // check looked clean. Logged at error level because audit is discarded at
                // this deployment's log level.
                //
                // isUnfiltered is load-bearing, NOT a nicety: a trader narrowing to one SKU
                // or a small location legitimately returns <10 rows, and without this gate
                // every such request would log an error. That would bury real errors under
                // routine traffic — the exact failure this logging exists to prevent.
                log.error('trader_screen_service',
                    'getSummary: SERVED ALMOST NOTHING on an UNFILTERED request against a ' +
                    'healthy cache — ' + svcState +
                    ' filters=' + JSON.stringify(params || {}));
            } else {
                log.audit('trader_screen_service', 'getSummary: ' + svcState);
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
            const recType = type === 'PO' ? 'purchaseorder' : 'salesorder';
            const savedRec = record.load({ type: recType, id: docId });
            const docNum = savedRec.getValue({ fieldId: 'tranid' });
            const docUrl = url.resolveRecord({
                recordType: recType,
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
