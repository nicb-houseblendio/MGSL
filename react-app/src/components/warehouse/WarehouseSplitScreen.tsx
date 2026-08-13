import * as React from 'react';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import {
  getSplitJobs,
  emptyEntry,
  entryComplete,
  entryTouched,
  evaluateEntry,
  dueInfo,
  splitOutcome,
  entryKey,
} from '@/lib/archSplit';
import { SplitCompletionDialog } from '@/components/warehouse/SplitCompletionDialog';
import { SplitWorkOrder } from '@/components/warehouse/SplitWorkOrder';
import type { ArchSplitEntry, ArchSplitJob, ArchSplitOutcome } from '@/types/archSplit';

/**
 * Warehouse bundle-split queue.
 *
 * A SEPARATE screen from the trader screen, on purpose — "le gars dans
 * l'entrepôt, on veut pas nécessairement qu'il ait le trader screen, mais qu'il
 * ait juste l'écran ici". It is deliberately narrow: what has to be split, in
 * what order, and a way to record the result. No pricing, no margins, no
 * customers' commercial terms.
 *
 * Ordered by ship date, because that is the only thing that decides what to cut
 * first. Late jobs surface at the top in red.
 */

const cardStyle: React.CSSProperties = {
  border: '1px solid #E2E8F0',
  borderRadius: 10,
  background: '#fff',
  padding: '13px 15px',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
};

export const WarehouseSplitScreen = () => {
  const jobs = React.useMemo(() => getSplitJobs(), []);
  const [search, setSearch] = React.useState('');
  const [entries, setEntries] = React.useState<Record<string, ArchSplitEntry>>({});
  const [openJob, setOpenJob] = React.useState<string | null>(null);
  const [printJob, setPrintJob] = React.useState<string | null>(null);
  const [showDone, setShowDone] = React.useState(true);
  const [result, setResult] = React.useState<{ job: ArchSplitJob; outcomes: ArchSplitOutcome[] } | null>(null);
  // A partial save closed the dialog with no acknowledgement at all, so it read
  // as "nothing happened". Confirm it, and say what is still outstanding.
  const [toast, setToast] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const entryFor = React.useCallback(
    (job: ArchSplitJob, lotNo: string): ArchSplitEntry => {
      const bundle = job.bundles.find((b) => b.lotNo === lotNo)!;
      return entries[entryKey(job.soNo, lotNo)] || emptyEntry(bundle);
    },
    [entries]
  );

  const jobDone = React.useCallback(
    (job: ArchSplitJob) => job.bundles.every((b) => entryComplete(entryFor(job, b.lotNo))),
    [entryFor]
  );
  const jobStarted = React.useCallback(
    (job: ArchSplitJob) => job.bundles.some((b) => entryTouched(entryFor(job, b.lotNo))),
    [entryFor]
  );

  // Scoped to the OPEN job — never resolved by scanning all jobs for a lot
  // number, which merged two orders that referenced the same bundle.
  const handleChange = React.useCallback(
    (soNo: string, lotNo: string, patch: Partial<ArchSplitEntry>) => {
      const job = jobs.find((j) => j.soNo === soNo);
      const bundle = job?.bundles.find((b) => b.lotNo === lotNo);
      if (!bundle) return;
      const k = entryKey(soNo, lotNo);
      setEntries((prev) => ({ ...prev, [k]: { ...(prev[k] || emptyEntry(bundle)), ...patch } }));
    },
    [jobs]
  );

  const handleSave = React.useCallback(() => {
    const job = jobs.find((j) => j.soNo === openJob);
    if (!job) return;
    const complete = job.bundles.filter((b) => entryComplete(entryFor(job, b.lotNo)));
    setOpenJob(null);
    if (complete.length === job.bundles.length) {
      setResult({
        job,
        outcomes: job.bundles.map((b) => splitOutcome(b, entryFor(job, b.lotNo))),
      });
    } else {
      const left = job.bundles.length - complete.length;
      setToast(`Progress saved on ${job.soNo} — ${left} bundle${left === 1 ? '' : 's'} still to record`);
    }
  }, [jobs, openJob, entryFor]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs
      .filter(
        (j) =>
          !q ||
          j.soNo.toLowerCase().includes(q) ||
          j.customer.toLowerCase().includes(q) ||
          j.bundles.some((b) => b.lotNo.toLowerCase().includes(q) || b.itemDescription.toLowerCase().includes(q))
      )
      // Ship date decides cutting order. Nothing else does.
      .sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  }, [jobs, search]);

  const pending = filtered.filter((j) => !jobDone(j));
  const done = filtered.filter((j) => jobDone(j));

  const renderJob = (job: ArchSplitJob) => {
    const due = dueInfo(job.shipDate);
    const complete = jobDone(job);
    const started = jobStarted(job);
    const totalRequested = job.bundles.reduce((s, b) => s + b.requestedBF, 0);
    const remaining = job.bundles.filter((b) => !entryComplete(entryFor(job, b.lotNo))).length;
    const flagged = job.bundles.filter((b) => evaluateEntry(entryFor(job, b.lotNo)).flagged).length;

    return (
      <div key={job.soNo} style={{ ...cardStyle, borderLeft: `4px solid ${complete ? '#22C55E' : due.color}` }}>
        <div style={{ minWidth: 190 }}>
          <div className="font-mono" style={{ fontSize: 14, fontWeight: 800, color: ARCH_SURFACE.navy }}>
            {job.soNo}
          </div>
          <div style={{ fontSize: 12.5, color: ARCH_SURFACE.text, marginTop: 2 }}>{job.customer}</div>
          <div style={{ fontSize: 10.5, color: ARCH_SURFACE.textLight, marginTop: 1 }}>
            {job.locationName} · {job.trader}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          {job.bundles.map((b) => {
            const st = evaluateEntry(entryFor(job, b.lotNo));
            return (
              <div key={b.lotNo} style={{ fontSize: 11.5, marginBottom: 3, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="font-mono" style={{ fontWeight: 700, color: ARCH_SURFACE.navyMid, minWidth: 168 }}>
                  {b.lotNo}
                </span>
                <span style={{ color: ARCH_SURFACE.textMid, flex: 1 }}>{b.itemDescription}</span>
                <span className="font-mono" style={{ color: ARCH_SURFACE.text, fontWeight: 700 }}>
                  {formatBF(b.requestedBF)}
                </span>
                <span style={{ color: ARCH_SURFACE.textLight, fontSize: 10 }}>of {formatBF(b.systemBF)} BF</span>
                {st.complete && (
                  <span style={{ color: st.flagged ? '#B91C1C' : '#15803D', fontSize: 10, fontWeight: 700 }}>
                    {st.flagged ? '⚠ check' : '✓'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'right', minWidth: 92 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 9px',
              borderRadius: 20,
              fontSize: 10.5,
              fontWeight: 700,
              color: due.color,
              background: due.background,
            }}
          >
            {due.label}
          </span>
          <div className="font-mono" style={{ fontSize: 11, color: ARCH_SURFACE.textMid, marginTop: 4 }}>
            {formatBF(totalRequested)} BF
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setPrintJob(job.soNo)}
            title="Print the work order and bundle tags"
            style={{
              padding: '7px 12px',
              borderRadius: 7,
              border: '1px solid #CBD5E1',
              background: '#fff',
              color: ARCH_SURFACE.textMid,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🖨 Work order
          </button>
          <button
            type="button"
            onClick={() => setOpenJob(job.soNo)}
            style={{
              padding: '7px 14px',
              borderRadius: 7,
              border: 'none',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: complete ? '#DCFCE7' : flagged ? '#FEE2E2' : '#FEF3C7',
              color: complete ? '#15803D' : flagged ? '#B91C1C' : '#A16207',
            }}
          >
            {complete ? '✓ Split done' : started ? `Continue (${remaining} left)` : `Enter split (${job.bundles.length})`}
          </button>
        </div>
      </div>
    );
  };

  const openJobObj = jobs.find((j) => j.soNo === openJob) || null;
  const printJobObj = jobs.find((j) => j.soNo === printJob) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#EEF1F6' }}>
      {/* Header — deliberately says WAREHOUSE, so nobody mistakes it for the trader screen */}
      <header
        style={{
          background: 'linear-gradient(135deg, #0F2641 0%, #1A3D63 60%, #254E7A 100%)',
          padding: '0 24px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1E6B47, #2A9060)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>MG</span>
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>MGSL</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              Warehouse
            </div>
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.15)' }} />
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 500 }}>Bundle splits</div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, customer, lot…"
          style={{
            marginLeft: 'auto',
            width: 260,
            padding: '7px 11px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            fontSize: 12.5,
            outline: 'none',
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 20,
            background: 'rgba(200,160,53,0.30)',
            color: '#fff',
          }}
          title="CWP ARCH has no data in NetSuite yet — this screen is running on demo data"
        >
          Demo data
        </span>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: ARCH_SURFACE.navy }}>Splits to do</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#A16207',
              background: '#FEF3C7',
              padding: '1px 8px',
              borderRadius: 10,
            }}
          >
            {pending.length}
          </span>
        </div>

        {pending.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: ARCH_SURFACE.textLight, fontSize: 13, background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0' }}>
            Nothing waiting to be split.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{pending.map(renderJob)}</div>
        )}

        {done.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                marginTop: 24,
                marginBottom: 12,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: ARCH_SURFACE.navy }}>
                {showDone ? '▾' : '▸'} Completed
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#15803D',
                  background: '#DCFCE7',
                  padding: '1px 8px',
                  borderRadius: 10,
                }}
              >
                {done.length}
              </span>
            </button>
            {showDone && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{done.map(renderJob)}</div>}
          </>
        )}
      </div>

      {openJobObj && (
        <SplitCompletionDialog
          job={openJobObj}
          entries={entries}
          onChange={(lotNo, patch) => handleChange(openJobObj.soNo, lotNo, patch)}
          onSave={handleSave}
          onClose={() => setOpenJob(null)}
        />
      )}
      {printJobObj && <SplitWorkOrder job={printJobObj} onClose={() => setPrintJob(null)} />}
      {result && <SplitResultDialog job={result.job} outcomes={result.outcomes} onClose={() => setResult(null)} />}

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#A16207',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 600,
            boxShadow: '0 6px 24px rgba(13,31,51,0.3)',
            zIndex: 400,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
};

