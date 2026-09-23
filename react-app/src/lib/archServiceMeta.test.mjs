/**
 * The ARCH service's `meta` action, which the screen polls every 30 s per open tab
 * since 2026-09-23. It must answer the same availability question as before
 * (META present AND the summary present, chunks included) WITHOUT parsing the
 * ~450 KB summary on every poll, and it must publish the two new run facts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TS = join(here, '../../../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen');
const load = (file, resolve) => {
  let mod = null;
  new Function('define', readFileSync(file, 'utf8'))((deps, f) => { mod = f(...deps.map(resolve)); });
  return mod;
};
const CacheKeys = load(join(TS, 'shared', 'cacheKeys_arch.js'), () => { throw new Error('no deps'); });

const service = (store) => load(join(TS, 'service', 'trader_screen_service_arch.js'), (id) => {
  if (id === 'N/runtime') return { getCurrentScript: () => ({ getParameter: () => null }) };
  if (id === 'N/log') return { audit: () => {}, error: () => {}, debug: () => {} };
  if (id === 'N/query') return { runSuiteQL: () => ({ asMappedResults: () => [] }) };
  if (/cacheKeys_arch$/.test(id)) return CacheKeys;
  if (/cacheClient$/.test(id)) return { getCache: () => ({ get: ({ key }) => (key in store ? store[key] : null) }) };
  return {};
});

const META = JSON.stringify({ cacheVersion: 1, lastUpdated: '2026-09-23T15:30:00Z', rowCount: 2, startedAt: '2026-09-23T15:28:40Z' });
const meta = (store) => service(store).getRouter({ action: 'meta' });

test('meta: available only when the summary is there too', () => {
  assert.equal(meta({}).reason, 'CACHE_MISS');
  assert.equal(meta({ [CacheKeys.META]: META }).reason, 'SUMMARY_MISSING');
  const ok = meta({ [CacheKeys.META]: META, [CacheKeys.SUMMARY]: '[{"a":1},{"a":2}]',
    [CacheKeys.RECON_LAST_RUN]: '2026-09-23T15:29:00Z' });
  assert.equal(ok.available, true);
  assert.equal(ok.startedAt, '2026-09-23T15:28:40Z', 'when the served rows started building');
  assert.equal(ok.reconLastRun, '2026-09-23T15:29:00Z', 'the reconciler heartbeat');
});

test('meta: chunked summaries, a missing chunk is a miss', () => {
  const pointer = JSON.stringify({ chunked: true, chunkCount: 2 });
  const base = { [CacheKeys.META]: META, [CacheKeys.SUMMARY]: pointer, [CacheKeys.buildSummaryDataKey(0)]: '[{"a":1}]' };
  assert.equal(meta(base).reason, 'SUMMARY_CHUNK_MISSING');
  assert.equal(meta(Object.assign({}, base, { [CacheKeys.buildSummaryDataKey(1)]: '[{"a":2}]' })).available, true);
  assert.equal(meta(Object.assign({}, base, { [CacheKeys.buildSummaryDataKey(1)]: 'garbage' })).reason, 'SUMMARY_CHUNK_UNREADABLE');
  assert.equal(meta({ [CacheKeys.META]: META, [CacheKeys.SUMMARY]: 'garbage' }).reason, 'SUMMARY_UNREADABLE');
});

test('meta: never parses the rows (a poll must stay cheap)', () => {
  const realParse = JSON.parse;
  let big = 0;
  JSON.parse = (s, ...rest) => { if (String(s).length > 1000) big++; return realParse(s, ...rest); };
  try {
    const rows = '[' + Array.from({ length: 500 }, (_, i) => '{"itemCode":"I' + i + '","pad":"' + 'x'.repeat(40) + '"}').join(',') + ']';
    const r = meta({ [CacheKeys.META]: META, [CacheKeys.SUMMARY]: rows });
    assert.equal(r.available, true);
  } finally { JSON.parse = realParse; }
  assert.equal(big, 0, 'no large JSON.parse on the meta path');
});
