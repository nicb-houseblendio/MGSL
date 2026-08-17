/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description CWP ARCH bundle split — the write path. Splits a lot through a
 *              single Inventory Adjustment and trues the Sales Order line up to
 *              what the warehouse actually measured.
 *
 * Called only by the elevated Suitelet (mcgi_sl_arch_split_execute). Never
 * exposed as a RESTlet: a RESTlet runs as the calling user and silently drops
 * restricted-role writes, which bit PO Allocation twice and got its RESTlet
 * retired on 2026-07-30.
 *
 * ── The split, concretely ────────────────────────────────────────────────────
 * A bundle is one lot. A customer takes part of it. Nobody knows the true
 * remainder until the bundle is physically opened and both piles are measured,
 * so the whole bundle is unavailable until then.
 *
 * The PARENT lot keeps the customer's portion — that is what the Sales Order
 * fulfils — and the remainder moves to a new CHILD lot at the same location.
 *
 *   before   316027-3            2 206 BF
 *   after    316027-3              950 BF   (customer, stays on the SO)
 *            316027-3-B          1 250 BF   (remainder, back to availability)
 *
 * ── Why the adjustment does NOT always net to zero ───────────────────────────
 * Nic's solution design (section 3.2) states "total value constant: the customer
 * portion + the remainder equal the original bundle". That is not what the
 * client described. Marc-Antoine, 2026-08-11: the physical result differs from
 * the system figure, "maybe 320, maybe 288", because every tally is somebody's
 * judgement about where a 7¾ inch board rounds to. The supplier's number stops
 * being authoritative the moment the bundle is opened.
 *
 * So the measured figures win and the adjustment books the difference. If the
 * system held 2 206 BF and the warehouse measures 950 + 1 250 = 2 200, the
 * adjustment nets -6 BF and that variance is visible on the transaction. The
 * alternative — forcing the halves to sum to the stored figure — would silently
 * fabricate 6 BF of hardwood. A bundle that tallies slightly off is normal and
 * expected; inventing stock is not.
 *
 * ── Units: the trap ─────────────────────────────────────────────────────────
 * 🔴 NetSuite stores quantities in the item's BASE unit, which is NOT the unit
 * the screen shows. For ARCH Lumber the units type is MBF, whose base is MBF
 * while BF is a sub-unit at 0.001 — so a lot reading `2.206` holds 2 206 BF.
 * Ovals (Unit) and Veneer (SQFT) are base-rate 1 and need no conversion.
 *
 * Two of the three categories therefore work if you do nothing, which is
 * precisely what makes this dangerous. Every quantity crossing this module is
 * converted explicitly through the item's own stock-unit rate rather than a
 * hardcoded 1000, so a fourth category (Decking, expected in Linear Feet) needs
 * no code change.
 *
 * Callers pass and receive DISPLAY units — board feet for Lumber. Nothing
 * outside this module should ever see a stored value.
 */
