// Live smoke for the query-builder parity work against a throwaway project.
//
// single()/maybeSingle() shape rows client-side, so they verify NOW against
// the deployed worker. Nested FK select is now resolved SERVER-SIDE (the SDK
// sends the embed syntax verbatim), so it only works once the matching worker
// change is deployed — until then the deployed worker rejects the embed
// syntax; this script reports that rather than failing. Count(no-limit)
// verifies now; count(limit) is exact only after the worker deploys.
//
//   SMT_KEY=smt_... PROJECT_URL=https://<proj>.somewhere.tech \
//     SMT_PROJECT_ID=<uuid> node test/live-query-builder.mjs

import { createClient } from '../dist/esm/index.js';

const KEY = process.env.SMT_KEY;
const URL = process.env.PROJECT_URL;
if (!KEY || !URL) { console.error('Set SMT_KEY and PROJECT_URL'); process.exit(2); }
const sw = createClient(URL, KEY, process.env.SMT_PROJECT_ID ? { projectId: process.env.SMT_PROJECT_ID } : undefined);

let failures = 0;
const ok = (n, c) => { console.log(`  ${c ? '✓' : '✗'} ${n}`); if (!c) failures++; };
const J = (x) => JSON.stringify(x);

async function main() {
  console.log('single() / maybeSingle() — verify live (client-side shaping)');
  {
    const one = await sw.from('users').select('*').eq('id', 1).single();
    ok('single() one row → object: ' + J(one.data), one.data?.name === 'Ann' && !one.error);
    const miss = await sw.from('users').select('*').eq('id', 999).maybeSingle();
    ok('maybeSingle() missing → null, no error', miss.data === null && !miss.error);
    const dup = await sw.from('users').select('*').single();
    ok('single() on many → PGRST116 error', dup.data === null && dup.error?.code === 'PGRST116');
  }

  console.log('count(no-limit) — verify live');
  {
    const total = await sw.from('users').select('*', { count: 'exact' });
    ok('count(no-limit) = 5: ' + total.count, total.count === 5);
  }

  console.log('count(limit) + head — exact only AFTER worker deploy (reporting)');
  {
    const paged = await sw.from('users').select('*', { count: 'exact' }).limit(2);
    console.log(`    count(limit 2) = ${paged.count} → ${paged.data?.length} rows (expect count=5 AFTER deploy)`);
    const head = await sw.from('users').select('*', { count: 'exact', head: true });
    console.log(`    head:true → data=${J(head.data)} count=${head.count}`);
  }

  console.log('nested FK select — SERVER-SIDE; verifies only AFTER worker deploy (reporting)');
  {
    const hasMany = await sw.from('users').select('*, posts(*)').order('id');
    const belongsTo = await sw.from('orders').select('*, customer(*)').order('id');
    if (hasMany.error || belongsTo.error) {
      console.log(`    pending deploy — deployed worker rejects embed syntax: ${(hasMany.error || belongsTo.error)?.code}`);
    } else {
      const ann = hasMany.data?.find((u) => u.id === 1);
      ok('AFTER-DEPLOY: Ann has 2 posts: ' + J(ann?.posts), ann?.posts?.length === 2);
      ok('AFTER-DEPLOY: order 101 customer object', belongsTo.data?.find((o) => o.id === 101)?.customer?.name === 'Acme');
    }
  }

  console.log('');
  if (failures > 0) { console.error(`❌ ${failures} live assertion(s) failed`); process.exit(1); }
  console.log('✅ live single/maybeSingle + count(no-limit) checks passed (embeds + count(limit) pending worker deploy)');
}
main().catch((e) => { console.error('fatal:', e); process.exit(1); });
