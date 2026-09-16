/**
 * Which view the screen opens on.
 *
 * Every role id, role name and subsidiary below is a transcript of the MGSL
 * sandbox on 2026-09-15, read with `sql.mjs`:
 *
 *   SELECT id, name, centertype, isinactive FROM role WHERE id IN (2181..2184)
 *   SELECT id, entityid, subsidiary FROM employee WHERE email LIKE 'ma.poirier%'
 *
 * The case this file exists for is the first one: role 2182 on subsidiary 5.
 * That is every hardwood user in the account today, and before this change all
 * of them opened on the CWP MTL softwood view.
 */
import {
  defaultViewFor,
  isArchRole,
  ARCH_ROLE_IDS,
  ARCH_ROLE_SCRIPT_IDS,
  SUBSIDIARY_TO_VIEW,
} from './traderDefaultView.ts';

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

const VIEWS = ['CWP IND', 'CWP MTL', 'CWP ARCH'];
const view = (o) => defaultViewFor({ views: VIEWS, ...o });

/* The three roles Marc-Antoine named, each on the subsidiary its holders
 * actually sit on. All three used to answer CWP MTL. */
ok('2182 Hardwood Trader on sub 5 opens ARCH',
  view({ roleId: '2182', subsidiaryId: '5' }) === 'CWP ARCH',
  view({ roleId: '2182', subsidiaryId: '5' }));
ok('2183 Logistics Coordinator on sub 5 opens ARCH',
  view({ roleId: '2183', subsidiaryId: '5' }) === 'CWP ARCH');
ok('2184 AP/AR Analyst on sub 5 opens ARCH',
  view({ roleId: '2184', subsidiaryId: '5' }) === 'CWP ARCH');
ok('2181 CWP ARC Trader opens ARCH even though it is inactive today',
  view({ roleId: '2181', subsidiaryId: '5' }) === 'CWP ARCH');

/* A number is what N/runtime hands back for a role id, not a string. */
ok('a numeric role id is accepted', view({ roleId: 2182, subsidiaryId: 5 }) === 'CWP ARCH');

/* Nobody else moves. MTL and IND keep the behaviour they shipped with. */
ok('Administrator on sub 5 still opens MTL',
  view({ roleId: '3', subsidiaryId: '5' }) === 'CWP MTL',
  view({ roleId: '3', subsidiaryId: '5' }));
ok('Administrator on sub 7 still opens IND',
  view({ roleId: '3', subsidiaryId: '7' }) === 'CWP IND');
ok('sub 9 still opens ARCH with no role hint at all',
  view({ subsidiaryId: '9' }) === 'CWP ARCH');
ok('sub 1 MGSL, mapped to nothing, falls to the first view',
  view({ subsidiaryId: '1' }) === 'CWP IND');
ok('an unknown subsidiary falls to the first view',
  view({ subsidiaryId: '99' }) === 'CWP IND');

/* The script id carries the decision to production, where the internal ids
 * will differ because these roles do not exist there yet. */
ok('a script id alone is enough',
  view({ roleScriptId: 'customrole2182', subsidiaryId: '5' }) === 'CWP ARCH');
ok('script id matching ignores case',
  view({ roleScriptId: 'CUSTOMROLE2184', subsidiaryId: '5' }) === 'CWP ARCH');

/* Name matching, and the trap it has to avoid. */
ok('the role name alone is enough',
  view({ roleName: 'MGSL - CWP MTL - Hardwood Trader', subsidiaryId: '5' }) === 'CWP ARCH');
ok('CWP ARC by name is enough',
  view({ roleName: 'MGSL - CWP ARC - Trader', subsidiaryId: '5' }) === 'CWP ARCH');
ok('🔴 "Saved Search Query API" does NOT match, though it contains arc and arch',
  view({ roleName: 'Saved Search Query API', subsidiaryId: '7' }) === 'CWP IND',
  view({ roleName: 'Saved Search Query API', subsidiaryId: '7' }));
ok('a research role does not match either',
  view({ roleName: 'Market Research Analyst', subsidiaryId: '7' }) === 'CWP IND');
ok('MCP ARCH Testing (SB) does not match on the arch substring alone',
  view({ roleName: 'MCP ARCH Testing (SB)', subsidiaryId: '7' }) === 'CWP IND');

/* A build that does not carry the ARCH view must never be sent to it. */
ok('ARCH is never returned when the build does not offer it',
  defaultViewFor({ views: ['CWP IND', 'CWP MTL'], roleId: '2182', subsidiaryId: '5' }) === 'CWP MTL',
  defaultViewFor({ views: ['CWP IND', 'CWP MTL'], roleId: '2182', subsidiaryId: '5' }));
ok('a subsidiary view the build does not offer falls through',
  defaultViewFor({ views: ['CWP ARCH'], roleId: '3', subsidiaryId: '7' }) === 'CWP ARCH');

/* Nothing known at all. This is what a bundle loaded outside NetSuite sees. */
ok('no input at all returns the first view', view({}) === 'CWP IND');
ok('an empty view list still returns something usable',
  defaultViewFor({ views: [], roleId: '2182' }) === 'CWP IND');
ok('nulls do not throw', view({ roleId: null, roleName: null, subsidiaryId: null }) === 'CWP IND');
ok('an empty string role name does not match',
  isArchRole({ roleName: '' }) === false);

/* The constants themselves, so a later edit cannot quietly drop one. */
ok('all four hardwood roles are listed', ARCH_ROLE_IDS.length === 4);
ok('every id has a matching script id',
  ARCH_ROLE_IDS.every((id) => ARCH_ROLE_SCRIPT_IDS.indexOf('customrole' + id) !== -1));
ok('subsidiary 9 is the only one mapped to ARCH',
  Object.keys(SUBSIDIARY_TO_VIEW).filter((k) => SUBSIDIARY_TO_VIEW[k] === 'CWP ARCH').join() === '9');

console.log(fail ? ('# FAIL ' + fail) : '# traderDefaultView ok');
process.exit(fail ? 1 : 0);
