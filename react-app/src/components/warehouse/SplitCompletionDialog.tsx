import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { evaluateEntry, entryComplete, jobRequestedBF, jobSystemBF, SPLIT_VARIANCE_TOLERANCE } from '@/lib/archSplit';
import type { ArchSplitEntry, ArchSplitJob } from '@/types/archSplit';

/**
 * Where the split actually gets recorded.
 *
 * Laid out like the client prototype: one compact row per bundle, with Lot BF and
 * SO BF as REFERENCE columns and only the customer bundle and the inventory
 * bundle as primary inputs. The prototype states the split of responsibility in
 * its own hint text: "Lot BF and SO BF are shown for reference. Enter the
 * customer bundle and the inventory bundle for each lift."
 *
 * Lot BF is STATIC. Marc-Antoine confirmed on 2026-08-13 that only two values are
 * entered, so the bundle total is the sum of the two piles and there is nothing
 * for a third input to hold. It was previously editable and pre-filled from the
 * system, which made it a trap: leave it alone and the screen reported a
 * discrepancy that was not one.
 *
 * Saving is never blocked by a discrepancy — a worker who measured correctly must
 * be able to record what they measured. It IS blocked by figures that cannot be
 * true: a negative part, or an empty customer bundle.
 */

interface SplitCompletionDialogProps {
  job: ArchSplitJob;
  entryFor: (lotNo: string) => ArchSplitEntry;
  onChange: (lotNo: string, patch: Partial<ArchSplitEntry>) => void;
  onReset: () => void;
  onSave: () => void;
  onClose: () => void;
}

const th: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: ARCH_SURFACE.textLight,
  whiteSpace: 'nowrap',
};

/**
 * Base cell.
 *
 * `color` is set EXPLICITLY and must stay that way. Radix's DialogContent carries
 * a muted foreground, so a cell without its own colour inherits it and renders
 * near-invisible on this white surface — the SO BF column and the totals row were
 * both unreadable in sandbox before this was pinned.
 */
const cell: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 12,
  verticalAlign: 'middle',
  color: ARCH_SURFACE.text,
};

/** Primary input: what the worker actually keys in. */
const entryInput = (state: 'ok' | 'flag' | 'empty'): React.CSSProperties => ({
  width: 96,
  padding: '7px 9px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  textAlign: 'right',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
  color: ARCH_SURFACE.text,
  background: '#fff',
  border: `1.5px solid ${state === 'flag' ? '#B91C1C' : state === 'ok' ? ARCH_SURFACE.green : '#CBD5E1'}`,
});

