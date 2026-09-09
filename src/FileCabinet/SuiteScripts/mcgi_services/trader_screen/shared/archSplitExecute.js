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
define([
    'N/record', 'N/query', 'N/runtime', 'N/log',
    // The FIFO-per-lot-and-location engine, validated to the cent against
    // Prod GL (Task 8, 2026-06-11) and already the cost source for both
    // trader-screen caches. A split must not invent a second costing model.
    '/SuiteScripts/MCGI_LIB_LotCost',
], (record, query, runtime, log, LotCostLib) => {

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
    const checkedStockUnitRate = (itemId) => {
        const rows = query.runSuiteQL({
            query:
                'SELECT u.conversionrate AS rate, i.stockunit AS stockunit, i.saleunit AS saleunit ' +
                'FROM item i JOIN unitstypeuom u ON u.internalid = i.stockunit ' +
                'WHERE i.id = ?',
            params: [itemId],
        }).asMappedResults();

        /* ── The SO true-up is the exposed half of this module, not the adjustment.
         *
         * An Inventory Adjustment line takes its unit from the item's STOCK unit,
         * which is the same field the rate below is keyed on, so those two cannot
         * drift apart. `trueUpSalesOrderLine` writes to a SALES ORDER line, whose
         * unit NetSuite sources from the SALE unit, which nothing here reads.
         *
         * 🔴 THROWS, and it must happen HERE in revalidate rather than at the write.
         * The adjustment posts BEFORE the true-up, so a late failure would leave
         * real stock physically split against a mis-scaled order line. Refusing in
         * revalidate keeps the whole thing pre-write, and the dry run runs through
         * this same path so the warehouse learns before walking to the bundle.
         *
         * Concretely, with stockunit=BF and saleunit=MBF, a 500 BF customer portion
         * would post a correct adjustment and then true the SO line up to 500 MBF,
         * which is 500,000 BF. */
        if (rows.length) {
            const stockUnit = parseInt(rows[0].stockunit, 10);
            const saleUnit  = parseInt(rows[0].saleunit, 10);
            if (!stockUnit || !saleUnit || stockUnit !== saleUnit) {
                log.error({
                    title: 'ARCH Split — UNIT MISMATCH, SPLIT REFUSED',
                    details: 'Item ' + itemId + ' has stockunit=' + stockUnit + ' saleunit=' + saleUnit +
                             '. The adjustment would post in the stock unit and the Sales Order true-up ' +
                             'in the sale unit. Fix the item record; do not convert in code.',
                });
                throw new Error('This item is stocked and sold in different units, so the split cannot ' +
                                'be completed without writing the wrong quantity to the order. Nothing ' +
                                'was adjusted. Set the sale unit to match the stock unit on the item.');
            }
        }

        const rate = rows.length ? parseFloat(rows[0].rate) : NaN;
        if (!isFinite(rate) || rate <= 0) {
            log.audit('ARCH Split', 'Item ' + itemId + ' has no usable stock-unit rate; treating as 1:1');
            return 1;
        }
        return rate;
    };

    const toStored  = (displayQty, rate) => displayQty * rate;
    const toDisplay = (storedQty, rate) => storedQty / rate;

    /* Two decimals, clear of the float noise that renders 841.1799999999. */
    const round2 = (n) => Math.round(n * 100) / 100;

    // NetSuite carries more precision than this on a unit cost, but eight
    // decimals already puts the residual on a 325 BF bundle below a tenth of a
    // cent, and a rate a human can read back is worth more than the last digit.
    const COST_DP = 8;
    const roundCost = (n) => {
        const f = Math.pow(10, COST_DP);
        return Math.round(n * f) / f;
    };

    /**
     * The parent lot's cost per DISPLAY unit at this location, or null.
     *
     * THE UNIT DIRECTION IS THE OPPOSITE OF EVERY QUANTITY IN THIS FILE.
     * `rate` is base-units-per-display-unit (0.001 for BF, because NetSuite
     * stores lumber in MBF), and getLotCostsAtLocation derives its rate as
     * `line GL / line qty` where that line qty is in BASE units. So a cost
     * converts base to display by MULTIPLYING by rate, where a quantity
     * divides. Divide here and purpleheart costs $4,320,000/BF.
     *
     * Measured against the two lots this code has already touched: the engine
     * returns 2740 for 315093-27 and 12990 for 315970-9-B, which is $2.74/BF
     * and $12.99/BF, and both match the posted GL exactly.
     *
     * No book is requested, so the engine uses the PRIMARY book. That is
     * deliberate: the adjustment posts to the primary book, and the USD book is
     * a reporting overlay that must not decide what the wood is worth here.
     */
    const readLotUnitCost = (lotId, locationId, rate) => {
        const costs = LotCostLib.getLotCostsAtLocation([String(lotId)], locationId) || {};
        const perBase = costs[String(lotId)];
        if (perBase === null || perBase === undefined || !isFinite(perBase)) return null;
        return perBase * rate;
    };

    /*
     * -- Value conservation on a split ---------------------------------------
     *
     * Marc-Antoine, 2026-09-09: "Il faudrait que l'impact GL net a 0. On se
     * retrouve avec plus de mbf apres le split, donc le $/bf devrait diminuer."
     *
     * He is right, and it is the whole point. A split does not create or destroy
     * wood, it re-measures it. The dollars must therefore stay still while the
     * board feet move: the same value comes back on the measured total at a new
     * rate. Before today this posted two lines and set no unit cost at all, so
     * NetSuite priced each receipt off the item estimate and the difference fell
     * straight into the GL. Measured on the only two adjustments this code has
     * ever made:
     *
     *   IA-CWP-595   +$49.32   18 extra BF handed out at the parent's own rate
     *   IA-CWP-467  +$477.30   645 BF repriced 12.25 to 12.99, ZEB84KD's
     *                          lastpurchaseprice, which is not what the wood cost
     *
     * $526.62 of value invented across two records, and it would have scaled with
     * every split a trader made.
     *
     * NetSuite will not issue stock at anything other than its own cost, which is
     * why this is three lines rather than two, exactly as he set out:
     *
     *   1. issue the WHOLE parent lot            307 BF, at whatever it cost
     *   2. receive the customer's measured qty   225 BF, at the new rate
     *   3. receive the remainder as a child lot  100 BF, at the new rate
     *
     * Line 1 carries NO unit cost on purpose. NetSuite relieves an issue at the
     * lot's actual cost and ignores what we ask for, so passing nothing lets the
     * parent lot empty to exactly zero instead of stranding a few cents in a lot
     * that reads as having no wood in it. Lines 2 and 3 share one rate, the
     * opening value over the measured total.
     *
     * Whatever the two sides fail to cancel is a rounding artefact of the cost
     * the engine reports to two decimals. It lands in the header account, which
     * is why that account is 8900000 Rounding Gain/Loss and not an inventory
     * clearing account.
     *
     * A short or long tally still lands on the parent and stays visible. It now
     * shows up as a CHANGE IN RATE, which is what it is, rather than as value
     * that appeared from nowhere.
     */
    const planSplitCost = (onHandDisplay, perDisplayCost, customerQty, remainderQty) => {
        if (!(onHandDisplay > 0)) {
            throw new Error('Cannot split a lot with nothing on hand at this location.');
        }
        if (!(perDisplayCost > 0)) {
            // Anything on hand was received by a posting transaction, so it has a
            // costed layer. A null here means the engine failed, not that the wood
            // is free, and guessing is what put $526.62 into the GL.
            throw new Error(
                'The lot reports no cost at this location, so the split cannot conserve its ' +
                'value. Refusing, rather than letting NetSuite price the receipts off the ' +
                'item estimate.'
            );
        }
        const totalAfter = customerQty + remainderQty;
        if (!(totalAfter > 0)) {
            throw new Error('A split must leave some wood: customer and remainder are both zero.');
        }

        const openingValue = round2(onHandDisplay * perDisplayCost);
        const newUnitCost  = roundCost(openingValue / totalAfter);

        // The parent leaves in one piece. No unit cost: NetSuite uses the lot's own.
        const lines = [{
            role: 'issue', qty: -onHandDisplay, unitCost: null,
            expectedAmount: -openingValue, lot: 'parent',
        }];
        // A split that hands the customer everything, or nothing, is legitimate:
        // a full-bundle sale and a pure re-measure both arrive here. Neither may
        // post a zero-quantity line, which NetSuite rejects.
        if (customerQty > 0) {
            lines.push({
                role: 'customer', qty: customerQty, unitCost: newUnitCost,
                expectedAmount: round2(customerQty * newUnitCost), lot: 'parent',
            });
        }
        if (remainderQty > 0) {
            lines.push({
                role: 'remainder', qty: remainderQty, unitCost: newUnitCost,
                expectedAmount: round2(remainderQty * newUnitCost), lot: 'child',
            });
        }

        return {
            onHandDisplay: onHandDisplay,
            totalAfter: totalAfter,
            openingValue: openingValue,
            oldUnitCost: perDisplayCost,
            newUnitCost: newUnitCost,
            lines: lines,
            // What the three lines fail to cancel, in dollars. Rounding only.
            residual: round2(lines.reduce((sum, l) => sum + l.expectedAmount, 0)),
        };
    };

    /**
     * What the saved adjustment actually did to the ledger.
     *
     * The arithmetic above is right on paper, but ONE inference in it is not
     * measured: that the `unitcost` field takes a per-DISPLAY-unit figure, the
     * same basis as `adjustqtyby` on its own line, rather than a per-base one.
     * Everything points that way, because NetSuite converts the quantity on
     * write and the posted `rate` comes back per base at exactly 1000x what we
     * passed, but getting it wrong is a thousandfold error, which is the exact
     * trap this file's own unit comment was written about.
     *
     * So the run measures itself. A conserved split nets to nothing on every
     * account; a per-base unit cost would show up here as roughly a thousand
     * times the bundle's value and could not hide.
     */
    const verifyAdjustmentGl = (adjId, plan) => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT a.acctnumber AS acctnumber, ' +
                    '       SUM(NVL(tal.debit, 0)) - SUM(NVL(tal.credit, 0)) AS net ' +
                    'FROM transactionaccountingline tal ' +
                    'JOIN account a ON a.id = tal.account ' +
                    'WHERE tal.transaction = ? AND tal.accountingbook = 1 ' +
                    'GROUP BY a.acctnumber',
                params: [adjId],
            }).asMappedResults();

            if (!rows.length) {
                // Accounting lines are written on save, so this should not happen.
                // Say so plainly instead of reporting a clean net we never saw.
                log.audit('ARCH Split GL', 'Adjustment ' + adjId +
                          ' has no primary-book accounting lines yet, so its GL impact is ' +
                          'UNVERIFIED. Expected a net of about ' + plan.residual + '.');
                return null;
            }

            const nets = rows.map((r) => String(r.acctnumber) + ' ' + round2(parseFloat(r.net) || 0));
            const worst = rows.reduce(
                (m, r) => Math.max(m, Math.abs(parseFloat(r.net) || 0)), 0);
            const summary =
                'Adjustment ' + adjId + ': ' + nets.join(', ') +
                ' | planned opening ' + plan.openingValue +
                ', ' + plan.onHandDisplay + ' -> ' + plan.totalAfter +
                ' at ' + plan.oldUnitCost + ' -> ' + plan.newUnitCost +
                ', expected residual ' + plan.residual;

            // A dollar is far above any rounding this can produce and far below
            // any unit error, so it separates the two without tuning.
            if (worst > 1) {
                log.error('ARCH Split GL NOT conserved', summary +
                          ' - the largest account net is ' + round2(worst) +
                          ', which is too big to be rounding. If it is near 1000x the ' +
                          'bundle value the unit cost went in per MBF instead of per BF.');
            } else {
                log.audit('ARCH Split GL conserved', summary);
            }
            return worst;
        } catch (e) {
            log.error('ARCH Split GL check failed',
                      'Adjustment ' + adjId + ' was saved and is NOT verified: ' + e.message);
            return null;
        }
    };

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

        /*
         * 🔴 THE ORDER MUST STILL BE OPEN AND THE LINE MUST NOT HAVE SHIPPED.
         *
         * Added 2026-09-09 after an adversarial pass drove this function with real
         * sandbox values and got an inventory adjustment of +89 BF against lot
         * 315643-7, INVENTING Purpleheart to raise a parent lot to a quantity that had
         * already left the building. SO-CWP-001346 was Billed (status G) and fully
         * shipped on IF1208, and nothing here noticed.
         *
         * Why the existing guards did not catch it. `isclosed` never flips on this
         * account: all 19 split-flagged lines read 'F', 3 of them on Billed orders. And
         * the negative-remainder check only fires when the REMAINDER exceeds on-hand,
         * so customer 300 / remainder 0 against a 211 BF lot sailed straight through.
         *
         * The queue query now excludes these too, but that is not sufficient on its
         * own: this endpoint takes a job id, and a stale browser tab, a retry or any
         * other caller can still submit one. The refusal belongs at the write.
         */
        const soStatus = String(so.getValue({ fieldId: 'status' }) || '');
        const shipped = Math.abs(parseFloat(
            so.getSublistValue({ sublistId: 'item', fieldId: 'quantityshiprecv', line: lineIndex })
        ) || 0);
        if (shipped > 0) {
            throw new Error(
                'That bundle has already shipped (' + shipped + ' on the line), so it cannot be ' +
                'split any more. Nothing was adjusted. The order is ' + (soStatus || 'in an unknown status') + '.'
            );
        }
        /* Status comes back as a DISPLAY string from getValue on a loaded record
         * ("Billed", "Closed"), not the letter SuiteQL returns, so match on text and
         * keep it permissive: an unexpected status refuses rather than proceeding. */
        if (/billed|closed|cancel/i.test(soStatus)) {
            throw new Error(
                'That sales order is ' + soStatus + ', so its bundles are no longer warehouse work ' +
                'and nothing was adjusted. If a split really is still needed, raise it on an open order.'
            );
        }

        const statusText = so.getSublistText({ sublistId: 'item', fieldId: F_SPLIT_STATUS, line: lineIndex });
        if (statusText === STATUS_DONE) {
            const existing = so.getSublistValue({ sublistId: 'item', fieldId: F_SPLIT_INVADJ, line: lineIndex });
            return { alreadyDone: true, inventoryAdjustmentId: existing, so: so, lineIndex: lineIndex };
        }

        const lot = readLotState(input.lotId, input.locationId);
        const rate = checkedStockUnitRate(lot.itemId);

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
     * One adjustment, three lines, and no net movement in the GL.
     *
     * `issueinventorynumber` for the negative line and `receiptinventorynumber`
     * for the positive ones, the same pairing MCGI_MR_REMAN_CREATE_INV_ADJ uses,
     * where the receipt field accepts a name and mints the lot if it is new. The
     * customer's line names the PARENT lot, which already exists, so the wood
     * goes back where it was; only the remainder mints anything.
     *
     * See the value-conservation note above for why this is three lines.
     */
    const postSplitAdjustment = (v, input, childLotName) => {
        /*
         * The read side and the write side use DIFFERENT units, and this cost a
         * wrong first run: `inventorynumberlocation.quantityonhand` reports the
         * item's BASE unit (MBF for Lumber), but an Inventory Adjustment's
         * adjustqtyby and inventoryassignment quantity are in the item's STOCK
         * unit (BF). Converting for the write as well as the read applied the
         * 0.001 twice, and a 680 BF remainder was created as 0.00068 MBF, i.e.
         * 0.68 BF, three orders of magnitude short, silently.
         *
         * So: convert when READING a stored quantity, pass DISPLAY units when
         * WRITING. Nothing below is converted.
         */
        const onHandDisplay = toDisplay(v.lot.storedQty, v.rate);

        // Priced BEFORE anything is created, so a lot we cannot cost costs us an
        // exception rather than a posted adjustment that has to be unwound.
        const perDisplayCost = readLotUnitCost(v.lot.lotId, input.locationId, v.rate);
        const plan = planSplitCost(
            onHandDisplay, perDisplayCost, input.customerQty, input.remainderQty
        );

        const adj = record.create({ type: record.Type.INVENTORY_ADJUSTMENT, isDynamic: true });
        adj.setValue({ fieldId: 'subsidiary', value: input.subsidiaryId });
        adj.setValue({ fieldId: 'account',    value: input.adjustmentAccountId });
        // Both mandatory on this account and neither is covered by
        // ignoreMandatoryFields: the save fails with "Please enter value(s) for:
        // Adjustment Location, Department".
        //
        // adjlocation is the header default; each line still carries its own
        // location, and for a split both are the same place by definition: the
        // remainder stays where the parent was.
        adj.setValue({ fieldId: 'adjlocation', value: input.locationId });
        // Department is the Trading Softwood / Trading Hardwood split the client
        // asked to be set automatically from the trader's role. Passed in rather
        // than inferred here, because this module has no idea who the trader is.
        adj.setValue({ fieldId: 'department',  value: input.departmentId });
        adj.setValue({
            fieldId: 'memo',
            value: 'CWP ARCH bundle split: ' + v.lot.lotName + ' on ' + input.soTranId +
                   ' (customer ' + input.customerQty + ', remainder ' + input.remainderQty +
                   '; ' + onHandDisplay + ' at ' + plan.oldUnitCost + ' -> ' +
                   plan.totalAfter + ' at ' + plan.newUnitCost + ')',
        });

        plan.lines.forEach((line) => {
            const lotRef = line.role === 'remainder'
                ? { receipt: childLotName }
                : (line.role === 'issue'
                    ? { issueId: v.lot.lotId }
                    // The parent lot by NAME, not by id: a receipt takes a name,
                    // and this one already exists, so NetSuite attaches to it
                    // rather than minting a second lot with the same number.
                    : { receipt: v.lot.lotName });
            addLine(adj, v, input, line.qty, lotRef, line.unitCost);
        });

        const id = adj.save({ enableSourcing: true, ignoreMandatoryFields: false });
        log.audit('ARCH Split', 'Inventory Adjustment ' + id + ' created for ' + v.lot.lotName +
                  ' -> ' + childLotName + ' (' + plan.lines.length + ' lines: ' +
                  plan.lines.map((l) => l.role + ' ' + l.qty).join(', ') +
                  ', display units; value ' + plan.openingValue + ' held at ' +
                  plan.newUnitCost + ' per unit)');
        verifyAdjustmentGl(id, plan);
        return id;
    };

    const addLine = (adj, v, input, displayDelta, lotRef, unitCost) => {
        adj.selectNewLine({ sublistId: 'inventory' });
        adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'item',        value: v.lot.itemId });
        adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'location',    value: input.locationId });
        adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'adjustqtyby', value: displayDelta });

        // Per DISPLAY unit, the same basis as adjustqtyby on this line. See
        // verifyAdjustmentGl for why that is measured rather than assumed.
        // Null on an issue line: NetSuite relieves at the lot's own cost and
        // ignores anything we pass, and setting it would only strand cents.
        // Guarded the same way MCGI_MR_REMAN_CREATE_INV_ADJ guards it.
        if (unitCost !== null && unitCost !== undefined && isFinite(unitCost)) {
            adj.setCurrentSublistValue({ sublistId: 'inventory', fieldId: 'unitcost', value: unitCost });
        }

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
        detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: displayDelta });
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
    /**
     * Fills in the accounting context from the order itself.
     *
     * The browser used to have to send subsidiaryId, departmentId and — worst —
     * adjustmentAccountId. A screen has no business naming the GL account an
     * inventory adjustment posts to; anyone who could reach the endpoint could
     * have pointed the write at any account in the chart. These are now read
     * from the Sales Order and from script configuration, and whatever the
     * caller sends for them is ignored.
     *
     * Department is the Trading Softwood / Trading Hardwood value the client
     * asked to be set from the trader's role. Taking it from the order means it
     * matches whatever the order already booked against rather than being
     * asserted twice.
     */
    const resolveContext = (input) => {
        const rows = query.runSuiteQL({
            query:
                'SELECT tl.subsidiary AS subsidiaryid, tl.department AS departmentid, t.tranid AS tranid ' +
                'FROM transaction t JOIN transactionline tl ON tl.transaction = t.id ' +
                "WHERE t.id = ? AND tl.mainline = 'T'",
            params: [input.soId],
        }).asMappedResults();
        if (!rows.length) throw new Error('That sales order does not exist.');

        const acct = runtime.getCurrentScript().getParameter({ name: 'custscript_arch_split_adj_account' });
        const accountId = parseInt(acct, 10);
        if (!accountId) {
            throw new Error(
                'No adjustment account is configured. Set custscript_arch_split_adj_account on the ' +
                'split endpoint deployment before completing splits.'
            );
        }

        return {
            subsidiaryId: rows[0].subsidiaryid,
            departmentId: input.departmentId || rows[0].departmentid,
            adjustmentAccountId: accountId,
            soTranId: rows[0].tranid,
        };
    };

    const executeSplit = (rawInput) => {
        const ctx = resolveContext(rawInput);
        const input = {
            soId: rawInput.soId,
            lineUniqueKey: rawInput.lineUniqueKey,
            lotId: rawInput.lotId,
            locationId: rawInput.locationId,
            customerQty: rawInput.customerQty,
            remainderQty: rawInput.remainderQty,
            subsidiaryId: ctx.subsidiaryId,
            departmentId: ctx.departmentId,
            adjustmentAccountId: ctx.adjustmentAccountId,
            soTranId: ctx.soTranId,
        };
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
        checkedStockUnitRate: checkedStockUnitRate,
        toStored: toStored,
        toDisplay: toDisplay,
        planSplitCost: planSplitCost,
        postSplitAdjustment: postSplitAdjustment,
    };
});
