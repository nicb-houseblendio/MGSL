import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatQty, unitLabel, formatUnitTotals } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { fmtMoney, fmtPct, marginColor } from '@/lib/archOrderPricing';
import type { ArchOrderDraft } from '@/types/archOrder';
import type { ArchOrderResult } from '@/lib/archOrderApi';

/**
 * What the wizard produced, and what NetSuite did with it.
 *
 * This used to exist BECAUSE nothing was written — it showed the assembled draft
 * instead of faking a success toast. The write path landed on 2026-08-20, so it
 * now reports the outcome as well, and the draft remains visible underneath
 * because a refusal is much easier to act on next to the thing that was refused.
 *
 * Three outcomes it must tell apart, and they are NOT the same:
 *   - not connected     nothing was attempted, the cart is intact
 *   - refused           nothing was written, the cart is intact, here is why
 *   - created           an SO exists, and its bundles may or may not be locked
 */

interface ArchOrderDraftDialogProps {
  draft: ArchOrderDraft;
  /** Null when the screen is not connected to NetSuite, so nothing was attempted. */
  result?: ArchOrderResult | null;
  submitting?: boolean;
  onClose: () => void;
}

const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #E2E8F0',
  fontSize: 12,
  color: ARCH_SURFACE.text,
};

const notice: React.CSSProperties = {
  display: 'flex',
  gap: 9,
  alignItems: 'flex-start',
  padding: '10px 12px',
  borderRadius: 9,
  fontSize: 11.5,
  lineHeight: 1.55,
  marginBottom: 16,
};

const head: React.CSSProperties = {
  padding: '7px 10px',
  textAlign: 'left',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  color: ARCH_SURFACE.textMid,
  background: 'linear-gradient(to bottom,#F1F5FA,#E8EDF5)',
  borderBottom: '2px solid #CBD5E1',
  whiteSpace: 'nowrap',
};

/**
 * The outcome, when there is one.
 *
 * Deliberately distinguishes "the order exists but its bundles are NOT locked"
 * from a plain success, because that state is the dangerous one: the stock reads
 * as committed at row level while no lot claims it, so the drawer shows nothing
 * and the bundle stays sellable. `lotsNotAttributed` and `formWarning` are how
 * the server reports it, and both are worth surfacing verbatim rather than
 * flattening into a tick.
 */
