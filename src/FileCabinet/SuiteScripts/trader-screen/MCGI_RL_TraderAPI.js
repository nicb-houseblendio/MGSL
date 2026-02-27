/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @description Trader Screen REST API - reads from N/cache (Map/Reduce), no live searches. POST for Create PO/SO.
 */
define(['N/cache', 'N/url', 'N/runtime', 'N/record', 'N/log'], function (cache, url, runtime, record, log) {
    const CACHE_NAME = 'MGSL_TRADERSCREEN_CACHE';
    const CACHE_SCOPE = cache.Scope.PUBLIC;

    const CUSTOM_LIST_MAP = {
        species: 'customlist_species',
        thickness: 'customlist1585',
        width: 'customlist1587',
        length: 'customlist1586',
        grade: 'customlist_grade',
        finition: 'customlistfinition',
        humidity: 'customlisthumidite',
        plannage: 'customlistplannage',
        etampage: 'customlist2001',
        autres: 'customlistitemsattributesautres',
    };

    function getParamsFromGet(requestParams) {
      log.debug('Get Params from Get Request', requestParams);
        var p = requestParams || {};
        return {
            action: p.action,
            itemId: p.itemId,
            locationId: p.locationId,
            bucket: p.bucket,
            filterType: p.filterType,
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
    }

    function getParamsFromPost(requestBody) {
        if (!requestBody) return {};
        if (typeof requestBody === 'object') return requestBody;
        try {
            return JSON.parse(requestBody);
        } catch (e) {
            return {};
        }
    }

    function toIdArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(Number).filter(function (n) {
            return !isNaN(n);
        });
        return value
                .toString()
                .split(',')
                .map(function (v) {
                    return Number(v.trim());
                })
                .filter(function (n) {
                    return !isNaN(n);
                });
    }

    function getMyCache() {
        return cache.getCache({ name: CACHE_NAME, scope: CACHE_SCOPE });
    }

    function handleGetContext() {
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
        return {
            success: true,
            data: {
                userId: user.id,
                userName: user.name,
                subsidiaryId: user.subsidiary,
                subsidiaryName: subsidiaryName,
                accountId: runtime.accountId,
                uomOptions: ['Packs', 'MBF'],
            },
        };
    }

    function handleGetMeta() {
        try {
            const myCache = getMyCache();
            const metaStr = myCache.get({ key: 'TS_META' });
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
            log.error('MCGI_RL_TraderAPI', 'getMeta error: ' + e.message);
            return { available: false, reason: 'ERROR' };
        }
    }

    function toValueList(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return value.toString().split(',').map(function (v) {
            return String(v).trim();
        }).filter(Boolean);
    }

    function applyFilters(rows, params) {
        var filtered = rows;
        if (params.location && toIdArray(params.location).length > 0) {
            var locIds = toIdArray(params.location);
            filtered = filtered.filter(function (r) {
                return locIds.indexOf(Number(r.locationId)) >= 0;
            });
        }
        if (params.item && toIdArray(params.item).length > 0) {
            var itemIds = toIdArray(params.item);
            filtered = filtered.filter(function (r) {
                return itemIds.indexOf(Number(r.internalId)) >= 0;
            });
        }
        if (params.species && toValueList(params.species).length > 0) {
            var spVals = toValueList(params.species);
            filtered = filtered.filter(function (r) {
                var rv = String(r.species || '').trim();
                return spVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.thickness && toValueList(params.thickness).length > 0) {
            var thVals = toValueList(params.thickness);
            filtered = filtered.filter(function (r) {
                var rv = String(r.thickness || '').trim();
                return thVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.width && toValueList(params.width).length > 0) {
            var wVals = toValueList(params.width);
            filtered = filtered.filter(function (r) {
                var rv = String(r.width || '').trim();
                return wVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.length && toValueList(params.length).length > 0) {
            var lenVals = toValueList(params.length);
            filtered = filtered.filter(function (r) {
                var rv = String(r.length || '').trim();
                return lenVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.grade && toValueList(params.grade).length > 0) {
            var grVals = toValueList(params.grade);
            filtered = filtered.filter(function (r) {
                var rv = String(r.grade || '').trim();
                return grVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.finition && toValueList(params.finition).length > 0) {
            var finVals = toValueList(params.finition);
            filtered = filtered.filter(function (r) {
                var rv = String(r.finition || '').trim();
                return finVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.humidity && toValueList(params.humidity).length > 0) {
            var humVals = toValueList(params.humidity);
            filtered = filtered.filter(function (r) {
                var rv = String(r.humidity || '').trim();
                return humVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.plannage && toValueList(params.plannage).length > 0) {
            var planVals = toValueList(params.plannage);
            filtered = filtered.filter(function (r) {
                var rv = String(r.plannage || '').trim();
                return planVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.etampage && toValueList(params.etampage).length > 0) {
            var etVals = toValueList(params.etampage);
            filtered = filtered.filter(function (r) {
                var rv = String(r.etampage || '').trim();
                return etVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.autres && toValueList(params.autres).length > 0) {
            var autVals = toValueList(params.autres);
            filtered = filtered.filter(function (r) {
                var rv = String(r.autres || '').trim();
                return autVals.some(function (v) {
                    return rv === v || Number(rv) === Number(v);
                });
            });
        }
        if (params.greaterThanZero !== false) {
            filtered = filtered.filter(function (r) {
                var total = (parseFloat(r.onHand) || 0) + (parseFloat(r.committed) || 0) + (parseFloat(r.outbound) || 0) +
                        (parseFloat(r.onOrder) || 0) + (parseFloat(r.inTransit) || 0);
                return total > 0;
            });
        }
        return filtered;
    }

    function computeTotals(rows) {
        var totals = { onHand: 0, committed: 0, outbound: 0, onOrder: 0, inTransit: 0, available: 0 };
        rows.forEach(function (r) {
            totals.onHand += parseFloat(r.onHand) || 0;
            totals.committed += parseFloat(r.committed) || 0;
            totals.outbound += parseFloat(r.outbound) || 0;
            totals.onOrder += parseFloat(r.onOrder) || 0;
            totals.inTransit += parseFloat(r.inTransit) || 0;
            totals.available += parseFloat(r.available) || 0;
        });
        return totals;
    }

    function handleGetSummary(params) {
        try {
            const myCache = getMyCache();
            const summaryStr = myCache.get({ key: 'TS_SUMMARY' });
            if (!summaryStr) {
                return { error: 'CACHE_MISS', message: 'Cache is being refreshed. Try again shortly.' };
            }
            var rows = JSON.parse(summaryStr);
            if (!Array.isArray(rows)) rows = [];

            var filtered = applyFilters(rows, params);
            var totals = computeTotals(filtered);

            var metaStr = myCache.get({ key: 'TS_META' });
            var meta = { lastUpdated: '', cacheVersion: 0, rowCount: 0 };
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
            log.error('MCGI_RL_TraderAPI', 'getSummary error: ' + e.message);
            return { error: 'CACHE_MISS', message: 'Cache error. Try again shortly.' };
        }
    }

    function handleGetDetail(itemId, locationId, bucket) {
        if (!itemId || !locationId) {
            return { success: false, error: 'itemId and locationId required' };
        }
        try {
            const myCache = getMyCache();
            var key = 'TS_DETAIL__' + itemId + '__' + locationId;
            var detailStr = myCache.get({ key: key });
            if (!detailStr) {
                return { error: 'DETAIL_CACHE_MISS', message: 'Data unavailable, please wait for next cache refresh.' };
            }
            var detail = JSON.parse(detailStr);
            if (bucket && detail[bucket] !== undefined) {
                return { success: true, data: detail[bucket] };
            }
            return { success: true, data: detail };
        } catch (e) {
            log.error('MCGI_RL_TraderAPI', 'getDetail error: ' + e.message);
            return { error: 'DETAIL_CACHE_MISS', message: 'Data unavailable.' };
        }
    }

    function handleCreateOrder(params) {
        var type = params.type;
        var itemId = params.itemId;
        var locationId = params.locationId;
        var partyId = params.partyId;
        var quantity = parseFloat(params.quantity);
        var dateStr = params.date;
        var notes = params.notes || '';

        var errors = [];
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
            var rec;
            if (type === 'PO') {
                rec = record.create({
                    type: record.Type.PURCHASE_ORDER,
                    isDynamic: true,
                });
                rec.setValue({ fieldId: 'entity', value: partyId });
                rec.setValue({ fieldId: 'location', value: locationId });
                rec.selectNewLine({ sublistId: 'item' });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId });
                if (dateStr) {
                    var d = new Date(dateStr);
                    if (!isNaN(d.getTime())) {
                        rec.setValue({ fieldId: 'duedate', value: d });
                    }
                }
                if (notes) rec.setValue({ fieldId: 'memo', value: notes });
                rec.commitLine({ sublistId: 'item' });
            } else {
                rec = record.create({
                    type: record.Type.SALES_ORDER,
                    isDynamic: true,
                });
                rec.setValue({ fieldId: 'entity', value: partyId });
                rec.setValue({ fieldId: 'location', value: locationId });
                rec.selectNewLine({ sublistId: 'item' });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId });
                if (dateStr) {
                    var d = new Date(dateStr);
                    if (!isNaN(d.getTime())) {
                        rec.setValue({ fieldId: 'shipdate', value: d });
                    }
                }
                if (notes) rec.setValue({ fieldId: 'memo', value: notes });
                rec.commitLine({ sublistId: 'item' });
            }

            var docId = rec.save();
            var docNum = rec.getValue({ fieldId: type === 'PO' ? 'tranid' : 'tranid' });
            var docUrl = url.resolveRecord({
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
            log.error('MCGI_RL_TraderAPI', 'createOrder error: ' + e.message);
            return { success: false, error: e.message || 'Failed to create order' };
        }
    }

    function handleRequest(params, method) {
        if (!params.action) {
            return { success: false, error: 'action parameter required' };
        }

        switch (params.action) {
            case 'getContext':
                return handleGetContext();
            case 'meta':
                return handleGetMeta();
            case 'summary':
                return handleGetSummary(params);
            case 'detail':
                return handleGetDetail(params.itemId, params.locationId, params.bucket);
            case 'createOrder':
                if (method !== 'POST') {
                    return { success: false, error: 'createOrder requires POST' };
                }
                return handleCreateOrder(params);
            default:
                return { success: false, error: 'Unknown action: ' + params.action };
        }
    }

    return {
        get: function (requestParams) {
            var params = getParamsFromGet(requestParams);
            return JSON.stringify(handleRequest(params, 'GET'));
        },
        post: function (requestBody) {
            var params = getParamsFromPost(requestBody);
            return JSON.stringify(handleRequest(params, 'POST'));
        },
    };
});
