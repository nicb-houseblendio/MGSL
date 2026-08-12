/**
 * Bucket colours for CWP ARCH.
 *
 * Kept local to ARCH rather than added to the shared CSS variables: ARCH has two
 * buckets IND/MTL do not (`reserve`, `readyToBuild`), and the shared palette is
 * consumed by IND/MTL components that must not shift.
 */

import type { ArchDetailKey } from '@/types/arch';

/**
 * Grid cell text colour.
 *
 * Must go through the CSS variables, not literal hex: the app has a dark theme
 * that remaps every metric colour (index.css `.dark`), and hardcoded dark-green
 * or navy figures are illegible on the dark grid.
 */
export const ARCH_METRIC_COLORS: Record<ArchDetailKey, string> = {
  available: 'var(--metric-onhand)',
  onHand: 'var(--metric-onhand)',
  reserve: 'var(--metric-committed)',
  readyToBuild: 'var(--metric-readytobuild)',
  outbound: 'var(--metric-outbound)',
  onOrder: 'var(--metric-onorder)',
  inTransit: 'var(--metric-intransit)',
};

/** Totals-row colour — light, for use on the navy footer. */
export const ARCH_FOOTER_COLORS: Record<string, string> = {
  available: '#A5D6A7',
  onHand: '#A5D6A7',
  reserve: '#FFB74D',
  readyToBuild: '#80DEEA',
  outbound: '#F48FB1',
  onOrder: '#90CAF9',
  inTransit: '#CE93D8',
};

/**
 * Fixed palette for the detail modal.
 *
 * The detail modal is a LIGHT surface in both themes — same choice IND and MTL
 * make (see DetailDrawer.tsx, which hardcodes #fff rows and #3D5166 header text).
 * Text inside it must therefore use fixed hex: the theme variables invert in dark
 * mode and would paint #CBD5E1 text onto a #F1F5FA header.
 */
export const ARCH_SURFACE = {
  text: '#0D1F33',
  textMid: '#3D5166',
  textLight: '#7A8FA3',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  rowEven: '#FFFFFF',
  rowOdd: '#F8FAFC',
  navy: '#0F2641',
  navyMid: '#1A3D63',
  green: '#1E6B47',
  red: '#B22222',
} as const;

/** Modal chrome per bucket: label, accent, tint and icon. */
export const ARCH_BUCKET_META: Record<ArchDetailKey, { label: string; color: string; bg: string; icon: string }> = {
  onHand: { label: 'On Hand', color: '#1B5E20', bg: '#E8F5E9', icon: '\u{1F4E6}' },
  reserve: { label: 'Reserved', color: '#E65100', bg: '#FFF8E1', icon: '\u{1F4CB}' },
  readyToBuild: { label: 'Ready to Build', color: '#00838F', bg: '#E0F7FA', icon: '\u{1F528}' },
  outbound: { label: 'Outbound', color: '#880E4F', bg: '#FCE4EC', icon: '\u{1F69A}' },
  onOrder: { label: 'On Order', color: '#0D47A1', bg: '#E3F2FD', icon: '\u{1F6D2}' },
  inTransit: { label: 'In Transit', color: '#4A148C', bg: '#F3E5F5', icon: '\u{26F5}' },
  available: { label: 'Available', color: '#1B5E20', bg: '#E8F5E9', icon: '✅' },
};