export const SplitCompletionDialog = ({
  job,
  entryFor,
  onChange,
  onReset,
  onSave,
  onClose,
}: SplitCompletionDialogProps) => {
  const rows = job.bundles.map((b) => {
    const entry = entryFor(b.lotNo);
    return { bundle: b, entry, state: evaluateEntry(entry, b.systemBF) };
  });

  const anyTouched = rows.some((r) => r.state.touched);
  const allComplete = rows.every((r) => entryComplete(r.entry) && !r.state.invalid);
  const flaggedCount = rows.filter((r) => r.state.flagged).length;
  const invalidCount = rows.filter((r) => r.state.invalid).length;

  const tot = rows.reduce(
    (a, r) => ({
      customer: a.customer + r.state.customer,
      inventory: a.inventory + r.state.inventory,
    }),
    { customer: 0, inventory: 0 }
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[1000px] w-[96vw] p-0 gap-0 overflow-hidden"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        aria-describedby={undefined}
        aria-label={`Record split for ${job.soNo}`}
      >
        <div style={{ padding: '13px 20px', background: 'linear-gradient(135deg,#0F2641,#1A3D63)' }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Enter split details</div>
          <div style={{ color: '#AFC2D6', fontSize: 11.5, marginTop: 2 }}>
            <span className="font-mono">{job.soNo}</span> · {job.customer} · {job.bundles.length} bundle
            {job.bundles.length === 1 ? '' : 's'} · <span className="font-mono">{formatBF(jobRequestedBF(job))} BF</span>
          </div>
        </div>

        <div style={{ padding: '14px 20px', overflowY: 'auto', background: '#fff' }}>
          <div style={{ fontSize: 11.5, color: ARCH_SURFACE.textMid, marginBottom: 10 }}>
            <strong>Lot BF</strong> and <strong>SO BF</strong> are shown for reference. Enter the{' '}
            <strong>customer bundle</strong> and the <strong>inventory bundle</strong> for each lift.
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                <th style={{ ...th, textAlign: 'left', width: 30 }} />
                <th style={{ ...th, textAlign: 'left' }}>Bundle</th>
                <th style={{ ...th, textAlign: 'left' }}>Item description</th>
                <th style={{ ...th, textAlign: 'right' }}>Lot BF</th>
                <th style={{ ...th, textAlign: 'right' }}>SO BF</th>
                <th style={{ ...th, textAlign: 'right' }}>Customer bundle</th>
                <th style={{ ...th, textAlign: 'right' }}>Inventory bundle</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ bundle, entry, state }, i) => {
                const inputState = (v: string): 'ok' | 'flag' | 'empty' =>
                  v.trim() === '' ? 'empty' : state.flagged || state.invalid ? 'flag' : 'ok';
                const bad = state.flagged || state.invalid;
                return (
                  <React.Fragment key={bundle.lotNo}>
                    <tr style={{ background: bad ? '#FEF7F7' : i % 2 ? '#FBFCFE' : '#fff' }}>
                      <td style={{ ...cell, textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            width: 19,
                            height: 19,
                            borderRadius: 5,
                            background: '#EEF1F6',
                            color: ARCH_SURFACE.textMid,
                            fontSize: 10,
                            fontWeight: 700,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td style={{ ...cell }}>
                        <span className="font-mono" style={{ fontWeight: 700, color: ARCH_SURFACE.navyMid, fontSize: 11.5 }}>
                          {bundle.lotNo}
                        </span>
                      </td>
                      <td style={{ ...cell, color: ARCH_SURFACE.textMid }}>{bundle.itemDescription}</td>
                      <td
                        style={{ ...cell, textAlign: 'right', fontWeight: 600, color: ARCH_SURFACE.textMid }}
                        className="font-mono"
                      >
                        {formatBF(bundle.systemBF)}
                      </td>
                      <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                        {formatBF(bundle.requestedBF)}
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={entry.customerBF}
                          onChange={(e) => onChange(bundle.lotNo, { customerBF: e.target.value })}
                          placeholder="0"
                          aria-label={`Customer bundle ${bundle.lotNo}`}
                          className="font-mono"
                          style={entryInput(inputState(entry.customerBF))}
                        />
                      </td>
                      <td style={{ ...cell, textAlign: 'right' }}>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={entry.inventoryBF}
                          onChange={(e) => onChange(bundle.lotNo, { inventoryBF: e.target.value })}
                          placeholder="0"
                          aria-label={`Inventory bundle ${bundle.lotNo}`}
                          className="font-mono"
                          style={entryInput(inputState(entry.inventoryBF))}
                        />
                      </td>
                      <td
                        style={{ ...cell, textAlign: 'right', fontWeight: 700, color: bad ? '#B91C1C' : ARCH_SURFACE.text }}
                        className="font-mono"
                      >
                        {state.touched ? formatBF(state.measured) : '—'}
                      </td>
                    </tr>
                    {(state.invalid || state.flagged) && (
                      <tr style={{ background: '#FEF7F7' }}>
                        <td />
                        <td colSpan={7} style={{ padding: '0 8px 7px', fontSize: 11 }}>
                          {state.invalid ? (
                            <span style={{ color: '#B91C1C' }}>
                              <strong>Impossible figures.</strong>{' '}
                              {state.customer < 0 || state.inventory < 0
                                ? 'Quantities cannot be negative.'
                                : 'The customer bundle is empty — record what they are actually receiving.'}
                            </span>
                          ) : (
                            <span style={{ color: '#B91C1C' }}>
                              Re-tallied{' '}
                              <strong className="font-mono">
                                {state.discrepancy > 0 ? '+' : ''}
                                {formatBF(state.discrepancy)} BF
                              </strong>{' '}
                              against Lot BF, {Math.abs(Math.round(state.discrepancyPct * 100))}%. Past{' '}
                              {Math.round(SPLIT_VARIANCE_TOLERANCE * 100)}% it is worth a second look, but you can
                              still save.
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #E2E8F0' }}>
                <td />
                <td style={{ ...cell, fontWeight: 700 }}>Total</td>
                <td />
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, color: ARCH_SURFACE.textMid }} className="font-mono">
                  {formatBF(jobSystemBF(job))}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                  {formatBF(jobRequestedBF(job))}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, paddingRight: 17 }} className="font-mono">
                  {formatBF(tot.customer)}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, paddingRight: 17 }} className="font-mono">
                  {formatBF(tot.inventory)}
                </td>
                <td
                  style={{
                    ...cell,
                    textAlign: 'right',
                    fontWeight: 700,
                    color: flaggedCount || invalidCount ? '#B91C1C' : ARCH_SURFACE.text,
                  }}
                  className="font-mono"
                >
                  {formatBF(tot.customer + tot.inventory)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div
            style={{
              marginTop: 14,
              padding: '9px 12px',
              borderRadius: 9,
              background: '#FFF8E1',
              border: '1px solid #E6B800',
              fontSize: 11,
              color: '#7A4100',
              lineHeight: 1.5,
            }}
          >
            Saving records the split and releases the hold. It does not write to NetSuite yet — correcting the sales
            order line and posting the inventory adjustment that splits the lot are still to be agreed. The next screen
            shows exactly what it would do.
          </div>
        </div>

        <div
          style={{
            padding: '11px 20px',
            borderTop: '1px solid #E2E8F0',
            background: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onReset}
            disabled={!anyTouched}
            style={{
              padding: '8px 15px',
              borderRadius: 9,
              border: '1.5px solid #CBD5E1',
              background: '#fff',
              color: anyTouched ? ARCH_SURFACE.textMid : '#A6B4C2',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: anyTouched ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            Reset
          </button>

          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11.5,
              color: invalidCount || flaggedCount ? '#B91C1C' : ARCH_SURFACE.textMid,
            }}
          >
            {invalidCount > 0
              ? `${invalidCount} bundle${invalidCount === 1 ? '' : 's'} with impossible figures`
              : flaggedCount > 0
                ? `${flaggedCount} bundle${flaggedCount === 1 ? '' : 's'} outside tolerance`
                : `${rows.filter((r) => entryComplete(r.entry)).length} of ${rows.length} recorded`}
          </span>

          {/* "Close", not "Cancel". Measurements live in WarehouseSplitScreen, so
              closing does NOT discard them — and it shouldn't: nobody should lose
              three re-tallied bundles to a mis-click. But a button promising a
              discard it never performs is worse than either behaviour alone. */}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 9,
              border: '1.5px solid #CBD5E1',
              background: '#fff',
              color: ARCH_SURFACE.textMid,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Close
          </button>

          <button
            type="button"
            onClick={onSave}
            disabled={!anyTouched || invalidCount > 0}
            style={{
              padding: '8px 20px',
              borderRadius: 9,
              border: 'none',
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: !anyTouched || invalidCount > 0 ? 'not-allowed' : 'pointer',
              background: !anyTouched || invalidCount > 0 ? '#E2E8F0' : 'linear-gradient(135deg,#1E6B47,#2A9060)',
              color: !anyTouched || invalidCount > 0 ? '#A6B4C2' : '#fff',
            }}
          >
            {allComplete ? 'Save splits' : 'Save partial'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
