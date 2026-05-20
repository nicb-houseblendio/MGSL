import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CurrencyBadge } from '@/components/InventoryTableMTL';
import { parseNumericLabel } from '@/hooks/useSummaryData';
import type { SummaryRow } from '@/lib/api';

interface PriceListModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: SummaryRow[];  // filtered rows from main table
}

type LocationOption = { id: string; name: string; currencies: string[]; available: number };

type Step2Filters = {
  vendor: string;
  po: string;
  thickness: string;
  width: string;
  length: string;
  grade: string;
};

type Side = 'prompt' | 'transit';

const EMPTY_FILTERS: Step2Filters = { vendor: '', po: '', thickness: '', width: '', length: '', grade: '' };

const TL_MBF = 27;

const rowKey = (r: SummaryRow) => r.detailKey || `${r.internalId}-${r.locationId}`;
const sideKey = (r: SummaryRow, side: Side) => `${rowKey(r)}|${side}`;

const promptQty   = (r: SummaryRow) => Math.max(0, (r.onHand ?? 0) - (r.committed ?? 0) - (r.outbound ?? 0));
const transitQty  = (r: SummaryRow) => r.inTransit ?? 0;

/** Convert NetSuite "- None -" / empty to dash for display */
const dimDisplay = (v: string | undefined): string =>
  !v || v === '- None -' ? '—' : v;

// ── PDF helpers ──────────────────────────────────────────────────────────────

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const getLogoUrl = (): string => {
  const win = typeof window !== 'undefined' ? window : undefined;
  return (win as { MCGI_CONFIG?: { logoUrl?: string } } | undefined)?.MCGI_CONFIG?.logoUrl || '';
};

type PdfRow = {
  r: SummaryRow;
  promptOK: boolean;
  transitOK: boolean;
  pVal: number;
  tVal: number;
};

