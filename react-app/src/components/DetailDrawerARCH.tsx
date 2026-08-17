import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatQty, displaySuffix } from '@/lib/archUom';
import { ARCH_BUCKET_META } from '@/components/arch/archColors';
import { ArchLotTable } from '@/components/arch/ArchLotTable';
import { ArchPOListView } from '@/components/arch/ArchPOListView';
import type { ArchSummaryRow, ArchDetailKey } from '@/types/arch';

/**
 * ARCH detail modal.
 *
 * Structure follows the POC: a bucket switcher across the top so a trader can
 * move between On Hand / Ready to Build / In Transit / On Order without closing,
 * and a lot table underneath.
 *
 * Every grid column has a tab except Reserved, which is a subset of On Hand and
 * is surfaced by the "Show reserved" toggle there instead of as a separate pile.
 * That rule matters: a click on any quantity must land on a view that actually
 * contains the number that was clicked.
 */

interface DetailDrawerARCHProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ArchSummaryRow;
  /** Bucket the user clicked on the grid. */
  triggerBucket: ArchDetailKey;
  uom: string;
  /** Add ticked bundles to the sales order cart. */
  onAddToCart?: (row: ArchSummaryRow, lotNos: string[], bucket: ArchDetailKey) => void;
  /** Lot numbers already on the order. */
  cartLotNos?: Set<string>;
}

/**
 * Four tabs, matching the client prototype exactly. It carried Available and
 * Outbound tabs at one point and dropped both, leaving the note "Available tab
 * removed — On Hand is the primary view; Reserved folds into it via a toggle".
 */
const TABS: { key: ArchDetailKey; label: string }[] = [
  { key: 'onHand', label: 'On Hand' },
  { key: 'readyToBuild', label: 'Ready to Build' },
  { key: 'inTransit', label: 'In Transit' },
  { key: 'onOrder', label: 'On Order' },
];

const TAB_KEYS = new Set<ArchDetailKey>(TABS.map((t) => t.key));

/**
 * Buckets without a tab of their own all land on On Hand, as the prototype does:
 * Reserved and Available are both views OF the on-hand pile rather than separate
 * piles. Reserved additionally opens with its section expanded (see below).
 *
 * Available lands on a tab whose header total is LARGER than the number clicked,
 * which is only honest because the On Hand table carries a per-lot Available
 * column — the clicked figure is the sum of that column. Do not remove it
 * without giving Available its tab back.
 */
const resolveTab = (bucket: ArchDetailKey): ArchDetailKey =>
  TAB_KEYS.has(bucket) ? bucket : 'onHand';

export const DetailDrawerARCH = ({
  open,
  onOpenChange,
  row,
  triggerBucket,
  uom,
  onAddToCart,
  cartLotNos,
}: DetailDrawerARCHProps) => {
  const [activeBucket, setActiveBucket] = React.useState<ArchDetailKey>(() => resolveTab(triggerBucket));
  // Land with reserved expanded when that is the column the trader actually clicked.
  const [showReserved, setShowReserved] = React.useState(triggerBucket === 'reserve');
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());

  // The modal is kept mounted across grid clicks, so re-sync when the trigger changes.
  React.useEffect(() => {
    if (!open) return;
    setActiveBucket(resolveTab(triggerBucket));
    setShowReserved(triggerBucket === 'reserve');
    setSelected(new Set());
  }, [open, triggerBucket, row.detailKey]);

  const meta = ARCH_BUCKET_META[activeBucket];
  const total = row[activeBucket] ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1180px] w-[96vw] p-0 gap-0 overflow-hidden"
        style={{ height: '82vh', display: 'flex', flexDirection: 'column' }}
        // The header below carries the context a description would; declaring
        // none explicitly is Radix's supported way to silence its a11y warning.
        aria-describedby={undefined}
        aria-label={`${row.description} — ${meta.label} detail`}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, var(--navy), var(--navy-mid))',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: meta.bg,
                fontSize: 18,
              }}
            >
              {meta.icon}
            </div>
            <div>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{row.description}</div>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 1 }}>
                {row.itemCode}
                {row.locationName ? ` · ${row.locationName}` : ''}
                {row.grade ? ` · Grade ${row.grade}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  // 0.45 measured 3.58:1 on this strip. Alpha is the whole
                  // contrast budget on a dark surface — 0.72 reads as the same
                  // quiet label and clears AA at 6.6.
                  color: 'rgba(255,255,255,0.72)',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                Total
              </div>
              <div className="font-mono" style={{ color: meta.bg, fontSize: 16, fontWeight: 700 }}>
                {formatQty(total, row.unit, uom)}
                <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>{displaySuffix(row.unit, uom)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bucket switcher */}
        <div
          style={{
            display: 'flex',
            background: 'var(--navy-mid)',
            borderBottom: '1px solid var(--navy)',
            flexShrink: 0,
            padding: '0 8px',
          }}
        >
          {TABS.map(({ key, label }) => {
            const on = key === activeBucket;
            const color = ARCH_BUCKET_META[key].color;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveBucket(key)}
                style={{
                  flex: 1,
                  padding: '9px 6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  background: on ? 'var(--navy)' : 'transparent',
                  // Inactive was 0.5 (4.04:1) and the figure below 0.4 (3.15:1).
                  // These tabs are not decoration — the trader reads In Transit
                  // and On Order straight off them without switching. Active vs
                  // inactive is still carried by the navy fill, the 700 weight,
                  // the 3px underline and the figure's hue.
                  color: on ? '#fff' : 'rgba(255,255,255,0.72)',
                  fontSize: 12.5,
                  fontWeight: on ? 700 : 600,
                  borderBottom: on ? `3px solid ${color}` : '3px solid transparent',
                  transition: 'all 0.12s',
                }}
              >
                <span>{label}</span>
                {/*
                  The ACTIVE tab's figure uses the light tint, not the saturated
                  bucket colour. The saturated ones are chosen for light
                  surfaces, and this strip is navy: In Transit rendered #4A148C
                  on #0D1F33 at 1.07:1 and On Order #0D47A1 at 1.77:1, so the
                  tab you were standing on was harder to read than the greyed-out
                  ones beside it. The tint keeps the bucket hue and is what the
                  header total already uses against this same navy.
                  The 3px underline keeps the saturated colour — a solid bar
                  carries at a weight 9px text cannot.
                */}
                <span
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: on ? ARCH_BUCKET_META[key].bg : 'rgba(255,255,255,0.72)',
                  }}
                >
                  {formatQty(row[key] ?? 0, row.unit, uom)}{' '}
                  {/* opacity here multiplies the alpha above, so 0.7 took the
                      inactive suffix down to ~0.28 effective. 0.85 keeps the
                      unit subordinate without dropping it under AA. */}
                  <span style={{ fontSize: 9, opacity: 0.85 }}>{displaySuffix(row.unit, uom)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {activeBucket === 'onOrder' ? (
            <ArchPOListView row={row} uom={uom} />
          ) : (
            <ArchLotTable
              row={row}
              bucket={activeBucket}
              uom={uom}
              showReserved={showReserved}
              onToggleReserved={() => setShowReserved((v) => !v)}
              selected={selected}
              onSelectionChange={setSelected}
              onAddToCart={onAddToCart ? (lotNos, bucket) => onAddToCart(row, lotNos, bucket) : undefined}
              cartLotNos={cartLotNos}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
