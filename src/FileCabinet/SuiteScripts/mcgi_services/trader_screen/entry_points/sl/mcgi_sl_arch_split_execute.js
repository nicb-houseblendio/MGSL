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
 * is deliberate: an unconfigured deployment must refuse everyone rather than
 * admit everyone. The warehouse role was settled 2026-09-22 (Feedback 11): MA
 * opened the screen as 2183 Hardwood Logistics Coordinator, so the SDF ships
 * `customrole2183` for this parameter and in the audience. The warehouse page
 * (script 6495, deployment 4656) is allemployees=T, and since 2026-09-22 also
 * allroles=T and run-as Administrator by the client's hand, which is exactly the
 * shape of mistake this guards against.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * POST, JSON body:
 *   { soId, lineUniqueKey, lotId, locationId, customerQty, remainderQty,
 *     subsidiaryId, adjustmentAccountId, soTranId, dryRun? }
 * Quantities are DISPLAY units — board feet for Lumber, all the way to the write.
 * NETSUITE does the converting, not the library; nothing anywhere should do unit
 * maths. Corrected 2026-09-02: this line used to say the library converts.
 *
 * Replies { ok: true, ... } or { ok: false, error, code }. Never a raw stack —
 * the warehouse screen shows the message verbatim to someone holding a tape
 * measure, so it has to read as an instruction.
 *
 * GET returns a small health payload and performs no writes. Useful for
 * confirming the deployment, the role allowlist and the executing user without
 * touching a bundle.
 */
define(['N/runtime', 'N/log', './../../shared/archSplitExecute', './../../shared/archSplitQueue'],
(runtime, log, splitLib, queueLib) => {

    const ROLE_ADMINISTRATOR = 3;

    /**
     * Roles permitted to complete a split. Empty parameter = Administrator only.
     *
     * Each entry is an internal id (`2183`) OR a role SCRIPT id (`customrole2183`).
     *
     * 🔴 CORRECTED in round-2 review, 2026-09-22: a script id is portable ONLY if
     * the role was created with a chosen one. A role made by hand in the UI gets
     * `customrole<internal id>`, so `customrole2183` is exactly as account-bound as
     * `2183`: in production it would name whichever role is created 2183rd there
     * (`customrole2181` is already a different role in each account). Matching by
     * script id is still the right mechanism; the fix for production is a role
     * with a DESCRIPTIVE script id shipped as an SDF object, or a preflight that
     * `SELECT scriptid, name FROM role WHERE scriptid = 'customrole2183'` names the
     * Hardwood Logistics Coordinator before any deploy of this deployment.
     */
    const permittedRoles = () => {
        const raw = runtime.getCurrentScript().getParameter({ name: 'custscript_arch_split_roles' });
        const entries = String(raw || '')
            .split(',')
            .map((s) => String(s).trim().toLowerCase())
            .filter((s) => s !== '');
        if (!entries.length) return [String(ROLE_ADMINISTRATOR)];
        // Administrator always retains access so a misconfigured list cannot lock
        // out the person who has to fix it.
        if (entries.indexOf(String(ROLE_ADMINISTRATOR)) === -1) entries.push(String(ROLE_ADMINISTRATOR));
        return entries;
    };

    /** True when the signed-in role matches an entry by internal id or script id. */
    const rolePermitted = (user, allowed) =>
        allowed.indexOf(String(Number(user.role))) !== -1 ||
        allowed.indexOf(String(user.roleId || '').toLowerCase()) !== -1;

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

    // Deliberately short. Subsidiary, department and the GL account are resolved
    // from the order and from script configuration, never accepted from the
    // caller — a screen must not be able to choose where an adjustment posts.
    const REQUIRED = ['soId', 'lineUniqueKey', 'lotId', 'locationId', 'customerQty', 'remainderQty'];

    const onRequest = (context) => {
        const user = runtime.getCurrentUser();
        const allowed = permittedRoles();

        if (!rolePermitted(user, allowed)) {
            // AUDIT, not ERROR: a refusal is this check doing its job, and it fires
            // on every page load by a role not yet on the list (twelve times in
            // eleven minutes on 2026-09-22). The role id goes back in the payload so
            // the screen can tell an administrator exactly which id to add.
            log.audit('ARCH Split Execute',
                'Refused: user ' + user.id + ' role ' + user.role + ' (' + (user.roleId || '?') +
                ') is not in [' + allowed.join(',') + ']');
            return respond(context, 403, {
                ok: false,
                code: 'FORBIDDEN',
                role: Number(user.role),
                error: 'Your role (id ' + user.role + ') is not permitted to see or complete bundle splits. '
                    + 'An administrator must add it to Permitted Split Roles on the MCGI SL ARCH Split Execute deployment.',
            });
        }

        if (context.request.method === 'GET') {
            // The warehouse screen's queue. Read-only, and served from the same
            // deployment as the write so both sit behind one role allowlist —
            // whoever may complete a split may see what is waiting, and nobody
            // else sees either.
            if (context.request.parameters.action === 'queue') {
                try {
                    const q = queueLib.getPendingSplits();
                    return respond(context, 200, { ok: true, jobs: q.jobs, counts: q.counts });
                } catch (e) {
                    log.error('ARCH Split Execute', 'Queue read failed: ' + (e.message || String(e)));
                    return respond(context, 500, {
                        ok: false, code: 'QUEUE_FAILED',
                        error: 'Could not load the split queue: ' + (e.message || String(e)),
                    });
                }
            }
            return respond(context, 200, {
                ok: true,
                service: 'arch-split-execute',
                user: user.id,
                role: user.role,
                // The script id the allowlist can match on, so an admin can see
                // the exact string to put in Permitted Split Roles.
                roleId: user.roleId,
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
                    /*
                     * Null when the bundle does not DIVIDE, which is the same rule
                     * the write path applies (Feedback 6 item 16): a bundle sold
                     * whole mints no child, so promising one here would print a lot
                     * number on the work order that NetSuite is never going to
                     * create. Written as both quantities to mirror the write path
                     * exactly, though a customer quantity of zero is refused before
                     * it reaches either.
                     */
                    proposedChildLot: (v.lot && input.customerQty > 0 && input.remainderQty > 0)
                        ? splitLib.nextChildLotNumber(v.lot.lotName, v.lot.siblings)
                        : undefined,
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
            /* The adjustment committed and a later step failed. NOT a refusal and
               NOT "nothing happened": its own code, the adjustment id, and ERROR,
               because somebody has to finish the order line by hand. Checked
               before the expected-refusal regex, which its wording would match. */
            if (e.posted) {
                log.error('ARCH Split Execute', 'POSTED BUT INCOMPLETE for user ' + user.id + ': ' + message);
                return respond(context, 500, {
                    ok: false,
                    code: 'POSTED_INCOMPLETE',
                    posted: true,
                    inventoryAdjustmentId: e.inventoryAdjustmentId,
                    error: message,
                });
            }
            // "That record does not exist" is NetSuite's own wording when the
            // Sales Order or lot has been deleted since the queue was drawn.
            // That is the guard working, not a system fault, so it must not be
            // logged as an error.
            // `different units` is the UOM guard in archSplitExecute.checkedStockUnitRate. It is
            // a data-setup refusal like the others here, so it must not log as a system
            // fault. The item-record error is logged separately, at ERROR, where it happens.
            // `does not reserve` and `different item` are the reservation and item
            // guards in revalidate: refusals of a request, not system faults.
            const expected = /no longer|already|more than|greater than|nothing on hand|cannot be negative|does not exist|different units|does not reserve|different item/i.test(message);
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