const buildPriceListHTML = (
  pdfRows: PdfRow[],
  locationName: string,
  currency: string,
  logoUrl: string
): string => {
  // Group by grade, then by thickness|width|length, joining vendors and summing qty per side
  const byGrade: Record<string, PdfRow[]> = {};
  for (const x of pdfRows) {
    const g = x.r.grade || 'Unknown';
    if (!byGrade[g]) byGrade[g] = [];
    byGrade[g].push(x);
  }

  const currBadgeStyle =
    currency === 'CAD'
      ? 'background:#E8F4FD;color:#0D47A1;border:1px solid #90CAF9'
      : 'background:#EAF3DE;color:#27500A;border:1px solid #A5D6A7';

  const logoHTML = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Logo" style="max-height:80px;max-width:240px;display:block" />`
    : '';

  const gradeBlocks = Object.keys(byGrade)
    .sort((a, b) => a.localeCompare(b))
    .map((grade) => {
      const gradeRows = byGrade[grade];

      // Group by thickness|width|length
      type Group = {
        ref: SummaryRow;
        vendors: Set<string>;
        promptQty: number;
        promptPrice: number | null;
        transitQty: number;
        transitPrice: number | null;
      };
      const groups: Record<string, Group> = {};
      gradeRows.forEach((x) => {
        const key = `${x.r.thickness ?? ''}|${x.r.width ?? ''}|${x.r.length ?? ''}`;
        if (!groups[key]) {
          groups[key] = {
            ref: x.r,
            vendors: new Set<string>(),
            promptQty: 0,
            promptPrice: null,
            transitQty: 0,
            transitPrice: null,
          };
        }
        const g = groups[key];
        if (x.r.vendor) g.vendors.add(x.r.vendor);
        if (x.promptOK)  { g.promptQty  += promptQty(x.r);  g.promptPrice  = x.pVal; }
        if (x.transitOK) { g.transitQty += transitQty(x.r); g.transitPrice = x.tVal; }
      });

      const bodyRows = Object.values(groups)
        .map((g) => {
          const mbfFactor = g.ref.mbfFactor ?? 0;
          const pDispQty =
            g.promptQty > 0 ? (g.promptQty * mbfFactor >= TL_MBF ? 'TL' : String(Math.round(g.promptQty))) : null;
          const tDispQty =
            g.transitQty > 0 ? (g.transitQty * mbfFactor >= TL_MBF ? 'TL' : String(Math.round(g.transitQty))) : null;
          const vendorStr = Array.from(g.vendors).join(', ');
          return `
            <tr>
              <td class="dim">${esc(dimDisplay(g.ref.thickness))}</td>
              <td class="dim">${esc(dimDisplay(g.ref.width))}</td>
              <td class="dim">${esc(dimDisplay(g.ref.length))}</td>
              <td class="vendor">${esc(vendorStr || '—')}</td>
              <td class="${pDispQty ? 'qty-prompt' : 'empty'}">${pDispQty ?? '—'}</td>
              <td class="${g.promptPrice !== null ? 'price' : 'empty'}">${g.promptPrice !== null ? '$' + g.promptPrice.toFixed(2) : '—'}</td>
              <td class="${tDispQty ? 'qty-transit' : 'empty'}">${tDispQty ?? '—'}</td>
              <td class="${g.transitPrice !== null ? 'price' : 'empty'}">${g.transitPrice !== null ? '$' + g.transitPrice.toFixed(2) : '—'}</td>
            </tr>`;
        })
        .join('');

      return `
        <div class="grade-block">
          <div class="grade-title">Grade ${esc(grade)}</div>
          <table>
            <colgroup>
              <col style="width:9%" /><col style="width:9%" /><col style="width:9%" /><col style="width:25%" />
              <col style="width:11%" /><col style="width:13%" /><col style="width:11%" /><col style="width:13%" />
            </colgroup>
            <thead>
              <tr class="group-row">
                <th colspan="4" style="background:#fff;"></th>
                <th colspan="2" class="col-prompt">Prompt</th>
                <th colspan="2" class="col-transit">In Transit</th>
              </tr>
              <tr class="col-row">
                <th>Thickness</th>
                <th>Width</th>
                <th>Length</th>
                <th>Vendor(s)</th>
                <th class="r">Qty (packs)</th>
                <th class="r">Price / MBF</th>
                <th class="r">Qty (packs)</th>
                <th class="r">Price / MBF</th>
              </tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>Price List — ${esc(locationName)}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;color:#0D1F33;font-size:10.5pt;}
      .page{padding:32px 36px;max-width:820px;margin:0 auto;}
      .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #1F6FEB;margin-bottom:20px;}
      .doc-title{font-size:20px;font-weight:700;color:#0D1F33;text-align:right;}
      .loc-name{font-size:12px;font-weight:600;color:#3D5166;margin-top:4px;}
      .curr-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;${currBadgeStyle};margin-top:4px;}
      table{width:100%;border-collapse:collapse;table-layout:fixed;}
      thead tr.group-row th{padding:6px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;text-align:center;border-bottom:1px solid #fff;}
      thead tr.col-row th{padding:7px 8px;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;font-weight:600;text-align:left;white-space:nowrap;color:rgba(255,255,255,.85);background:linear-gradient(to bottom,#0F2641,#1A3D63);}
      thead tr.col-row th.r{text-align:right;}
      tbody tr:nth-child(even){background:#F8FAFC;}
      tbody tr{border-bottom:1px solid #E2E8F0;}
      td{padding:6px 8px;vertical-align:middle;font-size:9.5pt;}
      td.dim{font-family:'Courier New',monospace;font-size:9.5pt;}
      td.vendor{font-size:8.5pt;color:#3D5166;}
      td.qty-prompt{color:#1B5E20;font-weight:700;font-family:'Courier New',monospace;text-align:right;}
      td.qty-transit{color:#4A148C;font-weight:700;font-family:'Courier New',monospace;text-align:right;}
      td.price{color:#C8A035;font-weight:700;font-family:'Courier New',monospace;text-align:right;}
      td.empty{color:#CBD5E1;text-align:right;font-family:'Courier New',monospace;}
      .col-prompt{background:#E8F0E5;color:#27500A;}
      .col-transit{background:#ECE3F5;color:#4A148C;}
      .grade-block{margin-bottom:20px;}
      .grade-title{font-size:13px;font-weight:700;color:#0F2641;padding:8px 0 6px;border-bottom:2px solid #1F6FEB;margin-bottom:8px;letter-spacing:.01em;}
      @page{margin:15mm;}
      @media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.page{padding:8px 12px;}thead{display:table-header-group;}}
    </style></head><body><div class="page">
      <div class="header">
        <div>${logoHTML}</div>
        <div style="text-align:right;">
          <div class="doc-title">Europe Offering &amp; Price List</div>
          <div class="loc-name">${esc(locationName)}</div>
          <div class="curr-badge">${esc(currency)}</div>
        </div>
      </div>
      ${gradeBlocks}
    </div></body></html>`;
};

// ── Select helper ────────────────────────────────────────────────────────────

const FilterSelect = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
    <span style={{ color: '#7A8FA3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        border: '1px solid #CBD5E1',
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 12,
        color: '#0D1F33',
        background: '#fff',
        minWidth: 90,
      }}
    >
      <option value="">All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  </label>
);

// ── PriceListModal ───────────────────────────────────────────────────────────

export const PriceListModal = ({ open, onOpenChange, rows }: PriceListModalProps) => {
  const [step, setStep] = React.useState<1 | 2>(1);
  const [selectedLocation, setSelectedLocation] = React.useState<LocationOption | null>(null);
  const [priceMap, setPriceMap] = React.useState<Record<string, string>>({});
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [globalPromptPrice, setGlobalPromptPrice] = React.useState('');
  const [globalTransitPrice, setGlobalTransitPrice] = React.useState('');
  const [step2Filters, setStep2Filters] = React.useState<Step2Filters>(EMPTY_FILTERS);

  // Reset all state when modal closes
  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setSelectedLocation(null);
      setPriceMap({});
      setChecked({});
      setGlobalPromptPrice('');
      setGlobalTransitPrice('');
      setStep2Filters(EMPTY_FILTERS);
    }
  }, [open]);

  // Step 1 — reload locations where at least one row has prompt or transit qty
  const locationsWithAvailable = React.useMemo(() => {
    const anyReload = rows.some((r) => r.isReload);
    const eligible = anyReload ? rows.filter((r) => r.isReload) : rows;

    const map = new Map<string, LocationOption & { currSet: Set<string> }>();
    for (const r of eligible) {
      const sellable = promptQty(r) + transitQty(r);
      if (sellable > 0) {
        const existing = map.get(r.locationId);
        if (existing) {
          existing.available += sellable;
          if (r.currency) existing.currSet.add(r.currency);
        } else {
          const currSet = new Set<string>();
          if (r.currency) currSet.add(r.currency);
          map.set(r.locationId, {
            id: r.locationId,
            name: r.locationName,
            currencies: [],
            available: sellable,
            currSet,
          });
        }
      }
    }
    return Array.from(map.values())
      .map(({ currSet, ...loc }) => ({ ...loc, currencies: Array.from(currSet).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // handleGoStep2 — loc passed as arg to avoid stale state bug
  // If re-selecting the same location, preserve existing prices/checks
  const handleGoStep2 = (loc: LocationOption) => {
    if (selectedLocation?.id === loc.id) {
      setStep(2);
      return;
    }
    const initialRows = rows.filter(
      (r) => r.locationId === loc.id && (promptQty(r) > 0 || transitQty(r) > 0)
    );
    const newPriceMap: Record<string, string> = {};
    const newChecked: Record<string, boolean> = {};
    initialRows.forEach((r) => {
      const pK = sideKey(r, 'prompt');
      const tK = sideKey(r, 'transit');
      newPriceMap[pK] = '';
      newPriceMap[tK] = '';
      newChecked[pK] = promptQty(r) > 0;
      newChecked[tK] = transitQty(r) > 0;
    });
    setSelectedLocation(loc);
    setPriceMap(newPriceMap);
    setChecked(newChecked);
    setGlobalPromptPrice('');
    setGlobalTransitPrice('');
    setStep2Filters(EMPTY_FILTERS);
    setStep(2);
  };

  // Step 2 — all rows for selected location (unmerged), with either side > 0
  const tableRows = React.useMemo(
    () =>
      rows.filter(
        (r) => r.locationId === selectedLocation?.id && (promptQty(r) > 0 || transitQty(r) > 0)
      ),
    [rows, selectedLocation]
  );

  // Filter options derived from full tableRows (not visibleRows — prevents cascading)
  const filterOptions = React.useMemo(() => {
    const clean = (v: string | undefined): v is string => !!v && v !== '- None -';
    const numSort = (a: string, b: string) => {
      const an = parseNumericLabel(a), bn = parseNumericLabel(b);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    };
    return {
      vendor:    [...new Set(tableRows.map((r) => r.vendor).filter(clean))].sort(),
      po:        [...new Set(tableRows.flatMap((r) => r.pos ?? []))].sort(),
      thickness: [...new Set(tableRows.map((r) => r.thickness).filter(clean))].sort(numSort),
      width:     [...new Set(tableRows.map((r) => r.width).filter(clean))].sort(numSort),
      length:    [...new Set(tableRows.map((r) => r.length).filter(clean))].sort(numSort),
      grade:     [...new Set(tableRows.map((r) => r.grade).filter(clean))].sort(),
    };
  }, [tableRows]);

  // Visible rows after step2Filters applied
  const visibleRows = React.useMemo(
    () =>
      tableRows.filter(
        (r) =>
          (!step2Filters.vendor    || r.vendor === step2Filters.vendor) &&
          (!step2Filters.po        || (r.pos ?? []).includes(step2Filters.po)) &&
          (!step2Filters.thickness || r.thickness === step2Filters.thickness) &&
          (!step2Filters.width     || r.width === step2Filters.width) &&
          (!step2Filters.length    || r.length === step2Filters.length) &&
          (!step2Filters.grade     || r.grade === step2Filters.grade)
      ),
    [tableRows, step2Filters]
  );

  // Side-aware select-all — scoped to visibleRows that have qty > 0 on that side
  const promptCandidates  = visibleRows.filter((r) => promptQty(r) > 0);
  const transitCandidates = visibleRows.filter((r) => transitQty(r) > 0);

  const allPromptChecked   = promptCandidates.length > 0 && promptCandidates.every((r) => checked[sideKey(r, 'prompt')]);
  const somePromptChecked  = promptCandidates.some((r) => checked[sideKey(r, 'prompt')]);
  const allTransitChecked  = transitCandidates.length > 0 && transitCandidates.every((r) => checked[sideKey(r, 'transit')]);
  const someTransitChecked = transitCandidates.some((r) => checked[sideKey(r, 'transit')]);

  const handleSelectAllSide = (side: Side) => {
    const candidates = side === 'prompt' ? promptCandidates : transitCandidates;
    const allOn = side === 'prompt' ? allPromptChecked : allTransitChecked;
    const newVal = !allOn;
    setChecked((prev) => {
      const next = { ...prev };
      candidates.forEach((r) => { next[sideKey(r, side)] = newVal; });
      return next;
    });
    if (!newVal) {
      setPriceMap((prev) => {
        const next = { ...prev };
        candidates.forEach((r) => { next[sideKey(r, side)] = ''; });
        return next;
      });
    }
  };

  const handleToggleSide = (r: SummaryRow, side: Side, on: boolean) => {
    const k = sideKey(r, side);
    setChecked((prev) => ({ ...prev, [k]: on }));
    if (!on) setPriceMap((prev) => ({ ...prev, [k]: '' }));
  };

  // Global fill — fills only checked rows on that side that have qty > 0
  const handleFillAllSide = (side: Side, v: string) => {
    if (side === 'prompt') setGlobalPromptPrice(v);
    else setGlobalTransitPrice(v);
    const candidates = side === 'prompt' ? promptCandidates : transitCandidates;
    setPriceMap((prev) => {
      const next = { ...prev };
      candidates.forEach((r) => {
        const k = sideKey(r, side);
        if (checked[k]) next[k] = v;
      });
      return next;
    });
  };

  // canGeneratePDF — at least one row where one side is checked AND has price > 0
  const canGeneratePDF = tableRows.some((r) => {
    const pK = sideKey(r, 'prompt');
    const tK = sideKey(r, 'transit');
    const pOk = checked[pK] && promptQty(r) > 0  && parseFloat(priceMap[pK] || '') > 0;
    const tOk = checked[tK] && transitQty(r) > 0 && parseFloat(priceMap[tK] || '') > 0;
    return pOk || tOk;
  });

  const handleGeneratePDF = () => {
    if (!selectedLocation) return;
    const pdfRows: PdfRow[] = tableRows
      .map((r) => {
        const pK = sideKey(r, 'prompt');
        const tK = sideKey(r, 'transit');
        const pVal = parseFloat(priceMap[pK] || '');
        const tVal = parseFloat(priceMap[tK] || '');
        const promptOK  = !!checked[pK] && promptQty(r) > 0  && !isNaN(pVal) && pVal > 0;
        const transitOK = !!checked[tK] && transitQty(r) > 0 && !isNaN(tVal) && tVal > 0;
        return { r, promptOK, transitOK, pVal, tVal };
      })
      .filter((x) => x.promptOK || x.transitOK);
    if (!pdfRows.length) return;
    const currency = pdfRows[0].r.currency || 'USD';
    const html = buildPriceListHTML(pdfRows, selectedLocation.name, currency, getLogoUrl());

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.write(html);
    doc.close();

    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    };

    const img = doc.querySelector('img');
    if (img && !img.complete) {
      img.onload = triggerPrint;
      img.onerror = triggerPrint;
      setTimeout(triggerPrint, 5000);
    } else {
      setTimeout(triggerPrint, 100);
    }
  };

  const stepSubtitle = step === 1
    ? 'Step 1 of 2 — Select a location'
    : `Step 2 of 2 — ${selectedLocation?.name ?? ''} · ${tableRows.length} item${tableRows.length !== 1 ? 's' : ''} (Prompt & In Transit)`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden p-0"
        style={{ maxWidth: '1280px', width: '96vw', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            background: 'linear-gradient(135deg, var(--navy) 0%, var(--navy-mid) 100%)',
            borderRadius: '14px 14px 0 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
              📄 Generate Price List
            </div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>
              {stepSubtitle}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 12,
                  padding: '4px 12px',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{
                background: 'rgba(255,255,255,0.12)',
                border: 'none',
                borderRadius: 6,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 18,
                width: 30,
                height: 30,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body — force light context so text is readable regardless of theme */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', color: '#0D1F33' }}>
          {/* ── Step 1: Location grid ─────────────────────────────────────── */}
          {step === 1 && (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 20px' }}>
              <p style={{ color: '#7A8FA3', fontSize: 13, marginBottom: 14 }}>
                Choose the reload location. Only locations with Prompt or In Transit inventory are shown.
              </p>
              {locationsWithAvailable.length === 0 ? (
                <p style={{ color: '#7A8FA3', fontSize: 13 }}>No locations with available inventory.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                  {locationsWithAvailable.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => handleGoStep2(loc)}
                      style={{
                        background: '#fff',
                        border: '1.5px solid #E2E8F0',
                        borderRadius: 8,
                        padding: '10px 12px',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#1E6B47';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(30,107,71,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#E2E8F0';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0D1F33', marginBottom: 4 }}>
                        {loc.name}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                        {loc.currencies.map((c) => (
                          <CurrencyBadge key={c} currency={c} />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Price entry table ─────────────────────────────────── */}
          {step === 2 && (
            <>
              {/* Pinned top section — filters + quick-fill */}
              <div style={{ flexShrink: 0, padding: '20px 20px 0' }}>
              <p style={{ color: '#7A8FA3', fontSize: 13, marginBottom: 14 }}>
                Items split into <strong style={{ color: PROMPT_COLOR_DARK }}>Prompt</strong> (On Hand − Committed − Outbound) and{' '}
                <strong style={{ color: TRANSIT_COLOR_DARK }}>In Transit</strong>. Check each column to include it and enter a price per MBF.
                Only checked rows appear on the PDF.
              </p>
              {/* Filter bar */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'flex-end',
                  padding: '12px 14px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  marginBottom: 10,
                }}
              >
                <FilterSelect label="Vendor"    value={step2Filters.vendor}    options={filterOptions.vendor}    onChange={(v) => setStep2Filters((f) => ({ ...f, vendor: v }))} />
                <FilterSelect label="PO"        value={step2Filters.po}        options={filterOptions.po}        onChange={(v) => setStep2Filters((f) => ({ ...f, po: v }))} />
                <FilterSelect label="Thickness" value={step2Filters.thickness} options={filterOptions.thickness} onChange={(v) => setStep2Filters((f) => ({ ...f, thickness: v }))} />
                <FilterSelect label="Width"     value={step2Filters.width}     options={filterOptions.width}     onChange={(v) => setStep2Filters((f) => ({ ...f, width: v }))} />
                <FilterSelect label="Length"    value={step2Filters.length}    options={filterOptions.length}    onChange={(v) => setStep2Filters((f) => ({ ...f, length: v }))} />
                <FilterSelect label="Grade"     value={step2Filters.grade}     options={filterOptions.grade}     onChange={(v) => setStep2Filters((f) => ({ ...f, grade: v }))} />
                <button
                  type="button"
                  onClick={() => setStep2Filters(EMPTY_FILTERS)}
                  style={{
                    border: '1px solid #CBD5E1',
                    background: '#fff',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 12,
                    cursor: 'pointer',
                    color: '#3D5166',
                    alignSelf: 'flex-end',
                  }}
                >
                  ↺ Reset
                </button>
              </div>

              {/* Quick-fill bar */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 20,
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  marginBottom: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: promptCandidates.length === 0 ? 0.5 : 1 }}>
                  <span style={{ color: '#3D5166', fontSize: 12 }}>
                    Fill all <strong style={{ color: PROMPT_COLOR_DARK }}>Prompt</strong> prices:
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ color: '#0D1F33', fontSize: 12, fontWeight: 600 }}>$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="/ MBF"
                      disabled={promptCandidates.length === 0}
                      value={globalPromptPrice}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== '' && parseFloat(v) < 0) return;
                        handleFillAllSide('prompt', v);
                      }}
                      style={{
                        border: '1px solid #CBD5E1',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 12,
                        width: 90,
                        fontFamily: 'monospace',
                        background: promptCandidates.length === 0 ? '#F1F5FA' : '#fff',
                        cursor: promptCandidates.length === 0 ? 'not-allowed' : 'text',
                      }}
                    />
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: transitCandidates.length === 0 ? 0.5 : 1 }}>
                  <span style={{ color: '#3D5166', fontSize: 12 }}>
                    Fill all <strong style={{ color: TRANSIT_COLOR_DARK }}>In Transit</strong> prices:
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ color: '#0D1F33', fontSize: 12, fontWeight: 600 }}>$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="/ MBF"
                      disabled={transitCandidates.length === 0}
                      value={globalTransitPrice}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== '' && parseFloat(v) < 0) return;
                        handleFillAllSide('transit', v);
                      }}
                      style={{
                        border: '1px solid #CBD5E1',
                        borderRadius: 4,
                        padding: '4px 6px',
                        fontSize: 12,
                        width: 90,
                        fontFamily: 'monospace',
                        background: transitCandidates.length === 0 ? '#F1F5FA' : '#fff',
                        cursor: transitCandidates.length === 0 ? 'not-allowed' : 'text',
                      }}
                    />
                  </span>
                </div>
              </div>
              </div>

              {/* Price table — own scroll viewport so horizontal scrollbar sits at bottom of visible table area */}
              <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th colSpan={5} style={GROUP_TH_BLANK} />
                      <th colSpan={3} style={GROUP_TH_PROMPT}>
                        PROMPT <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.7 }}>(On Hand − Committed − Outbound)</span>
                      </th>
                      <th colSpan={3} style={GROUP_TH_TRANSIT}>IN TRANSIT</th>
                    </tr>
                    <tr style={{ background: 'linear-gradient(to bottom, #F1F5FA, #E8EDF5)' }}>
                      <th style={TH_STYLE(false)}>THICKNESS</th>
                      <th style={TH_STYLE(false)}>WIDTH</th>
                      <th style={TH_STYLE(false)}>LENGTH</th>
                      <th style={TH_STYLE(false)}>GRADE</th>
                      <th style={TH_STYLE(false)}>VENDOR</th>
                      <th style={TH_STYLE_SIDE('prompt', false)}>
                        <input
                          type="checkbox"
                          checked={allPromptChecked}
                          ref={(el) => { if (el) el.indeterminate = !allPromptChecked && somePromptChecked; }}
                          onChange={() => handleSelectAllSide('prompt')}
                          disabled={promptCandidates.length === 0}
                          style={{ cursor: promptCandidates.length === 0 ? 'not-allowed' : 'pointer' }}
                        />
                      </th>
                      <th style={TH_STYLE_SIDE('prompt', true)}>QTY (PACKS)</th>
                      <th style={TH_STYLE_SIDE('prompt', true)}>PRICE / MBF</th>
                      <th style={TH_STYLE_SIDE('transit', false)}>
                        <input
                          type="checkbox"
                          checked={allTransitChecked}
                          ref={(el) => { if (el) el.indeterminate = !allTransitChecked && someTransitChecked; }}
                          onChange={() => handleSelectAllSide('transit')}
                          disabled={transitCandidates.length === 0}
                          style={{ cursor: transitCandidates.length === 0 ? 'not-allowed' : 'pointer' }}
                        />
                      </th>
                      <th style={TH_STYLE_SIDE('transit', true)}>QTY (PACKS)</th>
                      <th style={TH_STYLE_SIDE('transit', true)}>PRICE / MBF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      const pK = sideKey(r, 'prompt');
                      const tK = sideKey(r, 'transit');
                      const pQty = promptQty(r);
                      const tQty = transitQty(r);
                      const pHas = pQty > 0;
                      const tHas = tQty > 0;
                      const pChecked = pHas && !!checked[pK];
                      const tChecked = tHas && !!checked[tK];
                      const mbfFactor = r.mbfFactor ?? 0;
                      const pIsTL = pHas && pQty * mbfFactor >= TL_MBF;
                      const tIsTL = tHas && tQty * mbfFactor >= TL_MBF;
                      const rowBg = i % 2 === 0 ? '#fff' : '#F8FAFC';
                      return (
                        <tr key={rowKey(r)} style={{ background: rowBg }}>
                          <td style={TD_STYLE(false)}><span style={{ fontFamily: 'monospace', color: '#0D1F33' }}>{dimDisplay(r.thickness)}</span></td>
                          <td style={TD_STYLE(false)}><span style={{ fontFamily: 'monospace', color: '#0D1F33' }}>{dimDisplay(r.width)}</span></td>
                          <td style={TD_STYLE(false)}><span style={{ fontFamily: 'monospace', color: '#0D1F33' }}>{dimDisplay(r.length)}</span></td>
                          <td style={TD_STYLE(false)}><span style={{ color: '#0D1F33' }}>{dimDisplay(r.grade)}</span></td>
                          <td style={TD_STYLE(false)}><span style={{ color: '#3D5166', fontSize: 11 }}>{r.vendor || '—'}</span></td>

                          {/* ── Prompt side ─────────────────────────────────── */}
                          <SideCheckboxCell
                            has={pHas}
                            checked={pChecked}
                            onChange={(on) => handleToggleSide(r, 'prompt', on)}
                          />
                          <SideQtyCell has={pHas} checked={pChecked} qty={pQty} isTL={pIsTL} color={PROMPT_COLOR_DARK} dimColor="#7A8FA3" />
                          <SidePriceCell
                            has={pHas}
                            checked={pChecked}
                            value={priceMap[pK] ?? ''}
                            onChange={(v) => setPriceMap((prev) => ({ ...prev, [pK]: v }))}
                          />

                          {/* ── In Transit side ─────────────────────────────── */}
                          <SideCheckboxCell
                            has={tHas}
                            checked={tChecked}
                            onChange={(on) => handleToggleSide(r, 'transit', on)}
                          />
                          <SideQtyCell has={tHas} checked={tChecked} qty={tQty} isTL={tIsTL} color={TRANSIT_COLOR_DARK} dimColor="#7A8FA3" />
                          <SidePriceCell
                            has={tHas}
                            checked={tChecked}
                            value={priceMap[tK] ?? ''}
                            onChange={(v) => setPriceMap((prev) => ({ ...prev, [tK]: v }))}
                          />
                        </tr>
                      );
                    })}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={11} style={{ padding: '24px', textAlign: 'center', color: '#7A8FA3' }}>
                          No rows match the selected filters
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer — pinned outside scroll area */}
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                  padding: '12px 20px 16px',
                  borderTop: '1px solid #E2E8F0',
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  style={{
                    border: '1px solid #CBD5E1',
                    background: '#fff',
                    borderRadius: 6,
                    padding: '7px 16px',
                    fontSize: 13,
                    cursor: 'pointer',
                    color: '#3D5166',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGeneratePDF}
                  disabled={!canGeneratePDF}
                  style={{
                    background: canGeneratePDF ? '#1E6B47' : '#CBD5E1',
                    border: 'none',
                    borderRadius: 6,
                    padding: '7px 18px',
                    fontSize: 13,
                    fontWeight: 700,
                    color: canGeneratePDF ? '#fff' : '#7A8FA3',
                    cursor: canGeneratePDF ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                >
                  ↓ Generate PDF
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Cell sub-components ─────────────────────────────────────────────────────

const SideCheckboxCell = ({
  has,
  checked,
  onChange,
}: {
  has: boolean;
  checked: boolean;
  onChange: (on: boolean) => void;
}) => (
  <td style={{ ...TD_STYLE(false), opacity: has ? (checked ? 1 : 0.55) : 0.3 }}>
    <input
      type="checkbox"
      checked={checked}
      disabled={!has}
      onChange={(e) => onChange(e.target.checked)}
      style={{ cursor: has ? 'pointer' : 'not-allowed' }}
    />
  </td>
);

const SideQtyCell = ({
  has,
  checked,
  qty,
  isTL,
  color,
  dimColor,
}: {
  has: boolean;
  checked: boolean;
  qty: number;
  isTL: boolean;
  color: string;
  dimColor: string;
}) => (
  <td style={{ ...TD_STYLE(true), opacity: has ? (checked ? 1 : 0.5) : 0.4 }}>
    {has ? (
      <>
        <span style={{ fontFamily: 'monospace', color, fontWeight: 600 }}>
          {isTL ? 'TL' : Math.round(qty).toLocaleString()}
        </span>
        {isTL && (
          <span style={{ fontFamily: 'monospace', color: dimColor, fontSize: 11, marginLeft: 4 }}>
            ({Math.round(qty).toLocaleString()} pks)
          </span>
        )}
      </>
    ) : (
      <span style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>—</span>
    )}
  </td>
);

const SidePriceCell = ({
  has,
  checked,
  value,
  onChange,
}: {
  has: boolean;
  checked: boolean;
  value: string;
  onChange: (v: string) => void;
}) => {
  const enabled = has && checked;
  return (
    <td style={TD_STYLE(true)}>
      {has ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <span style={{ color: enabled ? '#0D1F33' : '#7A8FA3', fontSize: 12, fontWeight: 600 }}>$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            disabled={!enabled}
            value={value}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== '' && parseFloat(v) < 0) return;
              onChange(v);
            }}
            style={{
              border: '1px solid #CBD5E1',
              borderRadius: 4,
              padding: '3px 6px',
              fontSize: 12,
              width: 80,
              textAlign: 'right',
              fontFamily: 'monospace',
              background: enabled ? '#fff' : '#F1F5FA',
              color: enabled ? '#0D1F33' : '#7A8FA3',
            }}
            placeholder="0.00"
          />
        </span>
      ) : (
        <span style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>—</span>
      )}
    </td>
  );
};

