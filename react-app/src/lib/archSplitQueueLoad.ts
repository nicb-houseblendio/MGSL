/**
 * What the warehouse split screen should show after one attempt to read the
 * queue. Pure, so the decision can be tested without React or a network.
 *
 * Feedback 11, 2026-09-22. Marc-Antoine opened the screen as the Hardwood
 * Logistics Coordinator role and saw two invented orders, Heritage Cabinetry
 * and Atlas Millwork, under a badge reading "NetSuite unreachable". NetSuite was
 * reachable. The endpoint had refused his role, and the screen answered that
 * refusal by serving fixtures, so he went looking for a NetSuite permission
 * that did not exist and changed three deployments to "all" roles.
 *
 * The rule now:
 *  - no endpoint URL at all means a local preview, so fixtures are right;
 *  - an endpoint that answered with anything but a queue is an ERROR, shown as
 *    one, with no jobs. Invented orders on a screen where the warehouse cuts
 *    real wood are worse than an empty table.
 */

export type SplitQueueLoadSource = 'netsuite' | 'fixtures' | 'error';

/** Why a live load failed, so the screen can say who has to act. */
export type SplitQueueFailure =
  /** The script's own role allowlist refused the signed-in role. */
  | 'forbidden'
  /** NetSuite answered with a page, not JSON: the deployment audience blocked the role before the script ran, or the session expired. */
  | 'not_json'
  /** The script answered ok:false for another reason, e.g. the queue query failed. */
  | 'server'
  /** The request never completed. */
  | 'network';

export interface SplitQueueAttempt {
  /** Absent when the page was not served by the warehouse Suitelet. */
  hasEndpoint: boolean;
  /** Set when fetch itself rejected. */
  networkError?: string | null;
  /** The response Content-Type header, when there was a response. */
  contentType?: string | null;
  /** The parsed body, or undefined when it was not JSON. */
  body?: { ok?: boolean; code?: string; error?: string; role?: number | string } | null;
}

export interface SplitQueueLoadDecision {
  source: SplitQueueLoadSource;
  failure: SplitQueueFailure | null;
  /** Shown verbatim to the warehouse. Null when there is nothing to explain. */
  message: string | null;
}

const WHERE_TO_ADD =
  'An administrator must add it to "Permitted Split Roles" on the deployment ' +
  '"MCGI SL ARCH Split Execute" (Customization > Scripting > Script Deployments > Parameters).';

export const isJsonContentType = (ct: string | null | undefined): boolean =>
  /\bjson\b/i.test(String(ct || ''));

export const decideSplitQueueLoad = (a: SplitQueueAttempt): SplitQueueLoadDecision => {
  if (!a.hasEndpoint) {
    return { source: 'fixtures', failure: null, message: null };
  }
  if (a.networkError) {
    return {
      source: 'error',
      failure: 'network',
      message: 'The split queue could not be reached: ' + a.networkError,
    };
  }
  if (!a.body || typeof a.body !== 'object') {
    return {
      source: 'error',
      failure: 'not_json',
      message:
        'NetSuite answered with a page instead of the split queue, so the split script did not ' +
        'reply. Reload the page first, in case your session expired. If it happens again, an ' +
        'administrator must add your role to BOTH the Audience and "Permitted Split Roles" on the ' +
        '"MCGI SL ARCH Split Execute" deployment; if it is already in both, the script\'s ' +
        'execution log will say what failed.',
    };
  }
  if (a.body.ok === true) {
    return { source: 'netsuite', failure: null, message: null };
  }
  if (a.body.code === 'FORBIDDEN') {
    const role = a.body.role != null && String(a.body.role) !== '' ? ' (role id ' + a.body.role + ')' : '';
    return {
      source: 'error',
      failure: 'forbidden',
      message: 'Your role' + role + ' is not permitted to see or complete bundle splits. ' + WHERE_TO_ADD,
    };
  }
  return {
    source: 'error',
    failure: 'server',
    message: a.body.error || 'The split queue could not be loaded.',
  };
};
