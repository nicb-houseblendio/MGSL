// Presentational only — no hooks, no React namespace types needed.
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatBF } from '@/lib/archUom';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { nextSplitLotNo } from '@/lib/archSplit';
import type { ArchSplitJob } from '@/types/archSplit';

/**
 * The printable work order and bundle tags.
 *
 * Per the call, the warehouse worker prints this, sees the split to do and the
 * new lot number, writes the measured board footage on the tag by hand, and
 * staples it to the new bundle. So the tag deliberately leaves board feet BLANK
 * with a rule to write on — printing a number there would be printing a guess,
 * and the whole point is that the real figure is only known once the bundle is
 * opened and re-tallied.
 */

interface SplitWorkOrderProps {
  job: ArchSplitJob;
  onClose: () => void;
}

export const SplitWorkOrder = ({ job, onClose }: SplitWorkOrderProps) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent
      className="max-w-[860px] w-[94vw] p-0 gap-0 overflow-hidden"
      style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      aria-describedby={undefined}
      aria-label={`Work order for ${job.soNo}`}
    >
      <div
        className="no-print"
        style={{
          padding: '13px 18px',
          background: 'linear-gradient(135deg, #0F2641, #1A3D63)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>Work order &amp; bundle tags</div>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            marginLeft: 'auto',
            padding: '6px 16px',
            borderRadius: 7,
            border: 'none',
            background: '#fff',
            color: '#0F2641',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          🖨 Print
        </button>
      </div>

      {/*
        `color` is set here, not just `background`. This sheet pins itself to
        white, but the app foreground follows the OS theme, so on a dark theme
        every cell that did not name its own colour inherited near-white ONTO
        that white: the Bundle/Lot, Item and Pick-for-customer values all
        rendered at about 1.1:1 while On file, which sets textMid, stayed
        readable. That is worse here than anywhere else in the app, because
        this is the one screen the warehouse PRINTS — the missing values are
        exactly the ones the sawyer needs.
        Setting it on the root fixes every descendant that does not override,
        including any cell added later. Rule: if an element sets a light
        background, it must also set a colour.
      */}
      <div
        id="arch-split-print"
        style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#fff', color: ARCH_SURFACE.text }}
      >
        {/* Work order */}
        <div style={{ borderBottom: '2px solid #0F2641', paddingBottom: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0F2641' }}>BUNDLE SPLIT — WORK ORDER</div>
          <div style={{ fontSize: 12.5, color: ARCH_SURFACE.textMid, marginTop: 3 }}>
            <span className="font-mono" style={{ fontWeight: 700 }}>{job.soNo}</span> · {job.customer} ·{' '}
            {job.locationName} · ships {job.shipDate}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 26 }}>
          <thead>
            <tr>
              {['Bundle / Lot', 'Item', 'On file', 'Pick for customer', 'Measured', 'Back to stock'].map((h, i) => (
                <th
                  key={h}
                  style={{
                    textAlign: i >= 2 ? 'right' : 'left',
                    padding: '7px 8px',
                    borderBottom: '2px solid #0F2641',
                    fontSize: 9.5,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: ARCH_SURFACE.textMid,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {job.bundles.map((b) => (
              <tr key={b.lotNo}>
                <td className="font-mono" style={{ padding: '9px 8px', borderBottom: '1px solid #E2E8F0', fontWeight: 700 }}>
                  {b.lotNo}
                </td>
                <td style={{ padding: '9px 8px', borderBottom: '1px solid #E2E8F0' }}>{b.itemDescription}</td>
                <td className="font-mono" style={{ padding: '9px 8px', borderBottom: '1px solid #E2E8F0', textAlign: 'right', color: ARCH_SURFACE.textMid }}>
                  {formatBF(b.systemBF)}
                </td>
                <td className="font-mono" style={{ padding: '9px 8px', borderBottom: '1px solid #E2E8F0', textAlign: 'right', fontWeight: 800, fontSize: 14 }}>
                  {formatBF(b.requestedBF)}
                </td>
                {/* Blank, ruled — filled in by hand at the saw. */}
                <td style={{ padding: '9px 8px', borderBottom: '1px solid #E2E8F0', textAlign: 'right' }}>
                  <span style={{ display: 'inline-block', width: 78, borderBottom: '1.5px solid #0F2641', height: 17 }} />
                </td>
                <td style={{ padding: '9px 8px', borderBottom: '1px solid #E2E8F0', textAlign: 'right' }}>
                  <span style={{ display: 'inline-block', width: 78, borderBottom: '1.5px solid #0F2641', height: 17 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Tags for the new bundles */}
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: ARCH_SURFACE.textMid, marginBottom: 10 }}>
          Tags — cut out and attach to each new bundle
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {job.bundles.map((b) => (
            <div
              key={b.lotNo}
              style={{
                border: '2px dashed #0F2641',
                borderRadius: 8,
                padding: '12px 14px',
                breakInside: 'avoid',
              }}
            >
              <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: ARCH_SURFACE.textMid }}>
                New bundle
              </div>
              <div className="font-mono" style={{ fontSize: 17, fontWeight: 800, color: '#0F2641', margin: '3px 0 8px' }}>
                {nextSplitLotNo(b.lotNo)}
              </div>
              <div style={{ fontSize: 11, color: ARCH_SURFACE.text, marginBottom: 2 }}>{b.itemDescription}</div>
              <div className="font-mono" style={{ fontSize: 9.5, color: ARCH_SURFACE.textLight, marginBottom: 10 }}>
                from {b.lotNo}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: ARCH_SURFACE.textMid }}>
                  Board feet
                </span>
                <span style={{ flex: 1, borderBottom: '2px solid #0F2641', height: 22 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: ARCH_SURFACE.textMid }}>BF</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
