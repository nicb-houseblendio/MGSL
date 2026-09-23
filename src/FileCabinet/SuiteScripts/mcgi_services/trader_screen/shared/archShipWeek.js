/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description CWP ARCH: the ONE rule for "when does this sales order ship".
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Feedback 13 (2026-09-22). Five surfaces show an order's ship week: the lot
 * drawer (Reserved and Ready to Build), the Reserved panel, the Open Orders tab,
 * the warehouse split queue and the wizard's append preload. Each read the
 * native `shipdate` with its own copy of "equal to the order date means
 * default", and two copies of a rule is how two screens end up describing one
 * order differently. The cache MR, the open-orders service and the split queue
 * now all call `readShipWeeks` + `resolve` from here, and the browser only
 * renders what they return.
 *
 * ── Which field ─────────────────────────────────────────────────────────────
 * `custbody_ship_week` ("Ship Week", on the ARC form 386, visible, editable) is
 * the field MGSL plan with. Measured in PRODUCTION since 2026-08-01: it differs
 * from the order date on 259 of 870 CWP MTL and 178 of 503 IND orders (set by a
 * human), while `shipdate` differs on 0 and 14. MTL and IND display it, and the
 * ARCH PO drill-down already reads it for the PO's ship week.
 *
 * It is a WEEK, not a day: 62% of hand-set values are Mondays (271 of 437), and
 * 40 of 171 September values fall BEFORE the order date (down to -57 days),
 * because the week an order ships in can start before it was entered. So a
 * value before the order date is real, and "late" means the week is over, not
 * that its first day has passed (see `dueInfo` in react-app/src/lib/archSplit.ts).
 *
 * ── The resolution, in order ────────────────────────────────────────────────
 *   1. Ship Week, unless it is a default. Equal to a real ship date, it is the
 *      wizard's typed day in both fields, so it is read as a DATE.
 *   2. The native ship date, unless it is a default. Kept because the wizard
 *      wrote ONLY `shipdate` until 2026-09-22: SO-ARC-25 (9/30) and SO-ARC-26
 *      (9/23) carry the trader's typed date there and a default Ship Week.
 *   3. Nothing, flagged `defaulted` when a value existed but was a default, so
 *      the screen can say why it shows none.
 *
 * Marc-Antoine's own V4 prototype defines the column the same way: "Ship Week"
 * is `mondayOf(ship)`, the Monday of the expected ship date, beside a separate
 * "Exp. Ship Date".
 *
 * A DEFAULT is a value equal to the order date OR to the day the record was
 * created. NetSuite fills both fields with the order date when nobody enters
 * one, and the SAP import (externalid SAP-ARC-SO-*) stamped Ship Week with the
 * import day, 2026-09-18, on every imported order, which matches neither the
 * order date nor any plan. A genuine same-day ship therefore reads as no date;
 * accepted, the confident wrong week is the worse error.
 */
define([], () => {

    /** YYYY-MM-DD from anything SuiteQL returns for a date, else ''. */
    const isoDate = (v) => {
        if (!v) return '';
        const s = String(v).trim();
        const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (mdy) return mdy[3] + '-' + ('0' + mdy[1]).slice(-2) + '-' + ('0' + mdy[2]).slice(-2);
        const ymd = s.match(/^(\d{4}-\d{2}-\d{2})/);
        return ymd ? ymd[1] : '';
    };

    /**
     * @param {{shipWeek?:string, shipDate?:string, tranDate?:string, createdDate?:string}} f
     * @returns {{date:string, source:''|'week'|'date', defaulted:boolean}}
     */
    const resolve = (f) => {
        const o = f || {};
        const td = isoDate(o.tranDate);
        const cd = isoDate(o.createdDate);
        const isDefault = (d) => d === td || (cd !== '' && d === cd);
        const sw = isoDate(o.shipWeek);
        const sd = isoDate(o.shipDate);
        // Both real and EQUAL means one exact day was typed into both, which is
        // what the wizard writes since Feedback 13: read it as a date, so it is
        // late the next day rather than a week later.
        if (sw && !isDefault(sw) && sw === sd) return { date: sd, source: 'date', defaulted: false };
        if (sw && !isDefault(sw)) return { date: sw, source: 'week', defaulted: false };
        if (sd && !isDefault(sd)) return { date: sd, source: 'date', defaulted: false };
        return { date: '', source: '', defaulted: !!(sw || sd) };
    };

    /**
     * The four dates `resolve` needs, for a list of sales-order ids, in ONE
     * isolated read per 500 ids.
     *
     * ISOLATED ON PURPOSE, never joined into a caller's main query: a custom
     * body field makes SuiteQL fail the WHOLE query when it is unreadable, and
     * the open-orders service runs as the trader's role, not as an
     * administrator. A failure here costs the ship week and nothing else: the
     * caller falls back to its own `shipdate`/`trandate`, `sourced` is false,
     * and it is logged at AUDIT because a degraded read is not an outage.
     *
     * @returns {{byId: Object<string,{shipWeek:string, shipDate:string, tranDate:string, createdDate:string}>, sourced: boolean}}
     */
    const readShipWeeks = (query, log, ids) => {
        const list = [];
        const seen = {};
        (ids || []).forEach((v) => {
            const n = parseInt(v, 10);
            if (n > 0 && !seen[n]) { seen[n] = true; list.push(n); }
        });
        const byId = {};
        for (let i = 0; i < list.length; i += 500) {
            const slice = list.slice(i, i + 500);
            try {
                query.runSuiteQL({
                    query: "SELECT id AS tranid, TO_CHAR(custbody_ship_week, 'YYYY-MM-DD') AS sw, " +
                           "       TO_CHAR(shipdate, 'YYYY-MM-DD') AS sd, " +
                           "       TO_CHAR(trandate, 'YYYY-MM-DD') AS td, " +
                           "       TO_CHAR(createddate, 'YYYY-MM-DD') AS cd " +
                           'FROM transaction WHERE id IN (' + slice.map(() => '?').join(',') + ')',
                    params: slice,
                }).asMappedResults().forEach((r) => {
                    byId[String(r.tranid)] = {
                        shipWeek: String(r.sw || ''),
                        shipDate: String(r.sd || ''),
                        tranDate: String(r.td || ''),
                        createdDate: String(r.cd || ''),
                    };
                });
            } catch (e) {
                if (log) {
                    log.audit('ARCH ship week not readable (non-fatal, the ship date is used instead)',
                        (e.name || '') + ': ' + (e.message || String(e)));
                }
                return { byId: {}, sourced: false };
            }
        }
        return { byId: byId, sourced: true };
    };

    /**
     * `resolve` for one order id, falling back to the caller's own dates when
     * the isolated read failed or did not return the id.
     */
    const forOrder = (read, id, fallback) => {
        const hit = read && read.byId ? read.byId[String(id)] : null;
        return resolve(hit || fallback || {});
    };

    return { isoDate: isoDate, resolve: resolve, readShipWeeks: readShipWeeks, forOrder: forOrder };
});
