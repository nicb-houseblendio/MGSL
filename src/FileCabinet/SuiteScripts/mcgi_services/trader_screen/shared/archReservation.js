/**
 * archReservation.js — CWP ARCH pre-arrival bundle reservation (Feedback 8, phase 2).
 *
 * A bundle on the water cannot go on a sales order: NetSuite refuses an
 * inventory assignment against a lot with no stock (tested four ways,
 * 2026-09-16). So between take ownership and receipt the reservation is held by
 * us, as ONE `customrecord_arch_res` record per bundle, and handed to NetSuite
 * as a real assignment when the wood lands (the reconciler, phase 3).
 *
 * 🔴 THE CLAIM RECORD IS THE RESERVATION, AND ITS externalId IS THE LOCK.
 * Measured in sandbox 2026-09-23 with a probe running as customrole2184, the
 * order endpoint's role:
 *   - a second create with the same externalId is refused by NetSuite with
 *     DUP_CSTM_RCRD_ENTRY "There is already a Custom Record Entry with that
 *     name", and the id is reusable once the first is deleted;
 *   - that role CANNOT write the lot record (INSUFFICIENT_PERMISSION, "Lists ->
 *     Items"), so the custitemnumber_arch_res_* lot fields are a MIRROR written
 *     by the reconciler in an Administrator context, never by the endpoint.
 * Nothing else in NetSuite gives an atomic claim: there is no compare-and-set on
 * a field, and "read, then write if empty" lets two traders both win.
 *
 * Shapes:
 *   pending  = claim with no SO yet. The endpoint takes the bundle BEFORE the
 *              order saves (no SO id or line key exists until then). A crash
 *              leaves it pending; the reconciler releases one older than
 *              PENDING_TTL_MIN.
 *   held     = claim with SO and line key.
 *
 * Every function takes its NetSuite modules as arguments so the tests can load
 * this file with fakes and the three callers (endpoint, cache, reconciler) share
 * one definition of what a claim is.
 *
 * @NApiVersion 2.1
 */
