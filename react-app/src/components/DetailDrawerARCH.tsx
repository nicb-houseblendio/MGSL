import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { formatArchQty, uomSuffix } from '@/lib/archUom';
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

const TABS: { key: ArchDetailKey; label: string }[] = [
  // Available leads, mirroring the grid. It is a cross-bucket balance, so its lot
  // list draws uncommitted on-hand bundles PLUS incoming ones — see lotQuantity.
  { key: 'available', label: 'Available' },
  { key: 'onHand', label: 'On Hand' },
  { key: 'readyToBuild', label: 'Ready to Build' },
  // Outbound has a tab because it has a grid column — every bucket a trader can
  // click must land on a highlighted tab, or the modal looks broken.
  { key: 'outbound', label: 'Outbound' },
  { key: 'inTransit', label: 'In Transit' },
  { key: 'onOrder', label: 'On Order' },
];

/**
 * Reserved has no tab of its own — it is a subset of On Hand, surfaced by the
 * "Show reserved" toggle there. Every other bucket, including Available, has a
 * tab, so a click on any grid cell lands on a view that actually contains the
 * number that was clicked.
 */
const resolveTab = (bucket: ArchDetailKey): ArchDetailKey =>
  bucket === 'reserve' ? 'onHand' : bucket;

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
                  color: 'rgba(255,255,255,0.45)',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                Total
              </div>
              <div className="font-mono" style={{ color: meta.bg, fontSize: 16, fontWeight: 700 }}>
                {formatArchQty(total, uom)}
                <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>{uomSuffix(uom)}</span>
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
                  color: on ? '#fff' : 'rgba(255,255,255,0.5)',
                  fontSize: 12.5,
                  fontWeight: on ? 700 : 600,
                  borderBottom: on ? `3px solid ${color}` : '3px solid transparent',
                  transition: 'all 0.12s',
                }}
              >
                <span>{label}</span>
                <span
                  className="font-mono"
                  style={{ fontSize: 11, fontWeight: 700, color: on ? color : 'rgba(255,255,255,0.4)' }}
                >
                  {formatArchQty(row[key] ?? 0, uom)}{' '}
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{uomSuffix(uom)}</span>
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
