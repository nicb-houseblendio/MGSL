/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * @description MGSL Inventory Hold form — Lot dropdown driver.
 *
 *              The Lot field shown to the user is a proxy SELECT (custpage_hold_lot)
 *              injected by the UE's beforeLoad. The native -266 stored field
 *              (custrecord_mgsl_hold_lot) is hidden; this script populates the
 *              proxy's options from SuiteQL on each item/location change and
 *              copies the picked value into the stored field on save.
 *
 *              Why the proxy: NS renders -266 selects as a server-backed popup
 *              ("Type & tab" search) above a certain option count, and that popup
 *              ignores client-script setOptions/removeSelectOption. A plain SELECT
 *              we own end-to-end accepts the API and shows exactly the options
 *              we want. Stored field stays untouched (data model preserved).
 */
define(['N/query', 'N/log'], function (query, log) {

    var FIELD_ITEM     = 'custrecord_mgsl_hold_item';
    var FIELD_LOCATION = 'custrecord_mgsl_hold_location';
    var FIELD_LOT      = 'custrecord_mgsl_hold_lot';
    var FIELD_PROXY    = 'custpage_hold_lot';

    // Inventory-moving transaction types — same whitelist used by the MR's
    // segment-aware origin walk and the UE's beforeSubmit. Commitments
    // (SO/PO/RO) are excluded.
    var INVENTORY_MOVING_RECORDTYPES =
        "('itemreceipt','itemfulfillment','inventoryadjustment','creditmemo')";

    function refreshLotOptions(rec, clearProxyValue) {
        var proxyField = rec.getField({ fieldId: FIELD_PROXY });
        if (!proxyField) return;  // UE didn't inject (XEDIT or other non-form context)

        // Clear the proxy's current value if we're refreshing because item or
        // location changed (the previously picked lot is no longer relevant)
        if (clearProxyValue) {
            try { rec.setValue({ fieldId: FIELD_PROXY, value: '' }); } catch (e) {}
        }

        // Wipe all existing options. removeSelectOption({value: null}) clears
        // the entire option list on a plain SELECT (per NS docs).
        try { proxyField.removeSelectOption({ value: null }); } catch (e) {}

        var itemId = rec.getValue({ fieldId: FIELD_ITEM });
        var locId  = rec.getValue({ fieldId: FIELD_LOCATION });
        if (!itemId || !locId) return;  // wait until both are set

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
            var rows = query.runSuiteQL({
                query:  sql,
                params: [itemId, locId],
            }).asMappedResults() || [];
            rows.forEach(function (row) {
                proxyField.insertSelectOption({
                    value: String(row.lot_id),
                    text:  String(row.lot_name),
                });
            });
        } catch (e) {
            log.error('MGSL Hold CS', 'Lot refresh failed for item=' + itemId +
                ' loc=' + locId + ': ' + e.message);
        }
    }

    function fieldChanged(context) {
        if (context.fieldId !== FIELD_ITEM && context.fieldId !== FIELD_LOCATION) return;
        refreshLotOptions(context.currentRecord, true);
    }

    function saveRecord(context) {
        var rec = context.currentRecord;
        // Only enforce the proxy when it exists (it's missing in XEDIT context)
        var proxyField = rec.getField({ fieldId: FIELD_PROXY });
        if (!proxyField) return true;  // XEDIT or other → stored field still mandatory at server

        var proxyVal = rec.getValue({ fieldId: FIELD_PROXY });
        if (!proxyVal) {
            alert('Choisis un lot avant de sauvegarder.');
            return false;
        }
        try {
            rec.setValue({ fieldId: FIELD_LOT, value: proxyVal });
        } catch (e) {
            log.error('MGSL Hold CS', 'Copy proxy → stored failed: ' + e.message);
            alert('Erreur interne lors de la sauvegarde du lot. Réessaie.');
            return false;
        }
        return true;
    }

    return {
        fieldChanged: fieldChanged,
        saveRecord:   saveRecord,
    };
});
