/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * @description MGSL Inventory Hold — beforeLoad UI swap + beforeSubmit pack validation.
 *
 *              beforeLoad (Marc-Antoine 2026-05-30 feedback): hides the native
 *              -266 Inventory Number popup on the Lot field (which can't be
 *              filtered by location) and injects a regular SELECT
 *              (custpage_hold_lot) in its place. The SELECT's options are
 *              populated server-side from a SuiteQL on inventoryassignment,
 *              filtered by the form's current (item, location) with positive
 *              net on-hand. The client script (mgsl_hold_form_cs.js) keeps
 *              the options in sync as the user picks item / location, and
 *              copies the picked value into the stored field on save.
 *
 *              beforeSubmit (Marc-Antoine Q2, 2026-05-25): blocks the save
 *              when packs_on_hold exceeds currently-available packs at the
 *              (item, location, lot) combo, where "available" = gross packs
 *              from inventoryassignment MINUS sum of other active hold
 *              records on the same combo.
 *
 *              Fresh SuiteQL queries (no MR-cache dependency) so concurrent
 *              hold changes and inventory transactions since the last MR cycle
 *              are accounted for.
 *
 *              Fires on CREATE / EDIT / XEDIT. XEDIT requires loading the full
 *              record AND merging changed fields from newRecord — inline edit
 *              from the list view only includes changed fields in newRecord.
 *
 *              Lenient on data-hygiene cases (missing PPP / FBM factor): logs
 *              audit and allows the save. Fail-closed on no-stock combos.
 */
