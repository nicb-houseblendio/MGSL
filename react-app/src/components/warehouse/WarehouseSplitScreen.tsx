/**
 * Warehouse split checklist.
 *
 * A SEPARATE screen from the trader screen, on purpose — "le gars dans
 * l'entrepôt, on veut pas nécessairement qu'il ait le trader screen, mais qu'il
 * ait juste l'écran ici" (Marc-Antoine, 2026-08-11). It is served by its own
 * Suitelet so access can be restricted by role.
 *
 * The layout follows the client prototype (`warehouse_split_poc`) rather than
 * anything invented here: a light, dense table, two collapsible groups for
 * outstanding and completed splits, and a row per sales order carrying species,
 * trader, quantity, bundle count and ship week. An earlier version of this screen
 * used dark cards and was not recognisable as the same design.
 *
 * ⚠️ DEMO DATA. Jobs come from `getSplitJobs()`. Real ones come from a saved
 * search of SO lines flagged as splits, and that flag does not exist in NetSuite
 * yet.
 */

import * as React from 'react';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import {
  getSplitJobs,
  emptyEntry,
  entryComplete,
  entryTouched,
  evaluateEntry,
  entryKey,
  splitOutcome,
  speciesListOf,
  jobRequestedBF,
  traderShortName,
  traderInitials,
  traderColor,
  shortDate,
  dueInfo,
} from '@/lib/archSplit';
import { SplitCompletionDialog } from '@/components/warehouse/SplitCompletionDialog';
import { SplitWorkOrder } from '@/components/warehouse/SplitWorkOrder';
import { SplitNoteDialog } from '@/components/warehouse/SplitNoteDialog';
import type {
  ArchSplitEntry,
  ArchSplitJob,
  ArchSplitNote,
  ArchSplitOutcome,
} from '@/types/archSplit';

/* ── Palette, lifted from the prototype ─────────────────────────────────────*/

const TODO = { accent: '#EAB308', soft: '#FEFCE8', head: '#FDF0B8', dark: '#A16207' };
const DONE = { accent: '#22C55E', soft: '#F0FDF4', head: '#C5EFD3', dark: '#15803D' };

const th: React.CSSProperties = {
  padding: '9px 10px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#7A8FA3',
  background: '#fff',
  borderBottom: '1px solid #E2E8F0',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '9px 10px',
  fontSize: 12,
  color: ARCH_SURFACE.text,
  verticalAlign: 'middle',
};

