/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * MSL - Allocation Segment Sync (Purchase Orders & Inventory Adjustments)
 *
 * Deployable on both `purchaseorder` and `inventoryadjustment`. Other record
 * types are skipped.
 *
 * Sync rules:
 * - Create/Update: upsert custom segment value record
 *   customrecord_cseg_po_segment_gl
 *   - name = source record tranid
 *   - cseg_po_segment_gl_filterby_subsidiary = source record subsidiary
 *   - segment id is written back to the source record's `cseg_po_segment_gl`
 * - Delete: try to delete matching segment value(s); if delete fails, inactivate.
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime'], function (record, search, log, runtime) {
    var CFG = {
        LOG_PREFIX: 'MSL Allocation Segment Sync',
        SEGMENT_RECORD_TYPE: 'customrecord_cseg_po_segment_gl',
        FIELD_NAME: 'name',
        FIELD_SUBSIDIARY_FILTER: 'cseg_po_segment_gl_filterby_subsidiary',
        FIELD_INACTIVE: 'isinactive',
        FIELD_PO_SEGMENT_ON_PO: 'cseg_po_segment_gl'
    };

    var SUPPORTED_SOURCE_TYPES = {
        'purchaseorder': true,
        'inventoryadjustment': true
    };

    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        } catch (_e) {
            return String(value);
        }
    }

    function writeLog(level, titleSuffix, details) {
        try {
            var title = CFG.LOG_PREFIX + ' - ' + titleSuffix;
            if (level === 'error') {
                log.error({ title: title, details: details });
                return;
            }
            if (level === 'debug') {
                log.debug({ title: title, details: details });
                return;
            }
            log.audit({ title: title, details: details });
        } catch (_logErr) {
            // Never allow logging failures to interrupt transaction processing.
        }
    }

    function logDebug(titleSuffix, details) {
        writeLog('debug', titleSuffix, details);
    }

    function logAudit(titleSuffix, details) {
        writeLog('audit', titleSuffix, details);
    }

    function logError(titleSuffix, details) {
        writeLog('error', titleSuffix, details);
    }

    function getErrorDetails(err) {
        if (!err) return 'Unknown error';
        return {
            name: err.name || 'Error',
            message: err.message || String(err),
            stack: err.stack || ''
        };
    }

    function toId(value) {
        if (value === null || value === undefined || value === '') return '';
        return String(value);
    }

    function normalizeText(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    // NetSuite returns the literal placeholder text "To Be Generated" from
    // newRecord.getValue('tranid') on transactions whose document number
    // hasn't been assigned yet (auto-numbering, CSV imports, M/R creates).
    // Treat these as "not yet known" so we don't create/associate junk segments.
    function isAutoNumberPlaceholder(tranId) {
        if (!tranId) return false;
        var lower = String(tranId).toLowerCase().trim();
        return lower === 'to be generated' || lower === 'to be assigned';
    }

    function getPoData(poRec) {
        try {
            if (!poRec) return null;
            var tranId = '';
            var subsidiaryId = '';
            var poSegmentId = '';
            try { tranId = normalizeText(poRec.getValue({ fieldId: 'tranid' })); } catch (_e1) { tranId = ''; }
            try { subsidiaryId = toId(poRec.getValue({ fieldId: 'subsidiary' })); } catch (_e2) { subsidiaryId = ''; }
            try { poSegmentId = toId(poRec.getValue({ fieldId: CFG.FIELD_PO_SEGMENT_ON_PO })); } catch (_e3) { poSegmentId = ''; }
            return {
                tranId: tranId,
                subsidiaryId: subsidiaryId,
                poSegmentId: poSegmentId
            };
        } catch (ePoData) {
            logError('getPoData Failed', getErrorDetails(ePoData));
            return null;
        }
    }

    function isCsvImportContext(context) {
        try {
            if (runtime && runtime.ContextType && runtime.executionContext === runtime.ContextType.CSV_IMPORT) {
                return true;
            }
        } catch (_eCtx) { }
        try {
            if (context && context.executionContext && String(context.executionContext).toLowerCase() === 'csvimport') {
                return true;
            }
        } catch (_eCtx2) { }
        return false;
    }

    function loadFullSource(rec, reason) {
        try {
            var loaded = record.load({
                type: rec.type,
                id: rec.id,
                isDynamic: false
            });
            var loadedData = getPoData(loaded);
            logDebug('Loaded Source Record', {
                recordType: rec.type,
                recordId: rec.id,
                reason: reason,
                data: loadedData
            });
            return loadedData;
        } catch (eLoad) {
            logError('Source Record Load Failed', {
                recordType: rec.type,
                recordId: rec.id,
                reason: reason,
                error: getErrorDetails(eLoad)
            });
            return null;
        }
    }

    function getCurrentPoData(context) {
        try {
            var rec = context && context.newRecord;
            if (!rec || !rec.id) return getPoData(rec);

            // XEDIT payload can be partial; load full record for reliable values.
            if (context.type === context.UserEventType.XEDIT) {
                var xeditData = loadFullSource(rec, 'XEDIT');
                if (xeditData) return xeditData;
            }

            // CSV import: newRecord only contains imported fields, so auto-numbered
            // tranid (typical for inventoryadjustment) is missing. Load the full
            // record so the segment can be created/associated on first save.
            if (isCsvImportContext(context)) {
                var csvData = loadFullSource(rec, 'CSV_IMPORT');
                if (csvData) return csvData;
            }

            var partial = getPoData(rec);

            // Fallback: if newRecord is missing required fields OR returns the
            // "To Be Generated" placeholder for tranid, load the full record —
            // record.load returns the persisted state, which often has the real
            // auto-numbered tranid even when newRecord.getValue does not.
            if (
                partial && rec.id &&
                (
                    !partial.tranId ||
                    !partial.subsidiaryId ||
                    isAutoNumberPlaceholder(partial.tranId)
                )
            ) {
                var loaded = loadFullSource(rec, 'newRecord partial or placeholder tranid');
                if (loaded) return loaded;
            }

            return partial;
        } catch (eCurrentPo) {
            logError('getCurrentPoData Failed', getErrorDetails(eCurrentPo));
            return null;
        }
    }

    function findSegmentIds(tranId, subsidiaryId) {
        try {
            var normalizedTranId = normalizeText(tranId);
            if (!normalizedTranId) return [];
            if (isAutoNumberPlaceholder(normalizedTranId)) {
                logDebug('Segment Search Skipped - Placeholder Tranid', {
                    tranId: normalizedTranId
                });
                return [];
            }

            var filters = [[CFG.FIELD_NAME, 'is', normalizedTranId]];
            if (subsidiaryId) {
                filters.push('and', [CFG.FIELD_SUBSIDIARY_FILTER, 'anyof', String(subsidiaryId)]);
            }

            logDebug('Segment Search Start', {
                tranId: normalizedTranId,
                subsidiaryId: subsidiaryId || '',
                filters: filters
            });

            var ids = [];
            var segmentSearch = search.create({
                type: CFG.SEGMENT_RECORD_TYPE,
                filters: filters,
                columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })]
            });

            segmentSearch.run().each(function (res) {
                var id = toId(res.getValue({ name: 'internalid' }));
                if (id && ids.indexOf(id) === -1) ids.push(id);
                return true;
            });
            logDebug('Segment Search Result', {
                tranId: normalizedTranId,
                subsidiaryId: subsidiaryId || '',
                ids: ids
            });
            return ids;
        } catch (eSearch) {
            logError('Segment Search Failed', {
                tranId: normalizeText(tranId),
                subsidiaryId: subsidiaryId || '',
                error: getErrorDetails(eSearch)
            });
            return [];
        }
    }

    function findSegmentIdForUpsert(currentPo, oldPo) {
        try {
            var candidateLists = [];

            if (currentPo && currentPo.tranId) {
                // Requirement: when PO segment field is blank, match existing by name (tranid).
                candidateLists.push(findSegmentIds(currentPo.tranId, ''));
            }
            if (oldPo && oldPo.tranId) {
                candidateLists.push(findSegmentIds(oldPo.tranId, oldPo.subsidiaryId));
                candidateLists.push(findSegmentIds(oldPo.tranId, ''));
            }

            for (var i = 0; i < candidateLists.length; i++) {
                if (candidateLists[i] && candidateLists[i].length) {
                    logDebug('Segment Match Selected', {
                        selectedSegmentId: candidateLists[i][0],
                        selectedListIndex: i
                    });
                    return candidateLists[i][0];
                }
            }
            return '';
        } catch (eFind) {
            logError('findSegmentIdForUpsert Failed', getErrorDetails(eFind));
            return '';
        }
    }

    function upsertSegment(currentPo, oldPo, poId) {
        if (!currentPo || !currentPo.tranId || !currentPo.subsidiaryId) {
            logError('Missing Required PO Data', {
                poId: poId || '',
                tranId: currentPo && currentPo.tranId,
                subsidiaryId: currentPo && currentPo.subsidiaryId
            });
            return '';
        }

        // Defer when tranid hasn't been assigned yet. Creating a segment named
        // "To Be Generated" would pollute the segment table and cause every
        // pending IA to share one bogus segment. The follow-up EDIT (fired when
        // the auto-number lands) will pick this up via the name-mismatch path.
        if (isAutoNumberPlaceholder(currentPo.tranId)) {
            logAudit('Skip Upsert - Tranid Placeholder', {
                poId: poId || '',
                tranId: currentPo.tranId,
                subsidiaryId: currentPo.subsidiaryId
            });
            return '';
        }

        try {
            logAudit('Upsert Start', {
                poId: poId || '',
                currentPo: currentPo,
                oldPo: oldPo
            });

            var segmentId = findSegmentIdForUpsert(currentPo, oldPo);

            if (segmentId) {
                record.submitFields({
                    type: CFG.SEGMENT_RECORD_TYPE,
                    id: segmentId,
                    values: (function () {
                        var values = {};
                        values[CFG.FIELD_NAME] = currentPo.tranId;
                        values[CFG.FIELD_SUBSIDIARY_FILTER] = currentPo.subsidiaryId;
                        values[CFG.FIELD_INACTIVE] = false;
                        return values;
                    })()
                });

                logAudit('Segment Updated', {
                    poId: poId || '',
                    segmentId: segmentId,
                    tranId: currentPo.tranId,
                    subsidiaryId: currentPo.subsidiaryId
                });
                return String(segmentId);
            }

            var segmentRec = record.create({
                type: CFG.SEGMENT_RECORD_TYPE,
                isDynamic: false
            });
            segmentRec.setValue({ fieldId: CFG.FIELD_NAME, value: currentPo.tranId });
            segmentRec.setValue({ fieldId: CFG.FIELD_SUBSIDIARY_FILTER, value: currentPo.subsidiaryId });
            segmentRec.setValue({ fieldId: CFG.FIELD_INACTIVE, value: false });
            var newId = segmentRec.save({ enableSourcing: false, ignoreMandatoryFields: false });

            logAudit('Segment Created', {
                poId: poId || '',
                segmentId: newId,
                tranId: currentPo.tranId,
                subsidiaryId: currentPo.subsidiaryId
            });
            return String(newId);
        } catch (eUpsert) {
            logError('Upsert Failed', {
                poId: poId || '',
                tranId: currentPo.tranId,
                subsidiaryId: currentPo.subsidiaryId,
                error: getErrorDetails(eUpsert)
            });
            return '';
        }
    }

    function associateSegmentToPo(recordType, poId, currentPoSegmentId, targetSegmentId) {
        try {
            if (!recordType || !poId || !targetSegmentId) return;
            var currentId = toId(currentPoSegmentId);
            var targetId = toId(targetSegmentId);

            if (currentId && currentId === targetId) {
                logDebug('Segment Already Associated', {
                    recordType: recordType,
                    poId: poId,
                    segmentId: targetId
                });
                return;
            }

            var values = {};
            values[CFG.FIELD_PO_SEGMENT_ON_PO] = targetId;
            record.submitFields({
                type: recordType,
                id: poId,
                values: values
            });

            logAudit('Segment Associated', {
                recordType: recordType,
                poId: poId,
                fromSegmentId: currentId || '',
                toSegmentId: targetId
            });
        } catch (eAssociate) {
            logError('Segment Association Failed', {
                recordType: recordType || '',
                poId: poId || '',
                currentPoSegmentId: currentPoSegmentId || '',
                targetSegmentId: targetSegmentId || '',
                error: getErrorDetails(eAssociate)
            });
        }
    }

    function doesSegmentNameMatchTranid(segmentId, tranId) {
        try {
            var segmentIdSafe = toId(segmentId);
            var tranIdSafe = normalizeText(tranId);
            if (!segmentIdSafe || !tranIdSafe) return false;

            var lookup = search.lookupFields({
                type: CFG.SEGMENT_RECORD_TYPE,
                id: segmentIdSafe,
                columns: [CFG.FIELD_NAME]
            });
            var segmentName = normalizeText(lookup && lookup[CFG.FIELD_NAME]);
            var isMatch = segmentName === tranIdSafe;

            logDebug('Linked Segment Name Check', {
                segmentId: segmentIdSafe,
                segmentName: segmentName,
                tranId: tranIdSafe,
                isMatch: isMatch
            });

            return isMatch;
        } catch (eMatch) {
            logError('Linked Segment Name Check Failed', {
                segmentId: segmentId || '',
                tranId: tranId || '',
                error: getErrorDetails(eMatch)
            });
            return false;
        }
    }

    function deleteOrInactivateByPo(oldPo, poId) {
        if (!oldPo || (!oldPo.tranId && !oldPo.poSegmentId)) {
            logDebug('Delete Skipped', { poId: poId || '', reason: 'Missing old tranid' });
            return;
        }

        logAudit('Delete/Inactivate Start', {
            poId: poId || '',
            oldPo: oldPo
        });

        var ids = [];
        if (oldPo.poSegmentId) ids.push(String(oldPo.poSegmentId));
        var nameMatchIds = [];
        if (oldPo.tranId) {
            nameMatchIds = findSegmentIds(oldPo.tranId, oldPo.subsidiaryId);
            if (!nameMatchIds.length) nameMatchIds = findSegmentIds(oldPo.tranId, '');
        }
        for (var n = 0; n < nameMatchIds.length; n++) {
            if (ids.indexOf(String(nameMatchIds[n])) === -1) ids.push(String(nameMatchIds[n]));
        }

        if (!ids.length) {
            logAudit('No Segment Found For Delete', {
                poId: poId || '',
                tranId: oldPo.tranId,
                subsidiaryId: oldPo.subsidiaryId,
                poSegmentId: oldPo.poSegmentId || ''
            });
            return;
        }

        for (var i = 0; i < ids.length; i++) {
            var segmentId = ids[i];
            try {
                record.delete({
                    type: CFG.SEGMENT_RECORD_TYPE,
                    id: segmentId
                });

                logAudit('Segment Deleted', {
                    poId: poId || '',
                    segmentId: segmentId,
                    tranId: oldPo.tranId
                });
            } catch (eDelete) {
                try {
                    var values = {};
                    values[CFG.FIELD_INACTIVE] = true;
                    record.submitFields({
                        type: CFG.SEGMENT_RECORD_TYPE,
                        id: segmentId,
                        values: values
                    });

                    logAudit('Segment Inactivated', {
                        poId: poId || '',
                        segmentId: segmentId,
                        tranId: oldPo.tranId,
                        deleteError: eDelete.name + ': ' + eDelete.message
                    });
                } catch (eInactive) {
                    logError('Delete/Inactivate Failed', {
                        poId: poId || '',
                        segmentId: segmentId,
                        tranId: oldPo.tranId,
                        deleteError: eDelete.name + ': ' + eDelete.message,
                        inactiveError: eInactive.name + ': ' + eInactive.message
                    });
                }
            }
        }
    }

    function afterSubmit(context) {
        try {
            if (!context || !context.type) return;

            var sourceRec = (context.newRecord) || (context.oldRecord);
            var recordType = sourceRec && sourceRec.type ? String(sourceRec.type) : '';
            if (!SUPPORTED_SOURCE_TYPES[recordType]) {
                logDebug('Record Type Skipped', { recordType: recordType });
                return;
            }

            var eventType = context.type;
            logAudit('afterSubmit START', {
                recordType: recordType,
                eventType: eventType,
                poId: (context.newRecord && context.newRecord.id) || (context.oldRecord && context.oldRecord.id) || ''
            });

            if (eventType === context.UserEventType.DELETE) {
                var oldPo = getPoData(context.oldRecord);
                deleteOrInactivateByPo(oldPo, context.oldRecord && context.oldRecord.id);
                logAudit('afterSubmit END', { recordType: recordType, eventType: eventType });
                return;
            }

            if (
                eventType !== context.UserEventType.CREATE &&
                eventType !== context.UserEventType.EDIT &&
                eventType !== context.UserEventType.XEDIT
            ) {
                logDebug('Event Skipped', { eventType: eventType });
                return;
            }

            var currentPo = getCurrentPoData(context);
            var previousPo = getPoData(context.oldRecord);
            var poId = (context.newRecord && context.newRecord.id) || '';

            if (currentPo && currentPo.poSegmentId) {
                if (doesSegmentNameMatchTranid(currentPo.poSegmentId, currentPo.tranId)) {
                    logAudit('Skip - Segment Populated And Name Matches Tranid', {
                        recordType: recordType,
                        eventType: eventType,
                        poId: poId,
                        poSegmentId: currentPo.poSegmentId,
                        tranId: currentPo.tranId
                    });
                    return;
                }

                logAudit('Segment Populated But Name Mismatch - Continue Sync', {
                    recordType: recordType,
                    eventType: eventType,
                    poId: poId,
                    poSegmentId: currentPo.poSegmentId,
                    tranId: currentPo.tranId
                });
            }

            var segmentId = upsertSegment(currentPo, previousPo, poId);
            associateSegmentToPo(recordType, poId, currentPo && currentPo.poSegmentId, segmentId);

            logAudit('afterSubmit END', {
                recordType: recordType,
                eventType: eventType,
                poId: poId,
                segmentId: segmentId || '',
                currentPo: safeStringify(currentPo),
                previousPo: safeStringify(previousPo)
            });
        } catch (e) {
            logError('Fatal', {
                type: context && context.type,
                error: getErrorDetails(e)
            });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
