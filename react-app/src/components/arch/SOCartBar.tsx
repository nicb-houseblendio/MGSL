// No React import needed — this component uses no hooks or JSX namespace types
// beyond the automatic runtime.
import { formatUnitTotals } from '@/lib/archUom';
import type { ArchCartLine } from '@/types/archOrder';

/**
 * The cart strip, shown under the header once lots are selected.
 *
 * Deliberately always visible while non-empty: a trader ticks bundles across
 * several items and several detail modals before building the order, so the
 * running selection has to survive closing a modal and stay in sight.
 */

interface SOCartBarProps {
  cart: ArchCartLine[];
  onOpenWizard: () => void;
  onClear: () => void;
}

export const SOCartBar = ({ cart, onOpenWizard, onClear }: SOCartBarProps) => {
  if (cart.length === 0) return null;

  const itemCount = new Set(cart.map((l) => l.internalId)).size;
  // Not one number: a cart can mix a Lumber line in BF with a Veneer line in
  // SQFT, and their sum would be meaningless.
  const totalLabel = formatUnitTotals(cart.map((l) => ({ unit: l.unit, qty: l.preSplitQty })));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '9px 24px',
        flexShrink: 0,
        background: 'linear-gradient(90deg, #1E6B47, #237A52)',
        color: '#fff',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
        zIndex: 5,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
        <span style={{ fontSize: 15 }}>🛒</span> Sales order
      </span>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>
        {cart.length} bundle{cart.length === 1 ? '' : 's'} · {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
        <span className="font-mono" style={{ fontWeight: 700 }}>
          {totalLabel}
        </span>
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Clear the selected bundles?')) onClear();
          }}
          style={{
            padding: '6px 12px',
            borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.45)',
            background: 'transparent',
            color: '#fff',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onOpenWizard}
          style={{
            padding: '6px 16px',
            borderRadius: 7,
            border: 'none',
            background: '#fff',
            color: '#1E6B47',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Build sales order →
        </button>
      </div>
    </div>
  );
};