define([], () => {
    const TYPE = 'customrecord_arch_res';
    const F_LOT  = 'custrecord_arch_res_lot';
    const F_ITEM = 'custrecord_arch_res_item';
    const F_SO   = 'custrecord_arch_res_so';
    const F_LINE = 'custrecord_arch_res_line';
    /* The order request's idempotency key, written WITH the claim, before the SO
     * exists. Review 2026-09-23 (HIGH 3): if anything fails between the SO save and
     * `finalize`, a claim with no SO used to be swept as abandoned after 30 min
     * while its SO line still wanted the bundle. With the key, the reconciler finds
     * the order (externalid ARCH-ORDER-<key>, or the [ARCH-APPEND:<key>] marker)
     * and completes the claim instead. */
    const F_KEY  = 'custrecord_arch_res_key';

    /** Minutes a claim may stay without an SO before the reconciler releases it. */
    const PENDING_TTL_MIN = 30;

    /* The externalId is the lot's internal id, as a string. Not the lot NAME:
     * 6 duplicate-name groups cover 15 lot ids in ARCH scope, so a name would
     * lock unrelated bundles. And not item+lot: a lot id is already unique. */
    const externalIdFor = (lotId) => 'arch-res-' + String(parseInt(lotId, 10));

    const int = (v) => {
        const n = parseInt(v, 10);
        return isFinite(n) && n > 0 ? n : 0;
    };

    const CLAIMS_SQL =
        'SELECT c.id AS claimid, c.externalid AS ext, ' +
        '       c.' + F_LOT + ' AS lotid, inv.inventorynumber AS lotno, ' +
        '       c.' + F_SO + ' AS soid, t.tranid AS sonumber, ' +
        '       BUILTIN.DF(t.entity) AS customer, ' +
        '       c.' + F_LINE + ' AS linekey, c.' + F_ITEM + ' AS itemid, ' +
        '       c.' + F_KEY + ' AS orderkey, c.isinactive AS inactive, ' +
        "       TO_CHAR(c.created, 'YYYY-MM-DD HH24:MI:SS') AS since, " +
        /* 🔴 CURRENT_DATE, NOT SYSDATE. Measured 2026-09-23 from N/query: a claim
         * created at 05:00:38Z formats `created` as 01:00:38, CURRENT_DATE as
         * 01:00:39 and SYSDATE as 22:00:39 the previous day. So SYSDATE would age
         * every new claim by minus three hours and none would ever be swept.
         * SuiteQL refuses date subtraction outright ("Invalid or unsupported
         * search"), so the age is computed in JS from two strings on ONE clock. */
        "       TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD HH24:MI:SS') AS nowacct, " +
        // The lot's stock over ALL locations, so a reader can tell "on the water"
        // from "landed and not yet handed to NetSuite" without a second query.
        '       (SELECT SUM(inl.quantityonhand) FROM inventorynumberlocation inl ' +
        '         WHERE inl.inventorynumber = c.' + F_LOT + ') AS lotonhand ' +
        'FROM ' + TYPE + ' c ' +
        'LEFT JOIN inventorynumber inv ON inv.id = c.' + F_LOT + ' ' +
        'LEFT JOIN transaction t ON t.id = c.' + F_SO;
    /* 🔴 INACTIVE CLAIMS ARE READ TOO (review 2026-09-23). Their externalId still
     * blocks a new claim, so filtering them out made a bundle inactivated by hand
     * unreservable forever with nothing showing why. They count as held here, and
     * the reconciler releases them. */

    /**
     * Every live claim. Small by nature (one per bundle sold off a boat), so it
     * is read whole rather than per lot, which lets every caller also answer
     * "is this SO LINE a claimed one" without a second query.
     *
     * Returns { sourced, rows, byLotId, byLine } where byLine is keyed
     * `<soId>:<lineKey>`. On failure `sourced` is false and the maps are empty;
     * each caller decides what that means (the endpoint refuses, the cache
     * degrades and says so).
     */
    const readClaims = (query) => {
        const out = { sourced: true, error: '', rows: [], byLotId: {}, byLine: {} };
        let rows;
        try {
            rows = query.runSuiteQL({ query: CLAIMS_SQL, params: [] }).asMappedResults();
        } catch (e) {
            out.sourced = false;
            out.error = (e && (e.name || '')) + ': ' + (e && (e.message || String(e)));
            return out;
        }
        rows.forEach((r) => {
            const c = {
                claimId:  int(r.claimid),
                lotId:    int(r.lotid),
                lotNo:    r.lotno == null ? '' : String(r.lotno),
                soId:     int(r.soid),
                soNumber: r.sonumber == null ? '' : String(r.sonumber),
                customer: r.customer == null ? '' : String(r.customer),
                lineKey:  int(r.linekey),
                itemId:   int(r.itemid),
                orderKey: r.orderkey == null ? '' : String(r.orderkey),
                inactive: String(r.inactive || 'F') === 'T',
                since:    r.since == null ? '' : String(r.since),
                nowAcct:  r.nowacct == null ? '' : String(r.nowacct),
                lotOnHand: Number(r.lotonhand) || 0,
            };
            c.pending = !c.soId;
            out.rows.push(c);
            if (c.lotId) out.byLotId[String(c.lotId)] = c;
            if (c.soId && c.lineKey) out.byLine[String(c.soId) + ':' + String(c.lineKey)] = c;
        });
        return out;
    };

    /**
     * The exception the reconciler last wrote on each lot's mirror (2.7c), for
     * DISPLAY only. Deliberately NOT part of CLAIMS_SQL: the endpoint's lock
     * depends on that query, and a display column must never be able to take the
     * lock down. Returns { sourced, byLotId: { id: {code, label, since} } }.
     */
    const readExceptions = (query, lotIds) => {
        const ids = (lotIds || []).map(int).filter(Boolean);
        const out = { sourced: true, byLotId: {} };
        if (!ids.length) return out;
        try {
            query.runSuiteQL({
                query: 'SELECT inv.id AS lotid, ' +
                       '       BUILTIN.DF(inv.custitemnumber_arch_res_exception) AS label, ' +
                       "       TO_CHAR(inv.custitemnumber_arch_res_flagged, 'YYYY-MM-DD') AS since " +
                       'FROM inventorynumber inv ' +
                       'WHERE inv.id IN (' + ids.join(',') + ') ' +
                       '  AND inv.custitemnumber_arch_res_exception IS NOT NULL',
                params: [],
            }).asMappedResults().forEach((r) => {
                out.byLotId[String(int(r.lotid))] = { label: String(r.label || ''), since: String(r.since || '') };
            });
        } catch (e) {
            out.sourced = false;
        }
        return out;
    };

    const isDuplicate = (e) => {
        const s = (e && ((e.name || '') + ' ' + (e.message || ''))) || String(e);
        return /DUP_CSTM_RCRD_ENTRY|already a Custom Record Entry|duplicate|unique/i.test(s);
    };

    /**
     * Takes the bundle. Returns { ok: true, claimId } or { ok: false, taken: true }
     * when another claim holds it; any other failure throws, because a write path
     * that cannot tell whether it holds the lock must not go on to sell the wood.
     */
    const claim = (record, lotId, itemId, orderKey) => {
        const rec = record.create({ type: TYPE });
        rec.setValue({ fieldId: 'externalid', value: externalIdFor(lotId) });
        rec.setValue({ fieldId: F_LOT, value: int(lotId) });
        if (int(itemId)) rec.setValue({ fieldId: F_ITEM, value: int(itemId) });
        if (orderKey) rec.setValue({ fieldId: F_KEY, value: String(orderKey).slice(0, 64) });
        try {
            return { ok: true, claimId: rec.save() };
        } catch (e) {
            if (isDuplicate(e)) return { ok: false, taken: true };
            throw e;
        }
    };

    /** Names the order and line on a claim the endpoint already holds. */
    const finalize = (record, claimId, soId, lineKey) => {
        record.submitFields({
            type: TYPE, id: int(claimId),
            values: { [F_SO]: int(soId), [F_LINE]: int(lineKey) },
        });
    };

    /** Releases a bundle. A claim already gone is not an error. */
    const release = (record, claimId) => {
        try {
            record.delete({ type: TYPE, id: int(claimId) });
            return true;
        } catch (e) {
            const s = (e && ((e.name || '') + ' ' + (e.message || ''))) || '';
            if (/RCRD_DSNT_EXIST|does not exist/i.test(s)) return false;
            throw e;
        }
    };

    /** Age of a claim in minutes, from its `since` ('YYYY-MM-DD HH24:MI:SS', account time) against `nowAcct` in the same clock. */
    const ageMinutes = (since, nowAcct) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(since || ''));
        const n = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(nowAcct || ''));
        if (!m || !n) return null;
        const t = (a) => Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4], +a[5], +a[6]);
        return (t(n) - t(m)) / 60000;
    };

    /* ── What the reconciler does with one claim (2.7, 2.7b, 2.7c, 3.1) ────────
     *
     * Pure, so every branch is testable without NetSuite. BASE units throughout
     * (SuiteQL's own unit; SO line quantities arrive negative and are abs'd by
     * the caller). Two directions, never mixed (plan 2.7c):
     *   SO-side failure      -> RELEASE the bundle (void SO, deleted/closed line,
     *                           item changed under the reservation, fulfilled);
     *   supply-side failure  -> KEEP it and REPORT an exception. MA 2026-09-22:
     *                           no auto-release, « un endroit qui identifie les
     *                           bundles réservés sur des SOs, mais qui ne seront
     *                           jamais reçus ».
     * And the hand-off (3.1): once the lot has stock at the line's location,
     * assign min(open, stock there) to the SO line. The claim is released only
     * when the line is fully covered; a short arrival keeps it, reported.
     *
     * facts = { nowAcct, so: {type, status} | null, line: {item, location,
     *   qtyBase, shippedBase, closed} | null, stock: [{location, onHandBase,
     *   onOrderBase}], assignedOnLineBase, otherCommitBase, poLines: [{closedLine,
     *   closedPo, orderedBase, receivedBase, bundleBase}], poHasReceipt,
     *   assignedAllOnLineBase (every lot on the line, not only this one) }
     *
     * Returns { action: 'release' | 'handoff' | 'keep', reason, exception,
     *           handoffBase, releaseAfterHandoff, alert } */
    const EPS = 1e-6;
    const decideClaim = (c, f) => {
        const out = (action, reason, extra) => Object.assign(
            { action, reason, exception: null, handoffBase: 0, releaseAfterHandoff: false, alert: false }, extra || {});
        if (c.inactive) return out('release', 'the claim was inactivated by hand');
        if (!c.soId) {
            if (c.lineKey) return out('release', 'the sales order was deleted');
            /* Final review M2: the order WAS found by the request key but its line
             * could not be told apart. Releasing it on the TTL would leave a bare
             * line that locks every bundle of the item, so it is kept for a person. */
            if (f.orderFound) return out('keep', 'the order exists but its line is ambiguous', { alert: true });
            const age = ageMinutes(c.since, c.nowAcct || f.nowAcct);
            return (age !== null && age >= PENDING_TTL_MIN)
                ? out('release', 'abandoned: no order named it within ' + PENDING_TTL_MIN + ' minutes')
                : out('keep', 'pending, an order is being saved');
        }
        const so = f.so;
        if (!so || String(so.type).split(':')[0] !== 'SalesOrd') return out('release', 'the sales order no longer exists');
        const st = String(so.status || '').split(':').pop();
        if (st === 'C') return out('release', 'the sales order was cancelled');
        if (st === 'H') return out('release', 'the sales order was closed');
        const line = f.line;
        if (!line) return out('release', 'the line was removed from the sales order');
        if (line.closed) return out('release', 'the sales order line was closed');
        if (c.itemId && line.item && Number(line.item) !== Number(c.itemId)) {
            return out('release', 'the line now carries another item', { alert: true });
        }
        const need = Math.abs(line.qtyBase);
        const shipped = Math.abs(line.shippedBase || 0);
        const open = Math.max(0, need - shipped);
        if (open <= EPS) return out('release', 'the line is fulfilled');
        /* Two figures, review 2026-09-23 (HIGH 2): this bundle on the line, and
         * EVERY lot on the line. A line a person filled with another bundle by hand
         * no longer needs this one, so it is released; and a hand-off is capped by
         * what the line still lacks from all lots, never only from this one. */
        /* 🔴 GROSS AGAINST GROSS (final review M1). An assignment survives
         * fulfilment, so the assigned figures are GROSS while `open` is net of what
         * shipped. Comparing them released a short-landed claim as soon as the part
         * that did land shipped. Coverage is measured against the line's whole
         * quantity instead. */
        const assigned = Math.abs(f.assignedOnLineBase || 0);
        const assignedAll = Math.max(assigned, Math.abs(f.assignedAllOnLineBase || 0));
        if (assignedAll >= need - EPS) {
            return out('release', assigned >= need - EPS
                ? 'handed over: the line carries the bundle'
                : 'the line is already covered by another bundle');
        }

        const stock = f.stock || [];
        const total = stock.reduce((s, x) => s + Math.max(0, x.onHandBase || 0), 0);
        if (total > EPS) {
            if ((f.otherCommitBase || 0) > EPS) {
                return out('keep', 'another sales order also holds this bundle', { alert: true });
            }
            const here = stock.filter((x) => String(x.location) === String(line.location))
                .reduce((s, x) => s + Math.max(0, x.onHandBase || 0), 0);
            if (here <= EPS) return out('keep', 'landed at another location', { exception: 'VAL_LOCATION_CHANGED' });
            /* 🔴 NET OF WHAT IS ALREADY ON THE LINE (review 2026-09-23, HIGH 1). An
             * assignment does not lower on-hand, so after a short hand-off `here`
             * still counts the part already given, and the next run handed it out a
             * second time. `free` is what of this bundle is not on the line yet. */
            // `here` is net of what shipped from the bundle, so only the UNSHIPPED
            // part of what it already gave is still sitting in it.
            const free = here - Math.max(0, assigned - shipped);
            if (free <= EPS) return out('keep', 'landed short, all of it is on the line', { exception: 'VAL_RECEIVED_SHORT' });
            const give = Math.min(need - assignedAll, free);
            const full = assignedAll + give >= need - EPS;
            return out('handoff', full ? 'landed: handing the bundle to its line' : 'landed short',
                { handoffBase: give, releaseAfterHandoff: full, exception: full ? null : 'VAL_RECEIVED_SHORT' });
        }

        // Still on the water, or lost. Supply-side: report, never release.
        const po = f.poLines || [];
        const live = po.filter((p) => !p.closedLine && !p.closedPo);
        if (!po.length) return out('keep', 'the bundle is on no PO line', { exception: 'VAL_REMOVED_FROM_PO' });
        if (!live.length) return out('keep', 'its PO line is closed', { exception: 'VAL_PO_LINE_CLOSED' });
        if (f.poHasReceipt) return out('keep', 'the PO was received without it', { exception: 'VAL_RECEIVED_WITHOUT' });
        const onOrder = stock.reduce((s, x) => s + Math.max(0, x.onOrderBase || 0), 0);
        const bundle = live.reduce((s, p) => s + Math.abs(p.bundleBase || 0), 0);
        if (onOrder + EPS < bundle || live.some((p) => Math.abs(p.orderedBase) + EPS < Math.abs(p.bundleBase || 0))) {
            return out('keep', 'its PO line was reduced', { exception: 'VAL_PO_LINE_CLOSED' });
        }
        if (need > bundle + EPS) return out('keep', 'the SO line asks for more than the bundle', { exception: 'VAL_SO_LINE_ABOVE_BUNDLE' });
        return out('keep', 'on the water');
    };

    return {
        TYPE, F_LOT, F_ITEM, F_SO, F_LINE, F_KEY, PENDING_TTL_MIN, CLAIMS_SQL,
        externalIdFor, readClaims, readExceptions, claim, finalize, release, isDuplicate, ageMinutes, decideClaim,
    };
});
