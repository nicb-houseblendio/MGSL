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
    /**
     * CLAIMED. Written BEFORE the inventory adjustment is posted, so a line can
     * never be picked up twice.
     *
     * 🔴 THIS IS THE LOCK, and it is deliberately a fail-CLOSED one. The retry guard
     * used to be the adjustment id, stamped AFTER the adjustment in a save that is
     * best effort by design, so two concurrent posts both read Pending and both
     * split the bundle, and a failed stamp left a split bundle looking untouched.
     * Claiming first inverts the failure: a crash between the claim and the
     * adjustment leaves a job that needs a human to reset, which is the right trade
     * for inventory against a bundle cut twice.
     */
    const STATUS_INPROGRESS = 'In progress';
    const STATUS_DONE       = 'Done';

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
        // A split that hands the customer everything is legitimate: a bundle sold
        // whole after re-measuring arrives here with remainder 0. The mirror case,
        // customer 0, does NOT: `revalidate` refuses it. Neither figure may post a
        // zero-quantity line, which NetSuite rejects, so each is guarded.
        /*
         * 🔴 THE CUSTOMER'S PIECE IS THE ONE THAT GETS THE NEW NUMBER, and the wood
         * staying in stock keeps the parent's. Feedback 6 item 16: "Le bundle client
         * devient 314000-13-1 et le bundle qui retourne en inventaire garde son
         * numéro". This was the other way round until 2026-09-15, verified on
         * IA-CWP-729 where the customer shipped as `314000-13` and `314000-13-B`
         * stayed behind.
         *
         * It is also the better of the two for the tally. A lot's supplier tally is
         * keyed on its name, so under the old direction the wood that REMAINS -- the
         * wood a trader will be asked to sell next -- was renamed into a number no
         * capture record has ever described, while the piece about to leave kept the
         * matrix. Now the identity stays with the stock.
         *
         * ⚠️ `lot: 'child'` on the customer line is what forces the sales order's
         * inventory assignment to be rewritten; see `trueUpSalesOrderLine`. With one
         * of the two quantities at zero there is nothing to divide, so no child is
         * minted at all and the surviving piece simply keeps the parent name.
         */
        const divides = customerQty > 0 && remainderQty > 0;
        if (customerQty > 0) {
            lines.push({
                role: 'customer', qty: customerQty, unitCost: newUnitCost,
                expectedAmount: round2(customerQty * newUnitCost),
                lot: divides ? 'child' : 'parent',
            });
        }
        if (remainderQty > 0) {
            lines.push({
                role: 'remainder', qty: remainderQty, unitCost: newUnitCost,
                expectedAmount: round2(remainderQty * newUnitCost), lot: 'parent',
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
    /**
     * `<parent>-1`, then `-2`, walking past every sibling name already taken.
     *
     * Feedback 6 item 16 settles the convention: "Le bundle client devient
     * 314000-13-1". It is Marc-Antoine's own shape, not a new one. Measured
     * 2026-09-15, 14 lots at the three hardwood locations already read
     * `<PO>-<bundle>-<n>` -- `314683-10-1`, `315690-3-1/-2/-3`, `310661-16-2` --
     * and every one was created by him, through inventory adjustments IA-CWP-610,
     * -647 and -726. The letter ladder it replaces matched nothing anyone writes.
     *
     * ⚠️ Those 14 are all stock-IN (every quantity positive), so in his hand-entered
     * data the suffix means "sub-bundle received" and here it will mean "piece cut
     * off by a split". One shape, two histories. That is his call and he has made
     * it; recorded here because the name alone no longer says which happened.
     *
     * Collisions are not the risk: `takenNames` is every sibling already on the
     * item, so a received `315690-7-1` simply pushes a split to `-2`.
     */
    /**
     * How far a measured total may sit from the stored on-hand before a split is
     * refused outright. See the ceiling in `revalidate`.
     *
     * 0.25 is deliberately loose: it exists to stop a digit being dropped or a
     * bundle being measured twice, not to police a tally. The six real splits this
     * code has made range from 0% to 3%; the one that went wrong was 58%.
     */
    const SPLIT_VARIANCE_CEILING = 0.25;

    const nextChildLotNumber = (parentName, takenNames) => {
        const taken = new Set((takenNames || []).map((n) => String(n).trim()));
        for (let i = 1; i <= 99; i++) {
            const candidate = parentName + '-' + i;
            if (!taken.has(candidate)) return candidate;
        }
        throw new Error(
            'Cannot name a child lot for ' + parentName +
            ': -1 through -99 are all taken. This needs the naming convention settled.'
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
        /*
         * 🔴 THE CALLER CHOOSES WHICH WOOD GETS CUT, so the line has to agree.
         *
         * `lotId` and `locationId` arrive in the request body and were read straight
         * into `readLotState` without ever being compared to the line they are being
         * written against. The file already makes this argument for the shipped and
         * billed guards a few lines above -- "a stale browser tab, a retry or any
         * other caller can still submit one, the refusal belongs at the write" -- and
         * it was not applied to the two identifiers that decide which bundle is split.
         *
         * Wrong lot: the adjustment cuts and renames an unrelated bundle, then the
         * repoint finds no matching assignment and throws with the wood already moved.
         * Wrong location: the adjustment posts at one location while the order ships
         * from another, and the repoint matches on lot id alone so it happily points
         * the line at stock that is somewhere else.
         */
        const lineLocation = so.getSublistValue({ sublistId: 'item', fieldId: 'location', line: lineIndex });
        if (String(lineLocation || '') !== String(input.locationId || '')) {
            throw new Error('That order line ships from location ' + (lineLocation || 'none') +
                            ', not ' + input.locationId + '. Nothing was adjusted.');
        }
        /*
         * ⚠️ Joined on `tl.id = ia.transactionline` and filtered on `tl.uniquekey`.
         * Those are two different numbers: on SO-CWP-001346 the line is id 1 and
         * unique key 523734, and `inventoryassignment.transactionline` references the
         * ID. Filtering the assignment table directly on the unique key finds nothing
         * and would have read as "this line reserves no lots", which passes.
         */
        const reserved = query.runSuiteQL({
            query: 'SELECT DISTINCT ia.inventorynumber AS lotid ' +
                   'FROM inventoryassignment ia ' +
                   'JOIN transactionline tl ON tl.transaction = ia.transaction AND tl.id = ia.transactionline ' +
                   'WHERE ia.transaction = ? AND tl.uniquekey = ?',
            params: [input.soId, input.lineUniqueKey],
        }).asMappedResults();
        /*
         * 🔴 A line that reserves NO bundle is refused too (round-2 review,
         * 2026-09-22). This was `reserved.length && ...`, so a line with zero
         * assignments accepted ANY lotId at that location: a crafted POST, now
         * reachable by a real warehouse role, could cut unrelated wood. The queue
         * already marks such lines lotMissing and the screen will not send them,
         * so the only request this refuses is one the screen never makes. Also the
         * F8 plan's step 2.4b, for the pre-arrival reservation case.
         */
        if (!reserved.length) {
            throw new Error('That order line does not reserve any bundle, so there is nothing to split. ' +
                            'Assign the bundle on the Sales Order first. Nothing was adjusted.');
        }
        if (!reserved.some((r) => String(r.lotid) === String(input.lotId))) {
            throw new Error('That order line does not reserve lot ' + input.lotId +
                            ', so splitting it would cut a bundle the order has not asked for. ' +
                            'Nothing was adjusted.');
        }

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
        const stamped = so.getSublistValue({ sublistId: 'item', fieldId: F_SPLIT_INVADJ, line: lineIndex });
        if (statusText === STATUS_DONE) {
            return { alreadyDone: true, inventoryAdjustmentId: stamped, so: so, lineIndex: lineIndex };
        }
        /*
         * 🔴 IN PROGRESS IS A REFUSAL, not a state to resume from. Something already
         * claimed this line, so either a split is posting right now or one stopped
         * part-way and the wood may have moved. Running it again is the one outcome
         * that cannot be undone from here.
         */
        if (statusText === STATUS_INPROGRESS) {
            throw new Error(
                'This bundle is already being split' + (stamped ? ' (adjustment ' + stamped + ')' : '') +
                '. If nothing is running, the last attempt stopped part-way and the wood may already ' +
                'have moved: check the lot in NetSuite, correct the order line by hand, and set the ' +
                'split status back to Pending or on to Done. Nothing was adjusted.'
            );
        }
        /*
         * A status this code does not know is not a Pending line. The list gained a
         * third value on 2026-09-16 and could gain a fourth; refusing an unknown is
         * how that stays safe without this file being edited again.
         */
        if (statusText && statusText !== STATUS_PENDING) {
            throw new Error('That order line has a split status of "' + statusText + '", which is not ' +
                            'a job this screen can run. Nothing was adjusted.');
        }
        /*
         * 🔴 AN ADJUSTMENT WITHOUT A DONE STATUS is a split that posted and then
         * failed to finish, not a split waiting to happen. The wood is already
         * divided, so re-running would divide the REMAINDER and post a second
         * adjustment. Refuse, and name the adjustment so somebody can go and look.
         */
        if (stamped) {
            throw new Error(
                'Inventory adjustment ' + stamped + ' has already split this bundle, but the order line ' +
                'was never finished. Re-running would split the remainder a second time. Open that ' +
                'adjustment, correct the order line by hand, and set the split status to Done.'
            );
        }

        const lot = readLotState(input.lotId, input.locationId);
        // The lot must be the LINE's item. readLotState never compared them, so
        // with the reservation check above as the only link, a mis-assigned lot of
        // another item would be split and the order trued up against it.
        const lineItemId = String(so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: lineIndex }) || '');
        if (lineItemId && String(lot.itemId) !== lineItemId) {
            throw new Error('Lot ' + lot.lotName + ' is a different item from that order line, so ' +
                            'splitting it would move the wrong wood. Nothing was adjusted.');
        }
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

        /*
         * 🔴 A CEILING ON THE MEASURED TOTAL, and nothing else provides one.
         *
         * A re-tally is expected to disagree with the stored figure; that is the
         * point of measuring. It is not expected to disagree by half a bundle. The
         * adjustment issues the WHOLE lot and receives the measured pieces back, so
         * a wrong total does not error, it silently destroys or invents wood.
         *
         * ⚠️ `verifyAdjustmentGl` cannot catch this and never could: `planSplitCost`
         * sets the new unit cost to openingValue / totalAfter, so the GL nets to zero
         * for ANY total. It reports "GL conserved" while the board feet vanish.
         *
         * It has already happened. IA-CWP-731, posted by this code 2026-09-15,
         * issued 1,348 BF of Purpleheart and received back 300 + 270 = 570. **778 BF,
         * 58% of the bundle, gone**, with the unit cost more than doubling to absorb
         * the value. Every other split this code has made sits between 0 and 3%:
         * IA-CWP-683 +117, -729 -5, -730 +6, -732 0, -733 +19, -734 +15.
         *
         * The tolerance is generous on purpose. This refuses the fat finger, not the
         * honest variance, and the screen already shows a variance badge well below
         * it.
         */
        const measuredTotal = input.customerQty + (input.remainderQty || 0);
        const onHandDisplay = toDisplay(lot.storedQty, rate);
        if (onHandDisplay > 0) {
            const drift = Math.abs(measuredTotal - onHandDisplay) / onHandDisplay;
            if (drift > SPLIT_VARIANCE_CEILING) {
                throw new Error(
                    'The measured total (' + measuredTotal + ') is ' +
                    Math.round(drift * 100) + '% away from what lot ' + lot.lotName +
                    ' holds (' + onHandDisplay + '). A re-tally does not move a bundle by that ' +
                    'much, so nothing was adjusted. Re-measure, or correct the lot in NetSuite ' +
                    'first if the stored figure is the wrong one.'
                );
            }
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

        /*
         * Driven off `line.lot`, which is the plan's own word for which side keeps
         * the parent's identity, rather than off the role. Since item 16 the two no
         * longer coincide -- the CUSTOMER's piece is the child -- and reading the
         * role here is exactly how they would drift apart again.
         */
        /*
         * The plan decides which side is the child from its own copy of the
         * quantities, and the caller decides whether to mint a name from its own.
         * If those two ever disagree the adjustment either mints a lot the order
         * never points at, or receives the customer's wood into a name that does
         * not exist. Cheap to check, impossible to notice otherwise.
         */
        const childLines = plan.lines.filter((l) => l.lot === 'child').length;
        if (childLines !== (childLotName ? 1 : 0)) {
            throw new Error('Refusing to post: the cost plan has ' + childLines + ' child line(s) but ' +
                            (childLotName ? 'one child lot name was minted' : 'no child lot name was minted') +
                            '. Nothing was adjusted.');
        }

        plan.lines.forEach((line) => {
            const lotRef = line.role === 'issue'
                ? { issueId: v.lot.lotId }
                : (line.lot === 'child'
                    ? { receipt: childLotName }
                    // The parent lot by NAME, not by id: a receipt takes a name,
                    // and this one already exists, so NetSuite attaches to it
                    // rather than minting a second lot with the same number.
                    : { receipt: v.lot.lotName });
            addLine(adj, v, input, line.qty, lotRef, line.unitCost);
        });

        const id = adj.save({ enableSourcing: true, ignoreMandatoryFields: false });
        log.audit('ARCH Split', 'Inventory Adjustment ' + id + ' created for ' + v.lot.lotName +
                  ' -> ' + (childLotName || 'no child, the bundle did not divide') +
                  ' (' + plan.lines.length + ' lines: ' +
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
    /**
     * The internal id of a lot NetSuite has just minted by name.
     *
     * The adjustment creates the child by passing a NAME to `receiptinventorynumber`,
     * which is the only way to mint one, so nothing hands back an id. The sales order
     * needs the id, and a name is unique per item rather than globally -- 359 lot
     * names in this account repeat across items -- so the item is part of the lookup.
     */
    let childLotNameForLookup = null;
    const lotIdFromAdjustment = (adjustmentId, parentLotId) => {
        /*
         * 🔴 READ THE ASSIGNMENT TABLE, NOT THE RECORD. The first version of this
         * walked the saved adjustment's subrecords and did
         * `Number(getSublistValue('receiptinventorynumber'))`. That field does not
         * hold an id: `issueinventorynumber` is an id reference and
         * `receiptinventorynumber` is a bare STRING holding the lot NAME, which is
         * how NetSuite lets it mint a lot that does not exist yet. Measured on
         * adjustment 128223: line 1 reads `"315643-6"`, line 2 `"315643-6-B"`.
         *
         * So `Number('314000-13-1')` was NaN, both receipts were skipped, and this
         * threw on EVERY split that divides -- after the adjustment had committed.
         * Nic's own production script guards the same field the same way
         * (`MSL_SUE_itemReceiptCloseSourcePO.js`: never treat a value from
         * `receiptinventorynumber` as an id, even when it is all digits).
         *
         * Worse than the throw: a purely numeric lot name PARSES. This account has
         * lots `12345` and `12345-1` on one PO line, so the parent's own receipt row
         * could come back as a number, compare unequal to the parent id, and be
         * returned as the child -- repointing a customer's order at whatever record
         * happens to hold that internal id.
         *
         * `inventoryassignment.inventorynumber` is the internal id and is exposed to
         * SuiteQL. Verified on IA-CWP-729: 49813 for `314000-13` and 51539 for
         * `314000-13-B`.
         */
        const rows = query.runSuiteQL({
            query: 'SELECT DISTINCT ia.inventorynumber AS lotid ' +
                   'FROM inventoryassignment ia ' +
                   'WHERE ia.transaction = ? AND ia.inventorynumber <> ?',
            params: [adjustmentId, parentLotId],
        }).asMappedResults();
        if (rows.length === 1) return Number(rows[0].lotid);

        /*
         * A miss here is the post-creation search lag this account has shown before,
         * so the name lookup is the FALLBACK rather than the primary. More than one
         * is not a lag, it is an adjustment with a shape this code did not build, and
         * guessing which lot the customer's wood is in is not a thing to guess at.
         */
        if (rows.length === 0 && childLotNameForLookup) {
            const byName = query.runSuiteQL({
                query: 'SELECT id FROM inventorynumber WHERE inventorynumber = ?',
                params: [childLotNameForLookup],
            }).asMappedResults();
            if (byName.length === 1) return Number(byName[0].id);
        }
        throw new Error('Adjustment ' + adjustmentId + ' posted but ' +
                        (rows.length ? 'carries ' + rows.length + ' new lots, not one' :
                                       'carries no new lot to point the order at') +
                        '. The wood has moved; the order has not.');
    };

    /**
     * Makes the order's reservation match what the warehouse actually measured and
     * where it actually is: Feedback 6 items 17 and 16, which are one write.
     *
     * 🔴 THE QUANTITY, ALWAYS. Item 17: "Le BF sur la ligne se modifie bien, par
     * contre dans le INV detail c'est toujours l'ancienne valeur." The line was
     * trued up to the measured figure while the assignment kept the ordered one, so
     * the difference reserved nothing at all. Measured 2026-09-15: 9 split-linked
     * lines disagree, 297 BF, and the ARCH cache derives `reserve` from
     * `inventoryassignment`, so that wood reads as available to sell twice.
     *
     * 🔴 THE LOT, WHEN ONE WAS MINTED, and this is the whole cost of renaming the
     * customer's piece.
     * Until item 16 the customer's portion was received back into the PARENT lot, so
     * the assignment the order already carried stayed true and only the quantity
     * moved. Now that piece lives in a new lot and the parent holds the remainder,
     * so an order left pointing at the parent would reserve wood that is no longer
     * there -- an over-commitment against the remainder, silently.
     *
     * ⚠️ DISPLAY units here. An Inventory Adjustment's assignment quantity is BASE
     * and a Sales Order's is DISPLAY; they are the same field name on two record
     * types and the codebase has been caught by that four times. See the note in
     * `archOrderCreate.js` beside the same write.
     */
    const syncAssignment = (so, line, v, input, childLotName, adjustmentId) => {
        /*
         * GUARDED, the way `archOrderCreate` guards the same call. `inventorydetail`
         * is documented in that file as materialising only once a line is SAVED, and
         * this one always runs against a loaded order, so the throw should not
         * happen. "Should not" is the reason to catch it rather than the reason not
         * to: an exception here lands after the adjustment has posted, and it would
         * walk straight past the decision below about what is safe to leave behind.
         */
        let detail;
        try {
            detail = so.getSublistSubrecord({
                sublistId: 'item', fieldId: 'inventorydetail', line: line,
            });
        } catch (e) {
            if (childLotName) {
                throw new Error('The adjustment posted but the order line has no readable inventory ' +
                                'detail, so it cannot be pointed at ' + childLotName + ' (' +
                                (e.message || String(e)) + '). The wood has moved; the order has not.');
            }
            log.error('ARCH Split — reservation left stale',
                'Order line for ' + input.soTranId + ' has no readable inventory detail (' +
                (e.message || String(e)) + '), so its reserved quantity still reads the ordered ' +
                'figure rather than the measured ' + input.customerQty + '. The line is being ' +
                'marked Done because the wood really was split. Correct the reservation by hand.');
            return null;
        }
        // STANDARD-mode subrecord API: `selectNewLine`/`commitLine` are dynamic-only
        // and fail here as a bare TypeError that reads like a missing subrecord.
        const count = detail.getLineCount({ sublistId: 'inventoryassignment' });

        /*
         * COUNT FIRST, WRITE SECOND. Deciding while writing means the decision to
         * refuse arrives after the record has already been changed, and on the path
         * that only logs, those changes would be saved -- two assignments each
         * holding the full customer quantity, which is the opposite of the fix.
         */
        const matches = [];
        for (let i = 0; i < count; i++) {
            const at = Number(detail.getSublistValue({
                sublistId: 'inventoryassignment', fieldId: 'issueinventorynumber', line: i,
            }));
            if (at === Number(v.lot.lotId)) matches.push(i);
        }

        /*
         * The response differs by case because the damage does.
         *
         * With a child minted, an order still pointing at the parent reserves wood
         * that is not there, and an ambiguous line would be pointed at the wrong lot;
         * neither can be left, so both refuse before anything is written.
         *
         * Without one, the only thing at stake is the stale quantity item 17 is
         * about. Stranding a posted adjustment over that is the worse trade, so it is
         * recorded and the line quantity is still corrected.
         */
        /*
         * 🔴 `count`, NOT JUST `matches`. Counting only the assignments that name the
         * split lot let a line carrying that lot AND A DIFFERENT ONE through with
         * `matches.length === 1`. The repoint then set the line quantity and the
         * parent's assignment to the customer figure and left the other lot's
         * assignment untouched, so the assignments summed to more than the line and
         * `so.save()` failed -- after the adjustment had committed.
         */
        if (matches.length !== 1 || count !== 1) {
            const why = matches.length === 0
                ? 'reserves no quantity from ' + v.lot.lotName
                : (count !== 1
                    ? 'reserves ' + count + ' lots, so correcting one of them would leave the ' +
                      'assignments summing to more than the line'
                    : 'reserves ' + v.lot.lotName + ' on ' + matches.length + ' separate assignments');
            if (childLotName) {
                throw new Error('The adjustment posted but the order line ' + why +
                                ', so it cannot be pointed at ' + childLotName +
                                '. The wood has moved; the order has not.');
            }
            /*
             * ERROR, not audit. This is not a per-run condition -- the rule in this
             * file is level by CAUSE -- and it leaves a record needing a human: the
             * line is about to be marked Done, so the screen will show the job
             * finished while the reservation still reads the ordered figure. Nothing
             * else will ever point at it.
             */
            log.error('ARCH Split — reservation left stale',
                'Order line for ' + input.soTranId + ' ' + why + ', so its inventory detail was ' +
                'left alone and still reserves the ordered figure rather than the measured ' +
                input.customerQty + '. The line is being marked Done because the wood really was ' +
                'split. Correct the reservation by hand.');
            return null;
        }

        const i = matches[0];
        // The lot moves only when a child was minted. The QUANTITY moves every time:
        // that is Feedback 6 item 17.
        childLotNameForLookup = childLotName;
        const childId = childLotName ? lotIdFromAdjustment(adjustmentId, v.lot.lotId) : null;
        if (childId) {
            detail.setSublistValue({
                sublistId: 'inventoryassignment', fieldId: 'issueinventorynumber',
                line: i, value: childId,
            });
        }
        detail.setSublistValue({
            sublistId: 'inventoryassignment', fieldId: 'quantity',
            line: i, value: input.customerQty,
        });
        return childId;
    };

    /**
     * Records WHICH adjustment divided this line, before anything else can fail.
     *
     * Deliberately writes nothing but the one field: not the quantity, not the
     * status. A half-finished split must not look finished, and the status is what
     * the screen and `revalidate` both read to decide there is work left.
     */
    /** Writes one status onto the split line and saves. Nothing else changes. */
    const setLineStatus = (input, statusText) => {
        const so = record.load({ type: record.Type.SALES_ORDER, id: input.soId, isDynamic: false });
        const line = so.findSublistLineWithValue({
            sublistId: 'item', fieldId: 'lineuniquekey', value: String(input.lineUniqueKey),
        });
        if (line === -1) throw new Error('The Sales Order line vanished before the split could start.');
        so.setSublistText({ sublistId: 'item', fieldId: F_SPLIT_STATUS, line: line, text: statusText });
        so.save({ enableSourcing: false, ignoreMandatoryFields: true });
    };

    /**
     * Takes the line, or refuses the split.
     *
     * A failure here is a GOOD outcome: it means the claim could not be recorded, so
     * no wood has moved and the job is still exactly where it was.
     */
    const claimLine = (input) => {
        try {
            setLineStatus(input, STATUS_INPROGRESS);
        } catch (e) {
            throw new Error('This split could not be claimed, so nothing was adjusted (' +
                            (e.message || String(e)) + '). Try again; if it keeps failing the order ' +
                            'is locked or has changed underneath the queue.');
        }
    };

    const stampAdjustmentOnLine = (input, adjustmentId) => {
        const so = record.load({ type: record.Type.SALES_ORDER, id: input.soId, isDynamic: false });
        const line = so.findSublistLineWithValue({
            sublistId: 'item', fieldId: 'lineuniquekey', value: String(input.lineUniqueKey),
        });
        if (line === -1) throw new Error('The Sales Order line vanished right after the adjustment posted.');
        so.setSublistValue({ sublistId: 'item', fieldId: F_SPLIT_INVADJ, line: line, value: adjustmentId });
        so.save({ enableSourcing: false, ignoreMandatoryFields: true });
    };

    const trueUpSalesOrderLine = (v, input, adjustmentId, childLotName) => {
        const so = record.load({ type: record.Type.SALES_ORDER, id: input.soId, isDynamic: false });
        const line = so.findSublistLineWithValue({
            sublistId: 'item', fieldId: 'lineuniquekey', value: String(input.lineUniqueKey),
        });
        if (line === -1) throw new Error('The Sales Order line vanished between the adjustment and the true-up.');

        /*
         * THE LINE FIRST, THEN ITS DETAIL. Both go out in one save, but a subrecord
         * is fetched from the line it hangs off, and changing that line's quantity
         * after the subrecord has been edited is the order most likely to have the
         * edit rebuilt underneath it. Nothing here depends on the reverse.
         */
        so.setSublistValue({ sublistId: 'item', fieldId: 'quantity',       line: line, value: input.customerQty });

        /*
         * 🔴 ALWAYS, not only when the bundle divided. Feedback 6 item 17: "Le BF sur
         * la ligne se modifie bien, par contre dans le INV detail c'est toujours
         * l'ancienne valeur." The line was trued up to the MEASURED figure and the
         * reservation was left holding the ordered one, so the difference reserved
         * nothing. Measured 2026-09-15: 9 split-linked lines disagree, 297 BF in
         * total, and two of them were raised after the defect was first written up.
         *
         * The case that needs it most is the one item 16's repoint does NOT cover: a
         * bundle sold whole after re-measuring mints no child, so the lot does not
         * move, and the measurement is the only thing that changed. SO-CWP-001373,
         * the 172 BF row above, is one of those.
         */
        syncAssignment(so, line, v, input, childLotName, adjustmentId);
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
            /*
             * FROM THE ORDER, never from the caller. The doc block above says
             * subsidiary, account and department are all read here and whatever the
             * caller sends is ignored; that was true of the first two and false of
             * this one, which the caller won. It drives the Trading Softwood /
             * Trading Hardwood reporting split.
             */
            departmentId: rows[0].departmentid,
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

        /*
         * A child is minted only when the bundle actually DIVIDES.
         *
         * There is exactly ONE such case, not two: a bundle sold whole, remainder 0,
         * after the warehouse re-measured it. `revalidate` refuses a customer
         * quantity of zero outright, so `customerQty > 0` is always true here and
         * this condition is `remainderQty > 0` in substance. It is written out in
         * full anyway, because it mirrors `divides` in `planSplitCost` and the two
         * must agree: disagreeing mints a lot the order never points at.
         *
         * ⚠️ An earlier version of this comment claimed a second case, "a pure
         * re-measure (customer 0)". That cannot happen and the claim was used to
         * justify the shape of the code.
         */
        const divides = input.customerQty > 0 && input.remainderQty > 0;
        const childLotName = divides
            ? nextChildLotNumber(v.lot.lotName, v.lot.siblings)
            : null;
        /*
         * 🔴 CLAIM THE LINE BEFORE ANY STOCK MOVES, and refuse if the claim does not
         * land.
         *
         * This is the lock, and it is the only thing that makes a second run
         * impossible rather than merely discouraged. Everything that came before it
         * -- the adjustment id stamped afterwards, the error text asking a worker not
         * to try again -- reads the same status that a concurrent request has already
         * read, so two posts could both see Pending and both cut the bundle.
         *
         * ⚠️ The order matters more than the mechanism. Claim, then post: a crash in
         * between leaves a job marked In progress that a human has to look at, which
         * is a nuisance. Post, then claim: a crash in between leaves a bundle that
         * has been cut and looks untouched, which is a second cut. For inventory the
         * nuisance is the correct failure.
         *
         * Not best effort. If the claim cannot be written, nothing is posted at all.
         */
        claimLine(input);

        let adjustmentId;
        try {
            adjustmentId = postSplitAdjustment(v, input, childLotName);
        } catch (e) {
            /*
             * The claim outlived the thing it was protecting. Release it so the job
             * goes back on the queue rather than needing a hand: nothing was posted,
             * which is exactly the case where a retry is safe.
             */
            try {
                setLineStatus(input, STATUS_PENDING);
            } catch (e2) {
                log.error('ARCH Split — claim left standing',
                    'The adjustment failed for ' + input.soTranId + ' and the claim could not be ' +
                    'released (' + (e2.message || String(e2)) + '). Nothing was posted, so this line ' +
                    'is safe to set back to Pending by hand.');
            }
            throw e;
        }

        /*
         * The adjustment id, recorded now that there is one. The CLAIM above is what
         * stops a re-run; this is what tells a human WHICH adjustment to go and look
         * at, so it stays best effort: losing it costs traceability, not safety.
         */
        try {
            stampAdjustmentOnLine(input, adjustmentId);
        } catch (e) {
            log.error('ARCH Split', 'Adjustment ' + adjustmentId + ' posted but could not be stamped on the ' +
                      'order line, so the In progress line will not name it: ' + e.message);
        }

        let salesOrderId;
        try {
            salesOrderId = trueUpSalesOrderLine(v, input, adjustmentId, childLotName);
        } catch (e) {
            log.error('ARCH Split', 'Adjustment ' + adjustmentId + ' posted but the Sales Order true-up failed: ' + e.message);
            /* Tagged, not just worded (round-2 review, 2026-09-22). The Suitelet's
               expected-refusal regex matched "already" in this text and answered
               CONFLICT, and the screen then told the worker "Nothing was saved"
               about a split that HAD posted, while the line dropped out of the
               queue as In progress. `posted` + the id make it its own case. */
            const posted = new Error(
                'The bundle was split (adjustment ' + adjustmentId + ') but the Sales Order could not be updated: ' +
                e.message + ' The line is marked In progress and will not run again until somebody ' +
                'corrects it, which is deliberate: the wood has already moved.'
            );
            posted.posted = true;
            posted.inventoryAdjustmentId = adjustmentId;
            throw posted;
        }

        /*
         * 🔴 CORRECTED 2026-09-14. This block used to say "there is no ARCH cache
         * to refresh. The MR, the cache keys and the saved searches are all still
         * to be built (Track C)". That is FALSE and has been for some time:
         * `mcgi_mr_trader_screen_cache_arch.js` is ~3,000 lines, reads tallies at
         * :1006-1140, and its deployment is live on a self-rescheduling hourly
         * chain. Anyone planning work from the old wording was planning against a
         * system that does not exist.
         *
         * ⚠️ AND DO NOT PUT A TALLY HOOK HERE. This point is AFTER the true-up,
         * which RETHROWS at :762-766. So this block does not run on the one path
         * that matters most: the inventory adjustment has already committed at
         * :583, the lots really have moved, and the parent's tally is really
         * wrong, but the true-up failed and execution never reaches this line.
         *
         * The tally staleness is DERIVED, not written. The cache MR compares each
         * lot's most recent inventory adjustment against its capture record's
         * `lastmodified`, so a split needs no hook at all here and no write to
         * anybody else's record. See the ARCH split-to-tally plan.
         *
         *   Tag hook — bundle-tag PDF generation is the adjacent BT7 workstream.
         *   Emitting an event nothing consumes would be dead code that looks
         *   finished. Still a real gap, left on purpose rather than stubbed.
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
