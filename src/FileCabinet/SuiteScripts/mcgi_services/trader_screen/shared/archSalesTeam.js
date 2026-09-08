/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Who the trader on a sales order is, read from the SALES TEAM sublist.
 *
 * ── Why the header field is not enough ──────────────────────────────────────
 * `transaction.employee` is the header Sales Rep. With Team Selling on, NetSuite
 * puts the rep on the Sales Team sublist instead and leaves the header null.
 * Measured 2026-09-08 in the sandbox on every ARCH order created from the trader
 * screen (SO-CWP-001350..001354): header rep null on 4 of 4, sublist populated on
 * 4 of 4. Reading the header alone is why the Open Orders tab grouped every real
 * order under "Unassigned" (Marc-Antoine, 2026-09-08).
 *
 * ── Why not `isprimary` ─────────────────────────────────────────────────────
 * The flag reads 'F' on all 5 sublist rows of the ARCH orders created from the
 * trader screen, our own writer included, so a `WHERE isprimary = 'T'` filter
 * returns nothing for them and would leave the tab exactly as broken. It IS set
 * elsewhere in the account: 54 primary rows out of 10,162, across 8,658
 * transactions, measured 2026-09-08. So it is honoured when present and never
 * relied on. ⚠️ An earlier version of this note said "'F' on 5 of 5 rows in the
 * account", which was a four-order measurement written up as account-wide.
 *
 * ── ⚠️ UNVERIFIED UNDER THE TRADER ROLE ─────────────────────────────────────
 * Every measurement behind this file was taken as Administrator. The trader screen
 * service is called from a RESTlet, a RESTlet IGNORES `runasrole` and runs as the
 * CALLER, and `archOrderCreate.js:668` already records that the ARCH trader role
 * cannot read the employee table at all ("Record employee was not found") - which is
 * why `listSalesReps` was moved off the RESTlet onto a Suitelet. If that role also
 * cannot read `transactionsalesteam`, or reads it but cannot resolve
 * `BUILTIN.DF(st.employee)`, the tab returns to "Unassigned" for the actual users and
 * the failure is invisible. TEST AS EMPLOYEE 3293 (role 2181) BEFORE CALLING THIS
 * FIXED. Partly mitigated below: an id that resolves with an unreadable name no
 * longer falls through to the header rep, so the name and the id cannot disagree.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A primary member if any; else the highest contribution; a tie goes to the
 * lowest employee id so two reads of the same order agree. A shared order
 * (SO-CWP-001352 is a real 50/50) is flagged `shared` and `tied` rather than
 * silently attributed, because the tab has to pick ONE name to group under.
 *
 * ── Why a second query and never a JOIN ─────────────────────────────────────
 * The open-orders and split-queue queries are per LINE and already fan out per
 * lot assignment. Joining the sublist in would multiply every line of a two-rep
 * order by two; measured on SO-CWP-001352 during the 2026-09-08 audit, the
 * totals doubled. So this runs as its own query over the transaction ids and the
 * caller looks the rep up by id.
 */
