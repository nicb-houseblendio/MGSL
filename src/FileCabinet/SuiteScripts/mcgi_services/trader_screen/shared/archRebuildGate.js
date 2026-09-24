/**
 * archRebuildGate.js — when the ARCH cache chain runs a real rebuild.
 *
 * Until 2026-09-23 the rule was "every 15 minutes", so a trader's reservation,
 * a receipt or an IA took up to 15 min (plus a ~80 s build) to reach the
 * screen. The stated reason was log volume: 239 script notes per rebuild, 232 of
 * them MCGI_LIB_LotCost debug lines. The deployment runs at AUDIT now (7 notes),
 * so the rule becomes:
 *
 *   rebuild SOON AFTER SOMETHING CHANGED, never within FLOOR_MS of the last
 *   start, never more than HOURLY_CAP times in an hour, and at least every
 *   BACKSTOP_MS (the old 15 minutes) whatever happens.
 *
 * "Something changed" is a SIGNATURE of ARC activity, compared with the one
 * stored at the last rebuild's start:
 *   - transactions with an ARC line (any type: SO, PO, IR, IF, IA, TO, JE,
 *     invoice, bill) modified since the ANCHOR: count, max(lastmodifieddate) and
 *     an id-and-time hash, so a late commit (count) and a second edit of a row
 *     already in the window (hash) both show;
 *   - claims, inventory holds and packing-list captures, UNWINDOWED (count,
 *     sum(id), max(lastmodified)): small tables, and a deleted or lifted row
 *     leaves no timestamp behind (MTL learned this with holds);
 *   - the lot mirror (custitemnumber_arch_res_*): a reservation's exception
 *     badge can change while its claim does not;
 *   - the newest deletion in the last day (no subsidiary column, so any
 *     deletion over-triggers once, safely). 🔴 ON ITS OWN CLOCK: measured
 *     2026-09-23 under N/query, `deleteddate` reads on the SYSDATE clock (PT)
 *     while `lastmodifieddate` reads on the CURRENT_DATE clock (ET). Windowed by
 *     the data anchor, every deletion would stay invisible for three hours.
 * Item record edits, currency rates and customer changes are not in it; the
 * backstop covers them.
 *
 * 🔴 CLOCKS. The anchor is taken FROM THE DATA (max lastmodifieddate at the
 * rebuild's start, minus ANCHOR_MARGIN_MIN) and moved by pure arithmetic on the
 * wall-clock string, never from JS time or SYSDATE. N/query formats times on
 * one clock and SYSDATE on another (archReservation.js, measured), so a JS or
 * SYSDATE anchor could sit hours after the data, the window would be empty, and
 * the screen would silently run on the backstop looking healthy.
 *
 * Every rule here errs toward an EXTRA rebuild, never a skipped one: an absent
 * or unreadable stamp runs, a stale stored signature compares as changed, an
 * evicted state starts over. Only the backstop is unconditional.
 *
 * Pure: no NetSuite modules. The MR does the reading and writing.
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
    const FLOOR_MS          = 60 * 1000;        // IND and MTL run 60 s in prod
    const BACKSTOP_MS       = 15 * 60 * 1000;   // the old rule, kept as the floor of freshness
    const DETECT_MS         = 60 * 1000;        // the change check, at most once a minute
    const HOURLY_CAP        = 15;               // real rebuilds in any rolling hour
    const ANCHOR_MARGIN_MIN = 5;                // commit skew at the window's edge
    // Consecutive failed rebuilds -> minutes to wait before the next EARLY one.
    // Index 4+ is the backstop itself.
    const BACKOFF_MIN = [0, 2, 4, 8, 15];

    const TS = "'YYYY-MM-DD HH24:MI:SS'";
    const ARC_TXN = 'EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction = t.id AND tl.subsidiary = 9)';

    const TXN_SQL =
        'SELECT COUNT(*) AS n, TO_CHAR(MAX(t.lastmodifieddate), ' + TS + ') AS mx, ' +
        "SUM(MOD(t.id * TO_NUMBER(TO_CHAR(t.lastmodifieddate, 'DDHH24MISS')), 1000000007)) AS h " +
        'FROM transaction t WHERE t.lastmodifieddate >= TO_DATE(?, ' + TS + ') AND ' + ARC_TXN;

    /* The first anchor, when there is none: the newest ARC change in two days.
     * `SYSDATE - 2` only BOUNDS the scan (an unbounded MAX took 3.9 s); being two
     * days wide, a clock offset of a few hours cannot empty it. */
    const SEED_SQL =
        'SELECT TO_CHAR(MAX(t.lastmodifieddate), ' + TS + ') AS mx FROM transaction t ' +
        'WHERE t.lastmodifieddate >= SYSDATE - 2 AND ' + ARC_TXN;

    const TABLES = ['customrecord_arch_res', 'customrecord_mgsl_inventory_hold', 'customrecord_msl_plc_capture'];
    const tableSql = (type) =>
        'SELECT COUNT(*) AS n, SUM(id) AS s, TO_CHAR(MAX(lastmodified), ' + TS + ') AS mx FROM ' + type;

    /* Only record types the ARCH screen reads. Measured 2026-09-23, prod's last
     * day of deletions was 38 customrecord_celigo_rt1_lock and 2 fxreval: account
     * wide, each would have been an ARCH rebuild. No subsidiary column exists, so
     * an IND or MTL deletion of one of these types still triggers one, safely. */
    // All seen in deletedrecord in sandbox or prod (2026-09-23) except
    // inventorytransfer, which never appeared; a wrong name only drops that type
    // to the backstop.
    const DELETED_TYPES = ['salesorder', 'purchaseorder', 'itemreceipt', 'itemfulfillment', 'inventoryadjustment',
        'transferorder', 'inventorytransfer', 'inventorynumber', 'journalentry', 'vendorbill', 'invoice', 'assemblybuild',
        'customrecord_arch_res', 'customrecord_mgsl_inventory_hold', 'customrecord_msl_plc_capture'];
    const DELETED_SQL = 'SELECT TO_CHAR(MAX(deleteddate), ' + TS + ') AS mx FROM deletedrecord ' +
        'WHERE deleteddate >= SYSDATE - 1 AND recordtypeid IN (' + DELETED_TYPES.map((t) => "'" + t + "'").join(', ') + ')';

    const MIRROR_SQL =
        'SELECT COUNT(*) AS n, SUM(id) AS s, SUM(NVL(custitemnumber_arch_res_exception, 0)) AS e, ' +
        'SUM(NVL(custitemnumber_arch_res_line, 0)) AS l FROM inventorynumber ' +
        'WHERE custitemnumber_arch_res_so IS NOT NULL OR custitemnumber_arch_res_exception IS NOT NULL';

    const int = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };

    /** 'YYYY-MM-DD HH:MM:SS' minus `min` minutes, same clock, same format. '' if unparsable. */
    const minusMinutes = (stamp, min) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(stamp || ''));
        if (!m) return '';
        const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - min * 60 * 1000;
        const d = new Date(t);
        const p = (n) => (n < 10 ? '0' : '') + n;
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
               p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
    };

    /**
     * Read the signature. `run(sql, params)` returns mapped rows. Throws if the
     * transaction window or the deletions fail (nothing to detect without them);
     * the other parts sign as 'x' when their table cannot be read.
     * Returns { sig, mx } where mx is the newest ARC transaction change in the
     * window ('' if none), the source of the next anchor.
     */
    const readSignature = (run, anchor) => {
        const first = (sql, params) => { const r = run(sql, params || []); return r && r.length ? r[0] : {}; };
        /* The transaction window and the deletions are STRICT: they exist in every
         * account, and without them there is nothing to detect. The Feedback 8 and
         * capture tables and the lot mirror are TOLERANT: a missing one signs as
         * 'x'. Review 2026-09-23: prod has no customrecord_arch_res until X.2, and a
         * strict read turned the whole check off there. A table that is always
         * missing gives a stable part; one that fails now and then costs an extra
         * rebuild, the safe direction. */
        const soft = (label, fn) => { try { return label + ':' + fn(); } catch (e) { return label + ':x'; } };
        const t = first(TXN_SQL, [anchor]);
        const parts = ['t:' + int(t.n) + '|' + (t.mx || '') + '|' + (t.h == null ? '' : String(t.h))];
        TABLES.forEach((type) => {
            parts.push(soft(type.replace('customrecord_', ''), () => {
                const r = first(tableSql(type));
                return int(r.n) + '|' + (r.s == null ? '' : String(r.s)) + '|' + (r.mx || '');
            }));
        });
        parts.push(soft('mirror', () => {
            const m = first(MIRROR_SQL);
            return int(m.n) + '|' + (m.s == null ? '' : String(m.s)) + '|' + (m.e == null ? '' : String(m.e)) + '|' + (m.l == null ? '' : String(m.l));
        }));
        parts.push('d:' + (first(DELETED_SQL).mx || ''));
        return { sig: parts.join(' '), mx: t.mx || '' };
    };

    /**
     * Before any query. Returns { go: 'run'|'skip'|'detect', reason }.
     *   s.now        ms
     *   s.lastStart  the pacing stamp (ms), 0 if absent
     *   s.debug      the deployment's log level is DEBUG
     *   s.state      { starts: [ms], checkAt: ms, sig, anchor, fails }
     */
    const decide = (s) => {
        const now = Number(s.now);
        const st = s.state || {};
        const last = Number(s.lastStart);
        const age = (last > 0 && last <= now) ? now - last : Infinity;
        if (age === Infinity) {
            /* Review L1: a lost pacing stamp fails open, as it always has, but the
             * gate's own record of starts is a second floor, so an evicted or
             * unwritable stamp cannot become a rebuild on every cycle. */
            const lastRecorded = Math.max(0, ...startsInLastHour(st, now));
            if (lastRecorded && now - lastRecorded < FLOOR_MS) return { go: 'skip' };
            return { go: 'run', reason: 'no pacing stamp' };
        }
        if (age < FLOOR_MS) return { go: 'skip' };
        if (age >= BACKSTOP_MS) return { go: 'run', reason: 'backstop, ' + Math.round(age / 60000) + ' min since the last start' };
        // At DEBUG a rebuild is 239 notes: stay on the backstop (review H4).
        if (s.debug) return { go: 'skip' };
        const fails = Math.min(int(st.fails), BACKOFF_MIN.length - 1);
        if (fails > 0 && age < BACKOFF_MIN[fails] * 60 * 1000) return { go: 'skip' };
        if (startsInLastHour(st, now).length >= HOURLY_CAP) return { go: 'skip' };
        const ca = Number(st.checkAt) || 0;
        if (ca > 0 && ca <= now && now - ca < DETECT_MS) return { go: 'skip' };
        return { go: 'detect' };
    };

    /** After the detector. A stored signature is required to call anything a change. */
    const onSignature = (st, sigNow) => {
        if (!st || !st.sig) return { go: 'skip', reason: 'seeded' };
        if (sigNow !== st.sig) return { go: 'run', reason: 'change detected' };
        return { go: 'skip' };
    };

    /**
     * Did the TRANSACTIONS or the DELETIONS move between two signatures?
     *
     * The part the reservation reconciler cares about (2026-09-24): a sales order
     * voided, a line removed, a line given another bundle, a PO received. The
     * other parts are claims, holds, captures and the lot mirror, and the
     * reconciler WRITES the claims and the mirror itself, so counting them would
     * have it restart itself after every run. Its one transaction write, a
     * hand-off onto an SO line, costs at most one extra quiet run.
     *
     * False when either side is missing: a seeded or stale signature is not
     * evidence of a change here, and the 15-minute backstop still covers it.
     */
    const txnPartsChanged = (prevSig, nextSig) => {
        if (!prevSig || !nextSig) return false;
        // Split only before a label: the parts' own timestamps contain spaces.
        const pick = (sig) => String(sig).split(/ (?=[a-z_]+:)/).filter((p) => /^(t|d):/.test(p)).join(' ');
        return pick(prevSig) !== pick(nextSig);
    };

    const startsInLastHour = (st, now) =>
        ((st && Array.isArray(st.starts)) ? st.starts : [])
            .map(Number).filter((t) => t > now - 3600 * 1000 && t <= now);

    /** The state to store when a real rebuild starts. */
    const startedState = (st, now, sig, anchor) => ({
        starts:  startsInLastHour(st, now).concat([now]),
        checkAt: now,
        sig:     sig || '',
        anchor:  anchor || (st && st.anchor) || '',
        fails:   int(st && st.fails),
        running: now,
    });

    /** At summarize of a REAL run: count a failure, or clear the count. */
    const finishedState = (st, failed) => Object.assign({}, st || {}, {
        fails: failed ? int(st && st.fails) + 1 : 0,
        running: 0,
    });

    return {
        FLOOR_MS, BACKSTOP_MS, DETECT_MS, HOURLY_CAP, ANCHOR_MARGIN_MIN, BACKOFF_MIN,
        TXN_SQL, SEED_SQL, TABLES, tableSql, DELETED_SQL, MIRROR_SQL,
        minusMinutes, readSignature, decide, onSignature, txnPartsChanged, startsInLastHour, startedState, finishedState,
    };
});
