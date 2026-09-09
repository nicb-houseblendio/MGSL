/**
 * Reads the real Sales Teams for the wizard's commission-split picker.
 *
 * ⚠️ THE TRADER-SCREEN RESTLET, not the order endpoint, and that is a limit
 * rather than a preference. `action=salesTeams` is served by
 * `trader_screen_service_arch.js` (verified live 2026-09-09: 44 teams, 82 member
 * rows, no degradation). The order Suitelet serves `action=salesReps` and
 * nothing else, so there is no Suitelet leg to prefer here the way
 * `fetchSalesReps` prefers one.
 *
 * 🔴 AND A RESTLET RUNS AS THE CALLER. `runasrole` is ignored, so this list is
 * scoped to the trader's own role: all 44 teams sit in subsidiary 1 while role
 * 2181 is `subsidiaryoption = OWN` with a subsidiary-5 holder. An empty answer
 * is therefore expected for a real trader and is NOT an error — see
 * `parseSalesTeams`, which keeps 'empty' and 'failed' apart, and the notice the
 * wizard prints in each case. Moving this action onto the order Suitelet, which
 * runs as `customrole2184`, is what would close it; that file belongs to the
 * write path and is not changed here.
 *
 * A throw becomes 'failed' rather than an empty list, deliberately: telling a
 * trader there are no teams when we could not ask is the one thing this must not
 * do.
 */

import { apiGet } from '@/lib/api';
import { parseSalesTeams, type ArchSalesTeamsResult } from '@/lib/archSalesTeams';

/** ARCH is subsidiary 9 (ARC). Same constant the customer and rep reads use. */
const ARCH_SUBSIDIARY_ID = 9;

export const fetchArchSalesTeams = async (): Promise<ArchSalesTeamsResult> => {
  try {
    const body = await apiGet<unknown>('salesTeams', { subsidiaryId: ARCH_SUBSIDIARY_ID });
    return parseSalesTeams(body);
  } catch (e) {
    return parseSalesTeams({
      success: false,
      error: e instanceof Error ? e.message + '.' : 'The request did not complete.',
    });
  }
};
