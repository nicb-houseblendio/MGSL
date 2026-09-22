/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description CWP ARCH bundle split — the warehouse queue, read side.
 *
 * Returns the sales order lines a trader has flagged as splits and the warehouse
 * has not yet completed, shaped exactly as the warehouse screen's `ArchSplitJob`
 * expects: one entry per sales order, with its bundles nested.
 *
 * Read-only. The completion write lives in archSplitExecute.
 *
 * ── What defines the queue ──────────────────────────────────────────────────
 * `custcol_mgsl_split = T` AND split status is Pending. Status is compared by
 * TEXT rather than by internal id because the SDF custom list's value ids are not
 * known at deploy time — the same reason the MTL cache filters hold status in JS.
 *
 * A Pending line is also what holds the bundle: there is no separate hold record.
 * So this query and the availability rule read the same flag, and cannot drift
 * apart the way two records would.
 *
 * ── AND the order must be marked Ready to Build ─────────────────────────────
 * Added 2026-09-11, from Marc-Antoine directly (Feedback 5 call, 2026-09-10):
 * "il faudrait que le split s'envoie juste quand le SO est ready to build" — a
 * trader can flag a split while the order is still being built, and the warehouse
 * must not see it until the order is actually ready. `custbody_arch_ready_to_build`
 * (see `F_READY_TO_BUILD` in `archOrderCreate.js`) is read in its OWN isolated,
 * try-caught query rather than joined into `fetchRows()`.
 *
 * 🔴 CORRECTED 2026-09-14. This note used to say the field "does not exist in
 * this account yet". It DOES: `custbody_arch_ready_to_build` is internal id 14083,
 * a BODY field, and it is in use — 2 sales orders read T and 8 read F today. The
 * claim was true when written on 2026-09-11 and was never revisited.
 *
 * The isolated query stays anyway, and the reason is now the honest one: this file
 * has to keep working against an account where the field is absent (production has
 * never had it), and joining it into `fetchRows()`'s single big query would take
 * the ENTIRE queue down the moment that column does not exist, for every trader
 * and every order, not only the ones this gate is about. Same reasoning as
 * `archOrderCreate.js` guarding every write to it with `setIfPresent`.
 *
 * The gate FAILS CLOSED: an order is excluded unless it is affirmatively read as
 * Ready to Build, both when it explicitly reads false/blank and when the field
 * cannot be read at all (not yet created, or a query error). Failing open would
 * reproduce exactly the bug being fixed — the warehouse seeing unfinished work —
 * the moment the field's absence causes a lookup miss. `counts.readyToBuildKnown`
 * says whether the gate could actually be evaluated (false when the field itself
 * is unavailable), and `counts.notReadyToBuild` is how many otherwise-pending jobs
 * this excluded, so the warehouse screen can say WHY the queue is short rather
 * than reading as empty or broken.
 *
 * ── Units ───────────────────────────────────────────────────────────────────
 * `systemBF` is converted from the lot's stored quantity, which is the item's
 * BASE unit — MBF for Lumber, so a lot holding 2.206 reports 2206. Ovals and
 * Veneer are base-rate 1 and pass through unchanged. Everything leaving this
 * module is in DISPLAY units, matching what the screen labels.
 *
 * ── Two things deliberately left empty ──────────────────────────────────────
 * `containerNo` — there is no per-lot container attribution yet. SuiteQL exposes
 * only id, inventorynumber, item and lastmodifieddate on `inventorynumber`; the
 * container is not on the record. Nic's design carries this as an open question
 * ("derive from the packing-list lot → container mapping?"), so inventing a
 * source here would be guessing. It is a display column on the queue row, not
 * something the split depends on.
 *
 * `lotNo` may also be empty, and that matters more. It comes from the line's
 * inventory detail, and a split-flagged line without an assigned lot is a real
 * problem — the warehouse cannot know which bundle to cut. Such rows are
 * RETURNED, with `lotMissing: true`, rather than filtered out. Hiding them would
 * make a broken order look like no order at all.
 */
