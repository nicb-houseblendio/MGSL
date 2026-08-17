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
                rate: (isFinite(rate) && rate > 0) ? rate : 1,
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
            // ia.transactionline is the line NUMBER, not transactionline.id. Joining
            // on tl.id produces a cartesian product.
            'LEFT JOIN inventoryassignment ia ' +
            '       ON ia.transaction = t.id AND ia.transactionline = tl.linesequencenumber ' +
            'LEFT JOIN inventorynumber inv ON inv.id = ia.inventorynumber ' +
            'LEFT JOIN inventorynumberlocation inl ' +
            '       ON inl.inventorynumber = inv.id AND inl.location = tl.location ' +
            "WHERE t.type = 'SalesOrd' " +
            "  AND tl.custcol_mgsl_split = 'T' " +
            '  AND tl.mainline = \'F\' ' +
            'ORDER BY t.tranid, tl.linesequencenumber',
    }).asMappedResults();

    /**
     * @returns {{jobs: Array, counts: Object}} jobs match ArchSplitJob[]
     */
    const getPendingSplits = () => {
        const rows = fetchRows().filter((r) => String(r.splitstatus || '') === STATUS_PENDING);
        const units = unitsByItem([...new Set(rows.map((r) => String(r.itemid)))].filter(Boolean));

        const bySo = {};
        let lotMissingCount = 0;

        rows.forEach((r) => {
            const fact = units[String(r.itemid)] || { rate: 1, unit: 'BF' };
            const rate = fact.rate;
            const stored = parseFloat(r.lotstored);
            const systemBF = isFinite(stored) ? stored / rate : 0;
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
                unit:            fact.unit,
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
        if (lotMissingCount) {
            log.audit('ARCH Split Queue',
                lotMissingCount + ' split-flagged line(s) have no lot assigned; returned with lotMissing so the ' +
                'warehouse sees the order rather than nothing.');
        }
        return { jobs: jobs, counts: counts };
    };

    return { getPendingSplits: getPendingSplits };
});
