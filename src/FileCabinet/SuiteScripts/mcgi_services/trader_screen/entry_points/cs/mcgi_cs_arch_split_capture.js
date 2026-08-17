/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * @description CWP ARCH bundle split — capture rules on the Sales Order line.
 *
 * Runs on the Sales Order form, native and custom alike. It exists for two jobs,
 * and the second is not optional.
 *
 * ── 1. Keep the split flag and its quantity consistent ──────────────────────
 * Ticking Split without a quantity, or entering a quantity without ticking
 * Split, both produce a line the warehouse cannot act on. The pair is enforced
 * here, at entry, rather than discovered later by someone holding a tape measure.
 *
 * ── 2. Protect the two system-managed fields ────────────────────────────────
 * 🔴 Split Status and Split Inventory Adjustment are written by the server when a
 * split completes, and must never be typed over. They cannot be made read-only in
 * the field definition: a `transactioncolumncustomfield` rejects `DISABLED` **and**
 * `INLINE`, both at SDF validation time — verified, not assumed. So the only place
 * the read-only intent can live is here.
 *
 * Hand-editing Split Status is the dangerous one. Setting it to Done on a line
 * whose bundle was never cut leaves the stock unsplit while the queue believes
 * the work is finished, and the whole bundle stays held with nothing to release
 * it. Reverting Status to Pending after completion is just as bad in reverse: the
 * warehouse would be asked to cut a bundle that no longer exists.
 *
 * The server sets these through N/record, which does not run client scripts, so
 * rejecting every user edit here costs the real write path nothing.
 *
 * ── What is deliberately NOT validated here ─────────────────────────────────
 * The upper bound, "no more than the bundle holds". The client cannot know it:
 * the lot lives in the line's inventory detail, and NetSuite does not expose that
 * subrecord on a line until something else has created it — proven by probing a
 * softwood control at its own location, which failed identically. Guessing from
 * the line quantity would be wrong, since a split line's quantity IS the split
 * amount.
 *
 * That bound is checked server-side in archSplitExecute.revalidate, against live
 * data at the moment the split is completed, which is the only point where the
 * answer is trustworthy anyway. The bundle may have been sold in the meantime.
 */
define(['N/ui/message'], (message) => {

    const SUBLIST         = 'item';
    const F_SPLIT         = 'custcol_mgsl_split';
    const F_SPLIT_BF      = 'custcol_mgsl_split_bf';
    const F_SPLIT_STATUS  = 'custcol_mgsl_split_status';
    const F_SPLIT_INVADJ  = 'custcol_mgsl_split_invadj';

    /** Fields the server owns. Any user edit is refused. */
    const SYSTEM_FIELDS = [F_SPLIT_STATUS, F_SPLIT_INVADJ];

    const banner = (title, text, type) => {
        try {
            message.create({ title: title, message: text, type: type || message.Type.WARNING })
                   .show({ duration: 6000 });
        } catch (e) {
            // A banner is a courtesy. Never let its failure block a save.
        }
    };

    const num = (v) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : 0;
    };

    /**
     * Refuse edits to the server-owned fields, and refuse a non-positive split
     * quantity outright so the bad value never lands in the line at all.
     */
    const validateField = (context) => {
        if (context.sublistId !== SUBLIST) return true;

        if (SYSTEM_FIELDS.indexOf(context.fieldId) !== -1) {
            banner('Set automatically',
                   'Split Status and Split Inventory Adjustment are maintained by the split process. ' +
                   'Editing them by hand would leave the bundle held with nothing to release it.');
            return false;
        }

        if (context.fieldId === F_SPLIT_BF) {
            const line = context.currentRecord.getCurrentSublistValue({
                sublistId: SUBLIST, fieldId: F_SPLIT_BF,
            });
            // Blank is allowed while the line is being built; the pairing is
            // enforced on validateLine. Only a present-but-invalid value is
            // refused here.
            if (line !== '' && line !== null && line !== undefined && !(num(line) > 0)) {
                banner('Split quantity',
                       'Enter board feet greater than zero. Decimals are expected — hardwood is not measured in whole feet.');
                return false;
            }
        }

        return true;
    };

    /** Unticking Split clears the quantity, so no orphan figure is left behind. */
    const fieldChanged = (context) => {
        if (context.sublistId !== SUBLIST || context.fieldId !== F_SPLIT) return;
        const rec = context.currentRecord;
        const ticked = rec.getCurrentSublistValue({ sublistId: SUBLIST, fieldId: F_SPLIT });
        if (ticked !== true && ticked !== 'T') {
            rec.setCurrentSublistValue({
                sublistId: SUBLIST, fieldId: F_SPLIT_BF, value: '', ignoreFieldChange: true,
            });
        }
    };

    /** The flag and the quantity travel together or the line is refused. */
    const validateLine = (context) => {
        if (context.sublistId !== SUBLIST) return true;
        const rec    = context.currentRecord;
        const ticked = rec.getCurrentSublistValue({ sublistId: SUBLIST, fieldId: F_SPLIT });
        const bf     = rec.getCurrentSublistValue({ sublistId: SUBLIST, fieldId: F_SPLIT_BF });
        const isSplit = (ticked === true || ticked === 'T');

        if (isSplit && !(num(bf) > 0)) {
            alert('This line is marked as a split, so it needs the board feet to pick.\n\n' +
                  'That is what the warehouse works from. Enter it, or untick Split Bundle to sell the whole bundle.');
            return false;
        }

        if (!isSplit && num(bf) > 0) {
            alert('There is a split quantity on this line but Split Bundle is not ticked.\n\n' +
                  'Untouched, the warehouse never sees this line and the whole bundle ships. ' +
                  'Tick Split Bundle, or clear the quantity.');
            return false;
        }

        return true;
    };

    /**
     * Last gate. validateLine only fires for lines edited in this session, so a
     * line pasted in, imported, or left over from an earlier edit can still reach
     * save inconsistent.
     */
    const saveRecord = (context) => {
        const rec = context.currentRecord;
        let count = 0;
        try {
            count = rec.getLineCount({ sublistId: SUBLIST });
        } catch (e) {
            return true;
        }
        if (count < 0) return true;

        const bad = [];
        for (let i = 0; i < count; i++) {
            const ticked = rec.getSublistValue({ sublistId: SUBLIST, fieldId: F_SPLIT, line: i });
            const bf     = rec.getSublistValue({ sublistId: SUBLIST, fieldId: F_SPLIT_BF, line: i });
            const isSplit = (ticked === true || ticked === 'T');
            if (isSplit && !(num(bf) > 0))  bad.push('line ' + (i + 1) + ': marked as a split with no quantity');
            if (!isSplit && num(bf) > 0)    bad.push('line ' + (i + 1) + ': has a split quantity but is not marked as a split');
        }

        if (bad.length) {
            alert('This order cannot be saved yet:\n\n' + bad.join('\n') +
                  '\n\nA split needs both the tick and the board feet, or neither.');
            return false;
        }
        return true;
    };

    return {
        validateField: validateField,
        fieldChanged:  fieldChanged,
        validateLine:  validateLine,
        saveRecord:    saveRecord,
    };
});