export const WarehouseSplitScreen = () => {
  const jobs = React.useMemo(() => getSplitJobs(), []);

  const [entries, setEntries] = React.useState<Record<string, ArchSplitEntry>>({});
  const [notes, setNotes] = React.useState<Record<string, ArchSplitNote[]>>({});
  const [openJob, setOpenJob] = React.useState<string | null>(null);
  const [printJob, setPrintJob] = React.useState<string | null>(null);
  const [noteJob, setNoteJob] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ job: ArchSplitJob; outcomes: ArchSplitOutcome[] } | null>(null);
  const [search, setSearch] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<{ todo: boolean; done: boolean }>({
    todo: false,
    done: false,
  });

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

  /**
   * A bundle counts as recorded only if it is filled in AND the figures are
   * possible. `entryComplete` alone let the queue show "✓ Split done" for a split
   * the completion dialog refuses to save.
   */
  const entryDone = React.useCallback(
    (e: ArchSplitEntry) => entryComplete(e) && !evaluateEntry(e).invalid,
    []
  );

  const jobDone = React.useCallback(
    (job: ArchSplitJob) => job.bundles.every((b) => entryDone(entryFor(job, b.lotNo))),
    [entryFor, entryDone]
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

  const handleReset = React.useCallback(
    (soNo: string) => {
      const job = jobs.find((j) => j.soNo === soNo);
      if (!job) return;
      setEntries((prev) => {
        const next = { ...prev };
        job.bundles.forEach((b) => delete next[entryKey(soNo, b.lotNo)]);
        return next;
      });
    },
    [jobs]
  );

  const handleSave = React.useCallback(() => {
    const job = jobs.find((j) => j.soNo === openJob);
    if (!job) return;
    const complete = job.bundles.filter((b) => entryDone(entryFor(job, b.lotNo)));
    setOpenJob(null);
    if (complete.length === job.bundles.length) {
      setResult({ job, outcomes: job.bundles.map((b) => splitOutcome(b, entryFor(job, b.lotNo))) });
    } else {
      const left = job.bundles.length - complete.length;
      setToast(`Progrès enregistré sur ${job.soNo} — ${left} bundle${left === 1 ? '' : 's'} à saisir`);
    }
  }, [jobs, openJob, entryFor, entryDone]);

  const addNote = React.useCallback(
    (soNo: string, text: string, emailed: boolean) => {
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      setNotes((prev) => ({ ...prev, [soNo]: [...(prev[soNo] || []), { date, text, emailed }] }));
      if (emailed) {
        const job = jobs.find((j) => j.soNo === soNo);
        setToast(`Commentaire envoyé à ${job?.trader || 'le trader'}`);
      }
    },
    [jobs]
  );

  /* ── Filtering and grouping ───────────────────────────────────────────────*/

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) =>
        j.soNo.toLowerCase().includes(q) ||
        j.customer.toLowerCase().includes(q) ||
        j.trader.toLowerCase().includes(q) ||
        speciesListOf(j).toLowerCase().includes(q) ||
        j.bundles.some((b) => b.lotNo.toLowerCase().includes(q))
    );
  }, [jobs, search]);

  const pending = visible.filter((j) => !jobDone(j));
  const done = visible.filter((j) => jobDone(j));
  const allCollapsed = collapsed.todo && collapsed.done;

  const openJobObj = jobs.find((j) => j.soNo === openJob) || null;
  const printJobObj = jobs.find((j) => j.soNo === printJob) || null;
  const noteJobObj = jobs.find((j) => j.soNo === noteJob) || null;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  /* ── Row ──────────────────────────────────────────────────────────────────*/

  const renderRow = (job: ArchSplitJob, i: number) => {
    const isDone = jobDone(job);
    const started = jobStarted(job);
    const remaining = job.bundles.filter((b) => !entryDone(entryFor(job, b.lotNo))).length;
    const flagged = job.bundles.filter((b) => evaluateEntry(entryFor(job, b.lotNo)).flagged).length;
    const due = dueInfo(job.shipDate);
    const jobNotes = notes[job.soNo] || [];
    const latest = jobNotes.length ? jobNotes[jobNotes.length - 1].text : '';

    return (
      <tr key={job.soNo} style={{ background: i % 2 ? '#FBFCFE' : '#fff', borderBottom: '1px solid #EEF1F6' }}>
        <td style={{ ...td, paddingLeft: 14 }}>
          {/* No link: these sales orders are fixtures, so an arrow to a NetSuite
              record would be a dead affordance. It comes back with real data. */}
          <span className="font-mono" style={{ fontWeight: 700, color: '#1A6FE0', fontSize: 11.5 }}>
            {job.soNo}
          </span>
        </td>
        <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{job.customer}</td>
        <td style={{ ...td, textAlign: 'center', color: ARCH_SURFACE.textMid }}>{speciesListOf(job)}</td>
        <td style={{ ...td, textAlign: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: traderColor(job.trader),
                color: '#fff',
                fontSize: 8.5,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={job.trader}
            >
              {traderInitials(job.trader)}
            </span>
            <span style={{ color: ARCH_SURFACE.textMid }}>{traderShortName(job.trader)}</span>
          </span>
        </td>
        <td style={{ ...td, textAlign: 'right' }} className="font-mono">
          {formatBF(jobRequestedBF(job))} <span style={{ color: ARCH_SURFACE.textLight, fontSize: 10.5 }}>BF</span>
        </td>
        <td style={{ ...td, textAlign: 'center' }} className="font-mono">
          {job.bundles.length}×
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          <span style={{ fontWeight: 600 }}>{shortDate(job.shipDate)}</span>
          {!isDone && due.label !== 'No date' && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 9.5,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 8,
                color: due.color,
                background: due.background,
                whiteSpace: 'nowrap',
              }}
            >
              {due.label}
            </span>
          )}
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setOpenJob(job.soNo)}
            style={{
              padding: '5px 13px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              background: isDone ? DONE.head : TODO.head,
              color: isDone ? DONE.dark : TODO.dark,
            }}
          >
            {isDone
              ? '✓ Split done'
              : started
                ? `Continuer (${remaining})`
                : `Enter split (${job.bundles.length})`}
          </button>
          {flagged > 0 && !isDone && (
            <div style={{ fontSize: 9.5, color: '#B91C1C', fontWeight: 700, marginTop: 3 }}>
              {flagged} à vérifier
            </div>
          )}
        </td>
        <td
          style={{
            ...td,
            textAlign: 'center',
            maxWidth: 190,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            fontWeight: 600,
            color: jobNotes.length ? TODO.dark : '#1A6FE0',
          }}
          onClick={() => setNoteJob(job.soNo)}
          title={jobNotes.length ? latest : 'Ajouter un commentaire'}
        >
          {jobNotes.length ? latest : '＋ Comment'}
        </td>
        <td style={{ ...td, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => setPrintJob(job.soNo)}
            aria-label={`Imprimer le work order de ${job.soNo}`}
            title="Work order et tags"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: ARCH_SURFACE.textMid,
              padding: 2,
            }}
          >
            🖨
          </button>
        </td>
      </tr>
    );
  };

  const renderGroup = (
    key: 'todo' | 'done',
    label: string,
    palette: typeof TODO,
    list: ArchSplitJob[]
  ) => {
    if (list.length === 0) return null;
    const isCollapsed = collapsed[key];
    return (
      <tbody key={key}>
        <tr>
          <td
            colSpan={10}
            onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
            style={{
              background: palette.soft,
              borderTop: `3px solid ${palette.accent}`,
              borderBottom: `2px solid ${palette.head}`,
              padding: '8px 14px',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', color: palette.dark }}>
              {isCollapsed ? '▸' : '▾'} {label.toUpperCase()}
            </span>
            <span
              style={{
                marginLeft: 9,
                fontSize: 10.5,
                fontWeight: 700,
                color: palette.dark,
                background: palette.head,
                padding: '1px 8px',
                borderRadius: 10,
              }}
            >
              {list.length}
            </span>
          </td>
        </tr>
        {!isCollapsed && list.map(renderRow)}
      </tbody>
    );
  };

  return (
    <div style={{ background: '#EEF1F6', minHeight: '100vh', fontFamily: 'inherit' }}>
      {/* Top bar */}
      <div
        style={{
          background: 'linear-gradient(135deg,#0F2641,#1A3D63)',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: ARCH_SURFACE.green,
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            CWP
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: 12.5, fontWeight: 700, lineHeight: 1.1 }}>CWP</div>
            <div style={{ color: '#7A8FA3', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.09em' }}>
              ARCHITECTURAL
            </div>
          </div>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.18)', margin: '0 5px' }} />
          <div style={{ color: '#DCE5EF', fontSize: 12.5 }}>Split Checklist</div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par #SO, client, trader…"
          style={{
            flex: '0 1 420px',
            margin: '0 auto',
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />

        <div style={{ textAlign: 'right', color: '#AFC2D6', fontSize: 10.5, lineHeight: 1.35 }}>
          <div>{today}</div>
          <div style={{ color: '#fff', fontWeight: 700 }}>
            {pending.length} split{pending.length === 1 ? '' : 's'} à faire
          </div>
        </div>
      </div>

      {/* Sub header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '9px 16px',
          background: '#EEF1F6',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ARCH_SURFACE.text }}>Splits à faire</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: TODO.dark,
            background: TODO.head,
            padding: '2px 9px',
            borderRadius: 10,
          }}
        >
          {pending.length} en attente
        </span>
        <button
          type="button"
          onClick={() => setCollapsed({ todo: !allCollapsed, done: !allCollapsed })}
          style={{
            padding: '5px 12px',
            borderRadius: 8,
            border: '1px solid #CBD5E1',
            background: '#fff',
            color: ARCH_SURFACE.textMid,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {allCollapsed ? 'Tout ouvrir' : 'Tout replier'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: ARCH_SURFACE.textLight }}>
          Seules les commandes qui demandent un split apparaissent ici
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#7A4100',
            background: '#FBF1E5',
            border: '1px solid #D9822B',
            padding: '2px 8px',
            borderRadius: 9,
          }}
        >
          Données de démo
        </span>
      </div>

      {/* Table */}
      <div style={{ padding: '0 16px 24px' }}>
        <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', paddingLeft: 14 }}>#SO</th>
                <th style={{ ...th, textAlign: 'center' }}>Client</th>
                <th style={{ ...th, textAlign: 'center' }}>Species</th>
                <th style={{ ...th, textAlign: 'center' }}>Trader</th>
                <th style={{ ...th, textAlign: 'right' }}>Qté (BF)</th>
                <th style={{ ...th, textAlign: 'center' }}>Bundles</th>
                <th style={{ ...th, textAlign: 'center' }}>Ship week</th>
                <th style={{ ...th, textAlign: 'center' }}>Split</th>
                <th style={{ ...th, textAlign: 'center' }}>Commentaire</th>
                <th style={{ ...th, textAlign: 'center' }}>Print</th>
              </tr>
            </thead>
            {renderGroup('todo', 'Splits à faire', TODO, pending)}
            {renderGroup('done', 'Splits complétés', DONE, done)}
            {pending.length === 0 && done.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={10} style={{ padding: '40px 0', textAlign: 'center', color: ARCH_SURFACE.textLight, fontSize: 12.5 }}>
                    {search.trim() ? 'Aucun résultat pour cette recherche.' : 'Aucun split à faire.'}
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
      </div>

      {openJobObj && (
        <SplitCompletionDialog
          job={openJobObj}
          entryFor={(lotNo) => entryFor(openJobObj, lotNo)}
          onChange={(lotNo, patch) => handleChange(openJobObj.soNo, lotNo, patch)}
          onReset={() => handleReset(openJobObj.soNo)}
          onSave={handleSave}
          onClose={() => setOpenJob(null)}
        />
      )}
      {printJobObj && <SplitWorkOrder job={printJobObj} onClose={() => setPrintJob(null)} />}
      {noteJobObj && (
        <SplitNoteDialog
          job={noteJobObj}
          notes={notes[noteJobObj.soNo] || []}
          onAdd={(text, emailTrader) => addNote(noteJobObj.soNo, text, emailTrader)}
          onClose={() => setNoteJob(null)}
        />
      )}
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
