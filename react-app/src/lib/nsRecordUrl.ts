/**
 * NetSuite record URLs, built in the browser.
 *
 * ── Why the browser and not the server ──────────────────────────────────────
 * `shared/urlResolver.js` already wraps `N/url.resolveRecord`, and the IND/MTL
 * cache builders use it — but those are Map/Reduce scripts writing a cached row
 * once an hour. The ARCH Open Orders action is different: it runs live inside a
 * RESTlet, so adding `N/url` would mean a new entry in the ARCH service's
 * `define([...])` array, and a wrong dependency there takes down every action on
 * that service (summary, detail, customers), not just one column. It would also
 * put a ~90 byte string on the wire per order for a value that is a pure function
 * of an id we already send — and it does not even answer the host question.
 * Measured 2026-09-08 by reading a URL the IND cache builder had already stored
 * through that exact wrapper:
 *
 *     itemUrl = "/app/common/item/item.nl?id=1004&compid=9448239_SB1"
 *
 * `resolveRecord({ isEditMode: false })` returns a RELATIVE path carrying a
 * `compid`, with no host on it at all. Here the one thing that can actually be
 * wrong is a string transform, and a string transform can be tested. See
 * nsRecordUrl.test.mjs.
 *
 * ── 🔴 THE SANDBOX TRAP ─────────────────────────────────────────────────────
 * `runtime.accountId` is "9448239_SB1"; the host is "9448239-sb1". Underscore to
 * hyphen, and lowercase. MGSL are actively testing in that sandbox, so getting
 * this wrong would 404 every link for the only people looking at the screen while
 * production stayed fine.
 *
 * ── Why a missing account id is not fatal ───────────────────────────────────
 * The screen is SERVED from the NetSuite app origin — `lib/api.ts` resolves the
 * relative `restletUrl` against `window.location.origin`, and that is the only
 * reason any data loads at all. So a same-origin path opens the record perfectly
 * well; the absolute host is preferred only because it is unambiguous under
 * `target="_blank"`.
 */

/**
 * NetSuite's own path per record type. NOT derivable from the record name
 * (`salesorder` -> `salesord.nl`, `customer` -> `custjob.nl`), so a type that is
 * not listed here yields no URL rather than a guessed one.
 */
const RECORD_PATH: Record<string, string> = {
  salesorder: '/app/accounting/transactions/salesord.nl',
};

/**
 * Account id shape: alphanumerics, with `_` or `-` only in the middle.
 *
 * `accountId` reaches us from `window.MCGI_CONFIG`, i.e. from the page, so it is
 * validated before any of it becomes part of an origin. A dot or a slash in there
 * must never be spliced into a host name.
 */
const ACCOUNT_ID_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;

/** "9448239_SB1" -> "9448239-sb1". '' when the value is not account-id shaped. */
export const accountHostLabel = (accountId?: string | null): string => {
  const raw = String(accountId ?? '').trim();
  if (!raw || !ACCOUNT_ID_SHAPE.test(raw)) return '';
  return raw.toLowerCase().replace(/_/g, '-');
};

/**
 * A URL for one NetSuite record, or '' when we cannot vouch for one.
 *
 * '' is returned — and the caller must render no link — when the record type is
 * unknown or the internal id is absent or not an id. Fixture orders carry
 * `internalId: null` by construction, which is exactly that case.
 */
export const nsRecordUrl = (
  recordType: string,
  internalId?: string | number | null,
  accountId?: string | null
): string => {
  const path = RECORD_PATH[String(recordType || '').toLowerCase()];
  if (!path) return '';
  const id = String(internalId ?? '').trim();
  // Digits only. An id carrying its own '&' would otherwise append parameters to
  // the record URL, and a display number ("SO-CWP-001344") is not an id at all.
  if (!/^\d+$/.test(id)) return '';
  const host = accountHostLabel(accountId);
  if (!host) return path + '?id=' + id;
  /*
   * `compid` carries the RAW account id, underscore and all, while the host
   * carries the hyphenated one. That looks like an inconsistency and is not: it
   * is byte for byte what NetSuite's own `resolveRecord` emits (see the header),
   * and matching its output is a stronger correctness argument than any URL of
   * our own invention. Only included when we have an account id to state.
   */
  const raw = String(accountId ?? '').trim();
  return 'https://' + host + '.app.netsuite.com' + path + '?id=' + id + '&compid=' + raw;
};

/** The sales-order form, which is what clicking an SO number must open. */
export const salesOrderUrl = (
  internalId?: string | number | null,
  accountId?: string | null
): string => nsRecordUrl('salesorder', internalId, accountId);
