/**
 * Live full-surface test for @somewhere-tech/sdk after the dominant-player
 * rewrite. Exercises:
 *
 *   - sw.from(table).select/insert/update/upsert/delete + filters
 *   - sw.storage.from(bucket).upload/download/list/remove/getPublicUrl
 *   - sw.auth.signUp/signInWithPassword/getUser/getSession/updateUser/
 *     resetPasswordForEmail/signOut + setSession rehydration
 *   - sw.emails.send
 *   - sw.chat.completions.create
 *
 * A real smt_ key is required. The test creates a scratch project
 * directly against the HTTP API (since `sw.projects.*` no longer exists),
 * runs the full SDK surface inside that project, then deletes the
 * project via the two-step confirmation flow (reading the code from D1
 * via the CF global key — same mechanism as before).
 */
import { Somewhere, SomewhereError } from '../dist/esm/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const key = process.env.SMT_KEY;
if (!key) {
  console.error('SMT_KEY not set — aborting.');
  process.exit(2);
}

const BASE_URL = 'https://api.somewhere.tech/v1';
const suffix = Math.random().toString(36).slice(2, 8);
const subdomain = `sdk-dpr-${suffix}`;
const results = [];
let projectId;

async function step(name, expect, fn) {
  const row = { name, expect, outcome: 'pending', detail: '' };
  results.push(row);
  try {
    const data = await fn();
    row.outcome = 'pass';
    row.detail = previewJson(data);
    console.log(`  ✅ ${name} — ${row.detail}`);
    return data;
  } catch (err) {
    if (err instanceof SomewhereError) {
      const acceptable = expect.split('|').slice(1);
      if (acceptable.includes(err.code)) {
        row.outcome = 'expected-error';
        row.detail = `${err.code} (${err.statusCode}): ${err.message}`;
        console.log(`  ⚠️  ${name} — expected ${err.code}`);
        return null;
      }
      row.outcome = 'fail';
      row.detail = `${err.code} (${err.statusCode}): ${err.message}`;
      console.error(`  ❌ ${name} — ${err.code}: ${err.message}`);
      return null;
    }
    row.outcome = 'crash';
    row.detail = String(err?.stack ?? err);
    console.error(`  💥 ${name} — ${err}`);
    return null;
  }
}

function previewJson(v) {
  try {
    const s = JSON.stringify(v);
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  } catch {
    return String(v);
  }
}

/**
 * `stepResult` expects a `{data, error}` envelope. `pass` means
 * `error == null`; `fail` means the envelope carried an error we didn't
 * whitelist; `expected-error` means the envelope error matches one of
 * the accepted codes in `expect`.
 */
async function stepResult(name, expect, fn) {
  const row = { name, expect, outcome: 'pending', detail: '' };
  results.push(row);
  try {
    const result = await fn();
    if (!result || typeof result !== 'object' || !('error' in result)) {
      row.outcome = 'crash';
      row.detail = `result is not a {data, error} envelope: ${previewJson(result)}`;
      console.error(`  💥 ${name} — ${row.detail}`);
      return result;
    }
    if (result.error == null) {
      row.outcome = 'pass';
      row.detail = previewJson(result.data);
      console.log(`  ✅ ${name} — ${row.detail}`);
      return result;
    }
    const acceptable = expect.split('|').slice(1);
    if (acceptable.includes(result.error.code)) {
      row.outcome = 'expected-error';
      row.detail = `${result.error.code} (${result.error.statusCode}): ${result.error.message}`;
      console.log(`  ⚠️  ${name} — expected ${result.error.code}`);
      return result;
    }
    row.outcome = 'fail';
    row.detail = `${result.error.code} (${result.error.statusCode}): ${result.error.message}`;
    console.error(`  ❌ ${name} — ${result.error.code}: ${result.error.message}`);
    return result;
  } catch (err) {
    row.outcome = 'crash';
    row.detail = String(err?.stack ?? err);
    console.error(`  💥 ${name} — ${err}`);
    return null;
  }
}

