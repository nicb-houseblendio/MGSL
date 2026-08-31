import * as React from 'react';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { toLengthDistribution, widthLabel, widthNote } from '@/lib/archTally';
import type { TallyBundle } from '@/lib/archTally';

/**
 * The tally sheet viewer.
 *
 * A tally is the supplier's packing list - the document saying what is actually in
 * each bundle. This dialog shows it two ways, in order of preference:
 *
 *   1. PARSED, when a tally has been read into `mgsl.tally.v1`. Bundles are grouped
 *      by length, because that is the question a trader asks of a shipment ("do I
 *      have enough 12-footers?") and no single bundle can answer it.
 *   2. AS AN IMAGE, when nothing has been parsed and only a scan or photo exists.
 *
 * The system quantities in the tables behind this dialog stay authoritative either
 * way - the tally is the supplier's account of the shipment, not ours.
 *
 * Image upload is local-only for now: there is no ARCH back end to persist to. The
 * chosen file lives in component state and is gone on reload.
 */

interface TallyImageDialogProps {
  lotNo: string;
  itemDescription: string;
  /** Image already attached to the lot, if any. */
  imageUrl?: string | null;
  onClose: () => void;
  /** Called with a local object URL when the user picks a file. */
  onUpload?: (lotNo: string, dataUrl: string) => void;
  /**
   * The PARSED tally for this lot, when one exists.
   *
   * Takes precedence over the image, per SDD TY1: "the Trader Screen shows the lot's
   * own matrix in the existing Tally View; lots without parsed data fall back to the
   * linked PDF". Undefined means nothing has been parsed and the image path stands.
   */
  bundle?: TallyBundle | null;
  /** Bundles sharing this item and thickness. The distribution is built from these. */
  siblings?: TallyBundle[];
  /**
   * Set when the tally shown is a SAMPLE from another shipment rather than this lot's
   * own document. Must be rendered - an unlabelled sample is a confident wrong answer
   * attached to a real lot.
   */
  sample?: { sourceFile: string | null; po: string | null; species: string | null; container?: string | null } | null;
}

/**
 * The parsed tally, rendered.
 *
 * READ archTally.ts BEFORE CHANGING THIS. It leads with the LENGTH DISTRIBUTION
 * across bundles, not a per-bundle grid, because all 32 hand-verified bundles hold
 * exactly one thickness, one width and one length. A bundle is a single cell; the
 * distribution only exists once bundles are grouped. A grid-first view would demo
 * well and be empty on every real document.
 *
 * Two things are deliberately NOT inferred here: a missing width never prints "RW"
 * (that is a claim about the supplier, so it comes from widthPolicy), and a figure
 * only some bundles stated is marked partial rather than shown as a total.
 */
const TallyMatrixPanel = ({
  bundle, siblings, imageUrl, sample,
}: {
  bundle: TallyBundle;
  siblings: TallyBundle[];
  imageUrl?: string | null;
  sample?: { sourceFile: string | null; po: string | null; species: string | null; container?: string | null } | null;
}) => {
  const list = siblings && siblings.length ? siblings : [bundle];
  const { rows, totals } = toLengthDistribution(list);
  // Mark by IDENTITY, not by bundleNo: CHECHEN really contains pack 92 twice, and
  // marking by number would highlight both of its rows.
  const selfIdx = list.indexOf(bundle);

  const num = (n: number | null | undefined, dp = 0) =>
    n === null || n === undefined ? '\u00B7' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

  const cell: React.CSSProperties = {
    padding: '5px 10px', fontSize: 11.5, borderBottom: '1px solid #E2E8F0', textAlign: 'right', whiteSpace: 'nowrap',
  };
  const head: React.CSSProperties = {
    ...cell, fontWeight: 700, color: ARCH_SURFACE.textMid,
    background: '#F1F5F9', borderBottom: '1.5px solid #CBD5E1', position: 'sticky', top: 0,
  };

  const dims = [
    bundle.thickness?.inches != null ? `${bundle.thickness.inches}"` : null,
    widthLabel(bundle),
  ].filter((v) => v && v !== '\u2014').join(' \u00D7 ');

  const anyPartial =
    rows.some((r) => r.volumePartial || r.boardFeetPartial) || totals.volumePartial || totals.boardFeetPartial;

  /** A partial sum carries a dagger so it never reads as the whole. */
  const cellVal = (v: number | null, partial: boolean, dp = 0) => (
    <>
      {num(v, dp)}
      {partial && v != null ? <span style={{ color: '#B45309' }}>&dagger;</span> : null}
    </>
  );

  const nBundles = totals.bundles;

  return (
    <div style={{ width: '100%', alignSelf: 'flex-start' }}>
      {sample && (
        <div style={{
          background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8,
          padding: '8px 11px', marginBottom: 10, fontSize: 11, color: '#92400E', lineHeight: 1.5,
        }}>
          <b>Sample tally, not this lot&apos;s document.</b>{' '}
          Taken from {sample.po ? <>PO <span className="font-mono">{sample.po}</span></> : 'another shipment'}
          {sample.species ? ` (${sample.species})` : ''}
          {sample.container ? <>, container <span className="font-mono">{sample.container}</span></> : null}
          {sample.sourceFile ? <> &mdash; <span className="font-mono">{sample.sourceFile}</span></> : null}.
          It is here to show the shape of the view; the figures belong to a different shipment.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ARCH_SURFACE.textMid }}>
          {bundle.species || 'Tally'}
        </span>
        <span style={{ fontSize: 11, color: ARCH_SURFACE.textLight }}>
          {[dims, `${nBundles} ${nBundles === 1 ? 'bundle' : 'bundles'}`].filter(Boolean).join(' \u00B7 ')}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: ARCH_SURFACE.textLight, marginBottom: 8 }}>
        Lengths held at this thickness. This bundle is <span className="font-mono">{bundle.bundleNo}</span>
        {bundle.lengthFt != null ? <> at <b>{bundle.lengthFt}&apos;</b></> : null}.
      </div>

      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'auto', maxHeight: '52vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: 'left' }}>Length</th>
              <th style={head}>Bundles</th>
              <th style={head}>Pieces</th>
              <th style={head}>m&sup3;</th>
              <th style={head}>BF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isThis = selfIdx >= 0 && r.bundleIdx.includes(selfIdx);
              return (
                <tr key={r.label} style={isThis ? { background: '#EFF6FF' } : undefined}>
                  <td style={{ ...cell, textAlign: 'left', fontWeight: isThis ? 800 : 600 }} className="font-mono">
                    {r.label}{isThis ? ' \u25C4' : ''}
                  </td>
                  <td style={cell} className="font-mono">{num(r.bundles)}</td>
                  <td style={cell} className="font-mono">{num(r.pieces)}</td>
                  <td style={cell} className="font-mono">{cellVal(r.volumeM3, r.volumePartial, 3)}</td>
                  <td style={cell} className="font-mono">{cellVal(r.boardFeet, r.boardFeetPartial)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...cell, textAlign: 'left', fontWeight: 700, background: '#F8FAFC' }}>Total</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">{num(totals.bundles)}</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">{num(totals.pieces)}</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">
                {cellVal(totals.volumeM3, totals.volumePartial, 3)}
              </td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">
                {cellVal(totals.boardFeet, totals.boardFeetPartial)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 10.5, color: ARCH_SURFACE.textLight, lineHeight: 1.5 }}>
        {anyPartial && (
          <div style={{ color: '#B45309', marginBottom: 3 }}>
            &dagger; Only some bundles at that length state the figure, so the sum covers part of the row.
          </div>
        )}
        {widthNote(bundle)}
      </div>

      {imageUrl && (
        <div style={{ marginTop: 12 }}>
          <img src={imageUrl} alt={`Tally sheet for bundle ${bundle.bundleNo}`}
            style={{ maxWidth: '100%', maxHeight: '40vh', borderRadius: 6 }} />
        </div>
      )}
    </div>
  );
};

