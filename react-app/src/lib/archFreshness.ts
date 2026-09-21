/**
 * How old the ARCH grid's figures are, in words a trader can act on.
 *
 * ── Why ARCH needs its own thresholds ───────────────────────────────────────
 * The shared badge (`getLastUpdatedBadgeState` in useRefreshState) calls anything
 * over ONE HOUR "stale". That bound was meaningless against ARCH's old one-hour
 * rebuild — amber at the end of every single cycle — and it is worse now the
 * rebuild is every 15 minutes, because it would stay green through four missed
 * cycles. Either way it does not describe this screen, which is
 * why the badge was suppressed for ARCH entirely (`!isARCH &&` in App.tsx) rather
 * than given a sensible bound, and suppressing it is what left the grid with no
 * indication of its own age at all.
 *
 * That absence is the cheapest half of a real client report. Marc-Antoine, 2026-09-08:
 * « quand je crée un SO ça devrait aller dans ready to build ou dans reserved mais en
 * ce moment on dirait qu'il fait juste disparaitre du TS. » A trader who cannot tell
 * a stale screen from a wrong one has to assume the worst, and a newly sold bundle
 * genuinely does not move until the next rebuild.
 *
 * ── The bounds, and why these ───────────────────────────────────────────────
 * FRESH   under 20 min. One cycle plus a quarter, because the rebuild takes real
 *         time and a run that starts on the quarter hour finishes after it.
 *         Anything tighter reports the normal cycle as a problem, which is the
 *         defect being fixed.
 * DUE     20 to 45 min. One cycle has been missed. Worth noticing, not alarming:
 *         a single skipped run is recoverable and the refresh button is right there.
 * OVERDUE past 45 min. Three cycles gone. On this screen that has meant a silently
 *         dead schedule for days, and once a shrink guard refusing every rebuild
 *         for 20 hours, so it reads as an error rather than a shrug.
 * UNKNOWN no timestamp. Distinct from fresh: `getLastUpdatedBadgeState` returns 'ok'
 *         for a null, which paints a green badge over "we have no idea".
 *
 * Pure, and `now` is injected, so this is testable. Nothing here formats a date the
 * grid uses for arithmetic; it is display only.
 */
export type ArchFreshness = 'fresh' | 'due' | 'overdue' | 'unknown';

export interface ArchFreshnessReport {
  state: ArchFreshness;
  /** Minutes since the cache last completed, or null when unknown. */
  ageMinutes: number | null;
  /** Short badge text, e.g. "Updated 12 min ago". */
  label: string;
  /** The longer explanation, for a tooltip. Always says what to do. */
  title: string;
}

/**
 * ⚠️ THE MIRROR OF `REBUILD_INTERVAL_MS` IN THE CACHE BUILDER, and the two are
 * one setting in two files. Lowered 60 -> 15 on 2026-09-17 with the builder.
 *
 * The two bounds below keep the ratios the doc comment above argues for rather
 * than being re-picked: FRESH is one cycle plus a quarter, because a run that
 * starts on the quarter hour finishes after it, and OVERDUE is three missed
 * cycles. Changing the interval alone would leave a healthy screen claiming a
 * schedule it is not on, in three tooltips.
 */
export const ARCH_REBUILD_MINUTES = 15;
export const ARCH_FRESH_LIMIT_MINUTES = 20;
export const ARCH_OVERDUE_LIMIT_MINUTES = 45;

/** "12 min", "3 h 5 min", "2 days". Coarse on purpose past a day. */
export const formatAge = (mins: number): string => {
  const m = Math.max(0, Math.floor(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem ? `${h} h ${rem} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day' : `${d} days`;
};

export const archFreshness = (
  lastUpdated: string | null | undefined,
  nowMs: number
): ArchFreshnessReport => {
  if (!lastUpdated) {
    return {
      state: 'unknown',
      ageMinutes: null,
      label: 'Age unknown',
      title:
        'The cache did not report when it last completed, so the age of these figures is unknown. Press Refresh, and if this persists the ARCH cache schedule needs checking.',
    };
  }
  const t = new Date(lastUpdated).getTime();
  if (!isFinite(t)) {
    return {
      state: 'unknown',
      ageMinutes: null,
      label: 'Age unknown',
      title: `The cache reported a timestamp this screen cannot read ("${lastUpdated}"), so the age of these figures is unknown.`,
    };
  }
  // A timestamp in the future is a clock disagreement, not freshness. Clamp to 0
  // rather than printing a negative age, but do not call it unknown: the cache did
  // run, and the figures are current.
  const ageMinutes = Math.max(0, (nowMs - t) / 60000);
  const age = formatAge(ageMinutes);
  if (ageMinutes < ARCH_FRESH_LIMIT_MINUTES) {
    return {
      state: 'fresh',
      ageMinutes,
      label: `Updated ${age} ago`,
      title: `These figures come from the ARCH cache, which completed ${age} ago and rebuilds about every ${ARCH_REBUILD_MINUTES} minutes. A bundle sold in the last few minutes may not have moved between columns yet.`,
    };
  }
  if (ageMinutes < ARCH_OVERDUE_LIMIT_MINUTES) {
    return {
      state: 'due',
      ageMinutes,
      label: `Updated ${age} ago`,
      title: `The ARCH cache last completed ${age} ago and normally rebuilds every ${ARCH_REBUILD_MINUTES} minutes, so it has missed a cycle. Press Refresh to re-read it.`,
    };
  }
  return {
    state: 'overdue',
    ageMinutes,
    label: `${age} old`,
    title: `The ARCH cache last completed ${age} ago against a ${ARCH_REBUILD_MINUTES} minute schedule. Treat these quantities as out of date and check the ARCH cache schedule, which has silently stopped before.`,
  };
};
