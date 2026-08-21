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
define(['N/query', 'N/log'], (query, log) => {

    const STATUS_PENDING = 'Pending';

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
            '  BUILTIN.DF(t.employee)           AS trader, ' +
            '  BUILTIN.DF(tl.location)          AS locationname, ' +
            // ISO, explicitly. A bare date column comes back formatted to the
            // running user's preference (8/17/2026), which the screen parses as
            // Invalid Date and renders as "Ships in NaNd". ArchSplitJob.shipDate
            // is documented as ISO, so convert here rather than making every
            // consumer guess a locale.
            "  TO_CHAR(t.custbody_mgsl_expectedshipdate, 'YYYY-MM-DD') AS shipdate, " +
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
        const rows = fetchRows().filter((r) => String(r.splitstatus || '') === STATUS_PENDING);
        const units = unitsByItem([...new Set(rows.map((r) => String(r.itemid)))].filter(Boolean));

        const bySo = {};
        let lotMissingCount = 0;

        const rateless = [];
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
            if (lotMissing) lotMissingCount++;

            if (!bySo[r.sono]) {
                bySo[r.sono] = {
                    soNo:         r.sono,
                    soId:         r.soid,
                    customer:     r.customer || '',
                    trader:       r.trader || '',
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

        const jobs = Object.keys(bySo).map((k) => bySo[k]);
        const counts = {
            orders:      jobs.length,
            bundles:     rows.length,
            lotMissing:  lotMissingCount,
        };
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
        return { jobs: jobs, counts: counts };
    };

    return { getPendingSplits: getPendingSplits };
});