const ImageIcon = ({ size = 16, stroke = '#fff' }: { size?: number; stroke?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={stroke}
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

export const TallyImageDialog = ({
  lotNo,
  itemDescription,
  imageUrl,
  onClose,
  onUpload,
  bundle,
  siblings,
  sample,
}: TallyImageDialogProps) => {
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUpload) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === 'string') onUpload(lotNo, result);
    };
    reader.readAsDataURL(file);
  };

  return (
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
        aria-label={`Tally sheet for lot ${lotNo}`}
        style={{
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          width: 720,
          maxWidth: '94vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '13px 18px',
            background: 'linear-gradient(135deg, #0F2641, #1A3D63)',
            flexShrink: 0,
          }}
        >
          <ImageIcon />
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
            Tally — <span className="font-mono">{lotNo}</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5 }}>{itemDescription}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {onUpload && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 7,
                  border: '1.5px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {imageUrl ? 'Replace image' : 'Upload image'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                border: 'none',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.75)',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#EDF1F7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 340,
            padding: 16,
          }}
        >
          {bundle ? (
            <TallyMatrixPanel bundle={bundle} siblings={siblings || []} imageUrl={imageUrl} sample={sample} />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={`Tally sheet for lot ${lotNo}`}
              style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 6, boxShadow: '0 4px 18px rgba(13,31,51,0.25)' }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: ARCH_SURFACE.textLight, padding: '36px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <ImageIcon size={44} stroke="#CBD5E1" />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: ARCH_SURFACE.textMid }}>
                No tally image on this lot yet
              </div>
              <div style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5 }}>
                The tally is a photo or scan attached to the lot at receiving.
                {onUpload && (
                  <>
                    <br />
                    Use <b>Upload image</b> to attach one.
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: '9px 18px',
            borderTop: '1px solid #E2E8F0',
            fontSize: 10.5,
            color: ARCH_SURFACE.textLight,
            flexShrink: 0,
          }}
        >
          {bundle
            ? 'Parsed from the supplier packing list and grouped by length. The quantities in the tables behind this dialog remain the system figures.'
            : 'The tally sheet is the scan or photo attached to the lot record at receiving, shown as-is — board footage in the tables remains the system figure.'}
        </div>

        {/* MUST live inside the stopPropagation panel. Mounted on the backdrop,
            fileRef.current.click() bubbled to the backdrop's onClick={onClose},
            so the picker opened, the dialog unmounted underneath it, and the
            chosen file was silently dropped. */}
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>
    </div>
  );
};

/** Small square button that opens the tally viewer for a lot. */
export const TallyButton = ({ hasImage, onClick }: { hasImage: boolean; onClick: (e: React.MouseEvent) => void }) => (
  <button
    type="button"
    onClick={onClick}
    title={hasImage ? 'View the tally for this lot' : 'View the tally for this lot, or upload an image'}
    aria-label="Open tally image"
    style={{
      width: 26,
      height: 26,
      padding: 0,
      borderRadius: 6,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      border: `1px solid ${hasImage ? ARCH_SURFACE.green : ARCH_SURFACE.border}`,
      background: '#fff',
      color: hasImage ? ARCH_SURFACE.green : ARCH_SURFACE.navyMid,
    }}
  >
    <ImageIcon size={14} stroke="currentColor" />
    {hasImage && (
      <span
        style={{
          position: 'absolute',
          top: -3,
          right: -3,
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: ARCH_SURFACE.green,
          border: '2px solid #fff',
        }}
      />
    )}
  </button>
);
