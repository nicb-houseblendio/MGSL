/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description CWP ARCH bundle split — the only sanctioned write path.
 *
 * The warehouse screen POSTs the measured quantities here; this posts the
 * Inventory Adjustment that splits the lot and trues the Sales Order line up to
 * what was actually picked.
 *
 * ── Why a Suitelet and not a RESTlet ────────────────────────────────────────
 * A RESTlet runs as the calling user. Warehouse and trader roles cannot write
 * inventory adjustments, so a RESTlet drops those writes — sometimes silently.
 * That failure mode hit PO Allocation twice and its RESTlet was retired on
 * 2026-07-30. This deployment runs Execute-as-Role = Administrator so the write
 * always lands, which then makes the authorisation check this script's own
 * responsibility rather than NetSuite's.
 *
 * ── The role check fails CLOSED, and that is the point ──────────────────────
 * Running as Administrator means the deployment audience is not a security
 * boundary — anyone who can reach the URL writes as an administrator. The
 * audience has to stay wide enough for warehouse staff to load it, so the real
 * boundary is the allowlist below.
 *
 * `custscript_arch_split_roles` holds the permitted role internal IDs, comma
 * separated. If it is empty or unset, ONLY Administrator passes. That default
 * is deliberate: the warehouse role is still an open question with
 * Marc-Antoine, and until it is answered an unconfigured deployment must refuse
 * everyone rather than admit everyone. Sibling deployment 6495 currently sits at
 * allemployees=T, which is exactly the shape of mistake this guards against.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * POST, JSON body:
 *   { soId, lineUniqueKey, lotId, locationId, customerQty, remainderQty,
 *     subsidiaryId, adjustmentAccountId, soTranId, dryRun? }
 * Quantities are DISPLAY units — board feet for Lumber. The library converts to
 * NetSuite's stored base unit; nothing here should do unit maths.
 *
 * Replies { ok: true, ... } or { ok: false, error, code }. Never a raw stack —
 * the warehouse screen shows the message verbatim to someone holding a tape
 * measure, so it has to read as an instruction.
 *
 * GET returns a small health payload and performs no writes. Useful for
 * confirming the deployment, the role allowlist and the executing user without
 * touching a bundle.
 */
define(['N/runtime', 'N/log', './../../shared/archSplitExecute'], (runtime, log, splitLib) => {

    const ROLE_ADMINISTRATOR = 3;

    /** Role IDs permitted to complete a split. Empty parameter = Administrator only. */
    const permittedRoles = () => {
        const raw = runtime.getCurrentScript().getParameter({ name: 'custscript_arch_split_roles' });
        const ids = String(raw || '')
            .split(',')
            .map((s) => parseInt(String(s).trim(), 10))
            .filter((n) => !isNaN(n));
        if (!ids.length) return [ROLE_ADMINISTRATOR];
        // Administrator always retains access so a misconfigured list cannot lock
        // out the person who has to fix it.
        if (ids.indexOf(ROLE_ADMINISTRATOR) === -1) ids.push(ROLE_ADMINISTRATOR);
        return ids;
    };

    /**
     * A Suitelet cannot set an HTTP status code — NetSuite answers 200 to
     * everything, including refusals. Verified by testing: a malformed body and
     * a missing record both came back 200.
     *
     * So the status is carried in the payload as `status`, advisory only, and
     * clients MUST branch on `ok` and `code`. An earlier version called this
     * field `httpStatus`, which invited exactly the wrong thing: a caller
     * checking response.status would have read every error as success.
     */
    const respond = (context, status, payload) => {
        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        if (status) payload.status = status;
        context.response.write({ output: JSON.stringify(payload) });
    };

    const REQUIRED = [
        'soId', 'lineUniqueKey', 'lotId', 'locationId',
        'customerQty', 'remainderQty', 'subsidiaryId', 'adjustmentAccountId', 'departmentId',
    ];

    const onRequest = (context) => {
        const user = runtime.getCurrentUser();
        const allowed = permittedRoles();

        if (allowed.indexOf(Number(user.role)) === -1) {
            log.error('ARCH Split Execute',
                'Refused: user ' + user.id + ' role ' + user.role + ' is not in [' + allowed.join(',') + ']');
            return respond(context, 403, {
                ok: false,
                code: 'FORBIDDEN',
                error: 'Your role is not permitted to complete bundle splits. Ask an administrator to add it.',
            });
        }

        if (context.request.method === 'GET') {
            return respond(context, 200, {
                ok: true,
                service: 'arch-split-execute',
                user: user.id,
                role: user.role,
                permittedRoles: allowed,
                rolesConfigured: allowed.length > 1,
            });
        }

        if (context.request.method !== 'POST') {
            return respond(context, 405, { ok: false, code: 'METHOD', error: 'Use POST to complete a split.' });
        }

        let input;
        try {
            input = JSON.parse(context.request.body || '{}');
        } catch (e) {
            return respond(context, 400, { ok: false, code: 'BAD_JSON', error: 'The request body was not valid JSON.' });
        }

        const missing = REQUIRED.filter((k) => input[k] === undefined || input[k] === null || input[k] === '');
        if (missing.length) {
            return respond(context, 400, {
                ok: false, code: 'MISSING_FIELDS',
                error: 'Missing from the request: ' + missing.join(', ') + '.',
            });
        }

        input.customerQty  = parseFloat(input.customerQty);
        input.remainderQty = parseFloat(input.remainderQty);
        if (!isFinite(input.customerQty) || !isFinite(input.remainderQty)) {
            return respond(context, 400, {
                ok: false, code: 'BAD_QTY',
                error: 'The quantities must be numbers. Decimals are fine and expected.',
            });
        }

        try {
            // Dry run revalidates against live data and reports what WOULD happen,
            // writing nothing. The screen uses it to catch a stale queue before
            // the worker has walked to the bundle.
            if (input.dryRun) {
                const v = splitLib.revalidate(input);
                return respond(context, 200, {
                    ok: true,
                    dryRun: true,
                    alreadyDone: !!v.alreadyDone,
                    parentLot: v.lot ? v.lot.lotName : undefined,
                    proposedChildLot: v.lot ? splitLib.nextChildLotNumber(v.lot.lotName, v.lot.siblings) : undefined,
                    onHandDisplay: v.lot ? splitLib.toDisplay(v.lot.storedQty, v.rate) : undefined,
                });
            }

            const result = splitLib.executeSplit(input);
            log.audit('ARCH Split Execute',
                'Completed by user ' + user.id + ': ' + JSON.stringify(result));
            return respond(context, 200, result);

        } catch (e) {
            // Expected refusals (a sold bundle, a removed line, a second worker
            // getting there first) are AUDIT, not ERROR. They are the guard doing
            // its job, and logging them as errors would bury the real failures —
            // the same mistake that once put hundreds of lines a day in the log.
            const message = e.message || String(e);
            // "That record does not exist" is NetSuite's own wording when the
            // Sales Order or lot has been deleted since the queue was drawn.
            // That is the guard working, not a system fault, so it must not be
            // logged as an error.
            const expected = /no longer|already|more than|greater than|nothing on hand|cannot be negative|does not exist/i.test(message);
            if (expected) {
                log.audit('ARCH Split Execute', 'Refused for user ' + user.id + ': ' + message);
            } else {
                log.error('ARCH Split Execute', 'Failed for user ' + user.id + ': ' + message +
                          (e.stack ? ' | ' + e.stack : ''));
            }
            return respond(context, expected ? 409 : 500, {
                ok: false,
                code: expected ? 'CONFLICT' : 'FAILED',
                error: message,
            });
        }
    };

    return { onRequest: onRequest };
});
