// Pure, no-network unit tests for the DEFAULT-ON client query cache
// (tsk_bbcbbad3 — productize prong A, "platform intelligence"). Covers:
// request dedup, ~1s staleTime cache, invalidate-on-write, the `.fresh()`
// + `cache:false` opt-outs, prefetch warming, cache-key isolation, and the
// no-shared-mutation guarantee. Runs against the built ESM in dist/esm —
// no SMT_KEY / network required.
//
//   npm run build && node test/unit-cache.mjs

import { createClient } from '../dist/esm/index.js';

const URL_ = 'https://demo.somewhere.tech';
const TOKEN = 'eyJ.jwt.token';

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

/**
 * A fetch double for `POST /v1/db/query`. Counts how many times the network
 * was actually hit, distinguishes reads (body has `select`) from writes, and
 * can stall each response by `delayMs` so concurrency (dedup) is observable.
 */
function dbRecorder({ rows = [{ id: 1, name: 'A' }], delayMs = 0 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    let body = null;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method: init.method, body });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    // The real /db/query envelope is double-nested: the outer `data` is the
    // platform `{ok,data}` envelope, the inner `data` is the query payload.
    return new Response(
      JSON.stringify({ ok: true, data: { data: rows, count: rows.length } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const isQuery = (c) => c.method === 'POST' && c.url.endsWith('/v1/db/query');
  // A "read" is a select query; writes carry insert/update/upsert/delete keys.
  const readCount = () => calls.filter((c) => isQuery(c) && c.body && 'select' in c.body).length;
  return { fetchImpl, calls, readCount };
}

function client(opts) {
  const rec = dbRecorder(opts?.recorder);
  const sw = createClient(URL_, TOKEN, { fetch: rec.fetchImpl, ...opts?.create });
  return { sw, rec };
}

async function main() {
  /* ── dedup: two concurrent awaits of the same query share one fetch ── */
  console.log('request dedup (always on)');
  {
    const { sw, rec } = client({ recorder: { delayMs: 20 } });
    const [a, b] = await Promise.all([
      sw.from('todos').select('*').eq('user_id', 5),
      sw.from('todos').select('*').eq('user_id', 5),
    ]);
    check('2 concurrent identical awaits → 1 fetch', rec.readCount() === 1);
    check('both awaits resolve with data', Array.isArray(a.data) && Array.isArray(b.data));
  }

  /* ── staleTime: a repeat read within the window is served from cache ── */
  console.log('staleTime cache');
  {
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.from('todos').select('*').eq('id', 1);
    await sw.from('todos').select('*').eq('id', 1);
    check('repeat read within staleTime → 1 fetch', rec.readCount() === 1);
  }
  {
    // default-on: no cache option at all still caches (within the 1s default)
    const { sw, rec } = client();
    await sw.from('todos').select('*').eq('id', 1);
    await sw.from('todos').select('*').eq('id', 1);
    check('cache DEFAULT-ON: repeat read → 1 fetch', rec.readCount() === 1);
  }
  {
    // distinct filters are distinct cache keys — must not collide
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.from('todos').select('*').eq('id', 1);
    await sw.from('todos').select('*').eq('id', 2);
    check('distinct filters → distinct keys → 2 fetches', rec.readCount() === 2);
  }

  /* ── invalidate-on-write: a write clears the table so the next read is fresh ── */
  console.log('invalidate-on-write');
  {
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.from('users').select('*');
    await sw.from('users').insert({ name: 'B' });
    await sw.from('users').select('*');
    check('write then read → fresh fetch (2 reads despite staleTime)', rec.readCount() === 2);
  }
  {
    // a write to a DIFFERENT table must NOT invalidate an unrelated cache entry
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.from('users').select('*');
    await sw.from('posts').insert({ title: 'X' });
    await sw.from('users').select('*');
    check('write to other table leaves cache intact → 1 read', rec.readCount() === 1);
  }

  /* ── opt-out level 1: createClient({ cache: false }) always fetches ── */
  console.log('opt-out: cache:false');
  {
    const { sw, rec } = client({ create: { cache: false } });
    await sw.from('todos').select('*').eq('id', 1);
    await sw.from('todos').select('*').eq('id', 1);
    check('cache:false → every read fetches (2)', rec.readCount() === 2);
  }

  /* ── opt-out level 2: per-query .fresh() bypasses the cache ── */
  console.log('opt-out: .fresh()');
  {
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.from('todos').select('*').eq('id', 1).fresh();
    await sw.from('todos').select('*').eq('id', 1).fresh();
    check('.fresh() → every read fetches (2)', rec.readCount() === 2);
  }
  {
    // .fresh() still warms the cache for subsequent NORMAL reads
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.from('todos').select('*').eq('id', 1).fresh(); // 1 fetch, warms cache
    await sw.from('todos').select('*').eq('id', 1); // cache hit → no fetch
    check('.fresh() warms cache → following normal read is a hit (1 fetch total)', rec.readCount() === 1);
  }

  /* ── prefetch: warm the cache ahead of need ── */
  console.log('prefetch');
  {
    const { sw, rec } = client({ create: { cache: { staleTime: 5000 } } });
    await sw.prefetch(sw.from('todos').select('*').eq('id', 7));
    const res = await sw.from('todos').select('*').eq('id', 7);
    check('prefetch warms cache → later read served from cache (1 fetch)', rec.readCount() === 1);
    check('prefetched read returns data', Array.isArray(res.data));
  }

  /* ── isolation: a cache hit must hand back a copy, not the stored object ── */
  console.log('no shared-mutation poisoning');
  {
    const { sw, rec } = client({
      recorder: { rows: [{ id: 1, name: 'A' }] },
      create: { cache: { staleTime: 5000 } },
    });
    const r1 = await sw.from('todos').select('*');
    r1.data[0].name = 'MUTATED';
    const r2 = await sw.from('todos').select('*');
    check('cache hit is isolated from caller mutation', r2.data[0].name === 'A');
    check('the mutation test stayed a cache hit (1 fetch)', rec.readCount() === 1);
  }

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('✅ all cache unit tests passed');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
