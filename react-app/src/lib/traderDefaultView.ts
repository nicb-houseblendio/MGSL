/**
 * Which CWP view the screen opens on when a user arrives.
 *
 * 🔴 The subsidiary alone was the wrong axis, measured in the sandbox on
 * 2026-09-15. The three hardwood roles Marc-Antoine named on 09-14 are
 * `2182 MGSL - CWP MTL - Hardwood Trader`, `2183 ... Logistics Coordinator`
 * and `2184 ... AP/AR Analyst`, and every employee who holds one sits on
 * subsidiary 5, CWP MTL: employee 3293 Trader Hardwood, 3308 Test Trader
 * Hardwood and 678 Marc-Antoine himself. The Suitelet reads
 * `runtime.getCurrentUser().subsidiary`, so all three landed on the CWP MTL
 * softwood view and had to click across to CWP ARCH by hand. Nobody in the
 * account is on subsidiary 9 today, so the ARCH default had never once fired
 * for a real user.
 *
 * The role is the axis the client asked for, so the role decides first and the
 * subsidiary stays as the fallback. That also survives the ARC subsidiary move:
 * when hardwood employees land on subsidiary 9, the map below already answers
 * CWP ARCH for them and the role rule simply agrees.
 */

export const ARCH_VIEW = 'CWP ARCH';

/**
 * Verified against NetSuite 2026-08-12: CWP MTL (5) is the parent of IND (7),
 * PBF (8), ARC (9), ELIM (10) and 9501 (11); ARC is a SIBLING of IND, not a
 * child of it. 9 previously landed on the IND view, which showed a trader IND
 * data under an ARCH label.
 */
export const SUBSIDIARY_TO_VIEW: Record<string, string> = {
  '5': 'CWP MTL', '8': 'CWP MTL', '10': 'CWP MTL', '11': 'CWP MTL',
  '7': 'CWP IND', '14': 'CWP IND', '15': 'CWP IND', '16': 'CWP IND', '17': 'CWP IND', '18': 'CWP IND',
  '9': ARCH_VIEW,
};

/**
 * Sandbox internal ids, measured 2026-09-15. None of these roles exists in
 * production yet (`SELECT id, name FROM role WHERE LOWER(name) LIKE '%hardwood%'`
 * returns nothing there), so production will mint different ids and the two
 * rules below are what will actually carry the decision over.
 */
export const ARCH_ROLE_IDS = ['2181', '2182', '2183', '2184'];

/** SDF keeps the script id when a role is deployed, which internal ids do not. */
export const ARCH_ROLE_SCRIPT_IDS = [
  'customrole2181', 'customrole2182', 'customrole2183', 'customrole2184',
];

/**
 * ⚠️ The word boundary is load-bearing. A bare /arc/ matches "Saved Se-arc-h
 * Query API", a real role in this account, and /arch/ matches it too. Only
 * "hardwood" and a "CWP ARC" prefix are safe.
 */
export const ARCH_ROLE_NAME_RE = /\bhardwood\b|\bcwp\s+arc/i;

export interface DefaultViewInput {
  /** `MCGI_CONFIG.subsidiary.id`, the employee's subsidiary. */
  subsidiaryId?: string | number | null;
  /** `runtime.getCurrentUser().role`, the role internal id. */
  roleId?: string | number | null;
  /** `runtime.getCurrentUser().roleId`, the role script id. */
  roleScriptId?: string | null;
  /** The role's display name, looked up server side. Absent is normal. */
  roleName?: string | null;
  /** The views this build actually offers, in order. */
  views: string[];
}

const clean = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v).trim();

/** True when the signed-in role is one of the hardwood roles. */
export const isArchRole = (input: Omit<DefaultViewInput, 'views'>): boolean => {
  const id = clean(input.roleId);
  if (id && ARCH_ROLE_IDS.indexOf(id) !== -1) return true;

  const scriptId = clean(input.roleScriptId).toLowerCase();
  if (scriptId && ARCH_ROLE_SCRIPT_IDS.indexOf(scriptId) !== -1) return true;

  const name = clean(input.roleName);
  return name !== '' && ARCH_ROLE_NAME_RE.test(name);
};

/**
 * The view to open on. Role first, then subsidiary, then the first view this
 * build offers. Never returns a view the build does not carry.
 */
export const defaultViewFor = (input: DefaultViewInput): string => {
  const views = Array.isArray(input.views) ? input.views.filter(Boolean) : [];
  const fallback = views[0] || 'CWP IND';

  if (views.indexOf(ARCH_VIEW) !== -1 && isArchRole(input)) return ARCH_VIEW;

  const bySubsidiary = SUBSIDIARY_TO_VIEW[clean(input.subsidiaryId)];
  if (bySubsidiary && views.indexOf(bySubsidiary) !== -1) return bySubsidiary;

  return fallback;
};