define(['N/query', 'N/log', './archSalesTeam'], (query, log, ArchSalesTeam) => {

    const STATUS_PENDING = 'Pending';
    /** Claimed by the split endpoint before it posts. See archSplitExecute. */
    const STATUS_INPROGRESS = 'In progress';

    /**
     * NetSuite's unit name → the canonical code the React app uses.
     * Mirrors `normalizeUnit` in react-app/src/lib/archUom.ts; keep the two in
     * step. Verified 2026-08-17 against the six ARCH SKUs: four carry "BF", the
     * veneer carries "Square Feet", the oval carries "Unit". "Linear Feet"
     * exists in the account with zero items, waiting for Decking.
     */
    const normalizeUnit = (unitName) => {
        const s = String(unitName || '').trim().toLowerCase();
        if (!s) return 'BF';
        if (s === 'bf' || s.indexOf('board') !== -1) return 'BF';
        if (s === 'sqft' || s === 'sf' || (s.indexOf('square') !== -1 && s.indexOf('feet') !== -1)) return 'SQFT';
        if (s === 'lf' || (s.indexOf('linear') !== -1 && s.indexOf('feet') !== -1)) return 'LF';
        if (s === 'unit' || s === 'units' || s === 'ea' || s === 'each') return 'UNIT';
        return 'BF';
    };

    /**
     * Must stay in step with `F_READY_TO_BUILD` in `archOrderCreate.js` — one
     * field, two files, because a read query and a record-save call cannot
     * share a constant across SDF modules without a third shared file neither
     * currently needs.
     */
    const F_READY_TO_BUILD = 'custbody_arch_ready_to_build';

    /**
     * Ready to Build per SO id, read in its OWN try-caught query — see the
     * module doc comment for why this cannot join into `fetchRows()`.
     *
     * `available: false` means the gate could not be evaluated at all (the
     * field does not exist yet, or the query failed for any other reason), as
     * distinct from `available: true` with an id simply absent from `map`
     * (read successfully, and it is not Ready to Build). The caller treats
     * both the same way — excluded — but reports them differently so the
     * warehouse screen can say WHY the queue is short.
     */
    const readyToBuildBySo = (soIds) => {
        if (!soIds.length) return { available: true, map: {} };
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT id AS soid, ' + F_READY_TO_BUILD + ' AS flag ' +
                    'FROM transaction WHERE id IN (' + soIds.map(() => '?').join(',') + ')',
                params: soIds,
            }).asMappedResults();
            const map = {};
            rows.forEach((r) => { map[String(r.soid)] = r.flag === 'T'; });
            return { available: true, map: map };
        } catch (e) {
            log.audit('ARCH Split Queue — Ready to Build unavailable',
                'custbody_arch_ready_to_build could not be read, so every pending split is being ' +
                'excluded from the queue rather than shown unfiltered: ' +
                (e.name || '') + ': ' + (e.message || String(e)));
            return { available: false, map: {} };
        }
    };

    /**
     * Per-item unit facts, fetched once for the whole queue.
     *
     * `conversionrate` is how many BASE units one stock unit is worth — 0.001 for
     * BF against an MBF base, 1 for Ovals and Veneer. `unitname` is what the item
     * is actually counted in, and it is what stops the screen labelling a veneer
     * bundle in board feet.
     */
    const unitsByItem = (itemIds) => {
        const facts = {};
        if (!itemIds.length) return facts;
        const rows = query.runSuiteQL({
            query:
                'SELECT i.id AS itemid, u.conversionrate AS rate, u.unitname AS unitname ' +
                'FROM item i LEFT JOIN unitstypeuom u ON u.internalid = i.stockunit ' +
                'WHERE i.id IN (' + itemIds.map(() => '?').join(',') + ')',
            params: itemIds,
        }).asMappedResults();
        rows.forEach((r) => {
            const rate = parseFloat(r.rate);
            facts[String(r.itemid)] = {
                // 0, NOT 1, when the rate is missing. Defaulting to 1 here would
                // hide the failure from the caller's guard: an item present in
                // this map with a plausible-looking rate reads as healthy. 0 is
                // not a usable rate, so it forces the caller to decide.
                rate: (isFinite(rate) && rate > 0) ? rate : 0,
                unit: normalizeUnit(r.unitname),
            };
        });
        return facts;
    };

    const fetchRows = () => query.runSuiteQL({
        query:
            'SELECT ' +
            '  t.id                             AS soid, ' +
            '  t.tranid                         AS sono, ' +
            '  BUILTIN.DF(t.entity)             AS customer, ' +
            // Header rep: null on every ARCH order (Team Selling). Fallback only;
            // the sublist is read separately below. See archSalesTeam.js.
            '  BUILTIN.DF(t.employee)           AS trader, ' +
            '  BUILTIN.DF(tl.location)          AS locationname, ' +
            // ISO, explicitly. A bare date column comes back formatted to the
            // running user's preference (8/17/2026), which the screen parses as
            // Invalid Date and renders as "Ships in NaNd". ArchSplitJob.shipDate
            // is documented as ISO, so convert here rather than making every
            // consumer guess a locale.
            // The native ship date. Until 2026-09-22 this read
            // custbody_mgsl_expectedshipdate, which is null on 34 of 34 ARC orders
            // (the field is not on the SO record), so every job fell back to its
            // TRANSACTION date and the "Ships in N d" pill counted from the day the
            // order was entered. The order wizard now writes `shipdate` too.
            "  TO_CHAR(t.shipdate, 'YYYY-MM-DD')                       AS shipdate, " +
            "  TO_CHAR(t.trandate, 'YYYY-MM-DD')                       AS trandate, " +
            '  tl.id                            AS lineid, ' +
            '  tl.linesequencenumber            AS lineno, ' +
            '  tl.uniquekey                     AS lineuniquekey, ' +
            '  tl.item                          AS itemid, ' +
            '  BUILTIN.DF(tl.item)              AS itemdescription, ' +
            '  BUILTIN.DF(i.cseg1)              AS species, ' +
            '  tl.custcol_mgsl_split_bf         AS requestedbf, ' +
            '  BUILTIN.DF(tl.custcol_mgsl_split_status) AS splitstatus, ' +
            '  inv.id                           AS lotid, ' +
            '  inv.inventorynumber              AS lotno, ' +
            '  inl.quantityonhand               AS lotstored, ' +
            '  tl.location                      AS locationid ' +
            'FROM transactionline tl ' +
            'JOIN transaction t   ON t.id = tl.transaction ' +
            'JOIN item i          ON i.id = tl.item ' +
            // 🔴 tl.id, NOT tl.linesequencenumber. This file carried the reverse,
            // with a comment asserting that joining on tl.id "produces a cartesian
            // product". It does not, and that belief has now been measured false
            // twice: across every transaction 2026-08-01..19, joining on the
            // sequence leaves 8 assignments orphaned and joining on tl.id leaves 0,
            // and 2,073 of 6,003 lines (35%) have id <> seq.
            //
            // WHY IT SURVIVED: the columns are EQUAL on a single-line order, which
            // is every order the P6 suite seeded. Shown 2026-08-20 on SO-CWP-001344,
            // second line id 6 / seq 2:
            //     join on tl.id -> lot 49840 (316027-2)  correct
            //     join on seq   -> NULL                  no bundle at all
            //
            // WHY IT MATTERS MOST HERE: this query NAMES the bundle for the
            // warehouse, and archSplitExecute splits whatever lotId it is handed.
            // A wrong lot is a real adjustment against the wrong wood; a null one
            // silently drops the job. The cache builder and archOrderCreate were
            // both corrected; this file was missed.
            'LEFT JOIN inventoryassignment ia ' +
            '       ON ia.transaction = t.id AND ia.transactionline = tl.id ' +
            'LEFT JOIN inventorynumber inv ON inv.id = ia.inventorynumber ' +
            'LEFT JOIN inventorynumberlocation inl ' +
            '       ON inl.inventorynumber = inv.id AND inl.location = tl.location ' +
            "WHERE t.type = 'SalesOrd' " +
            "  AND tl.custcol_mgsl_split = 'T' " +
            '  AND tl.mainline = \'F\' ' +
            // A cancelled line is not warehouse work. Nothing filtered this, so a
            // split flagged on a line later closed stayed in the queue and could
            // still be executed against live stock. Every other consumer of open SO
            // lines here filters it: the cache builder's buckets, the order
            // endpoint's commitment guards, the open-orders service.
            "  AND tl.isclosed = 'F' " +
            /*
             * 🔴 AND `isclosed` IS NOT ENOUGH, because it never flips on this account.
             *
             * Measured 2026-09-09: all 19 split-flagged lines read isclosed 'F',
             * including 3 sitting on BILLED (status G) sales orders. So the filter
             * above, which was added to keep finished work out of the queue, does not
             * actually do it, and the live queue was serving exactly one job and it
             * was entirely stale: SO-CWP-001346 asked the warehouse to cut 300 BF off
             * lot 315643-7, which holds 211 BF, because that wood shipped on IF1208
             * and was billed on INV-CWP-1236.
             *
             * That is not a cosmetic stale row. `archSplitExecute` would have posted
             * an inventory adjustment of +89 BF against the parent lot to reach a
             * quantity that had already left the building, INVENTING Purpleheart. The
             * negative-remainder guard does not catch it: it only fires when the
             * REMAINDER exceeds on-hand.
             *
             * Two independent conditions, because either alone leaves a hole:
             *  - the ORDER must still be open. Same exclusion list as the open-orders
             *    service, and for the same reason it excludes rather than lists: a
             *    status nobody anticipated shows up as work instead of vanishing.
             *    Both spellings, because `transaction.status` is 'G' through the REST
             *    query endpoint and 'SalesOrd:G' inside N/query, and this file runs in
             *    N/query.
             *  - the LINE must not have shipped. A partially shipped line has no
             *    business being cut either: the bundle it names is already broken up.
             */
            "  AND t.status NOT IN ('G','H','C','SalesOrd:G','SalesOrd:H','SalesOrd:C') " +
            '  AND ABS(NVL(tl.quantityshiprecv, 0)) = 0 ' +
            // ARCH scope, the fourth site (Feedback 14, 2026-09-22). The other three
            // (cache MR, service, order endpoint) scope items to subsidiary ARC;
            // this queue had no scope at all, and 32 of the 38 split-flagged lines
            // in sandbox are CWP MTL items. None reached the queue today only
            // because the status filters above happened to drop them. By NAME, via
            // BUILTIN.DF: raw i.subsidiary is NOT_EXPOSED on this tenant.
            "  AND BUILTIN.DF(i.subsidiary) = 'ARC' " +
            'ORDER BY t.tranid, tl.linesequencenumber',
    }).asMappedResults();

    /**
     * @returns {{jobs: Array, counts: Object}} jobs match ArchSplitJob[]
     */
    /* ── ⚠️ ONE BUNDLE PER ROW, AND A LINE CAN YIELD SEVERAL ────────────────────
     *
     * The query fans out: joining assignments on tl.id returns one row per LOT on
     * the line, so a line carrying two bundles produces two rows and the loop below
     * pushes two bundles. That part is arguably right -- there really are two
     * physical bundles.
     *
     * What is NOT right is that `requestedBF` comes from `custcol_mgsl_split_bf`,
     * which is a LINE-level field. It is therefore repeated on every bundle of that
     * line: a 400 BF split request against two lots reads as 400 twice, i.e. 800
     * requested against a 400 BF request. Same cartesian trap the cache builder
     * documents and handles by taking line values once per (transaction, line).
     *
     * NOT FIXED HERE ON PURPOSE. How a split request divides across two bundles is
     * a warehouse decision nobody has made -- split both? which one absorbs the
     * 400? -- and guessing it in code would bury the question. Left visible.
     *
     * REACHABILITY, measured 2026-08-20: today it cannot happen. The ARCH wizard
     * writes exactly one lot per line, so every split-flagged line has exactly one
     * assignment. It becomes reachable the moment the native SO form can flag a
     * split (todo 4.3), because a user can attach two lots by hand there.
     *
     * Until the corrected join landed this was mostly masked: joining on the
     * sequence returned NULL for 35% of lines rather than fanning out.
     */

    const getPendingSplits = () => {
        const allRows = fetchRows();
        /*
         * 🔴 A BLANK STATUS IS PENDING WORK, AND REQUIRING 'Pending' EMPTIED THE QUEUE.
         *
         * Marc-Antoine reported this on the 2026-09-21 call, at [11:06], in the same
         * breath as the Open SO tab: "je pense que les OpenSO ils se feedent pas, ils
         * sont encore sur le departement Trading Hardwood. Meme chose bundle split."
         * The Open SO half was a department-scope bug. This half is not.
         *
         * Who writes this field, measured 2026-09-22:
         *   - `archOrderCreate` sets it to Pending when IT writes a split line.
         *   - `mcgi_cs_arch_split_capture` (CLIENT, id 6498, RELEASED, allroles) treats
         *     Split Status as server-owned and REFUSES every user edit to it, on
         *     purpose: hand-setting Done on an uncut bundle holds the stock forever.
         *   - Nothing at all sets it when a trader ticks Split in the NetSuite UI.
         *
         * So a hand-ticked split has no status, and this filter dropped it. Every one
         * of the six open ARC split lines was in that state, all six created by
         * Marc-Antoine in the UI on 2026-09-18 with a real BF entered (300, 157, 600,
         * 350, 600, 350), and the queue served zero jobs.
         *
         * ⚠️ WHY THE BLANK CASE IS SAFE HERE RATHER THAN A FLOOD. Account-wide there
         * are 24 open split-flagged lines with no status, and 18 of them are stale --
         * 15 on BILLED orders and 3 past fulfilment. They are already excluded by
         * `fetchRows`, which requires the ORDER to be open and the LINE unshipped.
         * Measured: the query returns 6 rows, and all 6 are the ARC jobs. The blank
         * case adds real work only because the staleness filters sit upstream of it.
         *
         * 🔴 'Done' AND 'In progress' ARE STILL EXCLUDED, and that is the whole point
         * of not simply dropping the status filter. Done means the wood was cut.
         * In progress means a split started and stopped, so the wood may already have
         * moved and it needs a person rather than another attempt -- counted below as
         * `stuck` so the screen can say the queue is short for a reason.
         */
        const isPending = (r) => {
            const st = String(r.splitstatus || '').trim();
            return st === STATUS_PENDING || st === '';
        };
        const rows = allRows.filter(isPending);
        /*
         * CLAIMED AND NOT FINISHED. `In progress` is written before the inventory
         * adjustment is posted, so a line sitting in it is a split that started and
         * stopped: the wood may already have moved and it needs a person, not another
         * attempt. The Pending filter above drops it from the queue automatically,
         * which is right -- and silent, which is not. Counted here so the screen can
         * say the queue is short for a reason rather than just looking empty.
         */
        const stuck = allRows.filter((r) => String(r.splitstatus || '') === STATUS_INPROGRESS);
        const stuckLines = [...new Set(stuck.map((r) => String(r.sono || r.soid)))];
        const units = unitsByItem([...new Set(rows.map((r) => String(r.itemid)))].filter(Boolean));

        const bySo = {};

        const rateless = [];
        // Same second query as the open-orders tab, for the same reason: joined
        // into the line query a two-rep order would double its bundles.
        let teamRep = {};
        try {
            teamRep = ArchSalesTeam.repByTransaction(rows.map((r) => r.soid));
        } catch (e) {
            log.audit('ARCH Split Queue — sales team unavailable, header rep only',
                (e.name || '') + ': ' + (e.message || String(e)));
        }
        rows.forEach((r) => {
            // Same rule as the ARCH cache builder: a MISSING conversion rate is
            // an error, not a default of 1. Lumber's real rate is 0.001, so
            // assuming 1 under-reports a bundle by three orders of magnitude —
            // and it does so invisibly for Veneer and Ovals, which really are
            // rate 1. The row is still returned so the warehouse sees the job,
            // but with a zero system figure and a logged error, rather than a
            // confident wrong number to measure against.
            const fact = units[String(r.itemid)];
            const rate = fact ? fact.rate : 0;
            // Catches BOTH failures: the item missing from the lookup entirely,
            // and the item present with an unusable rate.
            if (!(rate > 0)) rateless.push(r.itemdescription || String(r.itemid));
            const stored = parseFloat(r.lotstored);
            const systemBF = (rate > 0 && isFinite(stored)) ? stored / rate : 0;
            const lotMissing = !r.lotno;

            if (!bySo[r.sono]) {
                bySo[r.sono] = {
                    soNo:         r.sono,
                    soId:         r.soid,
                    customer:     r.customer || '',
                    trader:       (teamRep[String(r.soid)] && teamRep[String(r.soid)].rep) || r.trader || '',
                    locationName: r.locationname || '',
                    // Fall back to the transaction date when no expected ship date is
                    // set, so the queue's urgency pill always has something to sort on
                    // rather than silently grouping every order as undated.
                    shipDate:     r.shipdate || r.trandate || '',
                    bundles:      [],
                };
            }
            bySo[r.sono].bundles.push({
                lotNo:           r.lotno || '',
                lotId:           r.lotid || null,
                lotMissing:      lotMissing,
                itemDescription: r.itemdescription || '',
                species:         r.species || '',
                containerNo:     '',
                unit:            fact ? fact.unit : 'BF',
                systemBF:        systemBF,
                requestedBF:     parseFloat(r.requestedbf) || 0,
                lineUniqueKey:   r.lineuniquekey,
                locationId:      r.locationid,
                itemId:          r.itemid,
            });
        });

        const allJobs = Object.keys(bySo).map((k) => bySo[k]);

        // Ready to Build gate — see the module doc comment. FAILS CLOSED: a job
        // is kept only when its SO is affirmatively read as Ready to Build.
        const rtb = readyToBuildBySo([...new Set(allJobs.map((j) => String(j.soId)))]);
        const jobs = rtb.available ? allJobs.filter((j) => rtb.map[String(j.soId)] === true) : [];
        const notReadyToBuildCount = rtb.available ? allJobs.length - jobs.length : allJobs.length;

        // Counted from the VISIBLE jobs, not from every pending-split row — a
        // lot-missing line on an order the Ready to Build gate just hid would
        // otherwise show a banner about a line the warehouse cannot find in
        // the table below it.
        const lotMissingCount = jobs.reduce(
            (n, j) => n + j.bundles.filter((b) => b.lotMissing).length, 0
        );

        const counts = {
            orders:      jobs.length,
            bundles:     jobs.reduce((n, j) => n + j.bundles.length, 0),
            lotMissing:  lotMissingCount,
            // How many otherwise-pending orders the Ready to Build gate excluded,
            // and whether the gate could be evaluated at all — see the module doc
            // comment. The warehouse screen uses these to say WHY the queue is
            // short rather than leaving it looking empty or broken.
            notReadyToBuild:    notReadyToBuildCount,
            readyToBuildKnown:  rtb.available,
            /*
             * Splits that were claimed and never finished. Not work the warehouse can
             * pick up: each one needs somebody to look at the lot and the order line.
             */
            inProgress:         stuckLines.length,
            inProgressOrders:   stuckLines,
        };
        if (stuckLines.length) {
            // AUDIT, not ERROR, since 2026-09-22: this is a STANDING condition logged
            // on every queue load until someone fixes the line, and the screen now
            // shows it itself ("N splits started and not finished"). The one-off
            // ERROR is written where it happens, when the true-up fails.
            log.audit('ARCH Split Queue — splits claimed and not finished',
                stuckLines.length + ' order(s) carry a line marked In progress, so a split started and ' +
                'did not complete. The wood may already have moved. They are excluded from the queue ' +
                'and need checking by hand: ' + stuckLines.join(', '));
        }
        if (rateless.length) {
            log.error('ARCH Split Queue — no conversion rate',
                rateless.length + ' bundle(s) have no usable stock-unit rate; their system quantity is ' +
                'reported as 0 rather than assumed at rate 1: ' + [...new Set(rateless)].join(', '));
        }
        if (lotMissingCount) {
            log.audit('ARCH Split Queue',
                lotMissingCount + ' split-flagged line(s) have no lot assigned; returned with lotMissing so the ' +
                'warehouse sees the order rather than nothing.');
        }
        if (notReadyToBuildCount) {
            log.audit('ARCH Split Queue — Ready to Build gate',
                notReadyToBuildCount + ' order(s) have a pending split but are not (yet, or verifiably) ' +
                'Ready to Build, so they were held back from the warehouse queue.');
        }
        return { jobs: jobs, counts: counts };
    };

    return { getPendingSplits: getPendingSplits };
});