define(['N/log', 'N/query', 'N/record', 'N/ui/serverWidget'],
function (log, query, record, serverWidget) {

    var REC_TYPE       = 'customrecord_mgsl_inventory_hold';
    var FIELD_ITEM     = 'custrecord_mgsl_hold_item';
    var FIELD_LOCATION = 'custrecord_mgsl_hold_location';
    var FIELD_LOT      = 'custrecord_mgsl_hold_lot';
    var FIELD_PACKS    = 'custrecord_mgsl_hold_packs';
    var FIELD_STATUS   = 'custrecord_mgsl_hold_status';
    var FIELD_PROXY    = 'custpage_hold_lot';

    // Inventory-moving transaction types — same whitelist as the trader-screen
    // MR's segment walk and the lot-filter CS. Commitments (SO/PO/RO) excluded.
    var INVENTORY_MOVING_RECORDTYPES =
        "('itemreceipt','itemfulfillment','inventoryadjustment','creditmemo')";

    function safeStringify(v) {
        try { return JSON.stringify(v); } catch (e) { return String(v); }
    }

    function loadIfXedit(context) {
        if (context.type === context.UserEventType.XEDIT &&
            context.newRecord && context.newRecord.id) {
            try {
                return record.load({
                    type: REC_TYPE,
                    id:   context.newRecord.id,
                    isDynamic: false,
                });
            } catch (e) {
                log.error('MGSL Hold UE', 'XEDIT load failed: ' + e.message);
            }
        }
        return null;
    }

    function getEffectiveValue(context, loaded, fieldId) {
        var v;
        try { v = context.newRecord.getValue({ fieldId: fieldId }); }
        catch (e) { v = ''; }
        if ((v === '' || v === null || v === undefined) && loaded) {
            try { v = loaded.getValue({ fieldId: fieldId }); }
            catch (e) { v = ''; }
        }
        return v;
    }

    function getEffectiveText(context, loaded, fieldId) {
        var t;
        try { t = context.newRecord.getText({ fieldId: fieldId }); }
        catch (e) { t = ''; }
        if ((t === '' || t === null || t === undefined) && loaded) {
            try { t = loaded.getText({ fieldId: fieldId }); }
            catch (e) { t = ''; }
        }
        return t;
    }

    // ── Gross packs at (item, location, lot) ──────────────────────────────────
    // Returns one of:
    //   { packs: <number>, lot_ppp, fbm_factor, net_fbm }
    //   { packs: 0, notFound: true }                         // no IA activity
    //   { packs: 0, dataIssue: true, lot_ppp, fbm_factor }   // missing data
    //   null                                                 // SuiteQL error
    function fetchGrossPacks(itemId, locId, lotId) {
        var sql =
            'SELECT ' +
            '  ia.quantity AS qty_fbm, ' +
            '  tl.custcol_mgsl_ppp AS line_ppp, ' +
            '  bi.custitem_mgsl_fbm AS fbm_factor ' +
            'FROM inventoryassignment ia ' +
            'JOIN transactionline tl ON tl.transaction = ia.transaction ' +
            '                        AND tl.linesequencenumber = ia.transactionline ' +
            'JOIN transaction t ON t.id = ia.transaction ' +
            'JOIN item bi ON bi.id = tl.item ' +
            'WHERE ia.inventorynumber = ? ' +
            '  AND tl.item = ? ' +
            '  AND tl.location = ? ' +
            '  AND t.recordtype IN ' + INVENTORY_MOVING_RECORDTYPES + ' ' +
            "  AND COALESCE(t.voided, 'F') = 'F' " +
            'ORDER BY t.trandate ASC, t.id ASC, tl.linesequencenumber ASC';

        var rows;
        try {
            rows = query.runSuiteQL({
                query:  sql,
                params: [lotId, itemId, locId],
            }).asMappedResults() || [];
        } catch (e) {
            log.error('MGSL Hold UE', 'Gross-stock SuiteQL failed: ' + e.message);
            return null;
        }

        if (rows.length === 0) return { packs: 0, notFound: true };

        var net_fbm    = 0;
        var lot_ppp    = 0;
        var fbm_factor = 0;

        rows.forEach(function (row) {
            net_fbm += parseFloat(row.qty_fbm) || 0;
            if (!fbm_factor) fbm_factor = parseFloat(row.fbm_factor) || 0;
            // First positive transaction line wins for the lot's PPP. Matches
            // the MR's "first-additive-latches" logic.
            if (!lot_ppp && (parseFloat(row.qty_fbm) || 0) > 0) {
                lot_ppp = parseFloat(row.line_ppp) || 0;
            }
        });

        if (lot_ppp === 0 || fbm_factor === 0) {
            return {
                packs: 0,
                dataIssue: true,
                lot_ppp: lot_ppp,
                fbm_factor: fbm_factor,
            };
        }

        var packs = (net_fbm * 1000) / (lot_ppp * fbm_factor);
        return {
            packs:      packs,
            lot_ppp:    lot_ppp,
            fbm_factor: fbm_factor,
            net_fbm:    net_fbm,
        };
    }

    // ── Sum of OTHER active holds on (item, location, lot) ────────────────────
    // Returns sum (number) or null on query error.
    function fetchOtherActiveHoldPacks(itemId, locId, lotId, excludeHoldId) {
        var sql =
            'SELECT ' +
            '  invh.id, ' +
            '  invh.custrecord_mgsl_hold_packs AS packs, ' +
            '  BUILTIN.DF(invh.custrecord_mgsl_hold_status) AS status ' +
            'FROM customrecord_mgsl_inventory_hold invh ' +
            'WHERE invh.custrecord_mgsl_hold_item = ? ' +
            '  AND invh.custrecord_mgsl_hold_location = ? ' +
            '  AND invh.custrecord_mgsl_hold_lot = ? ' +
            "  AND invh.isinactive = 'F'";

        var rows;
        try {
            rows = query.runSuiteQL({
                query:  sql,
                params: [itemId, locId, lotId],
            }).asMappedResults() || [];
        } catch (e) {
            log.error('MGSL Hold UE', 'Other-holds SuiteQL failed: ' + e.message);
            return null;
        }

        var sum = 0;
        rows.forEach(function (row) {
            if (excludeHoldId && String(row.id) === String(excludeHoldId)) return;
            if (String(row.status || '').trim() !== 'Active') return;
            sum += parseFloat(row.packs) || 0;
        });
        return sum;
    }

    // ── SuiteQL: lots at (item, location) with positive on-hand ─────────────
    // Returns array of { lot_id, lot_name } sorted by lot_name.
    // Same shape as the CS query so the UE/CS render identical option sets.
    function fetchLotsAtCombo(itemId, locId) {
        if (!itemId || !locId) return [];
        var sql =
            'SELECT ' +
            '  invn.id AS lot_id, ' +
            '  invn.inventorynumber AS lot_name ' +
            'FROM inventorynumber invn ' +
            'JOIN inventoryassignment ia ON ia.inventorynumber = invn.id ' +
            'JOIN transactionline tl ON tl.transaction = ia.transaction ' +
            '                        AND tl.linesequencenumber = ia.transactionline ' +
            'JOIN transaction t ON t.id = ia.transaction ' +
            'WHERE invn.item = ? ' +
            '  AND tl.location = ? ' +
            '  AND t.recordtype IN ' + INVENTORY_MOVING_RECORDTYPES + ' ' +
            "  AND COALESCE(t.voided, 'F') = 'F' " +
            'GROUP BY invn.id, invn.inventorynumber ' +
            'HAVING SUM(ia.quantity) > 0 ' +
            'ORDER BY invn.inventorynumber ASC';
        try {
            return query.runSuiteQL({ query: sql, params: [itemId, locId] }).asMappedResults() || [];
        } catch (e) {
            log.error('MGSL Hold UE beforeLoad', 'Lot lookup failed for item=' + itemId +
                ' loc=' + locId + ': ' + e.message);
            return [];
        }
    }

    // ── beforeLoad ──────────────────────────────────────────────────────────
    function beforeLoad(context) {
        // Skip non-UI contexts (CSV imports, web-services, scheduled scripts, etc.)
        var isUserContext =
            context.type === context.UserEventType.CREATE ||
            context.type === context.UserEventType.EDIT ||
            context.type === context.UserEventType.VIEW ||
            context.type === context.UserEventType.COPY;
        if (!isUserContext) return;

        var form = context.form;
        var rec  = context.newRecord;

        // 1) Hide the native -266 popup AND clear its mandatory flag.
        //    Why drop mandatory: NS's standard mandatory validation order
        //    relative to the CS saveRecord event is not unambiguously
        //    documented. If NS validates mandatories before saveRecord runs,
        //    the hidden stored field would be flagged as empty even though
        //    the CS would have copied the proxy's value into it. The proxy
        //    carries the mandatory flag instead; the CS saveRecord still
        //    enforces a non-empty pick with a French alert.
        //
        //    If the stored field can't be found on the form for any reason
        //    (XML refactor, NS quirk, etc.) bail entire beforeLoad — adding
        //    the proxy without hiding the native popup would produce two
        //    lot pickers stacked on the form, which is worse than the
        //    original broken popup.
        var storedLotField = form.getField({ id: FIELD_LOT });
        if (!storedLotField) {
            log.error('MGSL Hold UE beforeLoad',
                'Stored lot field not found on form (field id=' + FIELD_LOT + '), bailing');
            return;
        }
        try {
            storedLotField.updateDisplayType({
                displayType: serverWidget.FieldDisplayType.HIDDEN
            });
            storedLotField.isMandatory = false;
        } catch (e) {
            log.error('MGSL Hold UE beforeLoad', 'Hide stored lot field failed: ' + e.message);
            return;
        }

        // 2) Inject the proxy SELECT, positioned right before the Packs field
        //    so the visible order is: Item / Location / Lot / Packs / Status / ...
        var proxy;
        try {
            proxy = form.addField({
                id:    FIELD_PROXY,
                type:  serverWidget.FieldType.SELECT,
                label: 'Lot',
            });
            proxy.isMandatory = true;
            // Help text — the hidden stored field's XML help is now stale
            // ("filtered to lots that exist for the selected Item") since we
            // now filter by item AND location. Set accurate text on the proxy
            // so Marc keeps the hint about how the dropdown is filtered.
            proxy.setHelpText({
                help: 'Lot from the bundle tag. Filtered to lots with positive ' +
                      'on-hand at the selected Item and Location.',
            });
        } catch (e) {
            log.error('MGSL Hold UE beforeLoad', 'Inject proxy field failed: ' + e.message);
            return;
        }

        // Try to position the proxy right before the Packs field. If insertField
        // throws (e.g. NS UI couldn't resolve the anchor), the proxy stays at
        // the bottom — visible but mis-ordered. Acceptable degradation.
        try {
            form.insertField({ field: proxy, nextfield: FIELD_PACKS });
        } catch (e) {
            log.audit('MGSL Hold UE beforeLoad', 'insertField fallback: ' + e.message);
        }

        // 3) View mode → display-only proxy
        if (context.type === context.UserEventType.VIEW) {
            proxy.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });
        }

        // 4) Pre-populate options + value whenever item/location are present.
        //    This unifies first-load (EDIT/VIEW/COPY) AND every form re-render
        //    after a beforeSubmit rejection — including CREATE re-renders,
        //    where the user has already filled the form and we MUST preserve
        //    their lot pick so they aren't forced to re-pick just to fix
        //    Packs. CS saveRecord copies proxy → stored before submit, so on
        //    re-render the stored lot value reflects the user's previous pick.
        //
        //    CREATE first-load is safe: itemId/locId/savedLotId are all
        //    empty, both inner branches short-circuit, proxy renders empty.
        var itemId     = rec.getValue({ fieldId: FIELD_ITEM });
        var locId      = rec.getValue({ fieldId: FIELD_LOCATION });
        var savedLotId = rec.getValue({ fieldId: FIELD_LOT });

        if (itemId && locId) {
            var rows = fetchLotsAtCombo(itemId, locId);
            rows.forEach(function (row) {
                proxy.addSelectOption({
                    value: String(row.lot_id),
                    text:  String(row.lot_name),
                });
            });

            // If the saved/picked lot isn't in the eligible set (drained
            // between create-time and now, or drained between the user's
            // first submit attempt and the rejected re-render), add it as
            // a labeled fallback option so the dropdown displays correctly
            // instead of going blank. The lot's display name is already on
            // the loaded record — no separate SuiteQL needed.
            if (savedLotId) {
                var inList = rows.some(function (r) {
                    return String(r.lot_id) === String(savedLotId);
                });
                if (!inList) {
                    var name = rec.getText({ fieldId: FIELD_LOT }) || '';
                    proxy.addSelectOption({
                        value: String(savedLotId),
                        text:  name + ' (no longer at this location)',
                    });
                }
                proxy.defaultValue = String(savedLotId);
            }
        } else if (savedLotId) {
            // Edge: record has lot but somehow no item/location. Show the lot
            // by name so the user sees what's there. (Shouldn't happen given
            // beforeSubmit's mandatory checks, but defensive.)
            var name2 = rec.getText({ fieldId: FIELD_LOT }) || '';
            proxy.addSelectOption({ value: String(savedLotId), text: name2 });
            proxy.defaultValue = String(savedLotId);
        }
    }

    function beforeSubmit(context) {
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT &&
            context.type !== context.UserEventType.XEDIT) {
            return;
        }

        var loaded = loadIfXedit(context);

        var itemId     = getEffectiveValue(context, loaded, FIELD_ITEM);
        var locId      = getEffectiveValue(context, loaded, FIELD_LOCATION);
        var lotId      = getEffectiveValue(context, loaded, FIELD_LOT);
        var newPacks   = parseFloat(getEffectiveValue(context, loaded, FIELD_PACKS)) || 0;
        var statusText = String(getEffectiveText(context, loaded, FIELD_STATUS) || '').trim();
        var holdId     = (context.newRecord && context.newRecord.id) || null;

        // Skip ONLY if explicitly Lifted — they don't subtract from On Hand.
        // For CREATE, the status field's getText can return empty even though
        // the default is val_active (NS quirk on default-valued fields in
        // beforeSubmit). So we invert the check: treat empty/Active as
        // "validate", skip only on explicit Lifted.
        if (statusText === 'Lifted') return;

        // Skip incomplete records — NS itself will reject these via mandatory/min validation
        if (!itemId || !locId || !lotId || newPacks <= 0) return;

        // Always allow edits that DECREASE packs (or keep equal). The user is
        // correcting downward, never making the situation worse. Without this,
        // a pre-existing over-hold state (created before this UE existed, or
        // via CSV/API) would trap the user — they couldn't reduce the offending
        // hold because the UE would still see other holds exceeding gross stock.
        // Source of "old packs":
        //   EDIT  → context.oldRecord (NS provides this)
        //   XEDIT → loaded record (NS doesn't provide oldRecord in XEDIT)
        //   CREATE → no prior packs, this guard doesn't apply
        var oldPacks = 0;
        if (context.type === context.UserEventType.EDIT && context.oldRecord) {
            try { oldPacks = parseFloat(context.oldRecord.getValue({ fieldId: FIELD_PACKS })) || 0; }
            catch (e) { oldPacks = 0; }
        } else if (context.type === context.UserEventType.XEDIT && loaded) {
            try { oldPacks = parseFloat(loaded.getValue({ fieldId: FIELD_PACKS })) || 0; }
            catch (e) { oldPacks = 0; }
        }
        if (oldPacks > 0 && newPacks <= oldPacks) return;

        // Compute gross packs at the combo
        var gross = fetchGrossPacks(itemId, locId, lotId);
        if (gross === null) {
            // SuiteQL error — lenient (don't block user on infra issue)
            log.audit('MGSL Hold UE',
                'Skip validation — gross-stock query failed. holdId=' + holdId +
                ' item=' + itemId + ' loc=' + locId + ' lot=' + lotId);
            return;
        }
        if (gross.notFound) {
            // No IA history at the combo — hold is meaningless
            throw 'Aucun mouvement d\'inventaire pour ce lot à cette location. Hold impossible.';
        }
        if (gross.dataIssue) {
            // Missing PPP or FBM factor — data hygiene, can't compute, lenient skip
            log.audit('MGSL Hold UE',
                'Skip validation — missing PPP/FBM. holdId=' + holdId +
                ' item=' + itemId + ' loc=' + locId + ' lot=' + lotId +
                ' ppp=' + gross.lot_ppp + ' fbm=' + gross.fbm_factor);
            return;
        }

        // Compute other-active-holds packs (excluding this record on edit)
        var otherHolds = fetchOtherActiveHoldPacks(itemId, locId, lotId, holdId);
        if (otherHolds === null) {
            // SuiteQL error — lenient
            log.audit('MGSL Hold UE',
                'Skip validation — other-holds query failed. holdId=' + holdId);
            return;
        }

        var available = Math.floor(gross.packs - otherHolds);
        if (available < 0) available = 0;

        if (newPacks > available) {
            log.audit('MGSL Hold UE',
                'REJECT: holdId=' + holdId +
                ' item=' + itemId + ' loc=' + locId + ' lot=' + lotId +
                ' requested=' + newPacks + ' available=' + available +
                ' grossPacks=' + gross.packs + ' otherHolds=' + otherHolds);

            var msg = 'Tu demandes ' + newPacks + ' packs mais il en reste seulement ' +
                      available + ' disponible pour ce lot à cette location';
            if (otherHolds > 0) {
                msg += ' (' + otherHolds + ' déjà en hold actif sur ce lot)';
            }
            msg += '.';

            // Throw as plain string (not error.create) so NS renders just the
            // message instead of the full SuiteScriptError JSON envelope. NS
            // shows plain-string throws as "Notice from script: <message>".
            throw msg;
        }
    }

    return {
        beforeLoad:   beforeLoad,
        beforeSubmit: beforeSubmit,
    };
});
