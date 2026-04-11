/**
 * Smoke test: exercises the full create → deploy → query → cleanup loop
 * against the live api.somewhere.tech API.
 *
 * Run with:
 *   SMT_KEY=smt_... npm test
 *
 * Skipped if SMT_KEY isn't set, so CI on a clean checkout stays green.
 */
import { Somewhere, SomewhereError } from '../src/index.js';

const key = process.env.SMT_KEY;
if (!key) {
  console.log('SMT_KEY not set — skipping live API test.');
  process.exit(0);
}

const sw = new Somewhere({ key });

async function main() {
  console.log('→ creating test project');
  const suffix = Math.random().toString(36).slice(2, 8);
  const project = await sw.projects.create({
    name: `SDK Smoke ${suffix}`,
    subdomain: `sdk-smoke-${suffix}`,
  });
  console.log('  created', project.id, project.subdomain);

  try {
    console.log('→ running migration');
    await sw.db.migrate(
      `CREATE TABLE IF NOT EXISTS notes (
         id INTEGER PRIMARY KEY,
         body TEXT NOT NULL,
         created_at TEXT DEFAULT (datetime('now'))
       );`,
      project.id,
    );

    console.log('→ inserting row');
    await sw.db.query(
      'INSERT INTO notes (body) VALUES (?)',
      ['hello from the sdk smoke test'],
      project.id,
    );

    console.log('→ reading rows');
    const result = await sw.db.query<{ id: number; body: string }>(
      'SELECT id, body FROM notes ORDER BY id DESC LIMIT 5',
      [],
      project.id,
    );
    console.log('  rows:', result.rows);

    console.log('→ deploying a static file');
    const deployResult = await sw.deploy({
      projectId: project.id,
      files: {
        'index.html': '<h1>hello from the sdk smoke test</h1>',
      },
    });
    console.log('  deployed to', deployResult.url);

    console.log('✅ smoke test passed');
  } catch (err) {
    if (err instanceof SomewhereError) {
      console.error(
        `❌ API error [${err.code}] ${err.message} (HTTP ${err.statusCode})`,
      );
    } else {
      console.error('❌ unexpected error:', err);
    }
    process.exitCode = 1;
  } finally {
    console.log('→ cleaning up: deleting project');
    try {
      await sw.projects.delete(project.id);
      console.log('  deleted');
    } catch (err) {
      console.warn('  cleanup failed (ignore if already deleted):', err);
    }
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
