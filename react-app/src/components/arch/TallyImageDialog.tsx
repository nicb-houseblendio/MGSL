import * as React from 'react';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import { toLengthDistribution } from '@/lib/archTally';
import type { TallyBundle } from '@/lib/archTally';

/**
 * The tally sheet viewer.
 *
 * A tally is the supplier's packing list — a photo or scan attached to the lot at
 * receiving, listing each bundle's boards. It is shown AS AN IMAGE, deliberately:
 * the board-by-board data is not keyed into NetSuite, and the trader's use for it
 * is visual ("which of these bundles has the best mix of the lengths my customer
 * wants?"). The system quantities in the tables behind this dialog stay
 * authoritative — the image is evidence, not a source of figures.
 *
 * Upload is local-only for now: there is no ARCH back end to persist to. The
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
}

/**
 * The parsed tally, rendered.
 *
 * ⚠️ READ archTally.ts BEFORE CHANGING THIS. It leads with the LENGTH DISTRIBUTION
 * across bundles, not a per-bundle grid, because all 32 hand-verified bundles hold
 * exactly one thickness, one width and one length. A bundle is a single cell; the
 * distribution only exists once bundles are grouped. A grid-first view would demo
 * well and be empty on every real document.
 */
const TallyMatrixPanel = ({
  bundle, siblings, imageUrl,
}: { bundle: TallyBundle; siblings: TallyBundle[]; imageUrl?: string | null }) => {
  const dist = toLengthDistribution(siblings && siblings.length ? siblings : [bundle]);
  const num = (n: number | null | undefined, dp = 0) =>
    n === null || n === undefined ? '·' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

  const cell: React.CSSProperties = {
    padding: '5px 10px', fontSize: 11.5, borderBottom: '1px solid #E2E8F0', textAlign: 'right', whiteSpace: 'nowrap',
  };
  const head: React.CSSProperties = {
    ...cell, fontWeight: 700, color: ARCH_SURFACE.textMid,
    background: '#F1F5F9', borderBottom: '1.5px solid #CBD5E1', position: 'sticky', top: 0,
  };

  const dims = [
    bundle.thickness?.inches != null ? `${bundle.thickness.inches}"` : null,
    bundle.width?.inches != null ? `${bundle.width.inches}"` : 'RW',
  ].filter(Boolean).join(' × ');

  const tot = dist.reduce(
    (a, r) => ({ b: a.b + r.bundles, p: a.p + r.pieces,
      m3: r.volumeM3 == null ? a.m3 : (a.m3 || 0) + r.volumeM3,
      bf: r.boardFeet == null ? a.bf : (a.bf || 0) + r.boardFeet }),
    { b: 0, p: 0, m3: null as number | null, bf: null as number | null },
  );

  return (
    <div style={{ width: '100%', alignSelf: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ARCH_SURFACE.textMid }}>
          {bundle.species || 'Tally'}
        </span>
        <span style={{ fontSize: 11, color: ARCH_SURFACE.textLight }}>
          {[dims, `${dist.reduce((n, r) => n + r.bundles, 0)} bundles`].filter(Boolean).join(' · ')}
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
              <th style={head}>m³</th>
              <th style={head}>BF</th>
            </tr>
          </thead>
          <tbody>
            {dist.map((r) => {
              const isThis = r.bundleNos.includes(bundle.bundleNo);
              return (
                <tr key={r.label} style={isThis ? { background: '#EFF6FF' } : undefined}>
                  <td style={{ ...cell, textAlign: 'left', fontWeight: isThis ? 800 : 600 }} className="font-mono">
                    {r.label}{isThis ? ' ◄' : ''}
                  </td>
                  <td style={cell} className="font-mono">{num(r.bundles)}</td>
                  <td style={cell} className="font-mono">{num(r.pieces)}</td>
                  <td style={cell} className="font-mono">{num(r.volumeM3, 3)}</td>
                  <td style={cell} className="font-mono">{num(r.boardFeet)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...cell, textAlign: 'left', fontWeight: 700, background: '#F8FAFC' }}>Total</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">{num(tot.b)}</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">{num(tot.p)}</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">{num(tot.m3, 3)}</td>
              <td style={{ ...cell, fontWeight: 700, background: '#F8FAFC' }} className="font-mono">{num(tot.bf)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 10.5, color: ARCH_SURFACE.textLight, lineHeight: 1.5 }}>
        {bundle.width?.inches == null
          ? 'This supplier prints random width (RW), so there is no width breakdown. Any width figure here would be invented.'
          : 'Parsed from the supplier document. System quantities in the tables behind this dialog remain authoritative.'}
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
            <TallyMatrixPanel bundle={bundle} siblings={siblings || []} imageUrl={imageUrl} />
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
          The tally sheet is the scan or photo attached to the lot record at receiving, shown as-is — board
          footage in the tables remains the system figure.
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
    title={hasImage ? 'View the tally image for this lot' : 'View or upload the tally image for this lot'}
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
