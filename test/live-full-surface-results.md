# JS SDK — Robust Live Test (ve32p4)

- Timestamp: 2026-04-12T01:15:12.815Z
- Subdomain: `sdk-t-ve32p4.somewhere.tech`

## Totals

| Outcome | Count |
|---|---|
| ✅ pass | 78 |
| ⚠️ expected | 5 |
| ❌ fail | 0 |
| 💥 crash | 0 |
| **total** | **83** |

## Per-call

| # | O | Call | Detail |
|---|---|---|---|
| 1 | ✅ | `insert single row` | [] |
| 2 | ✅ | `insert multiple rows` | [] |
| 3 | ✅ | `select *` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":2,"name":"Bob","email":"bob@test.com","role"… |
| 4 | ✅ | `select * returned 4 rows` | got 4 |
| 5 | ✅ | `select columns` | [{"id":1,"name":"Alice","email":"alice@test.com"},{"id":2,"name":"Bob","email":"bob@test.com"},{"id":3,"name":"Carol","email":"carol@test.com"},{"id":4,"name":"… |
| 6 | ✅ | `eq` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"}] |
| 7 | ✅ | `neq` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":2,"name":"Bob","email":"bob@test.com","role"… |
| 8 | ✅ | `gt` | [{"id":3,"name":"Carol","email":"carol@test.com","role":"admin","active":1,"created_at":"2026-04-12 01:15:03"},{"id":4,"name":"Dave","email":"dave@test.com","ro… |
| 9 | ✅ | `gte` | [{"id":2,"name":"Bob","email":"bob@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":3,"name":"Carol","email":"carol@test.com","role"… |
| 10 | ✅ | `lt` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":2,"name":"Bob","email":"bob@test.com","role"… |
| 11 | ✅ | `lte` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":2,"name":"Bob","email":"bob@test.com","role"… |
| 12 | ✅ | `like` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":2,"name":"Bob","email":"bob@test.com","role"… |
| 13 | ✅ | `ilike` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"}] |
| 14 | ✅ | `in` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":3,"name":"Carol","email":"carol@test.com","r… |
| 15 | ✅ | `is(null)` | [] |
| 16 | ✅ | `is(null) correctly filters` | type=object |
| 17 | ✅ | `match` | [{"id":4,"name":"Dave","email":"dave@test.com","role":"admin","active":0,"created_at":"2026-04-12 01:15:03"}] |
| 18 | ✅ | `order desc` | [{"id":4,"name":"Dave"},{"id":3,"name":"Carol"},{"id":2,"name":"Bob"},{"id":1,"name":"Alice"}] |
| 19 | ✅ | `order desc first is Dave or Carol` | Dave |
| 20 | ✅ | `limit` | [{"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":2,"name":"Bob","email":"bob@test.com","role"… |
| 21 | ✅ | `limit returned 2` | 2 |
| 22 | ✅ | `range` | [{"id":2,"name":"Bob","email":"bob@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"},{"id":3,"name":"Carol","email":"carol@test.com","role"… |
| 23 | ✅ | `range returned 2` | 2 |
| 24 | ✅ | `single (1 match)` | {"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"} |
| 25 | ✅ | `single returned object not array` | {"id":1,"name":"Alice","email":"alice@test.com","role":"user","active":1,"created_at":"2026-04-12 01:15:03"} |
| 26 | ✅ | `maybeSingle (0 matches)` | null |
| 27 | ⚠️ | `single (0 matches → PGRST116)` | PGRST116: Single-row query returned 0 rows. |
| 28 | ✅ | `single 0-row returns error` | PGRST116 |
| 29 | ✅ | `update with eq` | [] |
| 30 | ✅ | `verify update took effect` | {"role":"verified"} |
| 31 | ✅ | `update persisted` | verified |
| 32 | ✅ | `upsert (existing)` | [] |
| 33 | ✅ | `verify upsert` | {"name":"Alice Updated"} |
| 34 | ✅ | `upsert updated name` | Alice Updated |
| 35 | ✅ | `upsert (new)` | [] |
| 36 | ✅ | `delete with eq` | [] |
| 37 | ✅ | `verify delete` | [] |
| 38 | ✅ | `deleted row is gone` | 0 |
| 39 | ⚠️ | `invalid table (error)` | SYNTAX_ERROR: Invalid SQL: no such table: nonexistent_table: SQLITE_ERROR |
| 40 | ✅ | `invalid table returns error` | SYNTAX_ERROR |
| 41 | ✅ | `insert tasks` | [] |
| 42 | ✅ | `select tasks with filter` | [{"id":1,"user_id":1,"title":"Buy milk","done":0}] |
| 43 | ✅ | `filtered tasks correct` | [{"id":1,"user_id":1,"title":"Buy milk","done":0}] |
| 44 | ✅ | `upload` | {"path":"docs/hello.txt","fullPath":"/test-bucket/docs/hello.txt","id":"/test-bucket/docs/hello.txt"} |
| 45 | ✅ | `upload binary` | {"path":"imgs/pixel.png","fullPath":"/test-bucket/imgs/pixel.png","id":"/test-bucket/imgs/pixel.png"} |
| 46 | ✅ | `download` | {"body":{},"contentType":"text/plain"} |
| 47 | ✅ | `download byte-exact` | "hello storage round-trip test" |
| 48 | ✅ | `list` | [{"name":"docs","size":0,"content_type":null,"updated_at":"2026-04-12T01:15:06.951Z"},{"name":"imgs","size":0,"content_type":null,"updated_at":"2026-04-12T01:15… |
| 49 | ✅ | `list found files` | count=2 |
| 50 | ✅ | `getPublicUrl returns URL` | https://api.somewhere.tech/v1/fs/c4458bf7-53f9-4aef-85ee-9bff40581acf/test-bucket/docs/hello.txt |
| 51 | ✅ | `remove` | [{"name":"docs/hello.txt","size":0},{"name":"imgs/pixel.png","size":0}] |
| 52 | ⚠️ | `download after remove (error)` | NOT_FOUND: Path not found. |
| 53 | ✅ | `signUp` | {"user":{"id":"bbfe588f-3b76-49cb-b90b-78c5775fef1c","email":"test-ve32p4@example.com","display_name":null},"session":{"access_token":"eyJhbGciOiJIUzI1NiIsInR5c… |
| 54 | ✅ | `signUp returned user+session` | yes |
| 55 | ✅ | `getUser (post-signUp)` | {"user":{"id":"bbfe588f-3b76-49cb-b90b-78c5775fef1c","email":"test-ve32p4@example.com","display_name":null,"email_verified":0,"created_at":1775956508,"last_logi… |
| 56 | ✅ | `getUser matches signUp email` | test-ve32p4@example.com |
| 57 | ✅ | `getSession` | {"session":{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYmZlNTg4Zi0zYjc2LTQ5Y2ItYjkwYi03OGM1Nzc1ZmVmMWMiLCJwcm9qZWN0X2lkIjoiYzQ0NThiZjctNTN… |
| 58 | ✅ | `getSession has token` | yes |
| 59 | ✅ | `updateUser` | {"user":{"id":"bbfe588f-3b76-49cb-b90b-78c5775fef1c","email":"test-ve32p4@example.com","display_name":"Tester ve32p4","email_verified":false,"created_at":177595… |
| 60 | ✅ | `signOut` | null |
| 61 | ✅ | `getSession post-signOut` | {"session":null} |
| 62 | ✅ | `session cleared` | null |
| 63 | ✅ | `signInWithPassword` | {"user":{"id":"bbfe588f-3b76-49cb-b90b-78c5775fef1c","email":"test-ve32p4@example.com","display_name":"Tester ve32p4"},"session":{"access_token":"eyJhbGciOiJIUz… |
| 64 | ✅ | `signIn returned JWT` | yes |
| 65 | ✅ | `from().select via user session (dual-auth)` | [{"id":1},{"id":2},{"id":3},{"id":4}] |
| 66 | ✅ | `dual-auth query succeeded` | type=object |
| 67 | ✅ | `emails.send (dev-only while user session active)` | {"id":"9eb3566d-5968-44a9-b148-fc6404f6a099"} |
| 68 | ✅ | `resetPasswordForEmail` | {"sent":true} |
| 69 | ✅ | `signInWithOAuth (google)` | {"provider":"google","url":"https://api.somewhere.tech/v1/auth/google?project_id=c4458bf7-53f9-4aef-85ee-9bff40581acf"} |
| 70 | ✅ | `OAuth URL present` | https://api.somewhere.tech/v1/auth/google?project_id=c4458bf |
| 71 | ⚠️ | `signInWithOAuth (github — unsupported)` | UNSUPPORTED_FEATURE: Provider github is not supported. Use 'google'. |
| 72 | ✅ | `unsupported provider is error` | UNSUPPORTED_FEATURE |
| 73 | ✅ | `setSession (rehydrate)` | {"session":{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYmZlNTg4Zi0zYjc2LTQ5Y2ItYjkwYi03OGM1Nzc1ZmVmMWMiLCJwcm9qZWN0X2lkIjoiYzQ0NThiZjctNTN… |
| 74 | ✅ | `getUser via rehydrated client` | {"user":{"id":"bbfe588f-3b76-49cb-b90b-78c5775fef1c","email":"test-ve32p4@example.com","display_name":"Tester ve32p4","email_verified":0,"created_at":1775956508… |
| 75 | ✅ | `rehydrated user matches` | test-ve32p4@example.com |
| 76 | ⚠️ | `signInWithPassword (wrong pass)` | AUTH_INVALID_CREDS: Wrong email or password for this project. |
| 77 | ✅ | `wrong password is auth error` | AUTH_INVALID_CREDS |
| 78 | ✅ | `emails.send (with html)` | {"id":"44b5702f-0f0d-4271-b019-934fcb7569ec"} |
| 79 | ✅ | `chat.completions.create` | {"id":"chatcmpl-4g414z183c523x39616z2y6i","model":"claude-sonnet-4-6","content":"pong","usage":{"prompt_tokens":16,"completion_tokens":5,"total_tokens":21}} |
| 80 | ✅ | `response.id starts with chatcmpl-` | chatcmpl-4g414z183c523x39616z2y6i |
| 81 | ✅ | `response.model is returned` | claude-sonnet-4-6 |
| 82 | ✅ | `usage.total_tokens = prompt + completion` | 21 |
| 83 | ✅ | `cleanup` | project deleted |