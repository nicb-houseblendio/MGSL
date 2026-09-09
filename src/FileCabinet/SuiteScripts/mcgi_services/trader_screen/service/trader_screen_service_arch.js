/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Trader Screen service — CWP ARCH (subsidiary 9).
 *
 * Reads TS_ARCH_* keys from the shared MGSL_TRADERSCREEN_CACHE bucket,
 * populated by mcgi_mr_trader_screen_cache_arch.js.
 *
 * ⚠️ MUST expose getRouter / postRouter — that is what the RESTlet calls.
 *
 * ── Honesty about what is in the cache ──────────────────────────────────────
 * The ARCH builder fills On Hand and structurally zeroes the other five buckets
 * because no ARCH sales orders, purchase orders or transfer orders exist in the
 * account. `meta.bucketsEmpty` carries that fact to the browser so the screen
 * can say which columns are real. Serving zeros as though they were measured is
 * the failure mode to avoid — it is the same reasoning that keeps `source` on
 * the split queue hook.
 *
 * ── Filters ────────────────────────────────────────────────────────────────
 * ARCH filters on its own axes — location, species, thickness, category, grade
 * — not IND's width/length/country/vendor, and NOT container (see applyFilters).
 * Several of those segments are not populated on the hardwood items yet, so their
 * filters will legitimately match nothing; that is a data gap, not a bug here.
 */
define([
    'N/runtime', 'N/log', 'N/query',
    '../shared/cacheKeys_arch',
    '../shared/cacheClient',
    '../shared/archSalesTeam',
], (runtime, log, query, CacheKeysARCH, CacheClient, ArchSalesTeam) => {

    const getMyCache = () => CacheClient.getCache();

    const toValueList = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return value.toString().split(',').map((v) => String(v).trim()).filter(Boolean);
    };

    /**
     * Column totals, plus the distinct units that went into them.
     *
     * Board feet, square feet and pieces do not add up. The sums are computed
     * regardless and `units` reports what they span, which is what lets the
     * grid footer refuse to print a total across mixed units — the same
     * contract as `ArchTotals` on the front end.
     */
    const computeTotals = (rows) => {
        const t = {
            onHand: 0, reserve: 0, readyToBuild: 0,
            outbound: 0, onOrder: 0, inTransit: 0, available: 0,
            held: 0, heldLotCount: 0,
            units: [],
        };
        const seen = {};
        rows.forEach((r) => {
            t.onHand       += parseFloat(r.onHand)       || 0;
            t.reserve      += parseFloat(r.reserve)      || 0;
            t.readyToBuild += parseFloat(r.readyToBuild) || 0;
            t.outbound     += parseFloat(r.outbound)     || 0;
            t.onOrder      += parseFloat(r.onOrder)      || 0;
            t.inTransit    += parseFloat(r.inTransit)    || 0;
            t.available    += parseFloat(r.available)    || 0;
            t.held         += parseFloat(r.held)         || 0;
            t.heldLotCount += parseInt(r.heldLotCount, 10) || 0;
            const u = r.unit || 'BF';
            if (!seen[u]) { seen[u] = true; t.units.push(u); }
        });
        return t;
    };

    const applyFilters = (rows, params) => {
        let filtered = rows;

        if (params.location && toValueList(params.location).length > 0) {
            const locIds = toValueList(params.location).map(Number);
            filtered = filtered.filter((r) => locIds.indexOf(Number(r.locationId)) >= 0);
        }
        ['species', 'thickness', 'category', 'grade', 'grain'].forEach((field) => {
            if (params[field] && toValueList(params[field]).length > 0) {
                const vals = toValueList(params[field]);
                filtered = filtered.filter((r) => vals.indexOf(String(r[field] || '').trim()) >= 0);
            }
        });
        // `containerNo` is DELIBERATELY NOT A FILTER, removed 2026-08-19 with the
        // grid column. It was going to be fed from the lot-number prefix, and
        // Marc-Antoine confirmed that prefix is the PO number; a container can
        // also span several POs, so neither derives from the other.
        //
        // Removed rather than left as a dead branch because it fails LOUDLY in
        // the wrong direction: every lot's containerNo is empty today, so a
        // stale saved filter arriving here would match nothing and blank the
        // whole grid with no reason given. Ignoring the parameter is the honest
        // behaviour for a filter the screen no longer offers.
        // greaterThanZero: default true — hide rows with nothing in ANY bucket.
        //
        // Every bucket, not just the incoming three. A row that is entirely
        // outbound — shipped, nothing left on hand — has real activity a trader
        // needs to see, and testing only onHand/onOrder/inTransit would hide it
        // the moment outbound is populated. IND sums committed and outbound for
        // the same reason.
        if (params.greaterThanZero !== false && params.greaterThanZero !== 'false') {
            filtered = filtered.filter((r) =>
                (r.onHand || 0) + (r.reserve || 0) + (r.readyToBuild || 0) +
                (r.outbound || 0) + (r.onOrder || 0) + (r.inTransit || 0) +
                // Held stock counts as activity. A row that is entirely on hold
                // has an Available of 0, and hiding it would make the stock
                // disappear from the screen entirely — the opposite of what a
                // hold is for, which is to make it visible as unsellable.
                (r.held || 0) > 0);
        }
        return filtered;
    };

    const handleGetContext = () => {
        const user = runtime.getCurrentUser();
        return {
            success: true,
            data: {
                userId:       user.id,
                userName:     user.name,
                subsidiaryId: user.subsidiary,
                accountId:    runtime.accountId,
                // Must match ARCH_UOMS in react-app/src/lib/archUom.ts. "Native"
                // rather than "BF" because a row renders in its own item's unit.
                uomConfig: { 'CWP ARCH': ['Native (BF / SQFT / units)', 'Cubic meters (m³)'] },
            },
        };
    };

    /**
     * Is the summary ACTUALLY readable? META alone is not proof.
     *
     * SUMMARY and META are separate cache entries with separate lifetimes, so
     * they can disagree. The builder's shrink guard refreshes META on every run
     * but only rewrites SUMMARY when it accepts one; before that was fixed, a
     * repeatedly-tripping guard would let SUMMARY expire while META kept
     * claiming rows. The builder no longer does that — but a service that
     * believes META on its own would report "available, 14 rows" while the
     * summary endpoint returned CACHE_MISS, and the two answers would come from
     * the same request cycle.
     *
     * Cheap to check, so check rather than trust.
     *
     * @returns {{present: boolean, reason: string|null, rows: Array|null}}
     */
    const readSummary = (myCache) => {
        const raw = myCache.get({ key: CacheKeysARCH.SUMMARY });
        if (!raw) return { present: false, reason: 'SUMMARY_MISSING', rows: null };
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return { present: false, reason: 'SUMMARY_UNREADABLE', rows: null };
        }
        if (Array.isArray(parsed)) return { present: true, reason: null, rows: parsed };

        if (parsed && parsed.chunked && parsed.chunkCount) {
            // ⚠️ A MISSING CHUNK IS A MISS, NOT A SMALLER RESULT.
            // This loop used to skip absent chunks and return whatever it found,
            // which is silent truncation on the read side — the same failure the
            // shrink guard prevents on the write side, and harder to notice
            // because the rows that survive look perfectly valid. Chunks share
            // SUMMARY's TTL but are separate entries, so one expiring or failing
            // to write is a real scenario once chunking lands.
            const rows = [];
            for (let i = 0; i < parsed.chunkCount; i++) {
                const chunkRaw = myCache.get({ key: CacheKeysARCH.buildSummaryDataKey(i) });
                if (!chunkRaw) return { present: false, reason: 'SUMMARY_CHUNK_MISSING', rows: null };
                let chunkRows;
                try {
                    chunkRows = JSON.parse(chunkRaw);
                } catch (e) {
                    return { present: false, reason: 'SUMMARY_CHUNK_UNREADABLE', rows: null };
                }
                if (!Array.isArray(chunkRows)) {
                    return { present: false, reason: 'SUMMARY_CHUNK_UNREADABLE', rows: null };
                }
                rows.push.apply(rows, chunkRows);
            }
            return { present: true, reason: null, rows: rows };
        }
        return { present: false, reason: 'SUMMARY_UNREADABLE', rows: null };
    };

    const handleGetMeta = () => {
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysARCH.META });
            if (!raw) return { available: false, reason: 'CACHE_MISS' };
            const meta = JSON.parse(raw);

            // Cross-check. If META survived but the summary did not, the screen
            // has nothing to render, so saying "available" would be a lie that
            // the very next request contradicts. `lastUpdated` is still returned
            // so the UI can say WHEN the data it cannot show was last built,
            // rather than just failing blank.
            const summary = readSummary(myCache);
            if (!summary.present) {
                return {
                    available:   false,
                    reason:      summary.reason,
                    lastUpdated: meta.lastUpdated || '',
                    lastAttempt: meta.lastAttempt || meta.lastUpdated || '',
                    rowCount:    0,
                };
            }

            return {
                available:    true,
                cacheVersion: meta.cacheVersion,
                lastUpdated:  meta.lastUpdated,
                rowCount:     meta.rowCount,
                bucketsBuilt: meta.bucketsBuilt || [],
                bucketsEmpty: meta.bucketsEmpty || [],
                // >0 means the On Hand figures are LOW — lots exist that could
                // not be converted to display units and were excluded.
                skippedLotCount: meta.skippedLotCount || 0,
                // ⚠️ THIS OBJECT IS AN ALLOWLIST. A field added to the cached META
                // is invisible to the browser until it is named here — that has now
                // been missed twice (skippedLotCount, then shrinkGuard). If you add
                // something to the builder's META, add it here in the same commit.
                lastAttempt: meta.lastAttempt || meta.lastUpdated || '',
                // True means the last run REFUSED to update: the rows below are the
                // previously cached set, and `lastUpdated` is when they were built,
                // not when the run happened.
                shrinkGuard: meta.shrinkGuard === true,
                shrinkGuardRefused: meta.shrinkGuardRefused || 0,
                // Costing. costBook says WHICH book the money is in (1 = Primary
                // = CAD); the counts separate "nothing could be costed" from
                // "there is no stock", which an em-dash column cannot express.
                costBook:         meta.costBook || 0,
                costedRowCount:   meta.costedRowCount == null ? null : meta.costedRowCount,
                uncostedRowCount: meta.uncostedRowCount == null ? null : meta.uncostedRowCount,
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getMeta', details: e.message });
            return { available: false, reason: 'ERROR' };
        }
    };

    const handleGetSummary = (params) => {
        try {
            const myCache = getMyCache();
            const summary = readSummary(myCache);
            if (!summary.present) {
                return {
                    error: summary.reason === 'SUMMARY_MISSING' ? 'CACHE_MISS' : summary.reason,
                    message: summary.reason === 'SUMMARY_MISSING'
                        ? 'ARCH cache not populated. Run the ARCH Map/Reduce script.'
                        : 'ARCH cache is present but not readable (' + summary.reason + '). ' +
                          'Returning nothing rather than a partial set — run the ARCH Map/Reduce ' +
                          'script to rebuild.',
                };
            }
            const allRows = summary.rows;

            const filtered = applyFilters(allRows, params || {});
            const metaRaw = myCache.get({ key: CacheKeysARCH.META });
            const meta = metaRaw ? JSON.parse(metaRaw) : {};

            // Mirrors the audit line IND has carried for months, and its absence
            // here cost real time: when the browser sat on "Loading inventory
            // data…" there was no way to tell whether the request had reached
            // this service at all, because a successful ARCH call logged nothing.
            // Silence read identically to "never arrived".
            log.audit('trader_screen_service_arch.getSummary',
                'rowsInCache=' + allRows.length + ' rowsServed=' + filtered.length +
                ' metaRowCount=' + (meta.rowCount || 0) +
                ' shrinkGuard=' + (meta.shrinkGuard === true) +
                ' greaterThanZero=' + ((params || {}).greaterThanZero !== false));

            return {
                success: true,
                rows:    filtered,
                totals:  computeTotals(filtered),
                meta: {
                    lastUpdated:  meta.lastUpdated || '',
                    cacheVersion: meta.cacheVersion || 0,
                    rowCount:     filtered.length,
                    bucketsBuilt: meta.bucketsBuilt || [],
                    bucketsEmpty: meta.bucketsEmpty || [],
                    skippedLotCount: meta.skippedLotCount || 0,
                    lastAttempt: meta.lastAttempt || meta.lastUpdated || '',
                    shrinkGuard: meta.shrinkGuard === true,
                    shrinkGuardRefused: meta.shrinkGuardRefused || 0,
                    // Same allowlist rule as getMeta above — see the warning
                    // there. Added with lot costing, 2026-08-19.
                    costBook:         meta.costBook || 0,
                    costedRowCount:   meta.costedRowCount == null ? null : meta.costedRowCount,
                    uncostedRowCount: meta.uncostedRowCount == null ? null : meta.uncostedRowCount,
                },
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getSummary', details: e.message });
            return { error: 'CACHE_MISS', message: 'ARCH cache error: ' + e.message };
        }
    };

    const handleGetDetail = (params) => {
        const itemId     = params && params.itemId;
        const locationId = params && params.locationId;
        if (!itemId || !locationId) {
            return { success: false, error: 'itemId and locationId required' };
        }
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysARCH.detailKey(itemId, locationId) });
            if (!raw) {
                const buckets = ['onHand', 'reserve', 'readyToBuild', 'outbound', 'onOrder', 'inTransit'];
                const merged = {};
                let anyFound = false;
                buckets.forEach((b) => {
                    const bStr = myCache.get({ key: CacheKeysARCH.buildDetailBucketKey(itemId, locationId, b) });
                    if (bStr) { anyFound = true; merged[b] = JSON.parse(bStr); }
                });
                if (anyFound) return { success: true, data: merged };
                return {
                    error: 'DETAIL_CACHE_MISS',
                    message: 'ARCH detail not found. Try again after cache refresh.',
                };
            }
            return { success: true, data: JSON.parse(raw) };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getDetail', details: e.message });
            return { error: 'DETAIL_CACHE_MISS', message: 'ARCH detail error: ' + e.message };
        }
    };

    /**
     * The industrial companies, which ARCH does not sell to.
     *
     * "Need to filter out the industrial companies from the SO" — Lucas,
     * 2026-09-08. Subsidiary 7 is IND, legal name "CWP Industriel Inc.", and it
     * is the ONLY marker available: `customer.category` is NULL on all 807 active
     * customers, and no custom entity field for division, industry or segment
     * exists in the account (searched `customfield` for custentity% on
     * 2026-09-08; the three that match are unrelated Charted/SII fields).
     *
     * Active customers by subsidiary, measured 2026-09-08:
     *   5  CWP MTL      387
     *   7  IND          342   <- excluded
     *   21 WPRED         53
     *   1  MGSL          24
     *   2  COMMODITÉS     1
     * So this removes exactly the 342 Lucas named and leaves 465.
     */
    const INDUSTRIAL_CUSTOMER_SUBSIDIARY = 7;

    /**
     * Customers the wizard can raise an order for.
     *
     * Exists because the wizard's customer dropdown was a hardcoded list of
     * invented names, so `customerId` was always undefined and the order endpoint
     * refused every submission with "The order needs a customer".
     *
     * ── Why this is NOT scoped by the request's subsidiary ───────────────────
     * It would return an empty list. The ARCH screen calls this service with
     * subsidiaryId 9 (ARC), and measured 2026-08-20: **zero** of the 807 active
     * customers sit in subsidiary 9, while 387 sit in subsidiary 5 where the
     * hardwood actually is. Scoping on the request would therefore hide every
     * customer and look like a broken feature.
     *
     * Nor is it scoped to subsidiary 5. That would hide 420 customers on a guess
     * about who ARCH sells to, and hiding the one name a trader is looking for is
     * a worse failure than a longer list. 807 rows is a small payload and the
     * picker searches. NetSuite still refuses an order whose customer its
     * subsidiary does not permit, which is a clean failure rather than a silent
     * one.
     *
     * ⚠️ THAT REASONING IS UNCHANGED, and the IND exclusion below is not a
     * reversal of it. Scoping TO a subsidiary is a guess about who ARCH sells to;
     * excluding subsidiary 7 removes the group the CLIENT named and nothing else
     * (see INDUSTRIAL_CUSTOMER_SUBSIDIARY for Lucas's ask and the counts). 465 of
     * the 807 still come back, including WPRED, MGSL and COMMODITÉS, and a
     * customer with NO subsidiary is KEPT — the filter drops only what it can
     * prove is industrial.
     *
     * ── Why the exclusion happens here and not in the WHERE clause ──────────
     * The count of what was removed comes from the same rows that produced the
     * list, so the two cannot drift; a `WHERE c.subsidiary <> 7` would need a
     * second COUNT query to say the same thing, and SQL NULL semantics would have
     * silently dropped a subsidiary-less customer as a bonus. `excludedIndustrialCount`
     * and `totalActiveCount` travel with the response for the same reason
     * `taggedItemCount` travels with openOrders: a filter that removes more than
     * it should must not be able to look like an account with no customers.
     *
     * ── Why it is not cached ────────────────────────────────────────────────
     * One query per wizard open, against a table that changes when someone adds
     * a customer. A cache key here would need invalidating on a customer edit,
     * and this module has just finished deleting five keys that promised things
     * nothing maintained.
     *
     * `currency` and `terms` come back so the wizard can pre-fill from the
     * customer record rather than making the trader restate what NetSuite knows.
     */
    const handleGetCustomers = () => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT ' +
                    '  c.id                     AS id, ' +
                    '  c.companyname            AS companyname, ' +
                    '  c.entityid               AS entityid, ' +
                    '  c.currency               AS currencyid, ' +
                    // 🔴 The ISO CODE, not just the display name. The screen feeds
                    // this to toLocaleString({style:"currency"}), which throws
                    // RangeError on "US Dollar" and takes the whole React app down
                    // with it. `currency.symbol` is the code; BUILTIN.DF is the
                    // label. Both are returned because both are wanted, for
                    // different jobs.
                    '  cur.symbol               AS currencycode, ' +
                    '  BUILTIN.DF(c.currency)   AS currencyname, ' +
                    '  c.terms                  AS termsid, ' +
                    '  BUILTIN.DF(c.terms)      AS termsname, ' +
                    '  c.subsidiary             AS subsidiaryid, ' +
                    // The NAME, so the exclusion below can describe itself
                    // ("342 IND customers hidden") rather than carrying a
                    // hardcoded label that goes stale if the record is renamed.
                    '  BUILTIN.DF(c.subsidiary) AS subsidiaryname ' +
                    'FROM customer c ' +
                    'LEFT JOIN currency cur ON cur.id = c.currency ' +
                    "WHERE c.isinactive = 'F' " +
                    // Sorted on the DISPLAYED name, not on companyname. Sorting
                    // by companyname alone puts every record that lacks one at
                    // the top of the picker — "Anonymous Customer" and "Nordex
                    // Norway AS" ahead of "2K Wholesale Inc" — which reads as an
                    // unsorted list.
                    'ORDER BY COALESCE(c.companyname, c.entityid)',
            }).asMappedResults();

            /* Industrial companies out, and only those. A row with no subsidiary
             * at all is kept: it cannot be shown to be industrial, and hiding the
             * one name a trader is looking for is the worse failure. */
            const isIndustrial = (r) =>
                r.subsidiaryid !== null && r.subsidiaryid !== undefined &&
                String(r.subsidiaryid) === String(INDUSTRIAL_CUSTOMER_SUBSIDIARY);
            const excluded = rows.filter(isIndustrial);
            const kept = rows.filter((r) => !isIndustrial(r));
            const excludedName = excluded.length
                ? String(excluded[0].subsidiaryname || '').trim()
                : '';

            /* An exclusion that empties the picker is a DEFECT, not a quiet day,
             * and it is the one outcome nobody would report as a bug (the wizard
             * simply looks broken). ERROR only for that case: the normal
             * "342 removed" runs on every wizard open and an hourly ERROR line
             * once hid a four-day outage on this screen. */
            if (rows.length && !kept.length) {
                log.error('ARCH service — customer list emptied by the industrial filter',
                    'All ' + rows.length + ' active customers sit in subsidiary ' +
                    INDUSTRIAL_CUSTOMER_SUBSIDIARY + ' (' + (excludedName || 'IND') + '), so the ' +
                    'picker has nothing to offer. Either the exclusion is too broad or the ' +
                    'customer base moved subsidiary.');
            }

            return {
                success: true,
                customers: kept.map((r) => ({
                    id: String(r.id),
                    // companyname is blank on some records — County Line Materials
                    // LLC carries its name in entityid only — so neither field
                    // alone is a reliable label.
                    name: String(r.companyname || r.entityid || ('Customer ' + r.id)),
                    currencyId: r.currencyid ? String(r.currencyid) : null,
                    currencyCode: r.currencycode ? String(r.currencycode) : null,
                    currencyName: r.currencyname ? String(r.currencyname) : null,
                    termsId: r.termsid ? String(r.termsid) : null,
                    termsName: r.termsname ? String(r.termsname) : null,
                    subsidiaryId: r.subsidiaryid ? String(r.subsidiaryid) : null,
                })),
                /* What the filter did, so the picker can say why it is short or
                 * empty instead of implying the account has no customers. */
                totalActiveCount: rows.length,
                excludedIndustrialCount: excluded.length,
                excludedSubsidiaryId: String(INDUSTRIAL_CUSTOMER_SUBSIDIARY),
                excludedSubsidiaryName: excludedName,
            };
        } catch (e) {
            // A failed customer list must not read as "this account has no
            // customers". The screen keeps its picker disabled and says why.
            log.error('ARCH service — customer list failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return {
                success: false,
                error: 'The customer list could not be loaded: ' + (e.message || String(e)),
            };
        }
    };

    /**
     * Ship-to addresses for one customer.
     *
     * 🔴 Needed the moment customers became real. The wizard's ship-to list was a
     * fixture keyed by the fixture customer NAMES, so selecting a real customer
     * emptied it — and ship-to is a required field, which blocked the whole flow.
     * Found by clicking through the deployed screen; nothing in the types or the
     * build could have caught it.
     *
     * Per customer rather than bundled into the customer list: 3,755 address rows
     * across 778 customers would roughly quintuple that payload for data almost
     * all of which is never looked at.
     *
     * The server still resolves ship-to itself when the request omits it (see
     * `resolveShipAddress` in archOrderCreate), so this exists to let a trader SEE
     * and CHOOSE, not because the write depends on it.
     */
    const handleGetCustomerAddresses = (dataIn) => {
        const customerId = parseInt((dataIn && dataIn.customerId) || '', 10);
        if (!customerId) {
            return { success: false, error: 'customerId is required.' };
        }
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT ' +
                    // internalid = the ADDRESS BOOK entry, which is what
                    // `shipaddresslist` on a transaction takes. Passing the
                    // address id instead gets INVALID_FLD_VALUE.
                    '  ab.internalid           AS id, ' +
                    '  ab.label                AS label, ' +
                    '  ab.defaultshipping      AS defaultshipping, ' +
                    '  ab.defaultbilling       AS defaultbilling, ' +
                    '  ea.addrtext             AS addrtext, ' +
                    '  ea.city                 AS city, ' +
                    '  ea.state                AS state, ' +
                    '  ea.zip                  AS zip, ' +
                    '  ea.country              AS country ' +
                    'FROM customeraddressbook ab ' +
                    'LEFT JOIN customeraddressbookentityaddress ea ' +
                    '       ON ea.nkey = ab.addressbookaddress ' +
                    'WHERE ab.entity = ? ' +
                    'ORDER BY ab.defaultshipping DESC, ab.defaultbilling DESC',
                params: [customerId],
            }).asMappedResults();

            return {
                success: true,
                addresses: rows.map((r) => ({
                    id: String(r.id),
                    // A one-line label for a dropdown. `addrtext` is multi-line, so
                    // the newlines are collapsed rather than rendered as gaps.
                    label: String(r.addrtext || r.label || ('Address ' + r.id))
                        .split(String.fromCharCode(10)).filter(Boolean).join(', '),
                    city: r.city ? String(r.city) : null,
                    state: r.state ? String(r.state) : null,
                    isDefaultShipping: String(r.defaultshipping) === 'T',
                    isDefaultBilling: String(r.defaultbilling) === 'T',
                })),
            };
        } catch (e) {
            log.error('ARCH service — customer addresses failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return {
                success: false,
                error: 'The addresses for that customer could not be loaded: ' +
                       (e.message || String(e)),
            };
        }
    };

    /**
     * Sales reps an order can be credited to.
     *
     * 🔴 The order endpoint REFUSES without one. `resolveSalesRep` will not guess:
     * NetSuite rejects the whole save if the sales-team employee is not a real
     * sales rep, and picking an arbitrary one misattributes commission on a real
     * document. So the wizard has to send an id, and its Sales team dropdown was
     * a fixture with none.
     *
     * Found by driving the deployed wizard: the flow reached the final step and
     * was refused with "No sales rep could be determined". The guard did its job;
     * the UI simply had nothing to send.
     *
     * 27 active reps, so no filtering and no paging. Subsidiary is returned for
     * display only — filtering on it would repeat the customers mistake, where
     * scoping to the requested subsidiary would have returned an empty list.
     */
    const handleGetSalesReps = () => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT e.id AS id, e.entityid AS name, e.subsidiary AS subsidiaryid, ' +
                    '       BUILTIN.DF(e.subsidiary) AS subsidiaryname ' +
                    'FROM employee e ' +
                    "WHERE e.issalesrep = 'T' AND e.isinactive = 'F' " +
                    'ORDER BY e.entityid',
            }).asMappedResults();
            return {
                success: true,
                salesReps: rows.map((r) => ({
                    id: String(r.id),
                    name: String(r.name || ('Employee ' + r.id)),
                    subsidiaryId: r.subsidiaryid ? String(r.subsidiaryid) : null,
                    subsidiaryName: r.subsidiaryname ? String(r.subsidiaryname) : null,
                })),
            };
        } catch (e) {
            log.error('ARCH service — sales rep list failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return {
                success: false,
                error: 'The sales rep list could not be loaded: ' + (e.message || String(e)),
            };
        }
    };

    /**
     * Hardwood segment on the item. Third copy of this constant — the builder and
     * archOrderCreate each hold one — kept local because it is a single number and
     * a shared module for it would add an import to a scheduled cache builder for
     * no behavioural gain. `customrecord_cseg_subsidiary_loc`: 1=Hardwood,
     * 2=Softwood.
     */
    const HARDWOOD_SEGMENT = 1;

    /**
     * Open ARCH sales orders — for the second tab, and for the wizard's
     * "add to existing order" picker.
     *
     * 🔴 WHY THIS EXISTS, beyond making a tab real: the wizard's append path
     * COULD NOT SUCCEED without it. `getOpenOrders()` was a fixture generator, so
     * the only thing the wizard could offer as an append target was an invented
     * SO NUMBER ("SO-40123") — and the write endpoint takes an internal ID, parsed
     * strictly (`/^\d+$/` in `int()`). Every append was therefore refused with
     * "Adding to an existing order needs the internal id of that order", AFTER the
     * trader had filled in the whole wizard. Same shape as the Customer PO bug:
     * invisible to the type checker, obvious the moment somebody clicks the screen.
     *
     * So `internalId` on every order below is the load-bearing field. `soNo` is
     * for humans and must never be what gets sent back to the write endpoint.
     *
     * ── What counts as open ────────────────────────────────────────────────────
     * SalesOrd status letters that occur in this account: B, D, E, F, G, H.
     *   B Pending Fulfillment          D Partially Fulfilled
     *   E Pending Billing/Part Fulfil  F Pending Billing
     *   G Billed                       H Closed
     * G and H are finished, so open is B/D/E/F. 'A' (Pending Approval) does not
     * occur today and is included anyway, so switching approvals on later does not
     * silently empty this tab.
     *
     * ── The status is a PROJECTION, not a reading ─────────────────────────────
     * ARCH's vocabulary is Reserved / Ready to Build / In Transit, and none of the
     * three exists on the transaction. **Ready to Build has no field at all** —
     * every candidate was probed on 2026-08-18 and none resolved — so this never
     * returns it. A trader will not be shown a status the data cannot support.
     * `nsStatus` carries the real letter so the projection can be revised later
     * without repeating the archaeology.
     *
     * ── Units. Fourth time on this screen, so spelled out ─────────────────────
     * `transactionline.quantity` and `.rate` are BOTH read in BASE units, and
     * sales lines are NEGATIVE. A 500 BF line stores -0.5 at rate 8314.44.
     * Display is therefore:
     *
     *     quantity:  abs(qty)  / conversionrate     (÷ 0.001 = ×1000)
     *     price:     rate      * conversionrate     (× 0.001 = ÷1000)
     *
     * Opposite directions, exactly as on the builder's row cost. Their PRODUCT is
     * unchanged, which is what makes an error here invisible in the revenue column
     * and visible only in the quantity one. Two of the three ARCH unit types are
     * rate 1, so only Lumber ever exposes it.
     *
     * `unitName` is returned RAW rather than normalised. The front end already
     * owns `normalizeUnit`, and the builder's copy carries a note that a fourth
     * copy should be promoted to shared/ — which would mean redeploying a
     * scheduled cache builder to gain nothing here.
     *
     * ── Cost is the ROW average, and says so ──────────────────────────────────
     * Taken from the cached (item, location) `avgCostPerUnit`, the same figure the
     * grid shows — not from the lot on the line. Per-lot cost is not in the cache,
     * and a lot that has been sold may no longer be on hand to cost at all.
     * `costSource` is returned per line so the front end can decline to show a
     * margin rather than reporting revenue as pure profit.
     */
    /**
     * Finished: Billed, Closed, Cancelled. Everything else is open.
     *
     * Both spellings of each, because the column's format depends on WHERE it is
     * read from — see the note on the WHERE clause below. `statusLetter` does the
     * same normalisation on the way out.
     */
    const CLOSED_STATUSES = [
        'G', 'H', 'C',
        'SalesOrd:G', 'SalesOrd:H', 'SalesOrd:C',
    ];

    /** "SalesOrd:B" or "B" → "B". Empty string when there is nothing to read. */
    const statusLetter = (v) => {
        const s = String(v || '').trim();
        const i = s.lastIndexOf(':');
        return (i === -1 ? s : s.slice(i + 1)).toUpperCase();
    };

    /** NetSuite's letter → the label a person recognises. Display only. */
    const NS_STATUS_LABEL = {
        A: 'Pending Approval',
        B: 'Pending Fulfillment',
        D: 'Partially Fulfilled',
        E: 'Pending Billing/Partially Fulfilled',
        F: 'Pending Billing',
    };

    /**
     * NetSuite status → one of the three ARCH pills.
     *
     * Nothing maps to 'Ready to Build' and nothing should: it is a manual header
     * tick that does not exist yet. A and B mean the goods are committed and still
     * here; D, E and F all mean something has physically shipped.
     */
    const archStatusFor = (raw) => {
        switch (statusLetter(raw)) {
            case 'D':
            case 'E':
            case 'F':
                return 'In Transit';
            default:
                return 'Reserved';
        }
    };

    const OPEN_ORDERS_SQL =
        'SELECT ' +
        '  t.id                            AS tranid, ' +
        '  t.tranid                        AS sono, ' +
        '  t.trandate                      AS trandate, ' +
        '  t.status                        AS status, ' +
        '  t.entity                        AS customerid, ' +
        '  BUILTIN.DF(t.entity)            AS customer, ' +
        // Header Sales Rep. NULL on every ARCH order (Team Selling puts the rep on
        // the sublist instead); kept as the fallback. See archSalesTeam.js.
        '  t.employee                      AS repid, ' +
        '  BUILTIN.DF(t.employee)          AS rep, ' +
        // Who saved the record. Marc-Antoine asked for exactly this on 2026-09-08
        // ("devrait être la personne qui a créé le SO"), so it is now DISPLAYED in
        // its own column and can be grouped by — but it is still not what `trader`
        // holds. On 2 of the 4 real orders the creator is a developer or
        // integration user ('House Blend 2' saved SO-CWP-001344/001345), so
        // substituting it for the rep would have credited the sale to us.
        // Both, labelled. Neither silently standing in for the other.
        '  t.createdby                     AS createdbyid, ' +
        '  BUILTIN.DF(t.createdby)         AS createdby, ' +
        // The ISO CODE. BUILTIN.DF gives "US Dollar", which is a label and throws
        // RangeError if it ever reaches a currency formatter — see
        // handleGetCustomers, where that took the whole React app down.
        '  cur.symbol                      AS currencycode, ' +
        '  t.otherrefnum                   AS customerpo, ' +
        '  BUILTIN.DF(t.custbody_incoterms) AS incoterms, ' +
        // `shipdate` is the NATIVE field and it is populated. Verified 2026-08-20:
        // custbody_mgsl_expectedshipdate reads null on every row tried.
        '  t.shipdate                      AS shipdate, ' +
        // ⚠️ `shipaddresslist` is NOT_EXPOSED to SEARCH — selecting it is a hard
        // 400 ("Field not found ... NOT_EXPOSED"), not a null. `shippingaddress`
        // is the searchable one, and BUILTIN.DF gives the full address block.
        '  BUILTIN.DF(t.shippingaddress)   AS shipto, ' +
        // Base-to-transaction rate, needed to bring the CACHED COST (which is
        // GL, i.e. base currency) into the same currency as the revenue.
        '  t.exchangerate                  AS exchangerate, ' +
        '  tl.id                           AS lineid, ' +
        '  tl.item                         AS itemid, ' +
        '  i.itemid                        AS itemcode, ' +
        // `description`, NOT `displayname` — displayname is NULL on every ARCH item, so
        // this used to fall through to the SKU. See the note in the cache builder's
        // LOT_SQL. Keep these two SELECTs in step; they feed the same column.
        '  i.description                   AS description, ' +
        '  BUILTIN.DF(i.csegseg_thickness) AS thickness, ' +
        '  u.unitname                      AS unitname, ' +
        '  u.conversionrate                AS convrate, ' +
        '  tl.location                     AS locationid, ' +
        '  BUILTIN.DF(tl.location)         AS locationname, ' +
        '  tl.quantity                     AS lineqty, ' +
        '  tl.rate                         AS linerate, ' +
        // 🔴 THE LINE AMOUNT IN THE ORDER'S OWN CURRENCY. `tl.rate` is in the
        // SUBSIDIARY'S BASE currency (CAD here), so deriving a price from it
        // reported a USD order 38.6% high. See the note on pricePerBF below.
        '  tl.foreignamount                AS foreignamount, ' +
        '  tl.quantityshiprecv             AS shiprecv, ' +
        '  ia.inventorynumber              AS lotid, ' +
        '  inv.inventorynumber             AS lotno, ' +
        '  ia.quantity                     AS assignedqty ' +
        'FROM transactionline tl ' +
        'JOIN transaction t        ON t.id = tl.transaction ' +
        'JOIN item i               ON i.id = tl.item ' +
        'LEFT JOIN currency cur    ON cur.id = t.currency ' +
        'LEFT JOIN unitstypeuom u  ON u.internalid = i.stockunit ' +
        // 🔴 ia.transactionline references tl.id, NOT linesequencenumber. Measured
        // across every transaction 2026-08-01..19: joining on the sequence leaves
        // 8 assignments orphaned, joining on tl.id leaves 0. The two columns are
        // equal on single-line orders, which is why this hid for weeks.
        'LEFT JOIN inventoryassignment ia ' +
        '       ON ia.transaction = t.id AND ia.transactionline = tl.id ' +
        'LEFT JOIN inventorynumber inv ON inv.id = ia.inventorynumber ' +
        // Doing double duty, same as the builder: scopes to hardwood AND drops the
        // CA-E / TAXQC lines a user event adds to every order, which carry no
        // segment and would otherwise be counted as sold stock.
        'WHERE i.cseg_subsidiary_loc = ? ' +
        "  AND tl.mainline = 'F' " +
        "  AND tl.isclosed = 'F' " +
        "  AND t.type = 'SalesOrd' " +
        // 🔴 EXCLUDE the finished statuses rather than listing the open ones, and
        // accept BOTH spellings of every letter. `transaction.status` comes back
        // as a bare letter ("B") through the REST query endpoint but as
        // "SalesOrd:B" inside SuiteScript's N/query — the same column, two
        // formats. Listing the open ones therefore matched nothing here and this
        // tab returned an empty array while SuiteQL saw the order perfectly well.
        //
        // Excluding is also the safer direction: a status nobody anticipated shows
        // up on the tab instead of being silently hidden from it.
        '  AND t.status NOT IN (' + CLOSED_STATUSES.map((v) => "'" + v + "'").join(',') + ') ' +
        'ORDER BY t.trandate DESC, t.id DESC, tl.id';

    /** Counts hardwood-tagged items, so an empty tab can explain itself. */
    const HARDWOOD_ITEM_COUNT_SQL =
        'SELECT COUNT(*) AS n FROM item i WHERE i.cseg_subsidiary_loc = ?';

    /**
     * yyyy-mm-dd from whatever SuiteQL hands back, or '' — never a guess.
     * This tenant returns M/D/YYYY through the REST query endpoint.
     */
    const isoDate = (v) => {
        if (!v) return '';
        const s = String(v).trim();
        const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (mdy) {
            return mdy[3] + '-' + ('0' + mdy[1]).slice(-2) + '-' + ('0' + mdy[2]).slice(-2);
        }
        const ymd = s.match(/^(\d{4}-\d{2}-\d{2})/);
        return ymd ? ymd[1] : '';
    };

    /** First line of a NetSuite address block — the name, which is what fits a cell. */
    const addressLabel = (v) => String(v || '').split('\n')[0].trim();

    /**
     * Trims binary-float tails so a cell reads 8.31444 rather than
     * 8.314440000000001.
     *
     * Both conversions here are a multiply or divide by 0.001, which is not
     * representable, so the noise is guaranteed rather than incidental. Six places
     * is chosen to be wider than the data: an MBF rate carries two decimals, and
     * dividing it by a thousand needs five.
     */
    const tidy = (n, places) => {
        if (!isFinite(n)) return 0;
        const f = Math.pow(10, places);
        return Math.round(n * f) / f;
    };

    /**
     * The role this request is ACTUALLY running under, named for a human.
     *
     * 🔴 THE FIRST THING TO CHECK when the rep column comes back empty, and the
     * one thing nobody can see from the browser. This service is called from a
     * RESTlet; a RESTlet IGNORES `runasrole` and runs as the CALLER. So the
     * permissions that decide whether `transactionsalesteam` is readable are the
     * TRADER'S, not the ones every measurement behind this feature was taken with
     * (Administrator). `archOrderCreate.js:668` records an ARCH trader role that
     * could not read the `employee` table at all, which is why `listSalesReps`
     * had to move onto a Suitelet.
     *
     * ⚠️ COSTS A QUERY, so it is called ONLY when there is a problem to diagnose.
     * A healthy tab must not pay for a diagnostic on every load. `roleId` alone is
     * free but means nothing to the person reading the banner.
     *
     * Read from `rolepermissions` on 2026-09-08 for the role in question, 2181
     * "MGSL - CWP ARC - Trader": LIST_EMPLOYEE level 1 (View), TRAN_SALESORD
     * level 3 (Edit), ADMI_TEAMSELLINGCONTRIBUTION level 4 (Full). Its holder,
     * employee 3293, sits in subsidiary 5 with every rep on these orders, and the
     * role is `subsidiaryoption` OWN, so scope covers them. It SHOULD work. That
     * is not the same as knowing it does, which is why this exists.
     */
    const currentRoleLabel = () => {
        let user = null;
        try { user = runtime.getCurrentUser(); } catch (e) { user = null; }
        const id = user && user.role ? String(user.role) : '';
        const scriptId = user && user.roleId ? String(user.roleId) : '';
        let name = '';
        if (id) {
            try {
                const r = query.runSuiteQL({
                    query: 'SELECT name FROM role WHERE id = ?',
                    params: [id],
                }).asMappedResults();
                name = r && r.length ? String(r[0].name || '').trim() : '';
            } catch (e) {
                // A role that cannot read the `role` table is itself a finding, but
                // not one worth failing the tab for. The id still identifies it.
                name = '';
            }
        }
        const label = name || scriptId;
        if (label && id) return label + ' (' + id + ')';
        return label || (id ? 'role ' + id : '');
    };

    const handleGetOpenOrders = () => {
        let rows;
        try {
            rows = query.runSuiteQL({
                query: OPEN_ORDERS_SQL,
                params: [HARDWOOD_SEGMENT],
            }).asMappedResults();
        } catch (e) {
            log.error('ARCH service — open orders failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return {
                success: false,
                error: 'Open sales orders could not be loaded: ' + (e.message || String(e)),
            };
        }

        /* Row cost by item+location, from the cache the grid already serves, so the
         * two tabs cannot disagree about what a board foot cost. A pair with no
         * cached cost stays null, which the front end renders as unknown rather
         * than as zero. A cache miss here is survivable — the margin column
         * declines to show a number — whereas a thrown request is not. */
        const costByPair = {};
        try {
            const summary = readSummary(getMyCache());
            if (summary.present && summary.rows) {
                summary.rows.forEach((r) => {
                    const c = parseFloat(r.avgCostPerUnit);
                    costByPair[String(r.internalId) + '__' + String(r.locationId)] =
                        isFinite(c) ? c : null;
                });
            }
        } catch (e) {
            log.audit('ARCH open orders — cost lookup unavailable',
                (e.name || '') + ': ' + (e.message || String(e)));
        }

        const byOrder = {};
        const ordered = [];
        const lineSeen = {};
        const lineOrder = [];

        /* The trader, from the Sales Team sublist, as a SECOND query keyed by
         * transaction id. Never joined into the line query above: a two-rep order
         * would double every one of its lines. Unavailable is survivable (header
         * rep, then "Unassigned"); a thrown request is not. */
        let teamRep = {};
        let salesTeamRead = 'ok';
        let salesTeamError = '';
        /* Resolved at most once per request, and only if something asks. The log
         * line below and the response block at the end both want it. */
        let roleLabelCache = null;
        const roleLabel = () => {
            if (roleLabelCache === null) roleLabelCache = currentRoleLabel();
            return roleLabelCache;
        };
        try {
            teamRep = ArchSalesTeam.repByTransaction(rows.map((r) => r.tranid));
        } catch (e) {
            salesTeamRead = 'failed';
            salesTeamError = (e.name ? e.name + ': ' : '') + (e.message || String(e));
            /* ERROR, not audit. This was an audit line, and an audit line is
             * exactly how this failure stays invisible: the header rep is null on
             * every ARCH order, so a failure here makes the tab print "Unassigned"
             * on every row — the precise symptom Marc-Antoine reported — and
             * nothing anywhere says the column was UNREAD rather than empty. It is
             * a failure by cause, not a per-run condition, so it belongs at ERROR.
             * Reported to the browser as well; see `traderAttribution` below. */
            log.error('ARCH open orders — sales team read FAILED, every order will read Unassigned',
                salesTeamError + '. A RESTlet runs as the caller, so check that role first: ' +
                roleLabel() + '.');
        }

        rows.forEach((r) => {
            const tranId = String(r.tranid);
            const team = teamRep[tranId] || null;
            if (!byOrder[tranId]) {
                const letter = statusLetter(r.status);
                byOrder[tranId] = {
                    // 🔴 The append target. See the header.
                    internalId: tranId,
                    soNo:       String(r.sono || ('SO ' + tranId)),
                    customer:   String(r.customer || ''),
                    customerId: r.customerid ? String(r.customerid) : null,
                    // The trader IS the sales rep on the transaction, and on this
                    // account that lives on the Sales Team sublist, not the header:
                    // the header read null on 4 of 4 real orders and this said
                    // "Unassigned" for all of them. Sublist first, header second,
                    // then the honest blank. Grouping by anything else (creator,
                    // customer's default rep) would invent an owner.
                    trader:     String((team && team.rep) || r.rep || 'Unassigned'),
                    // The id is what the wizard's rep dropdown pre-selects on; with
                    // null here every Edit opened with the rep blank.
                    traderId:   (team && team.repId) ? String(team.repId) : (r.repid ? String(r.repid) : null),
                    /** More than one rep on the sublist; `traderTied` when they share evenly. */
                    traderShared: !!(team && team.shared),
                    traderTied:   !!(team && team.tied),
                    /**
                     * WHERE the name above came from: 'salesTeam', 'header' or
                     * 'none'. Without it, "Unassigned" is indistinguishable from a
                     * sublist the caller's role could not read, and the tab has no
                     * way to tell those apart either. See `traderAttribution`.
                     */
                    traderSource: (team && team.rep) ? 'salesTeam' : (r.rep ? 'header' : 'none'),
                    /** The rep's id resolved but their NAME did not; shows as "Employee <id>". */
                    traderNameUnreadable: !!(team && team.nameUnreadable),
                    createdBy:    String(r.createdby || ''),
                    createdById:  r.createdbyid ? String(r.createdbyid) : null,
                    shipTo:     addressLabel(r.shipto),
                    shipToFull: String(r.shipto || ''),
                    currency:   String(r.currencycode || ''),
                    customerPO: String(r.customerpo || ''),
                    incoterms:  String(r.incoterms || ''),
                    created:    isoDate(r.trandate),
                    shipDate:   isoDate(r.shipdate),
                    // The sublist is read for the TRADER above. This field stays
                    // blank: the wizard's header field is one rep (custbody_sales_rep),
                    // not a team, and a name under a "team" label would be a guess
                    // dressed up as data.
                    salesTeam:  '',
                    status:     archStatusFor(letter),
                    nsStatus:   letter,
                    nsStatusLabel: NS_STATUS_LABEL[letter] || letter,
                    lines:      [],
                };
                ordered.push(byOrder[tranId]);
            }

            const o = byOrder[tranId];
            const lineKey = tranId + '|' + String(r.lineid);

            /* ⚠️ THIS QUERY FANS OUT. A line with three lot assignments returns
             * three rows carrying the SAME line quantity and rate. Line-level
             * values are therefore taken ONCE per (transaction, line), and the
             * assignment rows only attribute that quantity to lots. Summing across
             * the raw rows triples the figure — the same cartesian trap the builder
             * and archSplitQueue both document. */
            if (!lineSeen[lineKey]) {
                const rate = parseFloat(r.convrate);
                const conv = isFinite(rate) && rate > 0 ? rate : 1;
                const shipped = Math.abs(parseFloat(r.shiprecv) || 0);
                const pairKey = String(r.itemid) + '__' + String(r.locationid);
                const rawCost = Object.prototype.hasOwnProperty.call(costByPair, pairKey)
                    ? costByPair[pairKey]
                    : null;

                /* ── Money is reported in the ORDER'S OWN CURRENCY ────────────
                 *
                 * 🔴 THE FIFTH SCALE TRAP ON THIS SCREEN, and the only one that
                 * shows up as money rather than quantity.
                 *
                 * `transactionline.rate` is denominated in the SUBSIDIARY'S BASE
                 * currency, which is CAD for both CWP MTL (5) and ARC (9), while
                 * `foreignamount` and `netamount` are in the TRANSACTION's
                 * currency. Deriving a unit price from `rate` therefore reported a
                 * USD order at the CAD figure and labelled it USD:
                 *
                 *     SO-CWP-001329, measured 2026-08-20
                 *       tl.rate        8314.44   (CAD per MBF)
                 *       netamount/qty  6000.00   (USD per MBF)  <- the real price
                 *       8314.44 = 6000 x 1.38574 exchange rate
                 *
                 * The tab showed $4,373 for an order worth $3,156 USD. Nothing
                 * looked wrong: every figure was self-consistent, just 38.6% high.
                 *
                 * So the price comes from the AMOUNT, not the rate. A zero-quantity
                 * line has no meaningful unit price and reports none rather than
                 * dividing by zero.
                 *
                 * And the cost has to move the other way. The cached cost is
                 * derived from the GL, so it is BASE currency; dividing by the
                 * order's exchange rate brings it alongside the revenue. Leaving
                 * it in CAD kept the MARGIN accidentally correct — both sides were
                 * CAD — while the revenue label was wrong, which is a worse place
                 * to be than either consistent answer.
                 */
                const qtyBase = Math.abs(parseFloat(r.lineqty) || 0);
                const amountTxn = Math.abs(parseFloat(r.foreignamount) || 0);
                const fx = parseFloat(r.exchangerate);
                const fxRate = isFinite(fx) && fx > 0 ? fx : 1;
                const pricePerUnit = qtyBase > 0 ? (amountTxn / qtyBase) * conv : 0;
                const cost = rawCost === null ? null : rawCost / fxRate;

                lineSeen[lineKey] = {
                    conv:         conv,
                    amountTxn:    amountTxn,
                    qtyBase:      qtyBase,
                    assignedBase: 0,
                    lineId:       String(r.lineid),
                    tranId:       tranId,
                    shell: {
                        internalId:   String(r.itemid),
                        itemCode:     String(r.itemcode || ''),
                        // .trim() before the fallback: three of six ARCH descriptions end
                        // in a real CRLF that Oracle TRIM does not strip.
                        description:  String(r.description || '').trim() || String(r.itemcode || ''),
                        thickness:    String(r.thickness || ''),
                        locationName: String(r.locationname || ''),
                        locationId:   String(r.locationid || ''),
                        // RAW NetSuite unit name. The front end normalises it.
                        unitName:     String(r.unitname || ''),
                        costPerBF:    cost === null ? null : tidy(cost, 4),
                        costSource:   cost === null ? 'unknown' : 'rowAverage',
                        // The order's own currency, for anything that needs to say so.
                        exchangeRate: tidy(fxRate, 6),
                        pricePerBF:   tidy(pricePerUnit, 6),
                        // A partly-shipped line belongs in outbound, not reserve.
                        bucket:       shipped > 0 ? 'outbound' : 'reserve',
                        existing:     true,
                        lineStatus:   archStatusFor(String(r.status || '')),
                    },
                };
                lineOrder.push(lineKey);
            }

            const seen = lineSeen[lineKey];
            const lotId = r.lotid ? String(r.lotid) : '';
            if (!lotId) return;   // no assignment on this row; residual handled below

            const assignedBase = Math.abs(parseFloat(r.assignedqty) || 0);
            seen.assignedBase += assignedBase;
            o.lines.push(Object.assign({}, seen.shell, {
                // Namespaced by SO and line so an existing order line can never
                // collide with the same lot picked off the grid — that collision
                // showed as duplicate rows and visibly doubled board feet.
                key:         'so:' + o.soNo + '|' + seen.lineId + '|' + lotId,
                lotNo:       String(r.lotno || ''),
                lotId:       lotId,
                containerNo: '',
                bf:          tidy(assignedBase / seen.conv, 4),
                /* NetSuite's OWN amount for this line, not a figure rebuilt from a
                 * rounded price times a rounded quantity. Exact whenever the line
                 * carries a single lot, which is every order the wizard writes; on a
                 * hand-built multi-lot line there is no authoritative per-BUNDLE
                 * amount to be had, so the line amount is apportioned by quantity
                 * share and the front end's per-row figure is a share by nature. */
                amount:      tidy(seen.amountTxn * (seen.qtyBase > 0 ? assignedBase / seen.qtyBase : 0), 2),
            }));
        });

        /* ── The unattributed remainder ──────────────────────────────────────────
         *
         * A line's assignments may cover only part of it, or none of it. The one
         * open hardwood SO in the sandbox today, SO-CWP-001329, carries NO
         * inventory detail on any of its three lines. Emitting only the assigned
         * portion would under-report every total on the tab while looking complete.
         *
         * So the residual is emitted as a lot-less line, which is the same
         * accounting the builder's `unattributed` does for the grid. A blank lot
         * number is the honest signal that the quantity is real but cannot be
         * traced to a bundle. Iterated in `lineOrder` rather than over the object
         * so line order is stable rather than whatever key order the engine gives.
         */
        lineOrder.forEach((lineKey) => {
            const seen = lineSeen[lineKey];
            const o = byOrder[seen.tranId];
            if (!o) return;
            const residualBase = seen.qtyBase - seen.assignedBase;
            // A ten-thousandth of a base unit is a rounding tail, not a remainder.
            if (residualBase <= 0.0001) return;
            o.lines.push(Object.assign({}, seen.shell, {
                key:          'so:' + o.soNo + '|' + seen.lineId + '|unattributed',
                lotNo:        '',
                lotId:        '',
                containerNo:  '',
                bf:           tidy(residualBase / seen.conv, 4),
                amount:       tidy(seen.amountTxn * (seen.qtyBase > 0 ? residualBase / seen.qtyBase : 0), 2),
                unattributed: true,
            }));
        });

        /* ── Why this tab can look empty, and it is not a bug ────────────────────
         *
         * Measured 2026-08-20: only SIX items in the whole account carry
         * cseg_subsidiary_loc = Hardwood, and every other CWP sales order runs on
         * untagged SS* items. So exactly ONE sales order in the account has ever
         * touched a hardwood-tagged item. Until the remaining SKUs are tagged
         * (todo 0.1, Lucas), real orders will not appear here — and the cause is
         * the tag, not this query. Returning the count lets the front end say that
         * instead of showing a blank table.
         */
        let taggedItemCount = null;
        try {
            const c = query.runSuiteQL({
                query: HARDWOOD_ITEM_COUNT_SQL,
                params: [HARDWOOD_SEGMENT],
            }).asMappedResults();
            const n = c && c.length ? parseInt(c[0].n, 10) : NaN;
            taggedItemCount = isFinite(n) ? n : null;
        } catch (e) {
            log.audit('ARCH open orders — tagged item count unavailable',
                (e.name || '') + ': ' + (e.message || String(e)));
        }

        /* ── Who owns these orders, and how sure are we ─────────────────────────
         *
         * 🔴 THE POINT IS THAT "UNASSIGNED EVERYWHERE" CANNOT BE SILENT AGAIN.
         * That is the state Marc-Antoine reported on 2026-09-08, and the cause was
         * reading a header field that is null on every ARCH order. The fix reads
         * the Sales Team sublist instead — under Administrator, which is NOT who
         * runs it: a RESTlet ignores `runasrole` and runs as the CALLER. If the
         * trader's own role cannot read `transactionsalesteam`, the tab returns to
         * exactly the reported symptom and nothing says so.
         *
         * So the counts travel with the orders, the same contract as
         * `taggedItemCount` above: the front end can then say "unread" instead of
         * printing "Unassigned" 40 times and letting the trader draw the wrong
         * conclusion. `roleLabel` is filled ONLY when there is something to
         * diagnose, because resolving it costs a query. */
        const fromSalesTeam = ordered.filter((o) => o.traderSource === 'salesTeam').length;
        const fromHeader    = ordered.filter((o) => o.traderSource === 'header').length;
        const unattributed  = ordered.filter((o) => o.traderSource === 'none').length;
        const namesUnreadable = ordered.filter((o) => o.traderNameUnreadable).length;
        const attributionBroken =
            salesTeamRead === 'failed' || (ordered.length > 0 && unattributed === ordered.length);

        return {
            success: true,
            source: 'netsuite',
            orders: ordered,
            taggedItemCount: taggedItemCount,
            traderAttribution: {
                orders:          ordered.length,
                fromSalesTeam:   fromSalesTeam,
                fromHeader:      fromHeader,
                unattributed:    unattributed,
                namesUnreadable: namesUnreadable,
                salesTeamRead:   salesTeamRead,
                salesTeamError:  salesTeamError,
                roleLabel:       attributionBroken ? roleLabel() : '',
            },
        };
    };

    /**
     * Setup > Sales Team: the named TEAMS, with their members and percentages.
     *
     * "Sales Team : Ça ne semble pas feeder de la bonne affaire : On veut les teams
     * qui sont dela page (Setup > sales team)" — Marc-Antoine, 2026-09-08. That
     * page is `entitygroup` with `issalesrep = 'T'`, and the percentages are
     * `entitygroupmember.contribution`.
     *
     * ── The template / instance relationship, measured not assumed ────────────
     * Sandbox, 2026-09-08:
     *   44 active teams   (entitygroup, issalesrep 'T', grouptype 'Employee')
     *   82 member rows    (entitygroupmember; 95 in the account overall)
     *   sizes             9 teams of 1, 33 of 2, 1 of 3, 1 of 4
     *   g.size            equal to the real member count on all 44 (0 mismatches)
     *   contributions     summing to exactly 1 on all 44
     *   isprimary 'T'     on 8 of the 82 rows
     * and "Sam/Justin" (group 2805) is Samuel Nadon 0.5 / Justin Loveland 0.5,
     * isprimary 'F' on both, which is BYTE FOR BYTE what SO-CWP-001352 stores in
     * its `transactionsalesteam`. So the group is the template and the transaction
     * sublist is the instance. `shared/archSalesTeam.js` reads the instance; this
     * reads the template.
     *
     * ── ⚠️ READ ONLY, and deliberately so ────────────────────────────────────
     * Nothing here writes. Selecting a team must not yet post a multi-member sales
     * team onto a real sales order: that attributes COMMISSION on real sales
     * documents and needs an explicit go-ahead from MGSL. Same shape as the split
     * fee and the confirmation email, both of which ship configured off.
     *
     * ── Why this lives on the RESTlet and not beside listSalesReps ────────────
     * `archOrderCreate.listSalesReps` was moved onto a Suitelet because the ARCH
     * trader role could not read the `employee` table ("Record 'employee' was not
     * found"). Three reasons that precedent does not carry here:
     *
     *  1. Its premise no longer holds, or never described role 2181. Read from
     *     `rolepermissions` on 2026-09-08, role 2181 "MGSL - CWP ARC - Trader"
     *     holds LIST_EMPLOYEE at permlevel 1 (View) with restriction -1, alongside
     *     TRAN_SALESORD level 3 and ADMI_TEAMSELLINGCONTRIBUTION level 4. Moving a
     *     second endpoint off the RESTlet on the strength of a note there is now
     *     evidence against would be cargo cult.
     *  2. It is a different access path. That failure was `FROM employee`. This
     *     reads `FROM entitygroup` and takes the name from the member row's own
     *     `m.name` column, with `BUILTIN.DF(m.employeemember)` only as a second
     *     chance. One of the two can fail and a name still comes back.
     *  3. The Suitelet is the ORDER WRITE endpoint. `listSalesReps` belongs there
     *     because the list and the write-path VALIDATOR must run the same predicate
     *     under the same role, so the screen cannot offer a rep the write will
     *     refuse. There is no write path here to keep in step, by design (above).
     *
     * ── ⚠️ THE MEASURED RISK, and why this degrades loudly ───────────────────
     * All 44 teams sit in SUBSIDIARY 1 (MGSL), none private, none restricted to
     * owner. Role 2181 is `subsidiaryoption` OWN and its holder, employee 3293
     * "Trader Hardwood", sits in subsidiary 5. If `entitygroup` is subsidiary
     * scoped for an OWN role, the trader sees ZERO teams and the picker is simply
     * empty. Nobody can log in as that role from here to settle it, so an empty
     * result is a STATEMENT rather than a shrug: `notice` says what happened and
     * names the role, `g.size` versus the members actually returned proves when
     * members were withheld rather than absent, and a read that throws returns a
     * failure instead of an empty list. Same machinery as `traderAttribution`.
     */
    const SALES_TEAMS_SQL =
        'SELECT ' +
        '  g.id                         AS teamid, ' +
        '  g.groupname                  AS teamname, ' +
        // The group's OWN member count. Equal to the real one on all 44 teams as
        // Administrator, so a shortfall against the rows returned is PROOF that
        // members were withheld from this caller, not that the team is small.
        '  g.size                       AS declaredsize, ' +
        '  m.employeemember             AS repid, ' +
        // TWO names, deliberately. `m.name` is the member row's own column;
        // BUILTIN.DF resolves through the employee record. Different access paths,
        // so a role that can read one but not the other still gets a label.
        '  m.name                       AS repname, ' +
        '  BUILTIN.DF(m.employeemember) AS repdf, ' +
        '  m.contribution               AS contribution, ' +
        '  m.isprimary                  AS isprimary ' +
        'FROM entitygroup g ' +
        // 🔴 LEFT, and the member filter is in the ON clause, not the WHERE. Both
        // for the same reason: a team whose members are unreadable must appear as a
        // team with no members, which is visible, rather than dropping out of the
        // list, which is the silent version of the same failure. `m."group"` MUST
        // be quoted; `group` is a reserved word and the query is a hard 400 without
        // the quotes.
        'LEFT JOIN entitygroupmember m ON m."group" = g.id AND m.isinactive = \'F\' ' +
        // The three filters that ARE the Setup > Sales Team page. 45 employee
        // groups exist; the 45th carries issalesrep 'F' and is not a sales team.
        /* 🔴 NO `g.grouptype` CLAUSE, and this is a SuiteQL DIALECT trap, not a
 * simplification. `grouptype` selects and filters perfectly through the REST
 * query endpoint (which is what sql.mjs uses, and where this query was
 * developed), but inside SuiteScript's N/query the SAME column is a record
 * join, and the live endpoint returned:
 *   "Search error occurred: Record Join 'grouptype' for record 'EntityGroup'
 *    was not found."
 * This is the same class of divergence as `transaction.status`, which comes
 * back 'B' through REST and 'SalesOrd:B' inside N/query. A shim test cannot
 * catch it: only calling the deployed endpoint can.
 *
 * Dropping it costs nothing, measured: `issalesrep = 'T' AND isinactive = 'F'`
 * returns the SAME 44 teams with or without the clause, and grouping those 44
 * by grouptype gives Employee for all 44. There is no non-Employee sales-rep
 * group in this account to exclude. */
        "WHERE g.issalesrep = 'T' AND g.isinactive = 'F' " +
        'ORDER BY g.groupname, m.employeemember';

    const handleGetSalesTeams = () => {
        /* Resolved at most ONCE per request. `currentRoleLabel` costs a query, and
         * the notice, the log line and the response field all want it; three calls
         * would be three queries for one string. */
        let roleLabelCache = null;
        const roleLabel = () => {
            if (roleLabelCache === null) roleLabelCache = currentRoleLabel();
            return roleLabelCache;
        };

        let rows;
        try {
            rows = query.runSuiteQL({ query: SALES_TEAMS_SQL }).asMappedResults();
        } catch (e) {
            log.error('ARCH service — sales team list failed',
                (e.name || '') + ': ' + (e.message || String(e)) +
                '. A RESTlet runs as the caller, so check that role first: ' +
                roleLabel() + '.');
            /* No `salesTeams` key at all on this path. Returning an empty array
             * beside a failure invites a picker to render "no teams", which is the
             * one thing this must never say when it does not know. */
            return {
                success: false,
                error: 'The sales team list could not be loaded: ' + (e.message || String(e)),
            };
        }

        /* ⚠️ THIS QUERY FANS OUT, one row per member, the same trap the open-orders
         * query documents at length. Team-level values are taken ONCE per group and
         * the member rows only fill its list. */
        const byTeam = {};
        const teams = [];
        let memberRowCount = 0;

        rows.forEach((r) => {
            const teamId = String(r.teamid);
            if (!byTeam[teamId]) {
                const declared = parseInt(r.declaredsize, 10);
                byTeam[teamId] = {
                    id:   teamId,
                    name: String(r.teamname || ('Team ' + teamId)),
                    /** What the group record says it holds. See declaredsize above. */
                    declaredSize: isFinite(declared) && declared > 0 ? declared : 0,
                    members: [],
                    memberCount: 0,
                    nameUnreadableCount: 0,
                    membersUnreadable: false,
                    contributionTotal: 0,
                };
                teams.push(byTeam[teamId]);
            }
            const t = byTeam[teamId];

            // The LEFT JOIN row for a team with no readable members carries no id.
            if (!r.repid) return;
            memberRowCount++;

            const repId = String(r.repid);
            const nm = String(r.repname || r.repdf || '').trim();
            const c = parseFloat(r.contribution);
            const frac = isFinite(c) ? c : 0;
            if (!nm) t.nameUnreadableCount++;
            t.members.push({
                id: repId,
                /* Same rule as archSalesTeam.pickRep, so the template and the
                 * instance cannot label the same person differently. A blank name
                 * would put an empty row in a picker; "null" would be worse. */
                name: nm || ('Employee ' + repId),
                nameUnreadable: !nm,
                /* 🔴 THE PERCENT TRAP. SuiteQL returns a Percent as a FRACTION
                 * (0.5), while `setValue` on the field takes the typed number (50).
                 * That has already cost this project a real bug on the customer
                 * rate fields, so both are returned under names that say which and
                 * a future writer has nothing left to guess. */
                contribution:    tidy(frac, 6),
                contributionPct: tidy(frac * 100, 4),
                isPrimary: String(r.isprimary || '').toUpperCase() === 'T',
            });
            t.memberCount = t.members.length;
            t.contributionTotal = tidy(
                t.members.reduce((s, m) => s + m.contribution, 0), 6);
        });

        teams.forEach((t) => { t.membersUnreadable = t.memberCount < t.declaredSize; });
        /* Sorted HERE as well as in the SQL. The picker is alphabetical whatever
         * order the engine hands back, and a plain comparator rather than
         * localeCompare so the order does not depend on the engine's locale. */
        teams.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        const teamsWithMissingMembers = teams.filter((t) => t.membersUnreadable).length;
        const membersWithUnreadableNames = teams.reduce((s, t) => s + t.nameUnreadableCount, 0);
        const degraded =
            teams.length === 0 || teamsWithMissingMembers > 0 || membersWithUnreadableNames > 0;

        let notice = '';
        if (!teams.length) {
            notice =
                'No sales team came back. This account had 44 of them under Setup > Sales Team ' +
                'when this was written (measured 2026-09-08), so an empty result is far more ' +
                'likely to be a permission or subsidiary-scope problem than an empty page: all ' +
                '44 sit in subsidiary 1 (MGSL), and a role scoped to its own subsidiary may not ' +
                'see them. This request ran as ' + roleLabel() + ', because a RESTlet ' +
                'ignores runasrole and runs as the caller.';
            /* ERROR, not audit. The picker is unusable in this state, and this is
             * the line somebody greps for. The partial case below stays at audit:
             * it runs on every wizard open and the list still works. */
            log.error('ARCH service — sales team list came back EMPTY', notice);
        } else if (degraded) {
            notice =
                (teamsWithMissingMembers
                    ? teamsWithMissingMembers + ' team(s) returned fewer members than the group ' +
                      'record says they hold. '
                    : '') +
                (membersWithUnreadableNames
                    ? membersWithUnreadableNames + ' member name(s) could not be read and show ' +
                      'as an employee id. '
                    : '') +
                'This request ran as ' + roleLabel() +
                '; a RESTlet ignores runasrole and runs as the caller.';
            log.audit('ARCH service — sales team list is incomplete', notice);
        }

        const out = {
            success: true,
            salesTeams: teams,
            teamCount: teams.length,
            /** Member rows that carried an id. Zero on every team is the bad case. */
            memberRowCount: memberRowCount,
            teamsWithMissingMembers: teamsWithMissingMembers,
            membersWithUnreadableNames: membersWithUnreadableNames,
            /** Only resolved when there is something to diagnose; it costs a query. */
            roleLabel: degraded ? roleLabel() : '',
        };
        if (notice) out.notice = notice;
        return out;
    };


    const getHandler = (dataIn) => {
        const action = (dataIn && dataIn.action) || 'get';
        const handlers = {
            getContext: handleGetContext,
            meta:       handleGetMeta,
            summary:    handleGetSummary,
            detail:     handleGetDetail,
            customers:  handleGetCustomers,
            customerAddresses: handleGetCustomerAddresses,
            salesReps:  handleGetSalesReps,
            // Setup > Sales Team. READ ONLY: see the note on handleGetSalesTeams
            // for why nothing here posts a team onto a real order.
            openOrders: handleGetOpenOrders,
            salesTeams: handleGetSalesTeams,
        };
        const handler = handlers[action];
        if (!handler) return { success: false, error: 'Unknown action: ' + action };
        return handler(dataIn);
    };

    return {
        getRouter: function (dataIn) {
            if (!dataIn || !dataIn.action) {
                return { success: false, error: 'action parameter required' };
            }
            return getHandler(dataIn);
        },
        postRouter: function () {
            // SO creation from the ARCH wizard is Track D, not Phase 1.
            return { success: false, error: 'No POST actions defined for the ARCH service' };
        },
    };
});
