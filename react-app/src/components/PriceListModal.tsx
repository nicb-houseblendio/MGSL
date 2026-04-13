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

const EMPTY_FILTERS: Step2Filters = { vendor: '', po: '', thickness: '', width: '', length: '', grade: '' };

const rowKey = (r: SummaryRow) => r.detailKey || `${r.internalId}-${r.locationId}`;

/** Convert NetSuite "- None -" / empty to dash for display */
const dimDisplay = (v: string | undefined): string =>
  !v || v === '- None -' ? '—' : v;

// ── PDF helpers ──────────────────────────────────────────────────────────────

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildPriceListHTML = (
  selectedRows: SummaryRow[],
  priceMap: Record<string, string>,
  locationName: string
): string => {
  // Step 1: group by grade
  const byGrade: Record<string, SummaryRow[]> = {};
  for (const r of selectedRows) {
    const g = r.grade || 'Unknown';
    if (!byGrade[g]) byGrade[g] = [];
    byGrade[g].push(r);
  }

  // Step 2: one row per selected item (no merging — preserves per-row prices)
  const tableHTML = Object.entries(byGrade)
    .map(([grade, gradeRows]) => {
      const rowsHTML = gradeRows
        .map((r) => {
          const availMBF = r.available * (r.mbfFactor ?? 0);
          const availDisplay = availMBF >= 27 ? 'TL' : String(Math.round(r.available));
          const price = esc(priceMap[rowKey(r)] || '');
          return `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${esc(dimDisplay(r.thickness))}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${esc(dimDisplay(r.width))}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${esc(dimDisplay(r.length))}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${esc(r.vendor || '')}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace">${availDisplay}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace">${price}</td>
            </tr>`;
        })
        .join('');
      return `
        <h3 style="font-family:sans-serif;color:#0F2641;margin:20px 0 6px">${esc(grade)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#0F2641;color:#fff">
              <th style="padding:8px 10px;text-align:left;font-weight:700">Thickness</th>
              <th style="padding:8px 10px;text-align:left;font-weight:700">Width</th>
              <th style="padding:8px 10px;text-align:left;font-weight:700">Length</th>
              <th style="padding:8px 10px;text-align:left;font-weight:700">Vendor</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Available</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700">Price/MBF</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><title>Price List</title></head>
    <body style="font-family:sans-serif;padding:24px">
      <h2 style="color:#0F2641;margin:0 0 4px">Europe Offering &amp; Price List</h2>
      <p style="color:#3D5166;margin:0 0 16px">${esc(locationName)}</p>
      ${tableHTML}
    </body></html>`;
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
  const [globalPrice, setGlobalPrice] = React.useState('');
  const [step2Filters, setStep2Filters] = React.useState<Step2Filters>(EMPTY_FILTERS);

  // Reset all state when modal closes
  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setSelectedLocation(null);
      setPriceMap({});
      setChecked({});
      setGlobalPrice('');
      setStep2Filters(EMPTY_FILTERS);
    }
  }, [open]);

  // Step 1 — reload locations with Available > 0
  const locationsWithAvailable = React.useMemo(() => {
    // Only include reload locations; fall back to all if none are flagged
    const anyReload = rows.some((r) => r.isReload);
    const eligible = anyReload ? rows.filter((r) => r.isReload) : rows;

    const map = new Map<string, LocationOption & { currSet: Set<string> }>();
    for (const r of eligible) {
      if ((r.available ?? 0) > 0) {
        const existing = map.get(r.locationId);
        if (existing) {
          existing.available += r.available;
          if (r.currency) existing.currSet.add(r.currency);
        } else {
          const currSet = new Set<string>();
          if (r.currency) currSet.add(r.currency);
          map.set(r.locationId, {
            id: r.locationId,
            name: r.locationName,
            currencies: [],
            available: r.available,
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
    const initialRows = rows.filter((r) => r.locationId === loc.id && (r.available ?? 0) > 0);
    const newPriceMap: Record<string, string> = {};
    const newChecked: Record<string, boolean> = {};
    initialRows.forEach((r) => {
      const key = rowKey(r);
      newPriceMap[key] = '';
      newChecked[key] = true;
    });
    setSelectedLocation(loc);
    setPriceMap(newPriceMap);
    setChecked(newChecked);
    setGlobalPrice('');
    setStep2Filters(EMPTY_FILTERS);
    setStep(2);
  };

  // Step 2 — all rows for selected location (unmerged)
  const tableRows = React.useMemo(
    () => rows.filter((r) => r.locationId === selectedLocation?.id && (r.available ?? 0) > 0),
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

  // Select All — scoped to visibleRows
  const allVisibleChecked =
    visibleRows.length > 0 && visibleRows.every((r) => checked[rowKey(r)]);
  const someVisibleChecked = visibleRows.some((r) => checked[rowKey(r)]);

  const handleSelectAll = () => {
    const newVal = !allVisibleChecked;
    setChecked((prev) => {
      const next = { ...prev };
      visibleRows.forEach((r) => { next[rowKey(r)] = newVal; });
      return next;
    });
    if (!newVal) {
      setPriceMap((prev) => {
        const next = { ...prev };
        visibleRows.forEach((r) => { next[rowKey(r)] = ''; });
        return next;
      });
    }
  };

  const handleUncheck = (r: SummaryRow) => {
    const key = rowKey(r);
    setChecked((prev) => ({ ...prev, [key]: false }));
    setPriceMap((prev) => ({ ...prev, [key]: '' }));
  };

  // Global fill — all visible rows regardless of checked state
  const handleFillAll = (v: string) => {
    setGlobalPrice(v);
    setPriceMap((prev) => {
      const next = { ...prev };
      visibleRows.forEach((r) => { next[rowKey(r)] = v; });
      return next;
    });
  };

  // canGeneratePDF — checks tableRows (not visibleRows): filtered-but-priced rows still go in PDF
  const canGeneratePDF = tableRows.some(
    (r) => checked[rowKey(r)] && parseFloat(priceMap[rowKey(r)] || '') > 0
  );

  const handleGeneratePDF = () => {
    if (!selectedLocation) return;
    const selectedRows = tableRows.filter(
      (r) => checked[rowKey(r)] && parseFloat(priceMap[rowKey(r)] || '') > 0
    );
    const html = buildPriceListHTML(selectedRows, priceMap, selectedLocation.name);
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
    document.body.appendChild(iframe);
    iframe.contentDocument!.write(html);
    iframe.contentDocument!.close();
    iframe.contentWindow!.focus();
    setTimeout(() => {
      iframe.contentWindow!.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 600);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col overflow-hidden p-0"
        style={{ maxWidth: '860px', width: '90vw', maxHeight: '85vh' }}
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
              {step === 1
                ? 'Step 1 of 2 — Select a location'
                : `Step 2 of 2 — ${selectedLocation?.name ?? ''}`}
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
                Choose the reload location. Only locations with available inventory are shown.
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
              <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 0' }}>
              <p style={{ color: '#7A8FA3', fontSize: 13, marginBottom: 14 }}>
                Select items and enter a price per MBF. Only checked items appear on the PDF.
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
                  marginBottom: 14,
                }}
              >
                <FilterSelect
                  label="Vendor"
                  value={step2Filters.vendor}
                  options={filterOptions.vendor}
                  onChange={(v) => setStep2Filters((f) => ({ ...f, vendor: v }))}
                />
                <FilterSelect
                  label="PO"
                  value={step2Filters.po}
                  options={filterOptions.po}
                  onChange={(v) => setStep2Filters((f) => ({ ...f, po: v }))}
                />
                <FilterSelect
                  label="Thickness"
                  value={step2Filters.thickness}
                  options={filterOptions.thickness}
                  onChange={(v) => setStep2Filters((f) => ({ ...f, thickness: v }))}
                />
                <FilterSelect
                  label="Width"
                  value={step2Filters.width}
                  options={filterOptions.width}
                  onChange={(v) => setStep2Filters((f) => ({ ...f, width: v }))}
                />
                <FilterSelect
                  label="Length"
                  value={step2Filters.length}
                  options={filterOptions.length}
                  onChange={(v) => setStep2Filters((f) => ({ ...f, length: v }))}
                />
                <FilterSelect
                  label="Grade"
                  value={step2Filters.grade}
                  options={filterOptions.grade}
                  onChange={(v) => setStep2Filters((f) => ({ ...f, grade: v }))}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
                  <span style={{ color: '#7A8FA3', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Fill All
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Price/MBF"
                    value={globalPrice}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== '' && parseFloat(v) < 0) return;
                      handleFillAll(v);
                    }}
                    style={{
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      padding: '5px 8px',
                      fontSize: 12,
                      width: 90,
                    }}
                  />
                </div>
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

              {/* Price table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'linear-gradient(to bottom, #F1F5FA, #E8EDF5)' }}>
                      <th style={TH_STYLE(false)}>
                        <input
                          type="checkbox"
                          checked={allVisibleChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = !allVisibleChecked && someVisibleChecked;
                          }}
                          onChange={handleSelectAll}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      <th style={TH_STYLE(false)}>THICKNESS</th>
                      <th style={TH_STYLE(false)}>WIDTH</th>
                      <th style={TH_STYLE(false)}>LENGTH</th>
                      <th style={TH_STYLE(false)}>GRADE</th>
                      <th style={TH_STYLE(false)}>VENDOR</th>
                      <th style={TH_STYLE(true)}>AVAILABLE</th>
                      <th style={TH_STYLE(true)}>PRICE / MBF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => {
                      const key = rowKey(r);
                      const isChecked = checked[key] ?? true;
                      const isTL = r.available * (r.mbfFactor ?? 0) >= 27;
                      const rowBg = i % 2 === 0 ? '#fff' : '#F8FAFC';
                      return (
                        <tr
                          key={key}
                          style={{
                            background: rowBg,
                            opacity: isChecked ? 1 : 0.45,
                          }}
                        >
                          <td style={TD_STYLE(false)}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setChecked((prev) => ({ ...prev, [key]: true }));
                                } else {
                                  handleUncheck(r);
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={TD_STYLE(false)}>
                            <span style={{ fontFamily: 'monospace', color: '#0D1F33' }}>{dimDisplay(r.thickness)}</span>
                          </td>
                          <td style={TD_STYLE(false)}>
                            <span style={{ fontFamily: 'monospace', color: '#0D1F33' }}>{dimDisplay(r.width)}</span>
                          </td>
                          <td style={TD_STYLE(false)}>
                            <span style={{ fontFamily: 'monospace', color: '#0D1F33' }}>{dimDisplay(r.length)}</span>
                          </td>
                          <td style={TD_STYLE(false)}>
                            <span style={{ color: '#0D1F33' }}>{dimDisplay(r.grade)}</span>
                          </td>
                          <td style={TD_STYLE(false)}>
                            <span style={{ color: '#3D5166', fontSize: 11 }}>{r.vendor || '—'}</span>
                          </td>
                          <td style={TD_STYLE(true)}>
                            <span style={{ fontFamily: 'monospace', color: '#1E6B47', fontWeight: 600 }}>
                              {isTL ? 'TL' : Math.round(r.available).toLocaleString()}
                            </span>
                            {isTL && (
                              <span style={{ fontFamily: 'monospace', color: '#7A8FA3', fontSize: 11, marginLeft: 4 }}>
                                ({Math.round(r.available).toLocaleString()} pks)
                              </span>
                            )}
                          </td>
                          <td style={TD_STYLE(true)}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                              <span style={{ color: isChecked ? '#0D1F33' : '#7A8FA3', fontSize: 12, fontWeight: 600 }}>$</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                disabled={!isChecked}
                                value={priceMap[key] ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v !== '' && parseFloat(v) < 0) return;
                                  setPriceMap((prev) => ({ ...prev, [key]: v }));
                                }}
                                style={{
                                  border: '1px solid #CBD5E1',
                                  borderRadius: 4,
                                  padding: '3px 6px',
                                  fontSize: 12,
                                  width: 90,
                                  textAlign: 'right',
                                  fontFamily: 'monospace',
                                  background: isChecked ? '#fff' : '#F1F5FA',
                                  color: isChecked ? '#0D1F33' : '#7A8FA3',
                                }}
                                placeholder="0.00"
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#7A8FA3' }}>
                          No rows match the selected filters
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
                  Generate PDF
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
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
});

const TD_STYLE = (numeric: boolean): React.CSSProperties => ({
  padding: '7px 10px',
  borderBottom: '1px solid #E2E8F0',
  textAlign: numeric ? 'right' : 'left',
  whiteSpace: 'nowrap',
  color: '#0D1F33',
});
