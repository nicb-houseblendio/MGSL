import * as React from 'react';
import { formatQty, displaySuffix } from '@/lib/archUom';
import { lotIncomingInfo, formatShortDate } from '@/lib/archFixtures';
import { ARCH_BUCKET_META, ARCH_SURFACE } from '@/components/arch/archColors';
import type { ArchSummaryRow, ArchLot, ArchDetailKey } from '@/types/arch';

/**
 * On Order / In Transit view — purchase orders, not tallies.
 *
 * Stock that has not been received has no tally: the supplier sends the packing
 * list with the shipment. What a trader needs here is the PO, who it is with,
 * and when it lands.
 *
 * ── 🔴 IT USED TO RENDER EMPTY, AND THEN IT USED TO LIE ─────────────────────
 *
 * Marc-Antoine, 2026-09-17: « On order : aucun PO n'apparaît. Est-ce parce que
 * nous n'avons pas encore de bundle? Il faudrait présenter l'information, mais
 * ne pas être capable de sélectionner des lots pour générer un SO. »
 *
 * He was half right about the cause. The bundles DO exist — PO-CWP-001326
 * carries 001326-1 and 001326-2 as inventory detail on unreceived lines — but
 * the cache's lot universe ended `AND inl.quantityonhand <> 0`, so a bundle with
 * nothing in the yard never reached the browser. The row total came from the PO
 * lines and had no bundles under it. Hence a header reading 3,000 BF above the
 * words "No open purchase orders".
 *
 * The second half is why this file changed rather than just the query. Every
 * supplier name and every ETA on this table came from `lotIncomingInfo`, a
 * seeded PRNG in `archFixtures.ts`. While the table was empty that was
 * invisible. The moment the bundles arrived it would have printed invented
 * suppliers and invented dates beside real lot numbers and real PO numbers, with
 * nothing on screen to say which was which. So the cache now carries the real
 * vendor and the real `custbody_ship_week`, and the fixture is reached ONLY when
 * the payload predates that or comes from fixtures — and when it is reached, the
 * table says so in a banner.
 *
 * Selection: there is none here, and that is the other half of his ask. This
 * view has no checkboxes at all, and `isLotLocked` in `archLots.ts` separately
 * refuses these bundles in the two views that DO sell, so a trader cannot reach
 * them from Available either.
 */

interface ArchPOListViewProps {
  row: ArchSummaryRow;
  uom: string;
  /**
   * Which incoming bucket to list. Defaults to `onOrder` so existing callers are
   * unchanged; In Transit renders through the same table because the columns a
   * trader wants are identical and only the quantity and the ink differ.
   */
  bucket?: Extract<ArchDetailKey, 'onOrder' | 'inTransit'>;
}

const EtaPill = ({ date, color }: { date: string; color: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 9px',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      background: '#EEF2FB',
      color,
      border: `1px solid ${color}33`,
    }}
  >
    <svg
      width="13"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 16h20l-2 5H4z" />
      <path d="M6 16v-5h12v5" />
      <path d="M9 11V7h6v4" />
    </svg>
    {date}
  </span>
);

/**
 * ⚠️ LOCAL midnight, not UTC.
 *
 * The cache sends `YYYY-MM-DD`. `new Date('2026-09-14')` is UTC midnight, which
 * renders as the 13th anywhere west of Greenwich — Montreal included — so every
 * ETA on this table would have been a day early. The cache's own `isoDate`
 * carries the same warning.
 */
