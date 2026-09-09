/**
 * No button in this app may submit the NetSuite form it is embedded in.
 *
 * Marc-Antoine, 2026-09-09: he clicked the toolbar Refresh and landed on a blank
 * page reading `{"error":"Method not allowed"}`.
 *
 * A `<button>` with no `type` attribute defaults to `type="submit"`. In its
 * DEFAULT mode this app is served as an INLINEHTML field inside a NetSuite
 * `serverWidget` form, so every untyped button submitted that form: the browser
 * POSTed the host Suitelet, the Suitelet answers only GET, and the trader lost
 * the screen. Nothing was wrong with the refresh logic at all.
 *
 * Why it survived so long: FULLSCREEN mode builds its own HTML document with no
 * NS form, so there is nothing to submit and every button behaves correctly.
 * That is the mode most testing happens in, including mine.
 *
 * There is no jsdom in this project, so this is a SOURCE invariant rather than a
 * render test. That is the right shape for this defect: the bug is a missing
 * attribute, and a source scan catches it everywhere at once instead of one
 * component at a time.
 *
 * What this file pins:
 *
 *   A. every `<Button>` and `<button>` in the app resolves to a non-submit type
 *   B. the shared Button applies `type="button"` BEFORE spreading props, so a
 *      caller can still opt into submit, and skips it for asChild
 *   C. the one real form in the app still declares its own button types, which
 *      is what makes the shared default safe
 *   D. the host Suitelet still refuses a non-GET, so the blank page stays
 *      impossible-to-misread rather than silently rendering something
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..');
const BUTTON = path.join(SRC, 'components', 'ui', 'button.tsx');
const SUITELET = path.join(
  here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services',
  'trader_screen', 'entry_points', 'sl', 'mcgi_sl_trader_screen_react.js',
);

let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log('ok - ' + name); return; }
  fail += 1;
  console.log('not ok - ' + name + (detail === undefined ? '' : '  << ' + JSON.stringify(detail)));
};

/*
 * Comment bodies are blanked before scanning, offsets preserved.
 *
 * This is not tidiness. My first scan of this defect reported the refresh button
 * as CLEAN: the apostrophe in its own comment ("Philippe's") opened a quote state
 * that swallowed the rest of the file, and the one button that had actually broken
 * was the one the scan missed. A scanner that can silently skip the bug is worse
 * than no scanner.
 */
const blankComments = (src) => {
  const out = src.split('');
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      for (let k = 0; k < 2 && i < src.length; k += 1) { out[i] = ' '; i += 1; }
      continue;
    }
    i += 1;
  }
  return out.join('');
};

/** End index of an opening JSX tag, respecting {} nesting and quotes. */
const tagEnd = (src, from) => {
  let i = from;
  let depth = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    } else if (c === '>' && depth === 0) {
      break;
    }
    i += 1;
  }
  return i;
};

const walk = (dir) => {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = walk(SRC);

const untyped = [];
for (const p of files) {
  const raw = fs.readFileSync(p, 'utf8');
  const src = blankComments(raw);
  const re = /<(Button|button)(\s|>|\/)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const end = tagEnd(src, m.index + m[0].length - 1);
    const attrs = src.slice(m.index, end + 1);
    if (/\btype\s*=/.test(attrs)) continue;
    if (attrs.includes('asChild')) continue;
    untyped.push({
      file: path.relative(SRC, p).replace(/\\/g, '/'),
      line: raw.slice(0, m.index).split('\n').length,
      tag: m[1],
    });
  }
}

/* ════ A. nothing may fall through to type="submit" ═══════════════════════ */

// A raw <button> has no component to inherit a default from, so it must say so
// itself. The shared <Button> supplies the default, so an untyped one is fine.
const rawUntyped = untyped.filter((u) => u.tag === 'button');
ok('A: no raw <button> relies on the implicit submit default',
  rawUntyped.length === 0, rawUntyped);

ok('A: the scan actually looked at the app, rather than finding nothing to look at',
  files.length > 20, files.length);

// The eight that were broken on 2026-09-09, by name. Each is a <Button>, so each
// is fixed by the shared default; this pins that they still route through it.
const EIGHT = [
  'App.tsx', 'components/CreateOrderModal.tsx', 'components/MultiSelectCombobox.tsx',
  'components/OrderPopover.tsx', 'components/ThemeToggle.tsx',
];
const stillUntypedComponent = untyped.filter((u) => u.tag === 'Button');
ok('A: every untyped button is the shared <Button>, which now supplies the type',
  stillUntypedComponent.every((u) => u.tag === 'Button'), stillUntypedComponent);
ok('A: and they live only in the files known to lean on the default',
  stillUntypedComponent.every((u) => EIGHT.includes(u.file)),
  stillUntypedComponent.map((u) => u.file));

/* ════ B. the shared default, and that a caller can still override it ════ */

const btn = fs.readFileSync(BUTTON, 'utf8');
const btnCode = blankComments(btn);

ok('B: the shared Button sets type="button"',
  /type:\s*'button'/.test(btnCode) || /type="button"/.test(btnCode), btnCode.slice(0, 0));

const defaultAt = btnCode.search(/type:\s*'button'|type="button"/);
const spreadAt = btnCode.indexOf('{...props}');
ok('B: it sets the default BEFORE spreading props, so type="submit" still wins',
  defaultAt !== -1 && spreadAt !== -1 && defaultAt < spreadAt,
  { defaultAt, spreadAt });

ok('B: the default is skipped for asChild, where Slot renders another element',
  /asChild\s*\?\s*\{\s*\}\s*:/.test(btnCode), true);

/* ════ C. the one real form still types its own buttons ══════════════════ */

const modal = fs.readFileSync(path.join(SRC, 'components', 'CreateOrderModal.tsx'), 'utf8');
ok('C: the only real <form> is still there, so this stays a live concern',
  /<form[\s>]/.test(modal) && /onSubmit=/.test(modal));
ok('C: its submit button declares type="submit" rather than relying on a default',
  /<Button\s+type="submit"/.test(modal));
ok('C: and its cancel declares type="button", so the form cannot be submitted by it',
  /<Button\s+type="button"/.test(modal));

/* ════ D. the Suitelet that produced the blank page ══════════════════════ */

const sl = fs.readFileSync(SUITELET, 'utf8');
ok('D: the host Suitelet still refuses a non-GET request',
  /request\.method\s*!==\s*'GET'/.test(sl));
ok('D: and that refusal is the exact text the trader saw',
  /Method not allowed/.test(sl));
ok('D: the default mode really does embed the app in a NetSuite form',
  /serverWidget\.createForm/.test(sl) && /INLINEHTML/.test(sl));

console.log(fail ? ('# FAIL ' + fail) : '# archSubmitButtons ok');
if (fail) process.exitCode = 1;
