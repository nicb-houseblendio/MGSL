// Presentational only — no hooks, no React namespace types needed.
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatBF } from '@/lib/archUom';
import { nextSplitLotNo, shortDate } from '@/lib/archSplit';
import type { ArchSplitJob } from '@/types/archSplit';

/**
 * The printed paperwork for a split job, matching the client prototype:
 * one WORK ORDER sheet, then one SPLIT / LOT SHEET per bundle.
 *
 * This replaced a single condensed sheet with cut-out tags. That version was
 * ours, not theirs, and Andrei flagged it — the printed form has to be the one
 * the warehouse was shown.
 *
 * Per the call, the worker prints this, sees the split to do and the new lot
 * number, writes the measured board footage on the sheet by hand and staples it
 * to the new bundle. So LOT BF is deliberately a blank rule: printing a number
 * there would be printing a guess, and the whole point is that the real figure
 * is only known once the bundle is opened and re-tallied.
 */

interface SplitWorkOrderProps {
  job: ArchSplitJob;
  onClose: () => void;
}

/* ── Sheet palette. Print ink, deliberately not the screen tokens. ───────────*/
const INK = '#0B1D5B';
const ACCENT = '#1F57FF';
/** Label grey. Darker than the prototype's #7A8FA3, which is faint on paper. */
const LABEL = '#586D82';
const HAIRLINE = '#E2E8F0';

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const SHEET: React.CSSProperties = {
  width: 816,
  maxWidth: '100%',
  background: '#fff',
  padding: '44px 48px',
  color: '#0D1F33',
  margin: '0 auto 26px',
  boxShadow: '0 6px 26px rgba(13,31,51,0.16)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 1.2,
  color: LABEL,
};

/** CWP wood lockup, sized for the sheet it heads. */
const Wordmark = ({ small }: { small?: boolean }) => (
  <div>
    <div
      style={{
        fontSize: small ? 12 : 15,
        fontWeight: 800,
        letterSpacing: small ? 2.5 : 3,
        color: INK,
        paddingLeft: small ? 2 : 3,
      }}
    >
      CWP
    </div>
    <div
      style={{
        fontSize: small ? 34 : 46,
        fontWeight: 800,
        color: ACCENT,
        lineHeight: 0.95,
        letterSpacing: small ? -1.5 : -2,
      }}
    >
      wood
    </div>
  </div>
);

const Chip = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'inline-block',
      background: INK,
      color: '#fff',
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: 14,
      padding: '6px 14px',
      borderRadius: 6,
      marginTop: 8,
    }}
  >
    {children}
  </div>
);

const Rule = () => <div style={{ height: 3, background: INK, margin: '16px 0 20px' }} />;

/** Blank line to write on, with its caption underneath. */
const SignLine = ({ label, width }: { label: string; width?: number }) => (
  <div style={width ? { width } : { flex: 1 }}>
    <div style={{ borderBottom: '1.5px solid #0D1F33', height: 30 }} />
    <div style={{ marginTop: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: LABEL }}>
      {label}
    </div>
  </div>
);

const Field = ({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) => (
  <div style={{ padding: '10px 14px', borderRight: last ? 'none' : `1px solid ${HAIRLINE}` }}>
    <div style={labelStyle}>{label}</div>
    <div
      style={{
        fontSize: 13.5,
        fontWeight: mono ? 700 : 600,
        marginTop: 2,
        fontFamily: mono ? MONO : undefined,
      }}
    >
      {value}
    </div>
  </div>
);

export const SplitWorkOrder = ({ job, onClose }: SplitWorkOrderProps) => {
  const totalBF = job.bundles.reduce((s, b) => s + b.systemBF, 0);
  const printedOn = new Date()
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();

  const cell: React.CSSProperties = {
    padding: '10px 8px',
    textAlign: 'center',
    fontFamily: MONO,
    fontSize: 12,
    whiteSpace: 'nowrap',
  };
  const headCell: React.CSSProperties = {
    padding: '9px 8px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    textAlign: 'center',
    color: '#fff',
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[900px] w-[95vw] p-0 gap-0 overflow-hidden"
        style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        aria-describedby={undefined}
        aria-label={`Order sheets for ${job.soNo}`}
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
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
            Work order &amp; lot sheets
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
            {job.bundles.length + 1} page{job.bundles.length + 1 === 1 ? '' : 's'}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              marginLeft: 'auto',
              height: 30,
              padding: '0 14px',
              borderRadius: 7,
              border: 'none',
              background: '#fff',
              color: '#0F2641',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Print / Save as PDF
          </button>
        </div>

        {/*
          `color` is set on this container, not just `background`. The sheets pin
          themselves to white and the app foreground follows the OS theme, so
          without it every value that does not name its own colour renders
          near-white on white — which is how the previous work order printed its
          Bundle, Item and Pick-for-customer columns blank.
        */}
        <div
          id="arch-split-print"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            background: '#EEF1F6',
            color: '#0D1F33',
          }}
        >
          {/* ══ WORK ORDER ═══════════════════════════════════════════════════ */}
          <div style={SHEET} className="arch-sheet">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Wordmark />
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 4, color: INK }}>
                  WORK ORDER
                </div>
                {/* No "SO #" prefix — soNo already carries it, and the
                    prototype's bare numeric id is what made that read right
                    there. Prefixing gave "SO #SO-52044". */}
                <Chip>{job.soNo}</Chip>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: 1.6,
                    color: ACCENT,
                    marginTop: 8,
                  }}
                >
                  PRINTED {printedOn}
                </div>
              </div>
            </div>

            <Rule />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.3fr 1fr 1fr 1fr',
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 6,
              }}
            >
              <Field label="CUSTOMER" value={job.customer} />
              <Field label="TRADER" value={job.trader} />
              <Field label="TOTAL QTY" value={`${formatBF(totalBF)} BF`} mono />
              {/* Formatted, matching the queue row. A raw ISO date on a printed
                  sheet is the one format nobody on a warehouse floor reads. */}
              <Field label="READY TO SHIP" value={shortDate(job.shipDate)} last />
            </div>

            <table
              style={{
                width: '100%',
                marginTop: 24,
                borderCollapse: 'collapse',
                fontSize: 12.5,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <thead>
                <tr style={{ background: INK }}>
                  <th style={{ ...headCell, width: 52 }}>CHECK</th>
                  <th style={{ ...headCell, width: 116 }}>BUNDLE</th>
                  <th style={{ ...headCell, width: 138 }}>CONTAINER</th>
                  <th style={{ ...headCell, textAlign: 'left', paddingLeft: 10 }}>DESCRIPTION</th>
                  <th style={{ ...headCell, width: 96 }}>BUNDLE BF</th>
                  <th style={{ ...headCell, width: 88 }}>SPLIT</th>
                </tr>
              </thead>
              <tbody>
                {job.bundles.map((b) => (
                  <tr key={b.lotNo} style={{ borderTop: '1px solid #EEF1F6' }}>
                    <td style={{ ...cell, display: 'table-cell' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 17,
                          height: 17,
                          border: `2px solid ${INK}`,
                          borderRadius: 3,
                          verticalAlign: 'middle',
                        }}
                      />
                    </td>
                    <td style={{ ...cell, fontWeight: 600 }}>{b.lotNo}</td>
                    <td style={cell}>{b.containerNo}</td>
                    <td
                      style={{
                        padding: '10px 10px',
                        fontWeight: 600,
                        fontFamily: 'inherit',
                        fontSize: 12.5,
                      }}
                    >
                      {b.itemDescription}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>
                      {formatBF(b.systemBF)}
                    </td>
                    <td style={{ ...cell }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          background: '#FFF3D6',
                          color: '#A16207',
                          fontFamily: 'inherit',
                        }}
                      >
                        YES
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div
              style={{
                marginTop: 16,
                padding: '11px 16px',
                background: '#FFF8E7',
                border: '1px solid #F0DCA8',
                borderRadius: 6,
                fontSize: 12.5,
                color: '#7A5B0F',
                fontWeight: 600,
              }}
            >
              This order requires a split — a lot sheet is attached for each bundle with its
              pre-assigned lot number.
            </div>

            <div style={{ display: 'flex', gap: 40, marginTop: 36, fontSize: 12.5 }}>
              <SignLine label="COMPLETED BY" />
              <SignLine label="DATE" width={180} />
            </div>

            <div
              style={{
                marginTop: 36,
                paddingTop: 14,
                borderTop: `1px solid ${HAIRLINE}`,
                textAlign: 'center',
                fontSize: 11,
                color: LABEL,
              }}
            >
              Canadian Wood Products-Montreal Inc. · 407 Rue McGill, Suite 315, Montreal QC H2Y 2G3,
              Canada · 514-871-2120
            </div>
          </div>

          {/* ══ SPLIT / LOT SHEET, one per bundle ════════════════════════════ */}
          {job.bundles.map((b, i) => (
            <div key={b.lotNo} style={SHEET} className="arch-sheet">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
              >
                <Wordmark small />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 3, color: INK }}>
                    SPLIT / LOT SHEET
                  </div>
                  {/* The lot the NEW bundle will carry — the same number the
                      completion screen says it creates, not a generated one. */}
                  <Chip>{nextSplitLotNo(b.lotNo, 0)}</Chip>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: 1.6,
                      color: ACCENT,
                      marginTop: 8,
                    }}
                  >
                    BUNDLE {i + 1} of {job.bundles.length} · {job.soNo}
                  </div>
                </div>
              </div>

              <Rule />

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  border: `1px solid ${HAIRLINE}`,
                  borderRadius: 6,
                }}
              >
                <Field label="FROM BUNDLE" value={b.lotNo} mono />
                <Field label="DESCRIPTION" value={b.itemDescription} last />
              </div>

              <div
                style={{
                  border: `1px solid ${HAIRLINE}`,
                  borderRadius: 8,
                  marginTop: 18,
                  padding: '12px 16px',
                }}
              >
                <div style={{ ...labelStyle, fontSize: 10 }}>LOT BF</div>
                <div style={{ borderBottom: '1.5px solid #0D1F33', height: 34, marginTop: 6 }} />
              </div>

              <div
                style={{
                  border: `2px solid ${ACCENT}`,
                  background: '#F4F7FF',
                  borderRadius: 10,
                  marginTop: 18,
                  padding: '18px 20px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: INK }}>
                  LOT #
                </div>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 800,
                    fontFamily: MONO,
                    color: ACCENT,
                    letterSpacing: 1,
                    marginTop: 6,
                  }}
                >
                  {nextSplitLotNo(b.lotNo, 0)}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 26,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 19,
                    height: 19,
                    border: `2px solid ${INK}`,
                    borderRadius: 3,
                  }}
                />
                Split completed &amp; verified
              </div>

              <div style={{ display: 'flex', gap: 40, marginTop: 30, fontSize: 12.5 }}>
                <SignLine label="SIGNATURE" />
                <SignLine label="DATE" width={180} />
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
