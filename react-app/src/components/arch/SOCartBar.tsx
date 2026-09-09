import * as React from 'react';
import { formatUnitTotals } from '@/lib/archUom';
import type { ArchCartLine } from '@/types/archOrder';

/**
 * The cart strip, shown under the header once lots are selected.
 *
 * Deliberately always visible while non-empty: a trader ticks bundles across
 * several items and several detail modals before building the order, so the
 * running selection has to survive closing a modal and stay in sight.
 *
 * ── THE STRIP IS THE WAY FORWARD, NOT JUST A READOUT ─────────────────────────
 * Lucas, 2026-09-08: "Can we make it so when you get to cart - you only have to
 * single or double click the 'create sales order' card to move to next menu instead
 * of proceed button in the bottom right?"
 *
 * So clicking the strip opens the wizard. The explicit button stays, because it is
 * the only thing that NAMES the action - a bar that silently happens to be clickable
 * is not discoverable, and removing the button would make the feature depend on
 * guessing. Both routes call the same `onOpenWizard`.
 *
 * ── THREE THINGS A BUBBLING CLICK COULD HAVE BROKEN ──────────────────────────
 *  1. CLEAR. It discards the trader's whole selection behind one window.confirm, so a
 *     stray bubble would pop that dialog when nobody asked for it. It stops the click.
 *  2. THE BUILD BUTTON, which would otherwise fire onOpenWizard twice - once itself,
 *     once through the strip. It stops the click too.
 *  3. COPYING THE NOTE. The failure reason is text a trader may want to select and
 *     paste into Slack, and a drag-select ends in a click. A click that leaves text
 *     selected is ignored.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────
 * The strip's onClick is a mouse convenience. The accessible control is the summary
 * card inside it: role="button", tabIndex 0, Enter and Space, and an aria-label that
 * says what it does. Keeping them separate is why neither carries interactive content
 * inside a button role.
 */

interface SOCartBarProps {
  cart: ArchCartLine[];
  /**
   * Why these bundles are still selected after an attempt to order them
   * (refused, unanswered, not connected). From orderOutcome().cartReason. The
   * bar used to stay green and silent after a failed create, which read as
   * "nothing happened".
   */
  note?: string | null;
  onOpenWizard: () => void;
  onClear: () => void;
}

export const SOCartBar = ({ cart, note, onOpenWizard, onClear }: SOCartBarProps) => {
  if (cart.length === 0) return null;

  const itemCount = new Set(cart.map((l) => l.internalId)).size;
  // Not one number: a cart can mix a Lumber line in BF with a Veneer line in
  // SQFT, and their sum would be meaningless.
  const totalLabel = formatUnitTotals(cart.map((l) => ({ unit: l.unit, qty: l.preSplitQty })));

  /**
   * A click anywhere on the strip advances, unless it finished a text selection.
   *
   * The selection check is not defensive padding: the note beside the totals is the
   * one thing on this bar worth copying, and without it a drag over the note would
   * open the wizard on mouse-up. `getSelection` is absent in some non-browser hosts,
   * hence the typeof guard.
   *
   * ⚠️ THE SELECTION MUST BE INSIDE THIS BAR, which is why `contains` is here and a
   * bare `!isCollapsed` is not enough. A trader who selects a lot number in the grid
   * and then clicks the cart still has that selection live; without the containment
   * check their click would be swallowed and the bar would look broken.
   */
  const barClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
    const bar = e.currentTarget as HTMLElement;
    if (sel && !sel.isCollapsed && String(sel).trim().length > 0
      && sel.anchorNode && bar.contains(sel.anchorNode)) return;
    onOpenWizard();
  };

  /** Space must not scroll the page, so both keys are handled and both preventDefault. */
  const cardKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenWizard();
    }
  };

  return (
    <div
      onClick={barClick}
      role="presentation"
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
        cursor: 'pointer',
      }}
    >
      {/* The summary card. This is the element Lucas is describing, and the only
          keyboard-reachable one - so it looks like a control rather than a caption.
          It carries no onClick of its own: a mouse click, and the click an assistive
          technology dispatches when it activates a role="button", both bubble to
          `barClick` on the strip. Keep that handler, or this card goes quiet to a
          mouse while still answering Enter. */}
      <div
        role="button"
        tabIndex={0}
        onKeyDown={cardKey}
        aria-label="Build the sales order from the selected bundles"
        title="Build the sales order from the selected bundles"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 10px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.35)',
          background: 'rgba(255,255,255,0.12)',
          cursor: 'pointer',
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
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
          click to build &rarr;
        </span>
      </div>
      {/* end summary card */}

      {note && (
        // #FDE68A on the bar's #1E6B47 is about 5:1; white would blend into the
        // totals and the point of this line is to be noticed.
        //
        // OUTSIDE the card on purpose: it is text to read and copy, not a control, and
        // putting it inside a role="button" would have a screen reader announce the
        // failure reason as part of the button's name.
        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#FDE68A', lineHeight: 1.35, minWidth: 0 }}>
          ⚠️ {note}
        </span>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={(e) => {
            // 🔴 NEVER let this ride on a strip click. Clear throws away the whole
            // selection, and the confirm is the only thing between a trader and losing
            // it - so the bubble stops here, before the confirm is even considered.
            e.stopPropagation();
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
          // Stops the bubble so the wizard is opened once, by one route, not twice.
          onClick={(e) => { e.stopPropagation(); onOpenWizard(); }}
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