// ── Styling ─────────────────────────────────────────────────────────────────

const PROMPT_COLOR_DARK  = '#1B5E20';  // dark green for prompt
const TRANSIT_COLOR_DARK = '#4A148C';  // dark purple for in transit
const PROMPT_BG_TINT  = '#E8F0E5';
const TRANSIT_BG_TINT = '#ECE3F5';

// Sticky thead — group row sticks at top:0, column row at top:GROUP_ROW_H
const GROUP_ROW_H = 28;

const GROUP_TH_BLANK: React.CSSProperties = {
  background: '#F1F5FA',
  borderBottom: '1px solid #CBD5E1',
  padding: '6px 8px',
  position: 'sticky',
  top: 0,
  zIndex: 3,
};

const GROUP_TH_PROMPT: React.CSSProperties = {
  background: PROMPT_BG_TINT,
  color: '#27500A',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  borderLeft: '2px solid #A5D6A7',
  borderBottom: '1px solid #A5D6A7',
  padding: '6px 8px',
  position: 'sticky',
  top: 0,
  zIndex: 3,
};

const GROUP_TH_TRANSIT: React.CSSProperties = {
  background: TRANSIT_BG_TINT,
  color: '#4A148C',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  borderLeft: '2px solid #CE93D8',
  borderBottom: '1px solid #CE93D8',
  padding: '6px 8px',
  position: 'sticky',
  top: 0,
  zIndex: 3,
};

const TH_STYLE = (numeric: boolean): React.CSSProperties => ({
  padding: '8px 10px',
  color: '#3D5166',
  fontWeight: 700,
  fontSize: 10.5,
  textAlign: numeric ? 'right' : 'left',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '2px solid #CBD5E1',
  whiteSpace: 'nowrap',
  background: '#F1F5FA',
  position: 'sticky',
  top: GROUP_ROW_H,
  zIndex: 2,
});

const TH_STYLE_SIDE = (side: Side, numeric: boolean): React.CSSProperties => ({
  ...TH_STYLE(numeric),
  background: side === 'prompt' ? PROMPT_BG_TINT : TRANSIT_BG_TINT,
  color: side === 'prompt' ? '#27500A' : '#4A148C',
  borderLeft: side === 'prompt' ? '2px solid #A5D6A7' : '2px solid #CE93D8',
});

const TD_STYLE = (numeric: boolean): React.CSSProperties => ({
  padding: '7px 10px',
  borderBottom: '1px solid #E2E8F0',
  textAlign: numeric ? 'right' : 'left',
  whiteSpace: 'nowrap',
  color: '#0D1F33',
});