define(['N/record', 'N/query', 'N/log'], (record, query, log) => {

    /** Split status list values, by the text the list carries. */
    const STATUS_PENDING = 'Pending';
    const STATUS_DONE    = 'Done';

    const F_SPLIT        = 'custcol_mgsl_split';
    const F_SPLIT_BF     = 'custcol_mgsl_split_bf';
    const F_SPLIT_STATUS = 'custcol_mgsl_split_status';
    const F_SPLIT_INVADJ = 'custcol_mgsl_split_invadj';

    /* ── Units ───────────────────────────────────────────────────────────────*/

    /**
     * How many BASE units one DISPLAY unit is worth, for an item's stock unit.
     *
     * Lumber: stock unit BF, rate 0.001 (1 BF = 0.001 MBF).
     * Ovals / Veneer: rate 1.
     *
     * Read from the account rather than assumed. Returns 1 when the item has no
     * units type configured at all, which is how every softwood item is set up —
     * those derive volume from pack fields instead and never reach this module.
     */
    const stockUnitRate = (itemId) => {
        const rows = query.runSuiteQL({
            query:
                'SELECT u.conversionrate AS rate ' +
                'FROM item i JOIN unitstypeuom u ON u.internalid = i.stockunit ' +
                'WHERE i.id = ?',
            params: [itemId],
        }).asMappedResults();
        const rate = rows.length ? parseFloat(rows[0].rate) : NaN;
        if (!isFinite(rate) || rate <= 0) {
            log.audit('ARCH Split', 'Item ' + itemId + ' has no usable stock-unit rate; treating as 1:1');
            return 1;
        }
        return rate;
    };

    const toStored  = (displayQty, rate) => displayQty * rate;
    const toDisplay = (storedQty, rate) => storedQty / rate;

    /* ── Child lot naming ────────────────────────────────────────────────────*/

    /**
     * The name for the remainder lot.
     *
     * 🔴 UNCONFIRMED — this is the one piece of the split still waiting on the
     * client, and it is isolated here so the answer changes one function.
     *
     * What the sandbox shows: lots are `<base>-<n>`, where the numeric suffix is
     * NOT ours to extend. The suffixes are non-contiguous — one base exists only
     * as `-13`, another starts at `-23` — which reads as the supplier's
     * packing-list bundle numbers, of which we hold whatever is still in stock.
     * Minting `-16` could therefore collide with a real bundle that simply has
     * not arrived.
     *
     * That is very likely why the four split remainders in the data append a
     * LETTER instead: 316027-3-B, -4-B, -6-B, -7-B, none of which still has a
     * parent. A second split produced `316027-4-B Leon` — a person's name — so
     * there is demonstrably no rule for that case yet.
     *
     * Caveat on all of the above: that data is a quick set Julie put together to
     * unblock us, not necessarily real practice, and Marc-Antoine's full import
     * had not landed when this was written. Treat the -B/-C ladder as a working
     * assumption, not a decision.
     *
     * Never generates a name that already exists — the caller passes the taken
     * names and this walks the alphabet past them.
     */
    const nextChildLotNumber = (parentName, takenNames) => {
        const taken = new Set((takenNames || []).map((n) => String(n).trim()));
        for (let i = 0; i < 26; i++) {
            const candidate = parentName + '-' + String.fromCharCode(66 + i); // B, C, D…
            if (!taken.has(candidate)) return candidate;
        }
        throw new Error(
            'Cannot name a child lot for ' + parentName +
            ': -B through -Z are all taken. This needs the naming convention settled.'
        );
    };

    /* ── Read helpers ────────────────────────────────────────────────────────*/

    /** The lot's stored on-hand at one location, plus sibling names for naming. */
    const readLotState = (lotId, locationId) => {
        const rows = query.runSuiteQL({
            query:
                'SELECT inv.inventorynumber AS lotname, inv.item AS itemid, ' +
                '       inl.quantityonhand AS storedqty ' +
                'FROM inventorynumber inv ' +
                'LEFT JOIN inventorynumberlocation inl ' +
                '       ON inl.inventorynumber = inv.id AND inl.location = ? ' +
                'WHERE inv.id = ?',
            params: [locationId, lotId],
        }).asMappedResults();
        if (!rows.length) throw new Error('Lot ' + lotId + ' does not exist.');
        const r = rows[0];

        // Sibling lots sharing the base, so a generated name cannot collide.
        const base = String(r.lotname).split('-')[0];
        const siblings = query.runSuiteQL({
            query:
                'SELECT inventorynumber AS lotname FROM inventorynumber ' +
                'WHERE item = ? AND inventorynumber LIKE ?',
            params: [r.itemid, base + '%'],
        }).asMappedResults().map((s) => s.lotname);

        return {
            lotId:     lotId,
            lotName:   r.lotname,
            itemId:    r.itemid,
            storedQty: parseFloat(r.storedqty) || 0,
            siblings:  siblings,
        };
    };

    /* ── Revalidation ────────────────────────────────────────────────────────*/

    /**
     * Everything that must still be true before anything is written.
     *
     * Runs against live data, not against whatever the screen was holding. The
     * screen may have been open for an hour; the bundle may have been sold,
     * the line removed, or another warehouse user may have completed the same
     * split already. First commit wins and the second gets a plain error.
     */
    const revalidate = (input) => {
        const so = record.load({ type: record.Type.SALES_ORDER, id: input.soId, isDynamic: false });

        const lineIndex = so.findSublistLineWithValue({
            sublistId: 'item', fieldId: 'lineuniquekey', value: String(input.lineUniqueKey),
        });
        if (lineIndex === -1) {
            throw new Error('That Sales Order line no longer exists. It may have been removed since the split was flagged.');
        }

        const flagged = so.getSublistValue({ sublistId: 'item', fieldId: F_SPLIT, line: lineIndex });
        if (flagged !== true && flagged !== 'T') {
            throw new Error('That Sales Order line is no longer flagged as a split.');
        }

        const statusText = so.getSublistText({ sublistId: 'item', fieldId: F_SPLIT_STATUS, line: lineIndex });
        if (statusText === STATUS_DONE) {
            const existing = so.getSublistValue({ sublistId: 'item', fieldId: F_SPLIT_INVADJ, line: lineIndex });
            return { alreadyDone: true, inventoryAdjustmentId: existing, so: so, lineIndex: lineIndex };
        }

        const lot = readLotState(input.lotId, input.locationId);
        const rate = stockUnitRate(lot.itemId);

        const customerStored  = toStored(input.customerQty,  rate);
        const remainderStored = toStored(input.remainderQty, rate);

        if (!(input.customerQty > 0)) {
            throw new Error('The customer quantity must be greater than zero.');
        }
        if (input.remainderQty < 0) {
            throw new Error('The remainder cannot be negative.');
        }
        if (lot.storedQty <= 0) {
            throw new Error('Lot ' + lot.lotName + ' has nothing on hand at that location any more.');
        }
        // The parent must be able to give up the remainder. The measured total may
        // differ from the stored figure — that is expected — but it cannot exceed
        // what is there, because that would be inventing stock rather than
        // recording a tally variance.
        if (remainderStored > lot.storedQty) {
            throw new Error(
                'The remainder (' + input.remainderQty + ') is more than lot ' + lot.lotName +
                ' holds (' + toDisplay(lot.storedQty, rate) + ').'
            );
        }

        return {
            alreadyDone: false,
            so: so, lineIndex: lineIndex, lot: lot, rate: rate,
            customerStored: customerStored, remainderStored: remainderStored,
        };
    };

    /* ── The Inventory Adjustment ────────────────────────────────────────────*/

    /**
     * One adjustment, two lines: take the remainder off the parent lot, put it
     * on a new child lot at the same location.
     *
     * `issueinventorynumber` for the negative line and `receiptinventorynumber`
     * for the positive one — the same pairing MCGI_MR_REMAN_CREATE_INV_ADJ uses,
     * where the receipt field accepts a name that does not exist yet and mints
     * the lot.
     */
    const postSplitAdjustment = (v, input, childLotName) => {
        const adj = record.create({ type: record.Type.INVENTORY_ADJUSTMENT, isDynamic: true });
        adj.setValue({ fieldId: 'subsidiary', value: input.subsidiaryId });
        adj.setValue({ fieldId: 'account',    value: input.adjustmentAccountId });
        // Both mandatory on this account and neither is covered by
        // ignoreMandatoryFields: the save fails with "Please enter value(s) for:
        // Adjustment Location, Department".
        //
        // adjlocation is the header default; each line still carries its own
        // location, and for a split both are the same place by definition — the
        // remainder stays where the parent was.
        adj.setValue({ fieldId: 'adjlocation', value: input.locationId });
        // Department is the Trading Softwood / Trading Hardwood split the client
        // asked to be set automatically from the trader's role. Passed in rather
        // than inferred here, because this module has no idea who the trader is.
        adj.setValue({ fieldId: 'department',  value: input.departmentId });
        adj.setValue({
            fieldId: 'memo',
            value: 'CWP ARCH bundle split — ' + v.lot.lotName + ' on ' + input.soTranId +
                   ' (customer ' + input.customerQty + ', remainder ' + input.remainderQty + ')',
        });

        /*
         * 🔴 The read side and the write side use DIFFERENT units, and this cost a
         * wrong first run: `inventorynumberlocation.quantityonhand` reports the
         * item's BASE unit (MBF for Lumber), but an Inventory Adjustment's
         * adjustqtyby and inventoryassignment quantity are in the item's STOCK
         * unit (BF). Converting for the write as well as the read applied the
         * 0.001 twice, and a 680 BF remainder was created as 0.00068 MBF, i.e.
         * 0.68 BF — three orders of magnitude short, silently.
         *
         * So: convert when READING a stored quantity, pass DISPLAY units when
         * WRITING. Nothing here is converted.
         */
        const onHandDisplay = toDisplay(v.lot.storedQty, v.rate);

        // The parent gives up the remainder and also absorbs any tally variance,
        // ending at exactly what the warehouse measured for the customer, so a
        // short or long tally lands here and stays visible.
        const parentDeltaDisplay = input.customerQty - onHandDisplay;
        addLine(adj, v, input, parentDeltaDisplay, { issueId: v.lot.lotId });

        // The remainder becomes the child lot.
        addLine(adj, v, input, input.remainderQty, { receipt: childLotName });

        const id = adj.save({ enableSourcing: true, ignoreMandatoryFields: false });
        log.audit('ARCH Split', 'Inventory Adjustment ' + id + ' created for ' + v.lot.lotName +
                  ' -> ' + childLotName + ' (parent delta ' + parentDeltaDisplay +
                  ', child ' + input.remainderQty + ', display units)');
        return id;
    };

    const addLine = (adj, v, input, storedDelta, lotRef) => {
        adj.selectNewLine({ sublistId: 'inventory' });
        adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item',        value: v.lot.itemId });
        adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'location',    value: input.locationId });
        adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'adjustqtyby', value: storedDelta });

        const detail = adj.getCurrentSublistSubrecord({ sublistId: 'inventory', fieldId: 'inventorydetail' });
        detail.selectNewLine({ sublistId: 'inventoryassignment' });

        // The two sides take DIFFERENT value types, and getting it wrong throws
        // INVALID_FLD_VALUE rather than failing quietly:
        //
        //   issueinventorynumber   the internal ID of an EXISTING lot. A name is
        //                          rejected outright. Nic's production lot
        //                          assignment passes Number(lotId) for the same
        //                          reason.
        //   receiptinventorynumber a NAME, for a lot that does not exist yet.
        //                          This is what mints the child lot.
        if (lotRef.issueId) {
            detail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId:   'issueinventorynumber',
                value:     Number(lotRef.issueId),
            });
        } else {
            detail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId:   'receiptinventorynumber',
                value:     String(lotRef.receipt),
            });
        }
        detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: storedDelta });
        detail.commitLine({ sublistId: 'inventoryassignment' });

        adj.commitLine({ sublistId: 'inventory' });
    };

    /* ── Sales Order true-up ─────────────────────────────────────────────────*/

    /**
     * The line now reflects what was actually picked, not what was asked for,
     * and carries the adjustment that did it.
     *
     * Flipping the status to Done is also what ends the hold: the ARCH cache
     * treats a Pending split line as holding its whole bundle, so there is no
     * separate hold record to release. Nic's design allowed either that or a
     * `customrecord_mgsl_inventory_hold` row — deriving it from the line avoids
     * a second record that can drift out of sync, and matches Marc-Antoine's
     * "committed derives from the SO lines".
     */
    const trueUpSalesOrderLine = (v, input, adjustmentId) => {
        const so = record.load({ type: record.Type.SALES_ORDER, id: input.soId, isDynamic: false });
        const line = so.findSublistLineWithValue({
            sublistId: 'item', fieldId: 'lineuniquekey', value: String(input.lineUniqueKey),
        });
        if (line === -1) throw new Error('The Sales Order line vanished between the adjustment and the true-up.');

        so.setSublistValue({ sublistId: 'item', fieldId: 'quantity',       line: line, value: input.customerQty });
        so.setSublistValue({ sublistId: 'item', fieldId: F_SPLIT_BF,       line: line, value: input.customerQty });
        so.setSublistText ({ sublistId: 'item', fieldId: F_SPLIT_STATUS,   line: line, text:  STATUS_DONE });
        so.setSublistValue({ sublistId: 'item', fieldId: F_SPLIT_INVADJ,   line: line, value: adjustmentId });

        const id = so.save({ enableSourcing: false, ignoreMandatoryFields: true });
        log.audit('ARCH Split', 'Sales Order ' + id + ' line ' + line + ' trued up to ' + input.customerQty);
        return id;
    };

    /* ── Orchestration ───────────────────────────────────────────────────────*/

    /**
     * @param {Object} input
     * @param {number} input.soId
     * @param {string} input.lineUniqueKey
     * @param {number} input.lotId              inventorynumber internal id
     * @param {number} input.locationId
     * @param {number} input.customerQty        DISPLAY units, measured
     * @param {number} input.remainderQty       DISPLAY units, measured
     * @param {number} input.subsidiaryId
     * @param {number} input.adjustmentAccountId
     * @param {string} input.soTranId           for the memo
     */
    const executeSplit = (input) => {
        const v = revalidate(input);

        // Someone already completed this one. Report their result rather than
        // splitting the bundle a second time.
        if (v.alreadyDone) {
            return {
                ok: true, alreadyDone: true,
                inventoryAdjustmentId: v.inventoryAdjustmentId,
                message: 'This split was already completed.',
            };
        }

        const childLotName = nextChildLotNumber(v.lot.lotName, v.lot.siblings);
        const adjustmentId = postSplitAdjustment(v, input, childLotName);

        // Past this point the inventory has moved. A failure in the true-up
        // leaves the adjustment posted and the line still Pending, which is the
        // safe direction: the bundle is split in reality and the screen still
        // shows work to do, rather than a completed line over unsplit stock.
        let salesOrderId;
        try {
            salesOrderId = trueUpSalesOrderLine(v, input, adjustmentId);
        } catch (e) {
            log.error('ARCH Split', 'Adjustment ' + adjustmentId + ' posted but the Sales Order true-up failed: ' + e.message);
            throw new Error(
                'The bundle was split (adjustment ' + adjustmentId + ') but the Sales Order could not be updated: ' +
                e.message + ' The split is still marked Pending — do not run it again, fix the order first.'
            );
        }

        /*
         * Two steps from Nic's section 3.2 are deliberately NOT here yet, because
         * both depend on things that do not exist:
         *
         *   Cache refresh — there is no ARCH cache to refresh. The MR, the cache
         *   keys and the saved searches are all still to be built (Track C), so
         *   there is nothing to invalidate. Until then the remainder appears on
         *   the trader screen at the next scheduled rebuild rather than
         *   immediately, which is a visible lag but not a correctness problem.
         *
         *   Tag hook — bundle-tag PDF generation is the adjacent BT7 workstream.
         *   Emitting an event nothing consumes would be dead code that looks
         *   finished.
         *
         * Both are one call each once their dependency lands. Left as a gap on
         * purpose rather than stubbed, so nobody reads a no-op as done.
         */
        return {
            ok: true,
            alreadyDone: false,
            inventoryAdjustmentId: adjustmentId,
            salesOrderId: salesOrderId,
            parentLot: v.lot.lotName,
            childLot: childLotName,
            customerQty: input.customerQty,
            remainderQty: input.remainderQty,
            tallyVarianceDisplay: toDisplay(
                (v.customerStored + v.remainderStored) - v.lot.storedQty, v.rate
            ),
        };
    };

    return {
        executeSplit: executeSplit,
        // Exported for the test runner and for the Suitelet's dry-run mode.
        revalidate: revalidate,
        nextChildLotNumber: nextChildLotNumber,
        stockUnitRate: stockUnitRate,
        toStored: toStored,
        toDisplay: toDisplay,
    };
});
