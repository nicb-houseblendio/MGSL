/**
 * Which ship date Edit SO brings back onto the wizard, as a pure function so the
 * rule is executed by tests rather than pinned as source text.
 *
 * - A ship date equal to the order date is NetSuite's DEFAULT, not a plan (26 of
 *   28 open ARC orders at round 2), so `shipDate` only counts when it differs.
 * - Feedback 17 item 4 (MA, 2026-09-23): « Ship date et equipment ne semble pas
 *   suivre ». A date the trader typed as today equals the order date on a same-day
 *   order, so the date the order actually holds (`shipDateStored`) is the fallback.
 * - Either way a PAST date is dropped (verification, 2026-09-23): it would price FX
 *   and milling on a stale day (115194: 2026-02-05, FX 1.3693 vs 1.4030 that day)
 *   and print that date as the ship date. The trader enters a real one instead.
 *
 * Dates are ISO `YYYY-MM-DD`, which compare correctly as strings.
 */
export interface EditShipDateSource {
  shipDate?: string | null;
  created?: string | null;
  shipDateStored?: string | null;
}

export const todayIsoLocal = (now: Date = new Date()): string =>
  now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
  String(now.getDate()).padStart(2, '0');

export const restoredShipDate = (o: EditShipDateSource, todayIso: string): string => {
  const planned = o.shipDate && o.shipDate !== o.created ? o.shipDate : '';
  const candidate = planned || o.shipDateStored || '';
  return candidate && candidate >= todayIso ? candidate : '';
};