const parseIsoLocal = (iso: string): Date | null => {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * What to print for one bundle, and whether any of it was invented.
 *
 * `incoming` absent (not null) is the only case that reaches the fixture: a
 * payload from `archFixtures.ts`, or one written by a cache older than
 * 2026-09-17. `null` means the cache looked and found no open PO line, which is
 * a real answer and gets an em dash rather than a guess.
 */
const resolveIncoming = (
  lot: ArchLot,
  bucket: 'onOrder' | 'inTransit'
): { po: string; supplier: string; eta: string; invented: boolean } => {
  if (lot.incoming === undefined) {
    const fake = lotIncomingInfo(lot.lotNo, bucket);
    return {
      po: lot.po || '—',
      supplier: fake.supplier,
      eta: formatShortDate(fake.eta),
      invented: true,
    };
  }
  const etaDate = parseIsoLocal(lot.incoming?.eta || '');
  return {
    // The PO off the order line beats the one derived from the lot-number
    // prefix: the prefix is a naming convention that can be wrong, and
    // `PO_FROM_LOT_RE` needs five leading digits, so a `1333-1` bundle yields
    // nothing at all from it.
    po: lot.incoming?.poNumber || lot.po || '—',
    supplier: lot.incoming?.supplier || '—',
    eta: etaDate ? formatShortDate(etaDate) : '',
    invented: false,
  };
};

export const ArchPOListView = ({ row, uom, bucket = 'onOrder' }: ArchPOListViewProps) => {
  const meta = ARCH_BUCKET_META[bucket];
  const lots = row.lots.filter((l) => (l[bucket] || 0) > 0);

  const label = bucket === 'onOrder' ? 'On Order' : 'In Transit';

  if (lots.length === 0) {
    /*
     * The row total that no bundle claims. Saying "no purchase orders" while the
     * header above reads 3,000 BF is the exact shape Marc-Antoine reported, so
     * the empty state now distinguishes "nothing is coming" from "something is
     * coming and no bundle numbers have been put on it yet".
     */
    const unclaimed = row[bucket] ?? 0;
    return (
      <div style={{ textAlign: 'center', padding: 40, color: ARCH_SURFACE.textLight, fontSize: 14 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🛒</div>
        {unclaimed > 0 ? (
          <>
            <div style={{ fontWeight: 600, color: ARCH_SURFACE.textMid }}>
              {formatQty(unclaimed, row.unit, uom)} {displaySuffix(row.unit, uom)} {label.toLowerCase()},
              on purchase orders with no bundle numbers yet
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, maxWidth: 460, marginInline: 'auto' }}>
              The quantity is real and it is on the grid. It cannot be listed bundle by bundle
              until someone generates the bundle numbers on the PO.
            </div>
          </>
        ) : (
          <>No open purchase orders</>
        )}
      </div>
    );
  }

  const total = lots.reduce((s, l) => s + (l[bucket] || 0), 0);
  const anyInvented = lots.some((l) => l.incoming === undefined);

  const headerCell: React.CSSProperties = {
    padding: '8px 10px',
    background: 'linear-gradient(to bottom,#F1F5FA,#E8EDF5)',
    color: ARCH_SURFACE.textMid,
    fontWeight: 700,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    borderBottom: '2px solid #CBD5E1',
  };

  const cell: React.CSSProperties = {
    padding: '9px 10px',
    borderBottom: '1px solid #E2E8F0',
  };

  return (
    <div style={{ padding: '16px 18px 22px' }}>
      {anyInvented && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 11px',
            borderRadius: 6,
            background: '#FFF7ED',
            border: '1px solid #FED7AA',
            color: '#9A3412',
            fontSize: 11.5,
            lineHeight: 1.45,
          }}
        >
          <strong>Sample supplier and ETA.</strong> This payload predates the ARCH cache carrying
          the real vendor and ship week, so those two columns are generated. The bundle numbers and
          quantities are real.
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
        <thead>
          <tr>
            {['PO #', 'Bundle', 'Supplier', 'Container #', 'ETA', `${label} (${displaySuffix(row.unit, uom)})`].map(
              (h, i) => (
                <th key={h} style={{ ...headerCell, textAlign: i >= 4 ? 'right' : 'left' }}>
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {lots.map((lot, i) => {
            const inc = resolveIncoming(lot, bucket);
            return (
              <tr key={lot.lotNo} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                <td style={{ ...cell, fontWeight: 700, color: meta.color }} className="font-mono">
                  {inc.po}
                </td>
                {/* The bundle number itself. It was never on this table, which is
                    part of why an empty one read as "no POs" rather than "no
                    bundles": there was no column where a bundle would have gone. */}
                <td style={{ ...cell, fontWeight: 600, color: ARCH_SURFACE.text }} className="font-mono">
                  {lot.lotNo}
                </td>
                <td style={{ ...cell, fontWeight: 600, color: ARCH_SURFACE.text }}>{inc.supplier}</td>
                <td style={{ ...cell, fontSize: 11, color: ARCH_SURFACE.textMid }} className="font-mono">
                  {lot.containerNo || '—'}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {inc.eta ? (
                    <EtaPill date={inc.eta} color={meta.color} />
                  ) : (
                    /* The PO carries no ship week. An em dash, never a guess —
                       this table's whole problem was guessed dates. */
                    <span style={{ color: ARCH_SURFACE.textLight }}>—</span>
                  )}
                </td>
                <td
                  style={{ ...cell, textAlign: 'right', fontWeight: 700, color: ARCH_SURFACE.navy }}
                  className="font-mono"
                >
                  {formatQty(lot[bucket], row.unit, uom)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: '#F1F5FA' }}>
            <td colSpan={5} style={{ ...cell, borderBottom: 'none', fontWeight: 700, color: ARCH_SURFACE.textMid }}>
              {lots.length} bundle{lots.length === 1 ? '' : 's'} on{' '}
              {new Set(lots.map((l) => resolveIncoming(l, bucket).po)).size} purchase order
              {new Set(lots.map((l) => resolveIncoming(l, bucket).po)).size === 1 ? '' : 's'}
            </td>
            <td
              style={{ ...cell, borderBottom: 'none', textAlign: 'right', fontWeight: 800, color: ARCH_SURFACE.navy }}
              className="font-mono"
            >
              {formatQty(total, row.unit, uom)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