const OutcomeNotice = ({
  result,
  submitting,
}: {
  result?: ArchOrderResult | null;
  submitting?: boolean;
}) => {
  if (submitting) {
    return (
      <div style={{ ...notice, background: '#EFF6FF', border: '1px solid #93C5FD', color: '#1E3A8A' }}>
        <span>Sending to NetSuite. Do not close this window or press Create again.</span>
      </div>
    );
  }
  if (!result) return null;

  if (!result.ok) {
    return (
      <div style={{ ...notice, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#7F1D1D' }}>
        <div>
          <strong>Nothing was written.</strong> Your selection is intact, so you can fix the
          problem and try again.
          <div style={{ marginTop: 6 }}>{result.error}</div>
          {result.problems && result.problems.length > 1 && (
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {result.problems.map((p, i) => (
                <li key={i} style={{ marginTop: 2 }}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const unlocked = (result.lotsNotAttributed || []).length > 0;
  if (unlocked || result.formWarning) {
    return (
      <div style={{ ...notice, background: '#FFF7ED', border: '1px solid #FDBA74', color: '#7C2D12' }}>
        <div>
          <strong>The order exists, but its bundles are not locked.</strong> The quantities are
          right, yet no lot claims them, so the wood still reads as sellable to everyone else.
          {result.formWarning && <div style={{ marginTop: 6 }}>{result.formWarning}</div>}
          {unlocked && (
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {(result.lotsNotAttributed || []).map((p, i) => (
                <li key={i} style={{ marginTop: 2 }}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...notice, background: '#F0FDF4', border: '1px solid #86EFAC', color: '#14532D' }}>
      <span>
        Created and the bundles are locked.
        {result.splitLinesQueued
          ? ` ${result.splitLinesQueued} line${result.splitLinesQueued === 1 ? '' : 's'} queued for the warehouse to split.`
          : ''}{' '}
        The trader screen catches up at the next cache refresh.
      </span>
    </div>
  );
};

export const ArchOrderDraftDialog = ({
  draft,
  result,
  submitting,
  onClose,
}: ArchOrderDraftDialogProps) => {
  const cur = draft.header.currency || 'USD';
  const splitCount = draft.lines.filter((l) => l.isSplit).length;
  const remanCount = draft.lines.filter((l) => l.reman.planing || l.reman.cutting).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[900px] w-[94vw] p-0 gap-0 overflow-hidden"
        style={{ maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
        aria-describedby={undefined}
        aria-label="Assembled sales order"
      >
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #0F2641, #1A3D63)',
            flexShrink: 0,
          }}
        >
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
            {submitting
              ? 'Sending to NetSuite…'
              : !result
                ? 'Order assembled — not sent, this screen is not connected to NetSuite'
                : result.ok
                  ? `Sales order created${result.salesOrderId ? ` — internal id ${result.salesOrderId}` : ''}`
                  : 'NetSuite refused this order — nothing was written'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 2 }}>
            {draft.mode === 'existing'
              ? `${result?.ok ? 'Appended to' : 'Would append to'} ${draft.existingSO}`
              : `${result?.ok ? 'Created' : 'Would create'} a new sales order`}{' '}
            · {draft.lines.length} line{draft.lines.length === 1 ? '' : 's'}
            {splitCount > 0 && ` · ${splitCount} split`}
            {remanCount > 0 && ` · ${remanCount} with services`}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#fff' }}>
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
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
            <span>
              The <strong>planing and cutting rates</strong> below are still placeholders, and the
              split fee is not charged at all until it is configured. Operations &amp; insurance is
              real. <strong>Do not quote a customer from these margins.</strong>
            </span>
          </div>

          <OutcomeNotice result={result} submitting={submitting} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 9,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              marginBottom: 16,
            }}
          >
            {(
              [
                ['Customer', draft.header.customer],
                ['Customer PO', draft.header.customerPO || '—'],
                ['Ship to', draft.header.shipTo],
                ['Ship date', draft.header.shipDate],
                ['Incoterms', draft.header.incoterms],
                ['Currency', draft.header.currency],
                ['Payment terms', draft.header.paymentTerms],
                ['Sales team', draft.header.salesTeam],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: ARCH_SURFACE.textLight,
                    marginBottom: 2,
                  }}
                >
                  {k}
                </div>
                {/* Colour PINNED. Inheriting it put the dark theme's near-white
                    foreground (#EEF1F6) on this panel's #F8FAFC — contrast 1.08,
                    i.e. all eight values invisible, while the labels above them
                    stayed readable because they set a colour explicitly. Any
                    text on a light surface in this app must state its own
                    colour; the app foreground follows the OS theme. */}
                <div style={{ fontSize: 12, fontWeight: 600, color: ARCH_SURFACE.text }}>{v}</div>
              </div>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={head}>Lot</th>
                <th style={head}>Item</th>
                <th style={{ ...head, textAlign: 'right' }}>BF</th>
                <th style={{ ...head, textAlign: 'right' }}>Price/BF</th>
                <th style={head}>Intent</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((l) => (
                <tr key={l.lotNo}>
                  <td style={{ ...cell, fontWeight: 700, color: ARCH_SURFACE.navyMid }} className="font-mono">
                    {l.lotNo}
                  </td>
                  <td style={cell}>{l.description}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }} className="font-mono">
                    {formatQty(l.orderedQty, l.unit)}
                    {l.isSplit && (
                      <span style={{ color: ARCH_SURFACE.textLight, fontWeight: 400 }}> / {formatQty(l.lotBF, l.unit)}</span>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }} className="font-mono">
                    {fmtMoney(l.pricePerBF)}
                  </td>
                  <td style={{ ...cell, fontSize: 11 }}>
                    {l.isSplit && (
                      <div style={{ color: '#B36B16', fontWeight: 600 }}>
                        SPLIT — pick {formatQty(l.orderedQty, l.unit)} of {formatQty(l.lotBF, l.unit)} {unitLabel(l.unit)}; hold the whole bundle
                      </div>
                    )}
                    {l.reman.planing && (
                      <div style={{ color: ARCH_SURFACE.navyMid }}>
                        Plane → {l.reman.planingSpec === 'other' ? l.reman.planingOther : `${l.reman.planingSpec}"`}
                      </div>
                    )}
                    {l.reman.cutting && <div style={{ color: '#B36B16' }}>Cut → {l.reman.cutLength}</div>}
                    {!l.isSplit && !l.reman.planing && !l.reman.cutting && (
                      <span style={{ color: ARCH_SURFACE.textLight }}>Full bundle, no services</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            style={{
              display: 'flex',
              gap: 24,
              flexWrap: 'wrap',
              marginTop: 16,
              padding: '12px 16px',
              borderRadius: 9,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
            }}
          >
            {(
              [
                ['Quantity', formatUnitTotals(draft.lines.map((l) => ({ unit: l.unit, qty: l.orderedQty }))), ARCH_SURFACE.text],
                ['Revenue', fmtMoney(draft.totals.revenue, cur, 0), ARCH_SURFACE.text],
                ['Estimated profit', fmtMoney(draft.totals.profit, cur, 0), marginColor(draft.totals.marginPct)],
                ['Margin', fmtPct(draft.totals.marginPct), marginColor(draft.totals.marginPct)],
              ] as [string, string, string][]
            ).map(([k, v, col]) => (
              <div key={k}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: ARCH_SURFACE.textLight,
                    marginBottom: 2,
                  }}
                >
                  {k}
                </div>
                <div className="font-mono" style={{ fontSize: 15, fontWeight: 700, color: col }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 20px',
            borderTop: '1px solid #E2E8F0',
            background: '#F8FAFC',
          }}
        >
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
      </DialogContent>
    </Dialog>
  );
};
