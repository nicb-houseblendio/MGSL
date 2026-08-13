import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import {
  evaluateEntry,
  emptyEntry,
  entryComplete,
  nextSplitLotNo,
  SPLIT_VARIANCE_TOLERANCE,
  entryKey,
} from '@/lib/archSplit';
import type { ArchSplitEntry, ArchSplitJob } from '@/types/archSplit';

/**
 * Where the split actually gets recorded.
 *
 * Three numbers per bundle, because the physical job produces three: what the
 * bundle really held once re-tallied, what goes to the customer, and what goes
 * back on the floor. The first is asked for rather than assumed — the supplier's
 * figure is one person's tally and the warehouse's is another's, and the whole
 * reason the bundle was locked is that nobody knew the real remainder.
 *
 * Saving is never blocked by a discrepancy. A worker who measured correctly must
 * be able to record what they measured; the screen flags and explains instead.
 */

interface SplitCompletionDialogProps {
  job: ArchSplitJob;
  entries: Record<string, ArchSplitEntry>;
  onChange: (lotNo: string, patch: Partial<ArchSplitEntry>) => void;
  onSave: () => void;
  onClose: () => void;
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: ARCH_SURFACE.textLight,
  marginBottom: 4,
};

const numInput = (state: 'ok' | 'flag' | 'empty'): React.CSSProperties => ({
  width: '100%',
  padding: '9px 10px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  textAlign: 'right',
  boxSizing: 'border-box',
  outline: 'none',
  color: ARCH_SURFACE.text,
  background: '#fff',
  border: `1.5px solid ${state === 'flag' ? '#B91C1C' : state === 'ok' ? ARCH_SURFACE.green : '#CBD5E1'}`,
});