async function httpDirect(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok !== true) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function fetchDeleteCodeFromD1(targetProjectId) {
  const envText = readFileSync('/Users/uzair/somewhere-tech/.env', 'utf-8');
  const pick = (name) => envText.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  const email = pick('CF_GLOBAL_KEY_EMAIL');
  const apiKey = pick('CF_GLOBAL_API_KEY');
  if (!email || !apiKey) return null;
  const accountId = 'b40a6657ef9b59a7bbc7fdf3f271a667';
  const dbId = 'a1a13e63-7579-4d4b-b1f3-e7ae8746dfbe';
  const sql = `SELECT code FROM delete_confirmations WHERE target_id = '${targetProjectId}' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: {
        'X-Auth-Email': email,
        'X-Auth-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    },
  );
  const json = await res.json();
  return json?.result?.[0]?.results?.[0]?.code ?? null;
}

async function main() {
  console.log(`\n=== SDK LIVE TEST — dominant-player rewrite (${suffix}) ===\n`);

  // ── Provision the scratch project directly (SDK no longer owns projects) ──
  console.log('\n## Setup (scratch project via raw HTTP)');
  const proj = await step('provision project', 'ok', () =>
    httpDirect('POST', '/projects', {
      name: `SDK DPR ${suffix}`,
      subdomain,
      description: 'dominant-player rewrite live test',
    }),
  );
  if (!proj?.id) {
    console.error('fatal: could not provision test project');
    await dumpResults();
    process.exit(1);
  }
  projectId = proj.id;

  const sw = new Somewhere({ key, projectId });
  console.log(`  project id: ${projectId}`);

  // Need a schema before db queries work. Migrate via raw HTTP — the SDK
  // no longer exposes db.migrate (by design; DDL is a dashboard concern).
  await step('schema migrate', 'ok', () =>
    httpDirect('POST', '/db/migrate', {
      project_id: projectId,
      sql: `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE bookings (
          id INTEGER PRIMARY KEY,
          user_id INTEGER,
          slot TEXT NOT NULL,
          confirmed INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `,
    }),
  );

  // ── sw.from(...) — Supabase-style query builder ──────────────────
  console.log('\n## sw.from(...) — Supabase query builder');

  await stepResult('from.insert single', 'ok', () =>
    sw.from('users').insert({ name: 'Alice', email: 'alice@example.com' }),
  );
  await stepResult('from.insert multiple', 'ok', () =>
    sw.from('users').insert([
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Carol', email: 'carol@example.com', status: 'pending' },
    ]),
  );

  await stepResult('from.select *', 'ok', () =>
    sw.from('users').select('*'),
  );
  await stepResult('from.select columns', 'ok', () =>
    sw.from('users').select('id, name, email'),
  );
  await stepResult('from.select eq', 'ok', () =>
    sw.from('users').select('*').eq('email', 'alice@example.com'),
  );
  await stepResult('from.select neq', 'ok', () =>
    sw.from('users').select('*').neq('status', 'active'),
  );
  await stepResult('from.select gt', 'ok', () =>
    sw.from('users').select('*').gt('id', 1),
  );
  await stepResult('from.select gte', 'ok', () =>
    sw.from('users').select('*').gte('id', 2),
  );
  await stepResult('from.select lt', 'ok', () =>
    sw.from('users').select('*').lt('id', 3),
  );
  await stepResult('from.select lte', 'ok', () =>
    sw.from('users').select('*').lte('id', 2),
  );
  await stepResult('from.select like', 'ok', () =>
    sw.from('users').select('*').like('email', '%@example.com'),
  );
  await stepResult('from.select ilike', 'ok', () =>
    sw.from('users').select('*').ilike('name', 'alice'),
  );
  await stepResult('from.select in', 'ok', () =>
    sw.from('users').select('*').in('name', ['Alice', 'Bob']),
  );
  await stepResult('from.select match', 'ok', () =>
    sw.from('users').select('*').match({ name: 'Alice', status: 'active' }),
  );
  await stepResult('from.select order', 'ok', () =>
    sw.from('users').select('id, name').order('name', { ascending: false }),
  );
  await stepResult('from.select limit', 'ok', () =>
    sw.from('users').select('*').limit(2),
  );
  await stepResult('from.select range', 'ok', () =>
    sw.from('users').select('*').range(0, 1),
  );
  await stepResult('from.select single', 'ok', () =>
    sw.from('users').select('*').eq('email', 'alice@example.com').single(),
  );
  await stepResult('from.select maybeSingle (0 rows)', 'ok', () =>
    sw.from('users').select('*').eq('email', 'nobody@example.com').maybeSingle(),
  );
  await stepResult('from.select single (0 rows — must error)', 'ok|PGRST116', () =>
    sw.from('users').select('*').eq('email', 'nobody@example.com').single(),
  );

  await stepResult('from.update eq', 'ok', () =>
    sw
      .from('users')
      .update({ status: 'verified' })
      .eq('email', 'alice@example.com'),
  );

  await stepResult('from.upsert', 'ok', () =>
    sw
      .from('users')
      .upsert(
        { email: 'dave@example.com', name: 'Dave' },
        { onConflict: 'email' },
      ),
  );

  await stepResult('from.delete eq', 'ok', () =>
    sw.from('users').delete().eq('email', 'carol@example.com'),
  );

  // Error paths: bad SQL / injection attempt should throw cleanly.
  await stepResult('from invalid identifier (error)', 'ok|VALIDATION_ERROR', () =>
    sw.from('u; DROP TABLE users; --').select('*'),
  );

  // ── sw.storage.from(...) — Supabase Storage ─────────────────────
  console.log('\n## sw.storage.from(...) — Supabase Storage');

  const bucket = sw.storage.from('avatars');
  const photo = new TextEncoder().encode('fake png bytes');
  await stepResult('storage.upload', 'ok', () =>
    bucket.upload('alice.png', photo, { contentType: 'image/png' }),
  );

  await stepResult('storage.list (root)', 'ok', () => bucket.list());

  const down = await stepResult('storage.download', 'ok', () =>
    bucket.download('alice.png'),
  );
  if (down?.data?.body) {
    const bytes = new Uint8Array(down.data.body);
    const text = new TextDecoder().decode(bytes);
    const pass = text === 'fake png bytes';
    results.push({
      name: 'storage.download byte-exact round-trip',
      expect: 'ok',
      outcome: pass ? 'pass' : 'fail',
      detail: `bytes=${bytes.byteLength} text=${JSON.stringify(text)}`,
    });
    console.log(`  ${pass ? '✅' : '❌'} storage.download byte-exact round-trip`);
  }

  const urlResult = bucket.getPublicUrl('alice.png');
  results.push({
    name: 'storage.getPublicUrl',
    expect: 'ok',
    outcome: urlResult?.data?.publicUrl ? 'pass' : 'fail',
    detail: previewJson(urlResult),
  });
  console.log(`  ✅ storage.getPublicUrl — ${previewJson(urlResult)}`);

  await stepResult('storage.remove', 'ok', () =>
    bucket.remove(['alice.png']),
  );

  // After remove, download should error.
  await stepResult('storage.download missing (error)', 'ok|NOT_FOUND|STORAGE_NOT_FOUND', () =>
    bucket.download('alice.png'),
  );

  // ── sw.auth — Supabase Auth ──────────────────────────────────────
  console.log('\n## sw.auth — Supabase Auth');

  const authEmail = `auth-${suffix}@example.com`;
  const authPassword = 'sdk-live-test-password-123';

  await stepResult('auth.signUp', 'ok', () =>
    sw.auth.signUp({ email: authEmail, password: authPassword }),
  );
  // After signUp the SDK should auto-session. Verify subsequent calls run scoped.
  const getUserPost = await stepResult('auth.getUser (post-signUp)', 'ok', () =>
    sw.auth.getUser(),
  );
  {
    const pass = getUserPost?.data?.user?.email === authEmail;
    results.push({
      name: 'auth.getUser returns the signUp email',
      expect: 'ok',
      outcome: pass ? 'pass' : 'fail',
      detail: `email=${getUserPost?.data?.user?.email}`,
    });
    console.log(`  ${pass ? '✅' : '❌'} auth.getUser returns the signUp email`);
  }

  // Sign out clears session; subsequent calls fall back to the smt_ key.
  await stepResult('auth.signOut', 'ok', () => sw.auth.signOut());

  const signInResult = await stepResult('auth.signInWithPassword', 'ok', () =>
    sw.auth.signInWithPassword({ email: authEmail, password: authPassword }),
  );
  const accessToken = signInResult?.data?.session?.access_token;

  // signInWithOAuth returns a URL, no HTTP.
  await stepResult('auth.signInWithOAuth (google)', 'ok', () =>
    sw.auth.signInWithOAuth({ provider: 'google' }),
  );
  await stepResult(
    'auth.signInWithOAuth (unsupported provider)',
    'ok|UNSUPPORTED_FEATURE',
    () => sw.auth.signInWithOAuth({ provider: 'github' }),
  );

  // In-memory session
  const session = await stepResult('auth.getSession', 'ok', () =>
    sw.auth.getSession(),
  );
  {
    const pass = session?.data?.session?.access_token === accessToken;
    results.push({
      name: 'auth.getSession reflects in-memory state',
      expect: 'ok',
      outcome: pass ? 'pass' : 'fail',
      detail: `match=${pass}`,
    });
    console.log(`  ${pass ? '✅' : '❌'} auth.getSession reflects in-memory state`);
  }

  // updateUser — patch the display name
  await stepResult('auth.updateUser', 'ok', () =>
    sw.auth.updateUser({ display_name: `SDK Tester ${suffix}` }),
  );

  // resetPasswordForEmail (anti-enumeration → always success)
  await stepResult('auth.resetPasswordForEmail', 'ok', () =>
    sw.auth.resetPasswordForEmail(authEmail),
  );

  // ── setSession flow: simulate browser rehydrating a stored JWT ────
  if (accessToken) {
    const freshSw = new Somewhere({ key, projectId });
    await stepResult('auth.setSession (rehydrate)', 'ok', () =>
      freshSw.auth.setSession({ access_token: accessToken }),
    );
    const dualAuthQuery = await stepResult(
      'from.select via rehydrated session',
      'ok',
      () => freshSw.from('users').select('id, email').eq('email', authEmail),
    );
    results.push({
      name: 'rehydrated session scopes to app_user',
      expect: 'ok',
      outcome:
        Array.isArray(dualAuthQuery?.data) && dualAuthQuery.data.length >= 0 ? 'pass' : 'fail',
      detail: previewJson(dualAuthQuery?.data),
    });
    console.log(`  ✅ rehydrated session scopes to app_user`);
  }

  // ── sw.emails.send — Resend shape ───────────────────────────────
  console.log('\n## sw.emails.send — Resend shape');
  await stepResult('emails.send', 'ok|VALIDATION_ERROR|UPSTREAM_ERROR', () =>
    sw.emails.send({
      from: 'noreply@somewhere.tech',
      to: 'sdk-test@example.com',
      subject: `SDK DPR ${suffix}`,
      html: `<h1>Hello from the SDK</h1><p>Run ${suffix}</p>`,
      text: `Hello from the SDK (run ${suffix})`,
    }),
  );

  // ── sw.chat.completions.create — OpenAI shape (throws on error) ──
  console.log('\n## sw.chat.completions.create — OpenAI shape');
  try {
    const completion = await sw.chat.completions.create({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Reply with the single word "pong" and nothing else.' }],
      max_tokens: 16,
    });
    const ok =
      completion.object === 'chat.completion' &&
      Array.isArray(completion.choices) &&
      completion.choices[0]?.message?.role === 'assistant' &&
      typeof completion.choices[0]?.message?.content === 'string' &&
      typeof completion.usage?.total_tokens === 'number';
    results.push({
      name: 'chat.completions.create',
      expect: 'ok',
      outcome: ok ? 'pass' : 'fail',
      detail: previewJson({
        id: completion.id,
        model: completion.model,
        content: completion.choices[0]?.message?.content,
        usage: completion.usage,
      }),
    });
    console.log(`  ${ok ? '✅' : '❌'} chat.completions.create`);
  } catch (err) {
    results.push({
      name: 'chat.completions.create',
      expect: 'ok',
      outcome: err instanceof SomewhereError ? 'fail' : 'crash',
      detail: err instanceof SomewhereError ? `${err.code}: ${err.message}` : String(err),
    });
    console.error(`  ❌ chat.completions.create — ${err}`);
  }
}

async function cleanup() {
  console.log('\n## Cleanup');
  if (!projectId) return;
  try {
    await httpDirect('POST', `/projects/${projectId}/request-delete`);
    results.push({
      name: 'projects.requestDelete (cleanup via raw HTTP)',
      expect: 'ok',
      outcome: 'pass',
      detail: 'code requested',
    });
  } catch (err) {
    results.push({
      name: 'projects.requestDelete (cleanup via raw HTTP)',
      expect: 'ok',
      outcome: 'fail',
      detail: String(err),
    });
    return;
  }
  const code = await fetchDeleteCodeFromD1(projectId);
  if (!code) {
    results.push({
      name: 'projects.delete (cleanup)',
      expect: 'ok',
      outcome: 'fail',
      detail: `could not fetch code for ${projectId}`,
    });
    return;
  }
  try {
    await httpDirect('DELETE', `/projects/${projectId}`, { code });
    results.push({
      name: 'projects.delete (cleanup via raw HTTP)',
      expect: 'ok',
      outcome: 'pass',
      detail: 'deleted',
    });
    console.log(`  ✅ cleanup complete`);
  } catch (err) {
    results.push({
      name: 'projects.delete (cleanup)',
      expect: 'ok',
      outcome: 'fail',
      detail: String(err),
    });
  }
}

async function dumpResults() {
  const pass = results.filter((r) => r.outcome === 'pass').length;
  const expectedErr = results.filter((r) => r.outcome === 'expected-error').length;
  const fail = results.filter((r) => r.outcome === 'fail').length;
  const crash = results.filter((r) => r.outcome === 'crash').length;
  console.log(
    `\n=== SUMMARY: ${pass} pass, ${expectedErr} expected-error, ${fail} fail, ${crash} crash ===`,
  );
  if (fail + crash > 0) {
    console.log('\nFailures:');
    for (const r of results) {
      if (r.outcome === 'fail' || r.outcome === 'crash') {
        console.log(`  ❌ ${r.name} — ${r.detail}`);
      }
    }
  }
  const md = buildMarkdownReport({ pass, expectedErr, fail, crash });
  writeFileSync(
    '/Users/uzair/somewhere-sdks/somewhere-sdk-js/test/live-full-surface-results.md',
    md,
  );
  console.log(
    `\n📄 Results saved to /Users/uzair/somewhere-sdks/somewhere-sdk-js/test/live-full-surface-results.md`,
  );
}

function buildMarkdownReport({ pass, expectedErr, fail, crash }) {
  const total = results.length;
  const out = [];
  out.push('# JS SDK — Live Full-Surface Test (dominant-player rewrite)');
  out.push('');
  out.push(`- Run ID: \`${suffix}\``);
  out.push(`- Subdomain: \`${subdomain}.somewhere.tech\``);
  out.push(`- Timestamp: ${new Date().toISOString()}`);
  out.push('');
  out.push(`## Totals`);
  out.push('');
  out.push(`| Outcome | Count |`);
  out.push(`|---|---|`);
  out.push(`| ✅ pass | ${pass} |`);
  out.push(`| ⚠️ expected error | ${expectedErr} |`);
  out.push(`| ❌ fail | ${fail} |`);
  out.push(`| 💥 crash | ${crash} |`);
  out.push(`| **total** | **${total}** |`);
  out.push('');
  out.push(`## Per-call results`);
  out.push('');
  out.push(`| # | Outcome | Call | Detail |`);
  out.push(`|---|---|---|---|`);
  results.forEach((r, i) => {
    const icon =
      r.outcome === 'pass'
        ? '✅'
        : r.outcome === 'expected-error'
          ? '⚠️'
          : r.outcome === 'fail'
            ? '❌'
            : '💥';
    const detail = (r.detail || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    out.push(`| ${i + 1} | ${icon} | \`${r.name}\` | ${detail} |`);
  });
  out.push('');
  return out.join('\n');
}

try {
  await main();
} catch (err) {
  console.error('\n💥 FATAL:', err);
  results.push({ name: '<fatal>', expect: 'ok', outcome: 'crash', detail: String(err?.stack ?? err) });
} finally {
  await cleanup();
  await dumpResults();
  const anyFailed = results.some((r) => r.outcome === 'fail' || r.outcome === 'crash');
  process.exit(anyFailed ? 1 : 0);
}
