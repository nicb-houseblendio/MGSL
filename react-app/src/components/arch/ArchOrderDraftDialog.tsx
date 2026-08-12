import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { fmtMoney, fmtPct, marginColor } from '@/lib/archOrderPricing';
import type { ArchOrderDraft } from '@/types/archOrder';

/**
 * What the wizard produced.
 *
 * This exists BECAUSE nothing is written to NetSuite yet. Rather than fake a
 * success toast and an SO number that does not exist, the flow ends by showing
 * exactly what it assembled — the header, every line, the split and service
 * intents, and the economics. That makes the missing decisions concrete: you can
 * point at "isSplit: true, 300 of 690 BF" and ask what that should become on the
 * sales order.
 */

interface ArchOrderDraftDialogProps {
  draft: ArchOrderDraft;
  onClose: () => void;
}

const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #E2E8F0',
  fontSize: 12,
  color: ARCH_SURFACE.text,
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

export const ArchOrderDraftDialog = ({ draft, onClose }: ArchOrderDraftDialogProps) => {
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
            Order assembled — not yet sent to NetSuite
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 2 }}>
            {draft.mode === 'existing' ? `Would append to ${draft.existingSO}` : 'Would create a new sales order'} ·{' '}
            {draft.lines.length} line{draft.lines.length === 1 ? '' : 's'}
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
              Writing this to NetSuite needs four decisions that are still open: how a{' '}
              <strong>split line is marked</strong> on the SO, where{' '}
              <strong>remanufacturing and cutting</strong> live, the real <strong>fee rates</strong>, and the{' '}
              <strong>SO header field IDs</strong>. The margins below use placeholder rates.
            </span>
          </div>

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
                <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
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
                    {formatBF(l.bf)}
                    {l.isSplit && (
                      <span style={{ color: ARCH_SURFACE.textLight, fontWeight: 400 }}> / {formatBF(l.lotBF)}</span>
                    )}
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }} className="font-mono">
                    {fmtMoney(l.pricePerBF)}
                  </td>
                  <td style={{ ...cell, fontSize: 11 }}>
                    {l.isSplit && (
                      <div style={{ color: '#B36B16', fontWeight: 600 }}>
                        SPLIT — pick {formatBF(l.bf)} of {formatBF(l.lotBF)} BF; hold the whole bundle
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
                ['Board feet', `${formatBF(draft.totals.bf)} BF`, ARCH_SURFACE.text],
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