export const SplitCompletionDialog = ({
  job,
  entries,
  onChange,
  onSave,
  onClose,
}: SplitCompletionDialogProps) => {
  const rows = job.bundles.map((b) => {
    const entry = entries[entryKey(job.soNo, b.lotNo)] || emptyEntry(b);
    return { bundle: b, entry, state: evaluateEntry(entry) };
  });

  const anyTouched = rows.some((r) => r.state.touched);
  const allComplete = rows.every((r) => entryComplete(r.entry) && !r.state.invalid);
  const flaggedCount = rows.filter((r) => r.state.flagged).length;
  const invalidCount = rows.filter((r) => r.state.invalid).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[1080px] w-[96vw] p-0 gap-0 overflow-hidden"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        aria-describedby={undefined}
        aria-label={`Record split for ${job.soNo}`}
      >
        <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #0F2641, #1A3D63)', flexShrink: 0 }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
            Record split — <span className="font-mono">{job.soNo}</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 2 }}>
            {job.customer} · {job.locationName} · {job.bundles.length} bundle
            {job.bundles.length === 1 ? '' : 's'} to split
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#fff' }}>
          <div
            style={{
              fontSize: 12,
              color: ARCH_SURFACE.textMid,
              lineHeight: 1.55,
              marginBottom: 16,
              padding: '10px 12px',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 9,
            }}
          >
            Re-tally the bundle as you split it. <strong>Measured</strong> is what the bundle actually held —
            it will not always match the figure on file, and that is expected. <strong>To customer</strong> and{' '}
            <strong>Back to stock</strong> should account for it.
          </div>

          {rows.map(({ bundle, entry, state }) => {
            const inputState = (v: string): 'ok' | 'flag' | 'empty' =>
              v.trim() === '' ? 'empty' : state.flagged || state.invalid ? 'flag' : 'ok';
            return (
              <div
                key={bundle.lotNo}
                style={{
                  border: `1px solid ${state.flagged || state.invalid ? '#FCA5A5' : '#E2E8F0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  marginBottom: 12,
                  background: state.flagged || state.invalid ? '#FEF7F7' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: ARCH_SURFACE.navyMid }}>
                    {bundle.lotNo}
                  </span>
                  <span style={{ fontSize: 12.5, color: ARCH_SURFACE.text }}>{bundle.itemDescription}</span>
                  <span className="font-mono" style={{ fontSize: 10.5, color: ARCH_SURFACE.textLight }}>
                    {bundle.containerNo}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: ARCH_SURFACE.textMid }}>
                    On file <strong className="font-mono">{formatBF(bundle.systemBF)}</strong> BF · trader asked for{' '}
                    <strong className="font-mono">{formatBF(bundle.requestedBF)}</strong> BF
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  <div>
                    <label style={label}>Measured (actual bundle)</label>
                    <input
                      type="number"
                      className="font-mono"
                      value={entry.measuredBF}
                      onChange={(e) => onChange(bundle.lotNo, { measuredBF: e.target.value })}
                      style={numInput(inputState(entry.measuredBF))}
                    />
                  </div>
                  <div>
                    <label style={label}>To customer</label>
                    <input
                      type="number"
                      className="font-mono"
                      value={entry.customerBF}
                      placeholder={String(bundle.requestedBF)}
                      onChange={(e) => onChange(bundle.lotNo, { customerBF: e.target.value })}
                      style={numInput(inputState(entry.customerBF))}
                    />
                  </div>
                  <div>
                    <label style={label}>Back to stock</label>
                    <input
                      type="number"
                      className="font-mono"
                      value={entry.inventoryBF}
                      onChange={(e) => onChange(bundle.lotNo, { inventoryBF: e.target.value })}
                      style={numInput(inputState(entry.inventoryBF))}
                    />
                  </div>
                  <div>
                    <label style={label}>Accounted for</label>
                    <div
                      className="font-mono"
                      style={{
                        padding: '9px 10px',
                        fontSize: 14,
                        fontWeight: 700,
                        textAlign: 'right',
                        color: state.flagged ? '#B91C1C' : ARCH_SURFACE.text,
                        background: '#F1F5FA',
                        borderRadius: 8,
                        border: '1.5px solid #E2E8F0',
                      }}
                    >
                      {state.touched ? formatBF(state.accounted) : '—'}
                    </div>
                  </div>
                </div>

                {state.touched && (
                  <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5 }}>
                    {state.invalid ? (
                      <span style={{ color: '#B91C1C' }}>
                        <strong>Check these figures.</strong>{' '}
                        {state.measured <= 0
                          ? 'A bundle cannot measure zero — enter what it actually held.'
                          : state.customer < 0 || state.inventory < 0
                            ? 'Quantities cannot be negative.'
                            : 'The customer bundle is empty — record what they are actually receiving.'}
                      </span>
                    ) : state.flagged ? (
                      <span style={{ color: '#B91C1C' }}>
                        <strong>
                          {state.discrepancy > 0 ? '+' : ''}
                          {formatBF(state.discrepancy)} BF
                        </strong>{' '}
                        against the measured bundle ({(state.discrepancyPct * 100).toFixed(1)}%, over the{' '}
                        {(SPLIT_VARIANCE_TOLERANCE * 100).toFixed(0)}% tolerance). Worth a re-check — you can still
                        save.
                      </span>
                    ) : entryComplete(entry) ? (
                      <span style={{ color: ARCH_SURFACE.green }}>
                        Balances. New bundle{' '}
                        <strong className="font-mono">{nextSplitLotNo(bundle.lotNo)}</strong> at{' '}
                        <strong className="font-mono">{formatBF(state.inventory)}</strong> BF goes back on the floor.
                        {state.measured !== bundle.systemBF && (
                          <>
                            {' '}
                            Bundle re-tallied {state.measured > bundle.systemBF ? 'up' : 'down'} by{' '}
                            <strong className="font-mono">{formatBF(Math.abs(state.measured - bundle.systemBF))}</strong>{' '}
                            BF against the figure on file.
                          </>
                        )}
                      </span>
                    ) : (
                      <span style={{ color: ARCH_SURFACE.textLight }}>Enter both quantities to complete this bundle.</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

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
              Saving records the split and releases the hold. It does <strong>not</strong> yet write to NetSuite —
              correcting the sales order line and posting the inventory adjustment that splits the lot are still to
              be agreed. The next screen shows exactly what it would do.
            </span>
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderTop: '1px solid #E2E8F0',
            background: '#F8FAFC',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              border: '1.5px solid #CBD5E1',
              background: '#fff',
              color: ARCH_SURFACE.textMid,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {/* "Close", not "Cancel". Measurements live in WarehouseSplitScreen,
                so closing this dialog does NOT discard them — and it shouldn't:
                someone who has re-tallied three bundles must not lose that by
                mis-clicking. But a button labelled Cancel promises a discard it
                never performs, which is worse than either behaviour alone. */}
            Close
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: flaggedCount || invalidCount ? '#B91C1C' : ARCH_SURFACE.textMid }}>
            {invalidCount > 0
              ? `${invalidCount} bundle${invalidCount === 1 ? '' : 's'} with impossible figures`
              : flaggedCount > 0
              ? `${flaggedCount} bundle${flaggedCount === 1 ? '' : 's'} outside tolerance`
              : allComplete
                ? 'All bundles accounted for'
                : `${rows.filter((r) => entryComplete(r.entry)).length} of ${rows.length} complete`}
          </span>
          <button
            type="button"
            disabled={!anyTouched || invalidCount > 0}
            onClick={onSave}
            style={{
              padding: '9px 22px',
              borderRadius: 9,
              border: 'none',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: anyTouched && !invalidCount ? 'pointer' : 'not-allowed',
              background: anyTouched && !invalidCount ? ARCH_SURFACE.green : '#CBD5E1',
              color: anyTouched && !invalidCount ? '#fff' : '#94A3B8',
            }}
          >
            {allComplete ? 'Complete split' : 'Save progress'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
