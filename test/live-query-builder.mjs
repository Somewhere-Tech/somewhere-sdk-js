// Live smoke for the query-builder parity work against a throwaway project.
// Embeds + single()/maybeSingle() run entirely client-side over the
// already-deployed /db/query, so they verify NOW. Count/head need the
// (un-deployed) worker change, so they're reported as "pending deploy".
//
//   SMT_KEY=smt_... PROJECT_URL=https://sdk-query-scratch.somewhere.tech \
//     node test/live-query-builder.mjs

import { createClient } from '../dist/esm/index.js';

const KEY = process.env.SMT_KEY;
const URL = process.env.PROJECT_URL;
if (!KEY || !URL) {
  console.error('Set SMT_KEY and PROJECT_URL'); process.exit(2);
}
const sw = createClient(URL, KEY, process.env.SMT_PROJECT_ID ? { projectId: process.env.SMT_PROJECT_ID } : undefined);

let failures = 0;
const ok = (n, c) => { console.log(`  ${c ? '✓' : '✗'} ${n}`); if (!c) failures++; };
const J = (x) => JSON.stringify(x);

async function main() {
  console.log('has-many embed: users.select("*, posts(*)")');
  {
    const { data, error } = await sw.from('users').select('id, name, posts(id, title)').order('id');
    ok('no error: ' + (error?.message ?? ''), !error);
    const ann = data?.find((u) => u.id === 1);
    const bob = data?.find((u) => u.id === 2);
    const dan = data?.find((u) => u.id === 4);
    ok('Ann has 2 posts: ' + J(ann?.posts), ann?.posts?.length === 2);
    ok('Bob has 1 post', bob?.posts?.length === 1);
    ok('Dan (no posts) → empty array', Array.isArray(dan?.posts) && dan.posts.length === 0);
    ok('base narrowed: only id,name,posts kept: ' + J(Object.keys(ann ?? {})),
      ann && J(Object.keys(ann).sort()) === J(['id', 'name', 'posts']));
    ok('post narrowed to id,title: ' + J(ann?.posts?.[0]),
      ann?.posts?.[0] && J(Object.keys(ann.posts[0]).sort()) === J(['id', 'title']));
  }

  console.log('belongs-to embed: orders.select("*, customer(*)")');
  {
    const { data, error } = await sw.from('orders').select('*, customer(*)').order('id');
    ok('no error: ' + (error?.message ?? ''), !error);
    const o101 = data?.find((o) => o.id === 101);
    ok('order 101 customer is an object: ' + J(o101?.customer),
      o101?.customer && o101.customer.name === 'Acme');
    ok('order 103 → Globex', data?.find((o) => o.id === 103)?.customer?.name === 'Globex');
  }

  console.log('single() / maybeSingle()');
  {
    const one = await sw.from('users').select('*').eq('id', 1).single();
    ok('single() one row → object: ' + J(one.data), one.data?.name === 'Ann' && !one.error);
    const miss = await sw.from('users').select('*').eq('id', 999).maybeSingle();
    ok('maybeSingle() missing → null, no error', miss.data === null && !miss.error);
    const dup = await sw.from('users').select('*').single();
    ok('single() on many → PGRST116 error', dup.data === null && dup.error?.code === 'PGRST116');
  }

  console.log('count modes (pending worker deploy — reporting live behavior)');
  {
    const total = await sw.from('users').select('*', { count: 'exact' });
    console.log(`    count(no limit) = ${total.count} (expect 5)`);
    const paged = await sw.from('users').select('*', { count: 'exact' }).limit(2);
    console.log(`    count(limit 2) = ${paged.count} (expect 5 AFTER deploy; ${paged.data?.length} rows now)`);
    const head = await sw.from('users').select('*', { count: 'exact', head: true });
    console.log(`    head:true → data=${J(head.data)} count=${head.count} (expect data=null,count=5 AFTER deploy)`);
    ok('count(no-limit) already correct (=5)', total.count === 5);
  }

  console.log('');
  if (failures > 0) { console.error(`❌ ${failures} live assertion(s) failed`); process.exit(1); }
  console.log('✅ live embed + single/maybeSingle checks passed');
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });
