// Pure, no-network unit tests for the query-builder parity work
// (tsk_4a462e29): count modes (exact + head), nested FK select
// (belongs-to + has-many), and single() / maybeSingle().
//
//   npm run build && node test/unit-query-builder.mjs
//
// Every test drives the builder with a fetch double that replies based on
// the request body, so we exercise the real /db/query wire shape and the
// client-side embed stitching without touching the network.

import { createClient } from '../dist/esm/index.js';

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(`${name} (got ${a})`, a === e);
}

/** A fetch double whose responder sees the parsed request body. */
function makeClient(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    let body = null;
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method: init.method, body });
    const r = responder(body, url) ?? { json: { ok: true, data: [] } };
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const sw = createClient('https://demo.somewhere.tech', 'eyJ.jwt', { fetch: fetchImpl });
  return { sw, calls };
}
/** The platform wraps payloads as { ok, data: <payload> }; the SDK unwraps .data. */
const reply = (payload) => ({ json: { ok: true, data: payload } });

async function main() {
  /* ── count: 'exact' returns the total alongside the page ───────────── */
  console.log("select('*', { count: 'exact' })");
  {
    const { sw, calls } = makeClient((body) => {
      if (body.table === 'todos') return reply({ data: [{ id: 1 }, { id: 2 }], error: null, count: 42 });
      return reply({ data: [] });
    });
    const res = await sw.from('todos').select('*', { count: 'exact' }).eq('done', false).limit(2);
    const body = calls.at(-1).body;
    eq('body.count', body.count, 'exact');
    check('body has no head', body.head === undefined);
    eq('body.select', body.select, '*');
    eq('data is the page', res.data, [{ id: 1 }, { id: 2 }]);
    eq('count is the server total (not page len)', res.count, 42);
    check('no error', res.error === null);
  }

  /* ── count + head: count only, no rows ─────────────────────────────── */
  console.log("select('*', { count: 'exact', head: true })");
  {
    const { sw, calls } = makeClient((body) => {
      if (body.table === 'todos') return reply({ data: [], error: null, count: 42 });
      return reply({ data: [] });
    });
    const res = await sw.from('todos').select('*', { count: 'exact', head: true }).eq('done', false);
    const body = calls.at(-1).body;
    eq('body.count', body.count, 'exact');
    eq('body.head', body.head, true);
    check('data is null on head', res.data === null);
    eq('count present on head', res.count, 42);
    check('no error', res.error === null);
  }

  /* ── nested select: belongs-to (object embed) ──────────────────────── */
  console.log("select('*, customer(*)') — belongs-to");
  {
    const { sw, calls } = makeClient((body) => {
      if (body.table === 'orders') {
        return reply({ data: [
          { id: 1, customer_id: 10, total: 99 },
          { id: 2, customer_id: 11, total: 50 },
        ] });
      }
      if (body.table === 'customer') {
        return reply({ data: [
          { id: 10, name: 'Ann' },
          { id: 11, name: 'Bob' },
        ] });
      }
      return reply({ data: [] });
    });
    const res = await sw.from('orders').select('*, customer(*)');
    const baseCall = calls.find((c) => c.body.table === 'orders');
    const embedCall = calls.find((c) => c.body.table === 'customer');
    eq('base query sends select:* (embeds stripped)', baseCall.body.select, '*');
    check('embed fetched by id IN (...)', !!embedCall &&
      embedCall.body.filters?.some((f) => f.column === 'id' && f.op === 'in'));
    eq('embed fk values collected', embedCall.body.filters.find((f) => f.op === 'in').value, [10, 11]);
    eq('customer stitched as an object', res.data, [
      { id: 1, customer_id: 10, total: 99, customer: { id: 10, name: 'Ann' } },
      { id: 2, customer_id: 11, total: 50, customer: { id: 11, name: 'Bob' } },
    ]);
  }

  /* ── nested select: has-many (array embed) ─────────────────────────── */
  console.log("select('*, posts(*)') — has-many");
  {
    const { sw, calls } = makeClient((body) => {
      if (body.table === 'users') {
        return reply({ data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
      }
      if (body.table === 'posts') {
        return reply({ data: [
          { id: 11, user_id: 1, t: 'x' },
          { id: 12, user_id: 1, t: 'y' },
          { id: 13, user_id: 2, t: 'z' },
        ] });
      }
      return reply({ data: [] });
    });
    const res = await sw.from('users').select('*, posts(*)');
    const embedCall = calls.find((c) => c.body.table === 'posts');
    check('child fetched by <base-singular>_id IN (...)', !!embedCall &&
      embedCall.body.filters?.some((f) => f.column === 'user_id' && f.op === 'in'));
    eq('base ids collected', embedCall.body.filters.find((f) => f.op === 'in').value, [1, 2]);
    eq('posts stitched as arrays grouped by fk', res.data, [
      { id: 1, name: 'A', posts: [{ id: 11, user_id: 1, t: 'x' }, { id: 12, user_id: 1, t: 'y' }] },
      { id: 2, name: 'B', posts: [{ id: 13, user_id: 2, t: 'z' }] },
    ]);
  }

  /* ── nested select with alias + base column narrowing ──────────────── */
  console.log("select('id, buyer:customer(name)') — alias + narrowing");
  {
    const { sw, calls } = makeClient((body) => {
      if (body.table === 'orders') return reply({ data: [{ id: 1, customer_id: 10, total: 99 }] });
      if (body.table === 'customer') return reply({ data: [{ id: 10, name: 'Ann' }] });
      return reply({ data: [] });
    });
    const res = await sw.from('orders').select('id, buyer:customer(name)');
    const embedCall = calls.find((c) => c.body.table === 'customer');
    // 'id' is injected for stitching even though only 'name' was requested.
    eq('embed select injects id for the join', embedCall.body.select, 'name, id');
    eq('base narrowed to requested cols + alias; injected id stripped from embed', res.data, [
      { id: 1, buyer: { name: 'Ann' } },
    ]);
  }

  /* ── empty base rows → no embed query, empty result ────────────────── */
  console.log("select('*, posts(*)') with no base rows");
  {
    const { sw, calls } = makeClient((body) => {
      if (body.table === 'users') return reply({ data: [] });
      return reply({ data: [] });
    });
    const res = await sw.from('users').select('*, posts(*)');
    eq('data empty', res.data, []);
    check('no embed query issued', !calls.some((c) => c.body.table === 'posts'));
  }

  /* ── single() ──────────────────────────────────────────────────────── */
  console.log('single()');
  {
    const one = makeClient(() => reply({ data: [{ id: 7, name: 'X' }] }));
    const r1 = await one.sw.from('t').select('*').eq('id', 7).single();
    eq('one row → the object', r1.data, { id: 7, name: 'X' });
    check('no error', r1.error === null);

    const zero = makeClient(() => reply({ data: [] }));
    const r0 = await zero.sw.from('t').select('*').eq('id', 999).single();
    check('zero rows → PGRST116 error', r0.data === null && r0.error?.code === 'PGRST116');

    const many = makeClient(() => reply({ data: [{ id: 1 }, { id: 2 }] }));
    const rm = await many.sw.from('t').select('*').single();
    check('>1 row → PGRST116 error', rm.data === null && rm.error?.code === 'PGRST116');
  }

  /* ── maybeSingle() ─────────────────────────────────────────────────── */
  console.log('maybeSingle()');
  {
    const zero = makeClient(() => reply({ data: [] }));
    const r0 = await zero.sw.from('t').select('*').eq('id', 999).maybeSingle();
    check('zero rows → data null, no error', r0.data === null && r0.error === null);

    const one = makeClient(() => reply({ data: [{ id: 7 }] }));
    const r1 = await one.sw.from('t').select('*').eq('id', 7).maybeSingle();
    eq('one row → the object', r1.data, { id: 7 });
  }

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('✅ all query-builder parity unit tests passed');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
