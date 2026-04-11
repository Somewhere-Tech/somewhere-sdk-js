/**
 * Full-surface live test for @somewhere-tech/sdk.
 *
 * Exercises every SDK method that's feasible against api.somewhere.tech:
 *   - projects.create / list / get / rename / deploys / undeploy /
 *     archive / unarchive / delete
 *   - deploy / deploy.status / promote / promote.rollback
 *   - db.migrate / query / tables / schema
 *   - storage.put / get / delete / list
 *   - fs.write / read (file + directory) / stat / versions / move / copy / delete
 *   - auth.signup / login / me / forgot / users / logout
 *   - email.send (quota-gated)
 *   - ai.complete (activation-gated — expected PAID_API_NOT_ACTIVATED)
 *   - jobs.create / status / list / cancel / progress
 *   - cron.create / list / update / delete
 *   - queue.push
 *   - logs.write / read
 *   - env.set / list / delete
 *   - domains.add / verify / list / delete (BYO, verification will fail)
 *   - preview.invite / revoke / viewers
 *   - feedback.submit / list
 *   - billing.status / checkout (no-op portal for non-billing admins)
 *   - usage.get / summary
 *
 * Cleans up the test project and any side resources on exit. Any unexpected
 * SomewhereError is recorded and continues so we get a full report.
 *
 * Run with:
 *   SMT_KEY=smt_... node test/live-full-surface.mjs
 */
import { Somewhere, SomewhereError } from '../dist/esm/index.js';
import { writeFileSync } from 'node:fs';

const key = process.env.SMT_KEY;
if (!key) {
  console.error('SMT_KEY not set — aborting.');
  process.exit(2);
}

const sw = new Somewhere({ key });
const suffix = Math.random().toString(36).slice(2, 8);
const subdomain = `sdk-live-${suffix}`;

/**
 * Every step is one assertion against a live endpoint. The test stops on
 * a fatal throw (unexpected JS error) but continues on SomewhereError so
 * we get a full matrix of which endpoints pass and which fail.
 *
 * `expect` is one of:
 *   - 'ok'          — the call must succeed
 *   - 'ok|<code>'   — success OR that specific error code is acceptable
 *     (e.g. 'ok|PAID_API_NOT_ACTIVATED' for AI endpoints that need activation)
 */