define(['N/query', 'N/log'], (query, log) => {

    /** Oracle-style IN lists cap at 1000 entries; stay well under. */
    const CHUNK = 500;

    const SQL =
        'SELECT ' +
        '  st.transaction           AS tranid, ' +
        '  st.employee              AS repid, ' +
        '  BUILTIN.DF(st.employee)  AS rep, ' +
        '  st.contribution          AS contribution, ' +
        '  st.isprimary             AS isprimary ' +
        'FROM transactionsalesteam st ' +
        'WHERE st.transaction IN (%IDS%)';

    const num = (v) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : 0;
    };

    /**
     * One rep out of a transaction's sublist rows, or null for none.
     * Exported for the test; the rule above, in code.
     */
    const pickRep = (members) => {
        if (!members || !members.length) return null;
        const primaries = members.filter((m) => String(m.isprimary || '').toUpperCase() === 'T');
        const pool = primaries.length ? primaries : members;
        let best = null;
        pool.forEach((m) => {
            if (!best) { best = m; return; }
            const c = num(m.contribution);
            const bc = num(best.contribution);
            if (c > bc || (c === bc && parseInt(m.repid, 10) < parseInt(best.repid, 10))) best = m;
        });
        const top = num(best.contribution);
        // Counted within POOL, not members: `best` came from pool, so comparing it
        // against members measured two different sets. And with no `!primaries.length`
        // guard - two PRIMARIES splitting evenly is still a coin toss, and gating on the
        // flag reported that as a clean single attribution.
        const rivals = pool.filter((m) => m !== best && num(m.contribution) >= top).length;
        // A rep the caller's role can identify but not NAME: SuiteQL omits a null column
        // from the row entirely, so `rep` arrives ''. Reporting an id with a blank name
        // let the service fall through to the header rep and group the order under
        // "Unassigned" while Edit pre-selected the id, the two halves disagreeing.
        const repId = best.repid ? String(best.repid) : null;
        const name = String(best.rep || '').trim();
        return {
            repId:       repId,
            rep:         name || (repId ? 'Employee ' + repId : ''),
            /** True when the id resolved but the caller's role could not read the name. */
            nameUnreadable: !!repId && !name,
            memberCount: members.length,
            shared:      members.length > 1,
            /** True when the pick was a coin toss between equal contributions. */
            tied:        rivals > 0,
        };
    };

    /**
     * { [transactionId]: pickRep(...) } for every id that has sublist rows. Ids
     * are coerced to positive integers before they reach the SQL; anything else
     * is dropped, so this cannot be steered by a row value.
     */
    const repByTransaction = (tranIds) => {
        // Digits only, then parse. parseInt alone reads "1 OR 1=1" as 1, which is
        // harmless here but is not "an id"; the test pins the strict version.
        const ids = [...new Set((tranIds || [])
            .map((v) => (/^\s*\d+\s*$/.test(String(v)) ? parseInt(v, 10) : NaN))
            .filter((n) => isFinite(n) && n > 0))];
        const out = {};
        if (!ids.length) return out;
        const byTran = {};
        // The try is INSIDE the loop on purpose. Wrapped around the whole loop, or left
        // to the caller's catch where it was until 2026-09-08, a failure on the last
        // chunk threw away every rep the earlier chunks had already resolved and the
        // whole tab reverted to "Unassigned".
        let failedChunks = 0;
        const chunkCount = Math.ceil(ids.length / CHUNK);
        for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK);
            try {
                const rows = query.runSuiteQL({ query: SQL.replace('%IDS%', slice.join(',')) }).asMappedResults();
                rows.forEach((r) => {
                    const k = String(r.tranid);
                    (byTran[k] = byTran[k] || []).push(r);
                });
            } catch (e) {
                failedChunks++;
                log.error('ARCH sales team - chunk read failed, keeping what resolved',
                    'ids ' + slice[0] + '..' + slice[slice.length - 1] + ': ' +
                    (e.name || '') + ': ' + (e.message || String(e)));
            }
        }
        if (failedChunks) {
            // ERROR, not audit: some orders will silently read Unassigned, and an hourly
            // audit line once hid a four-day outage on this screen.
            log.error('ARCH sales team - PARTIAL read',
                failedChunks + ' of ' + chunkCount + ' chunk(s) failed, so some orders fall back to ' +
                'the header rep and will read Unassigned. This is a partial result, not an empty one.');
        }
        Object.keys(byTran).forEach((k) => { out[k] = pickRep(byTran[k]); });
        const tiedCount = Object.keys(out).filter((k) => out[k].tied).length;
        if (tiedCount) {
            log.audit('ARCH sales team',
                tiedCount + ' order(s) split evenly between reps with no primary; grouped under the lowest employee id and flagged tied.');
        }
        return out;
    };

    return { repByTransaction: repByTransaction, pickRep: pickRep };
});