/* ── Result: what completing the split would do in NetSuite ─────────────────*/

const SplitResultDialog = ({
  job,
  outcomes,
  onClose,
}: {
  job: ArchSplitJob;
  outcomes: ArchSplitOutcome[];
  onClose: () => void;
}) => (
  <div
    onClick={onClose}
    role="presentation"
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 300,
      background: 'rgba(13,31,51,0.72)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 30,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Split recorded"
      style={{
        background: '#fff',
        borderRadius: 14,
        width: 760,
        maxWidth: '94vw',
        maxHeight: '88vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #0F2641, #1A3D63)' }}>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
          Split recorded — <span className="font-mono">{job.soNo}</span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 2 }}>
          The hold on {outcomes.length === 1 ? 'the bundle' : 'these bundles'} would now be released
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {outcomes.map((o) => (
          <div
            key={o.lotNo}
            style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}
          >
            <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: ARCH_SURFACE.navyMid, marginBottom: 8 }}>
              {o.lotNo}
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.8, color: ARCH_SURFACE.text }}>
              <li>
                Correct the sales order line to{' '}
                <strong className="font-mono">{formatBF(o.soLineBF)} BF</strong> — replacing the trader's placeholder.
              </li>
              <li>
                Inventory adjustment splitting the lot: <strong className="font-mono">{o.lotNo}</strong> becomes{' '}
                <strong className="font-mono">{formatBF(o.originalLotBF)} BF</strong>, and a new bundle{' '}
                <strong className="font-mono">{o.newLotNo}</strong> is created at{' '}
                <strong className="font-mono">{formatBF(o.newLotBF)} BF</strong>.
              </li>
              {o.systemVarianceBF !== 0 && (
                <li>
                  Re-tally variance of{' '}
                  <strong className="font-mono" style={{ color: o.systemVarianceBF > 0 ? '#15803D' : '#B91C1C' }}>
                    {o.systemVarianceBF > 0 ? '+' : ''}
                    {formatBF(o.systemVarianceBF)} BF
                  </strong>{' '}
                  against the figure on file.
                </li>
              )}
              <li>Release the hold so the remainder is sellable again.</li>
            </ol>
          </div>
        ))}

        <div
          style={{
            display: 'flex',
            gap: 9,
            alignItems: 'flex-start',
            padding: '10px 12px',
            borderRadius: 9,
            background: '#FFF8E1',
            border: '1px solid #E6B800',
            fontSize: 11.5,
            color: '#7A4100',
            lineHeight: 1.55,
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
          <span>
            None of this is written to NetSuite yet. Three things need agreeing first: how the SO line is corrected
            after the fact, the exact form of the inventory adjustment, and the lot-numbering rule when an
            already-split bundle is split again.
          </span>
        </div>
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', textAlign: 'right' }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '9px 22px',
            borderRadius: 9,
            border: 'none',
            background: ARCH_SURFACE.green,
            color: '#fff',
            fontSize: 13.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  </div>
);