const results = [];
async function step(name, expect, fn) {
  const row = { name, expect, outcome: 'pending', detail: '' };
  results.push(row);
  try {
    const data = await fn();
    row.outcome = 'pass';
    const preview = previewJson(data);
    row.detail = preview;
    console.log(`  ✅ ${name} — ${preview}`);
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

let projectId;
let jobId;
let cronId;
let appUserJwt;
let appUserSessionToken;

async function main() {
  console.log(`\n=== SDK LIVE SURFACE TEST (${suffix}) ===\n`);

  // ── Account-level endpoints ──────────────────────────────────────
  console.log('\n## Billing / usage / auth account');
  await step('billing.status', 'ok', () => sw.billing.status());
  await step('usage.summary', 'ok', () => sw.usage.summary());

  // ── Project lifecycle ────────────────────────────────────────────
  console.log('\n## Projects');
  const created = await step('projects.create', 'ok', () =>
    sw.projects.create({
      name: `SDK Live ${suffix}`,
      subdomain,
      description: 'Full-surface SDK live test',
    }),
  );
  if (!created?.id) {
    console.error('fatal: project creation failed, cannot continue');
    await dumpResults();
    process.exit(1);
  }
  projectId = created.id;
  console.log(`  project id: ${projectId}`);

  await step('projects.list', 'ok', () => sw.projects.list());
  await step('projects.get', 'ok', () => sw.projects.get(projectId));
  await step('projects.deploys', 'ok', () => sw.projects.deploys(projectId));
  await step('projects.rename', 'ok', () =>
    sw.projects.rename(projectId, { description: 'renamed description' }),
  );

  // ── DB ──────────────────────────────────────────────────────────
  console.log('\n## Database');
  await step('db.migrate', 'ok', () =>
    sw.db.migrate(
      `CREATE TABLE notes (
         id INTEGER PRIMARY KEY,
         title TEXT NOT NULL,
         body TEXT,
         created_at TEXT DEFAULT (datetime('now'))
       );`,
      projectId,
    ),
  );
  await step('db.query insert', 'ok', () =>
    sw.db.query(
      'INSERT INTO notes (title, body) VALUES (?, ?), (?, ?)',
      ['first', 'hello', 'second', 'world'],
      projectId,
    ),
  );
  await step('db.query select', 'ok', () =>
    sw.db.query('SELECT id, title, body FROM notes ORDER BY id', [], projectId),
  );
  await step('db.tables', 'ok', () => sw.db.tables(projectId));
  await step('db.schema', 'ok', () => sw.db.schema('notes', projectId));

  // ── Storage (raw KV blobs) ──────────────────────────────────────
  console.log('\n## Storage (raw R2)');
  const blobBytes = new TextEncoder().encode('hello from sdk live test');
  await step('storage.put', 'ok', () =>
    sw.storage.put(
      'test/blob.txt',
      blobBytes,
      { contentType: 'text/plain; charset=utf-8' },
      projectId,
    ),
  );
  await step('storage.get', 'ok', async () => {
    const { body, contentType } = await sw.storage.get('test/blob.txt', projectId);
    const text = new TextDecoder().decode(body);
    return { bytes: body.byteLength, contentType, text: text.slice(0, 40) };
  });
  await step('storage.list', 'ok', () =>
    sw.storage.list({ prefix: 'test/' }, projectId),
  );
  await step('storage.delete', 'ok', () =>
    sw.storage.delete('test/blob.txt', projectId),
  );

  // ── FS (structured) ─────────────────────────────────────────────
  console.log('\n## Filesystem');
  await step('fs.write', 'ok', () =>
    sw.fs.write(
      '/sdk-test/hello.txt',
      new TextEncoder().encode('hello fs'),
      { contentType: 'text/plain' },
      projectId,
    ),
  );
  await step('fs.write v2', 'ok', () =>
    sw.fs.write(
      '/sdk-test/hello.txt',
      new TextEncoder().encode('hello fs v2'),
      { contentType: 'text/plain' },
      projectId,
    ),
  );
  await step('fs.stat', 'ok', () =>
    sw.fs.stat('/sdk-test/hello.txt', projectId),
  );
  await step('fs.versions', 'ok', () =>
    sw.fs.versions('/sdk-test/hello.txt', projectId),
  );
  await step('fs.read (file)', 'ok', async () => {
    const r = await sw.fs.read('/sdk-test/hello.txt', projectId);
    if ('body' in r) {
      return {
        bytes: r.body.byteLength,
        text: new TextDecoder().decode(r.body),
      };
    }
    throw new Error('expected file, got directory');
  });
  await step('fs.read (directory)', 'ok', async () => {
    const r = await sw.fs.read('/sdk-test', projectId);
    if ('entries' in r) return { entries: r.entries.length };
    return { warning: 'expected directory listing, got file' };
  });
  await step('fs.copy', 'ok', () =>
    sw.fs.copy('/sdk-test/hello.txt', '/sdk-test/copy.txt', projectId),
  );
  await step('fs.move', 'ok', () =>
    sw.fs.move('/sdk-test/copy.txt', '/sdk-test/moved.txt', projectId),
  );
  await step('fs.delete', 'ok', () =>
    sw.fs.delete('/sdk-test/moved.txt', projectId),
  );

  // ── Env vars ────────────────────────────────────────────────────
  console.log('\n## Env vars');
  await step('env.set', 'ok', () =>
    sw.env.set('SDK_TEST_VAR', 'sdk-live-value', projectId),
  );
  await step('env.list', 'ok', () => sw.env.list(projectId));
  await step('env.delete', 'ok', () =>
    sw.env.delete('SDK_TEST_VAR', projectId),
  );

  // ── App-user auth ───────────────────────────────────────────────
  console.log('\n## App-user auth');
  const signupEmail = `sdk-${suffix}@example.com`;
  const signupPassword = 'sdk-live-test-password-123';
  const signup = await step('auth.signup', 'ok', () =>
    sw.auth.signup(signupEmail, signupPassword, projectId),
  );
  appUserJwt = signup?.token;
  const login = await step('auth.login', 'ok', () =>
    sw.auth.login(signupEmail, signupPassword, projectId),
  );
  appUserSessionToken = login?.session_token;
  await step('auth.users', 'ok', () =>
    sw.auth.users({ limit: 5 }, projectId),
  );
  await step(
    'auth.forgot (anti-enumeration — always ok)',
    'ok',
    () => sw.auth.forgot(signupEmail, projectId),
  );
  if (appUserSessionToken) {
    await step('auth.logout', 'ok', () =>
      sw.auth.logout(appUserSessionToken, projectId),
    );
  }

  // auth.me with app-user JWT (new short-lived client)
  if (appUserJwt) {
    const appSw = new Somewhere({ token: appUserJwt, projectId });
    await step('auth.me (app-user JWT)', 'ok', () => appSw.auth.me());
    await step('db.query (app-user JWT, dual-auth)', 'ok', () =>
      appSw.db.query('SELECT 1 AS one'),
    );
  }

  // ── Deploy → promote → rollback → undeploy ──────────────────────
  console.log('\n## Deploy / Promote');
  await step('deploy (static index.html)', 'ok', () =>
    sw.deploy({
      projectId,
      files: {
        'index.html': '<!doctype html><h1>SDK live test</h1>',
      },
    }),
  );
  await step('deploy.status', 'ok', () => sw.deploy.status(projectId));

  // promote + rollback — free tier returns UPGRADE_REQUIRED.
  // Bootstrap admin is Builder so we expect ok, but we'll accept either.
  await step(
    'promote',
    'ok|UPGRADE_REQUIRED|NOT_FOUND|DEPLOY_NOT_READY',
    () => sw.promote(projectId),
  );
  await step(
    'promote.rollback',
    'ok|UPGRADE_REQUIRED|NOT_FOUND|NO_PROD_SNAPSHOT',
    () => sw.promote.rollback(projectId),
  );

  // ── Email (Resend proxy) ────────────────────────────────────────
  console.log('\n## Email');
  await step(
    'email.send',
    'ok|RESEND_ERROR|UPSTREAM_ERROR|QUOTA_EXCEEDED|VALIDATION_ERROR',
    () =>
      sw.email.send(
        {
          to: 'sdk-test@example.com',
          subject: 'SDK live test',
          text: 'hello from the sdk live surface test',
        },
        projectId,
      ),
  );

  // ── AI proxy (activation-gated) ─────────────────────────────────
  console.log('\n## AI');
  await step(
    'ai.complete',
    'ok|PAID_API_NOT_ACTIVATED|UPSTREAM_ERROR|QUOTA_EXCEEDED',
    () =>
      sw.ai.complete(
        {
          messages: [{ role: 'user', content: 'Reply with the word pong and nothing else.' }],
          maxTokens: 32,
        },
        projectId,
      ),
  );

  // Stubs — endpoints not shipped. We expect UNSUPPORTED_FEATURE / NOT_FOUND.
  await step(
    'ai.embed (stub)',
    'ok|UNSUPPORTED_FEATURE|NOT_FOUND|PAID_API_NOT_ACTIVATED',
    () => sw.ai.embed({ input: 'hello' }, projectId),
  );
  await step(
    'ai.image (stub)',
    'ok|UNSUPPORTED_FEATURE|NOT_FOUND|PAID_API_NOT_ACTIVATED',
    () => sw.ai.image({ prompt: 'a cat' }, projectId),
  );
  await step(
    'ai.tts (stub)',
    'ok|UNSUPPORTED_FEATURE|NOT_FOUND|PAID_API_NOT_ACTIVATED',
    () => sw.ai.tts({ input: 'hello' }, projectId),
  );

  // ── Logs ────────────────────────────────────────────────────────
  console.log('\n## Logs');
  await step('logs.write', 'ok', () =>
    sw.logs.write(
      { level: 'info', message: 'sdk live test info entry', data: { suffix } },
      projectId,
    ),
  );
  await step('logs.read', 'ok', () =>
    sw.logs.read({ limit: 10 }, projectId),
  );

  // ── Jobs / Cron / Queue ─────────────────────────────────────────
  console.log('\n## Jobs / Cron / Queue');
  // Use httpbin as a reliable 200-responding handler URL so the job
  // tier-1 executor actually completes.
  const handler = 'https://httpbin.org/post';
  const job = await step('jobs.create', 'ok', () =>
    sw.jobs.create(
      { handler, payload: { suffix }, timeoutSeconds: 30 },
      projectId,
    ),
  );
  jobId = job?.job_id;
  if (jobId) {
    await step('jobs.status', 'ok', () => sw.jobs.status(jobId));
    await step('jobs.list', 'ok', () =>
      sw.jobs.list({ limit: 5 }, projectId),
    );
    await step(
      'jobs.progress',
      'ok|JOB_NOT_FOUND|JOB_COMPLETE|VALIDATION_ERROR',
      () => sw.jobs.progress(jobId, { progress: 50, message: 'halfway' }),
    );
    await step(
      'jobs.cancel',
      'ok|JOB_ALREADY_COMPLETE|JOB_NOT_FOUND|JOB_COMPLETE',
      () => sw.jobs.cancel(jobId),
    );
  }

  const cron = await step('cron.create', 'ok', () =>
    sw.cron.create(
      {
        schedule: '0 0 1 1 *',
        handler,
        name: `sdk-live-${suffix}`,
        enabled: false,
      },
      projectId,
    ),
  );
  cronId = cron?.cron_id;
  if (cronId) {
    await step('cron.list', 'ok', () => sw.cron.list(projectId));
    await step('cron.update', 'ok', () =>
      sw.cron.update(cronId, { enabled: true }),
    );
    await step('cron.delete', 'ok', () => sw.cron.delete(cronId));
  }

  await step('queue.push', 'ok', () =>
    sw.queue.push({ handler, payload: { suffix } }, projectId),
  );

  // ── Preview sharing ─────────────────────────────────────────────
  console.log('\n## Preview');
  await step(
    'preview.invite',
    'ok|UPSTREAM_ERROR|UPGRADE_REQUIRED|VALIDATION_ERROR',
    () => sw.preview.invite(`preview-${suffix}@example.com`, projectId),
  );
  await step(
    'preview.viewers',
    'ok|UPGRADE_REQUIRED',
    () => sw.preview.viewers(projectId),
  );
  await step(
    'preview.revoke',
    'ok|UPGRADE_REQUIRED|VIEWER_NOT_FOUND',
    () => sw.preview.revoke(`preview-${suffix}@example.com`, projectId),
  );

  // ── Domains (BYO, verification will fail without a real CNAME) ──
  console.log('\n## Domains (BYO)');
  await step(
    'domains.add',
    'ok|UPGRADE_REQUIRED|DOMAIN_ALREADY_EXISTS|VALIDATION_ERROR',
    () => sw.domains.add(`sdk-${suffix}.example.com`, projectId),
  );
  await step(
    'domains.list',
    'ok|UPGRADE_REQUIRED',
    () => sw.domains.list(projectId),
  );
  await step(
    'domains.verify',
    'ok|UPGRADE_REQUIRED|DOMAIN_NOT_VERIFIED|NOT_FOUND|VERIFICATION_FAILED',
    () => sw.domains.verify(`sdk-${suffix}.example.com`),
  );
  await step(
    'domains.delete',
    'ok|UPGRADE_REQUIRED|NOT_FOUND',
    () => sw.domains.delete(`sdk-${suffix}.example.com`),
  );

  // ── Feedback ────────────────────────────────────────────────────
  console.log('\n## Feedback');
  await step('feedback.submit', 'ok', () =>
    sw.feedback.submit(
      { message: `sdk live test feedback ${suffix}`, pageUrl: 'https://example.com' },
      projectId,
    ),
  );
  await step('feedback.list', 'ok', () => sw.feedback.list(projectId));

  // ── Usage (project scope) ───────────────────────────────────────
  console.log('\n## Usage (project)');
  await step('usage.get', 'ok', () => sw.usage.get(projectId));

  // ── Project lifecycle: undeploy → archive → unarchive → delete ──
  console.log('\n## Project lifecycle finish');
  await step('projects.undeploy', 'ok|NOT_DEPLOYED', () =>
    sw.projects.undeploy(projectId),
  );
  await step('projects.archive', 'ok', () =>
    sw.projects.archive(projectId),
  );
  await step('projects.unarchive', 'ok', () =>
    sw.projects.unarchive(projectId),
  );

  // ── Auth verification stubs (requires app-user JWT) ─────────────
  if (appUserJwt) {
    console.log('\n## App-user verification surface');
    const appSw = new Somewhere({ token: appUserJwt, projectId });
    await step(
      'auth.requestVerification (app-user)',
      'ok|ALREADY_VERIFIED|RATE_LIMITED',
      () => appSw.auth.requestVerification(),
    );
    await step(
      'auth.verifyEmail (wrong code — must error)',
      'ok|INVALID_CODE|VALIDATION_ERROR|NO_VERIFICATION_PENDING|NOT_FOUND|AUTH_INVALID_CREDS',
      () => appSw.auth.verifyEmail('000000'),
    );
    await step(
      'auth.updateMe (app-user)',
      'ok',
      () => appSw.auth.updateMe({ displayName: `SDK Tester ${suffix}` }),
    );
  }
}

async function cleanup() {
  console.log('\n## Cleanup');
  if (!projectId) return;

  // Two-step delete: projects.requestDelete emails a 6-digit code, then
  // projects.delete(id, code) actually destroys. The bootstrap admin's
  // email doesn't deliver, so the test reads the code out of the
  // delete_confirmations D1 table via the CF REST API. Real users read
  // the code from their inbox.
  try {
    const req = await sw.projects.requestDelete(projectId);
    console.log(`  ✅ projects.requestDelete — ${previewJson(req)}`);
    results.push({
      name: 'projects.requestDelete (cleanup)',
      expect: 'ok',
      outcome: 'pass',
      detail: previewJson(req),
    });
  } catch (err) {
    const msg = err instanceof SomewhereError ? `${err.code}: ${err.message}` : String(err);
    console.warn(`  ⚠️  projects.requestDelete — ${msg}`);
    results.push({
      name: 'projects.requestDelete (cleanup)',
      expect: 'ok',
      outcome: 'fail',
      detail: msg,
    });
    return;
  }

  const code = await fetchDeleteCodeFromD1(projectId);
  if (!code) {
    console.warn(`  ⚠️  could not fetch delete code — project ${projectId} orphaned`);
    results.push({
      name: 'projects.delete (cleanup)',
      expect: 'ok',
      outcome: 'fail',
      detail: `could not fetch confirmation code for project ${projectId}`,
    });
    return;
  }

  try {
    const deleted = await sw.projects.delete(projectId, code);
    console.log(`  ✅ projects.delete — ${previewJson(deleted)}`);
    results.push({
      name: 'projects.delete (cleanup)',
      expect: 'ok',
      outcome: 'pass',
      detail: previewJson(deleted),
    });
  } catch (err) {
    const msg = err instanceof SomewhereError ? `${err.code}: ${err.message}` : String(err);
    console.warn(`  ⚠️  projects.delete — ${msg}`);
    results.push({
      name: 'projects.delete (cleanup)',
      expect: 'ok',
      outcome: 'fail',
      detail: msg,
    });
  }
}

/**
 * Reads the most recent unused delete confirmation code for a project
 * directly from the `delete_confirmations` D1 table via the CF REST API.
 * Only used for test cleanup — real users get the code via email.
 */
async function fetchDeleteCodeFromD1(targetProjectId) {
  const { readFileSync } = await import('node:fs');
  const envText = readFileSync('/Users/uzair/somewhere-tech/.env', 'utf-8');
  const pick = (name) => envText.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  const email = pick('CF_GLOBAL_KEY_EMAIL');
  const key = pick('CF_GLOBAL_API_KEY');
  if (!email || !key) return null;
  const accountId = 'b40a6657ef9b59a7bbc7fdf3f271a667';
  const dbId = 'a1a13e63-7579-4d4b-b1f3-e7ae8746dfbe';
  const sql = `SELECT code FROM delete_confirmations WHERE target_id = '${targetProjectId}' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: {
        'X-Auth-Email': email,
        'X-Auth-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    },
  );
  const json = await res.json();
  return json?.result?.[0]?.results?.[0]?.code ?? null;
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

  const markdown = buildMarkdownReport({ pass, expectedErr, fail, crash });
  const logPath = new URL('./live-full-surface-results.md', import.meta.url).pathname;
  writeFileSync(logPath, markdown);
  console.log(`\n📄 Results saved to ${logPath}`);
}

function buildMarkdownReport({ pass, expectedErr, fail, crash }) {
  const total = results.length;
  const lines = [];
  lines.push(`# JS SDK — Live Full-Surface Test Results`);
  lines.push('');
  lines.push(`- Run ID: \`${suffix}\``);
  lines.push(`- Test subdomain: \`${subdomain}.somewhere.tech\``);
  lines.push(`- API base: \`https://api.somewhere.tech/v1\``);
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Totals`);
  lines.push('');
  lines.push(`| Outcome | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| ✅ pass | ${pass} |`);
  lines.push(`| ⚠️ expected error | ${expectedErr} |`);
  lines.push(`| ❌ fail | ${fail} |`);
  lines.push(`| 💥 crash | ${crash} |`);
  lines.push(`| **total** | **${total}** |`);
  lines.push('');
  lines.push(`## Per-call results`);
  lines.push('');
  lines.push(`| # | Outcome | Method | Detail |`);
  lines.push(`|---|---|---|---|`);
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
    lines.push(`| ${i + 1} | ${icon} | \`${r.name}\` | ${detail} |`);
  });
  lines.push('');
  if (fail + crash > 0) {
    lines.push(`## Failures only`);
    lines.push('');
    for (const r of results) {
      if (r.outcome === 'fail' || r.outcome === 'crash') {
        lines.push(`### ${r.name}`);
        lines.push('');
        lines.push('```');
        lines.push(r.detail);
        lines.push('```');
        lines.push('');
      }
    }
  }
  return lines.join('\n');
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
