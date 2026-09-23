import React from 'react';
import { archFreshness } from '@/lib/archFreshness';

/**
 * HOW OLD the ARCH figures are, in the header.
 *
 * Its own component since 2026-09-23 so it can TICK: it used to be computed once
 * per App render, so "Updated 2 min ago" froze until something else re-rendered,
 * which on a screen that now refreshes itself would have read as stuck. The
 * 30 s tick re-renders this badge only, never the grid.
 */
export const ArchFreshnessBadge = ({ lastUpdated }: { lastUpdated: string | undefined }) => {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  // A new lastUpdated re-renders with the current time too, not the last tick's.
  React.useEffect(() => setNow(Date.now()), [lastUpdated]);

  const f = archFreshness(lastUpdated, now);
  const bg =
    f.state === 'fresh'
      ? 'rgba(76,175,80,0.25)'
      : f.state === 'due'
        ? 'rgba(255,183,77,0.28)'
        : 'rgba(239,83,80,0.30)';
  return (
    <>
      <div className="w-px h-5 bg-white/15" />
      <span
        className="text-[10px] px-2 py-0.5 rounded-full"
        style={{ background: bg, color: '#FFFFFF' }}
        title={f.title}
      >
        {f.label}
      </span>
    </>
  );
};
