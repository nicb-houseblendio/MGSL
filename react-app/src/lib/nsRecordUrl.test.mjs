// nsRecordUrl.ts — the SO link the Open Orders tab needs, and the sandbox host trap.
//
// This exists because the whole risk of building a NetSuite record URL in the
// browser is one string transform: `runtime.accountId` is "9448239_SB1" and the
// host is "9448239-sb1.app.netsuite.com". Underscore, and case. Get it wrong and
// every link on the tab 404s in the sandbox MGSL are actually testing in, while
// looking perfectly plausible in production.
import { accountHostLabel, nsRecordUrl, salesOrderUrl } from './nsRecordUrl.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ── the host label ────────────────────────────────────────────────────────────
// 🔴 THE SANDBOX TRAP. Measured from this account's own RESTlet host on
// 2026-09-08: accountId "9448239_SB1" is served at 9448239-sb1.*.netsuite.com.
ok('sandbox: 9448239_SB1 -> 9448239-sb1', accountHostLabel('9448239_SB1') === '9448239-sb1', accountHostLabel('9448239_SB1'));
ok('sandbox: the underscore does NOT survive', !accountHostLabel('9448239_SB1').includes('_'), accountHostLabel('9448239_SB1'));
ok('sandbox: the uppercase SB does NOT survive', !/SB/.test(accountHostLabel('9448239_SB1')), accountHostLabel('9448239_SB1'));
ok('production: a bare account id is just lowercased', accountHostLabel('9448239') === '9448239', accountHostLabel('9448239'));
ok('release preview: 1234567_RP -> 1234567-rp', accountHostLabel('1234567_RP') === '1234567-rp', accountHostLabel('1234567_RP'));
ok('second sandbox: 9448239_SB2 -> 9448239-sb2', accountHostLabel('9448239_SB2') === '9448239-sb2', accountHostLabel('9448239_SB2'));
ok('demo accounts: TSTDRV1234567 -> tstdrv1234567', accountHostLabel('TSTDRV1234567') === 'tstdrv1234567', accountHostLabel('TSTDRV1234567'));
ok('already hyphenated is idempotent', accountHostLabel('9448239-sb1') === '9448239-sb1', accountHostLabel('9448239-sb1'));
ok('whitespace is trimmed', accountHostLabel('  9448239_SB1  ') === '9448239-sb1', accountHostLabel('  9448239_SB1  '));

// Anything that is not account-id shaped yields NO host rather than a host built
// out of it. `accountId` comes from window.MCGI_CONFIG, i.e. from the page, so a
// dot or a slash in it must never end up in an origin.
ok('empty -> no host', accountHostLabel('') === '' && accountHostLabel(null) === '' && accountHostLabel(undefined) === '');
ok('a dotted value is refused, not spliced into a host', accountHostLabel('evil.com') === '', accountHostLabel('evil.com'));
ok('a slashed value is refused', accountHostLabel('9448239/../x') === '', accountHostLabel('9448239/../x'));
ok('an at-sign is refused', accountHostLabel('a@b') === '', accountHostLabel('a@b'));
ok('a trailing underscore is not an account id', accountHostLabel('9448239_') === '', accountHostLabel('9448239_'));

// ── the record URL ────────────────────────────────────────────────────────────
// The exact shape NetSuite's own resolveRecord emits, measured 2026-09-08 from a
// URL the IND cache builder had stored through shared/urlResolver.js:
//   "/app/common/item/item.nl?id=1004&compid=9448239_SB1"
// Host hyphenated, compid RAW. That asymmetry is NetSuite's, not ours.
ok('sandbox SO url is absolute, on the -sb1 host, with the raw compid',
  salesOrderUrl('126449', '9448239_SB1') === 'https://9448239-sb1.app.netsuite.com/app/accounting/transactions/salesord.nl?id=126449&compid=9448239_SB1',
  salesOrderUrl('126449', '9448239_SB1'));
ok('production SO url is on the bare host',
  salesOrderUrl('126449', '9448239') === 'https://9448239.app.netsuite.com/app/accounting/transactions/salesord.nl?id=126449&compid=9448239',
  salesOrderUrl('126449', '9448239'));
// No account id is survivable, not fatal: the screen is SERVED from the NetSuite
// app origin (lib/api.ts resolves the relative restletUrl against
// window.location.origin and that is the only reason any data loads), so a
// same-origin path still opens the record.
ok('no account id falls back to a same-origin path, not to nothing',
  salesOrderUrl('126449', '') === '/app/accounting/transactions/salesord.nl?id=126449',
  salesOrderUrl('126449', ''));
ok('and the fallback is a path, never a bare id or a broken origin',
  salesOrderUrl('126449').startsWith('/app/accounting/transactions/'), salesOrderUrl('126449'));

// An id we cannot vouch for produces NO link. Fixture orders carry internalId
// null by construction, and offering a link there sends the trader to a 404.
ok('null internal id -> no url', salesOrderUrl(null, '9448239_SB1') === '', salesOrderUrl(null, '9448239_SB1'));
ok('undefined internal id -> no url', salesOrderUrl(undefined, '9448239_SB1') === '');
ok('empty internal id -> no url', salesOrderUrl('', '9448239_SB1') === '');
ok('non-numeric internal id -> no url', salesOrderUrl('SO-CWP-001344', '9448239_SB1') === '', salesOrderUrl('SO-CWP-001344', '9448239_SB1'));
ok('an id carrying its own query string is refused, not appended',
  salesOrderUrl('126449&e=T', '9448239_SB1') === '', salesOrderUrl('126449&e=T', '9448239_SB1'));
ok('a numeric id with surrounding space is accepted once trimmed',
  salesOrderUrl(' 126449 ', '9448239').includes('?id=126449&'), salesOrderUrl(' 126449 ', '9448239'));
ok('a numeric id given as a number works', salesOrderUrl(126449, '9448239').includes('?id=126449&'));
// The fallback path has no account to state, so it must not invent an empty one.
ok('the same-origin fallback carries no empty compid',
  !salesOrderUrl('126449', '').includes('compid'), salesOrderUrl('126449', ''));

// ── record types ──────────────────────────────────────────────────────────────
// Only the types whose path is KNOWN get a url. NetSuite's record paths are not
// derivable from the record name (`salesord.nl`, `custjob.nl`, `custinvc.nl`),
// so a type nobody has looked up must produce nothing rather than a guess.
ok('an unknown record type yields no url rather than a guessed path',
  nsRecordUrl('journalentry', '1', '9448239') === '', nsRecordUrl('journalentry', '1', '9448239'));
ok('the record type is matched case-insensitively', nsRecordUrl('SalesOrder', '1', '9448239') !== '');
ok('salesOrderUrl is nsRecordUrl bound to salesorder',
  salesOrderUrl('9', '9448239') === nsRecordUrl('salesorder', '9', '9448239'));

console.log(fail ? ('# FAIL ' + fail) : '# nsRecordUrl ok');
process.exit(fail ? 1 : 0);
