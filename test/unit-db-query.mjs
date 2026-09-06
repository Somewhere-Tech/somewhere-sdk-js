// Built-package contract for the intentional SDK db.query() -> Row[] adapter.
// Canonical REST payload is {data,count,changes,last_row_id}; the array facade
// discards metadata and must never mistake a malformed result for an empty read.
// Both package entry points run actual Client.call parsing with local HTTP doubles.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '../dist/esm/index.js';
const cjs = createRequire(import.meta.url)('../dist/cjs/index.cjs');

for (const [format, sdk] of [['ESM', esm], ['CommonJS', cjs]]) {
  const canonical = (data, changes = 0, last_row_id = null) => ({
    data, count: data.length, changes, last_row_id,
  });
  function fixture(json, status = 200, raw) {
    const calls = [];
    const sw = new sdk.Somewhere({
      key: 'smt_fixture_developer_key', projectId: 'fixture-project',
      baseUrl: 'https://fixture.invalid/v1',
      fetch: async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
        return new Response(raw ?? JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
      },
    });
    return { sw, calls };
  }
  const returned = [{ id: 7, body: 'example' }];
  const wide = [{ id: '9007199254740993', amount: '-9223372036854775808', nested: { value: null } }];
  const cases = [
    ['read', 'SELECT id, body FROM notes', canonical(returned), returned],
    ['empty read', 'SELECT id FROM notes WHERE id = ?', canonical([]), []],
    ['write', 'UPDATE notes SET body = ?', canonical([], 4, 7), []],
    ['RETURNING', 'INSERT INTO notes (body) VALUES (?) RETURNING id, body', canonical(returned, 1, 7), returned],
    ['wide values', 'SELECT id, amount FROM notes', canonical(wide, 0, '9223372036854775807'), wide],
    ['canonical precedence', 'SELECT id FROM notes', { ...canonical(returned), rows: [{ id: 'wrong' }], results: [] }, returned],
  ];
  for (const [name, sql, payload, expected] of cases) {
    const { sw, calls } = fixture({ ok: true, data: payload });
    const result = await sw.db.query(sql, ['fixture-bind'], { timeoutMs: 1234 });
    assert.deepEqual(result, expected, `${format}: ${name}`);
    assert.ok(Array.isArray(result));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://fixture.invalid/v1/db/query');
    assert.deepEqual(calls[0].body, { project_id: 'fixture-project', sql, params: ['fixture-bind'], timeout_ms: 1234 });
    assert.equal(calls[0].headers.Authorization, 'Bearer smt_fixture_developer_key');
  }
  for (const payload of [undefined, null, [], {}, { rows: returned }, { results: returned },
    { data: null }, { data: {} }, { data: 'not rows' }, { data: 0 }]) {
    const { sw } = fixture({ ok: true, data: payload });
    await assert.rejects(() => sw.db.query('SELECT id FROM notes'), (error) => {
      assert.ok(error instanceof sdk.SomewhereError);
      assert.equal(error.code, 'INVALID_RESPONSE');
      assert.equal(error.retry, false);
      assert.equal(error.statusCode, 200);
      return true;
    }, `${format}: malformed successful payload must not become []`);
  }
  for (const raw of ['', '<html>upstream returned HTML</html>']) {
    const { sw } = fixture(null, 200, raw);
    await assert.rejects(() => sw.db.query('SELECT id FROM notes'), { code: 'INVALID_RESPONSE' });
  }
  for (const [status, error, retry] of [[403, 'APP_USER_RAW_SQL_FORBIDDEN', false], [503, 'DATABASE_UNAVAILABLE', true]]) {
    const { sw } = fixture({ ok: false, error, message: 'fixture refusal', retry, retry_after_ms: retry ? 250 : null }, status);
    await assert.rejects(() => sw.db.query('SELECT id FROM notes'), (failure) => {
      assert.ok(failure instanceof sdk.SomewhereError);
      assert.equal(failure.code, error);
      assert.equal(failure.statusCode, status);
      assert.equal(failure.retry, retry);
      assert.equal(failure.retryAfterMs, retry ? 250 : null);
      return true;
    });
  }
  console.log(`PASS ${format}: canonical read/empty/write/RETURNING/wide values, payload rejection and typed errors`);
}
