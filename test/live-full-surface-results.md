# JS SDK — Live Full-Surface Test (dominant-player rewrite)

- Run ID: `dvoq4u`
- Subdomain: `sdk-dpr-dvoq4u.somewhere.tech`
- Timestamp: 2026-04-11T19:52:02.107Z

## Totals

| Outcome | Count |
|---|---|
| ✅ pass | 47 |
| ⚠️ expected error | 4 |
| ❌ fail | 0 |
| 💥 crash | 0 |
| **total** | **51** |

## Per-call results

| # | Outcome | Call | Detail |
|---|---|---|---|
| 1 | ✅ | `provision project` | {"id":"66dc4928-6e1e-4e7f-be72-ccb5597caf6b","name":"SDK DPR dvoq4u","slug":"sdk-dpr-dvoq4u","subdomain":"sdk-dpr-dvoq4u","status":"deployed… |
| 2 | ✅ | `schema migrate` | {"statements_run":2,"results":[{"sql":"CREATE TABLE users (\n          id INTEGER PRIMARY KEY,\n          name TEXT NOT NULL,\n          ema… |
| 3 | ✅ | `from.insert single` | [{"id":1}] |
| 4 | ✅ | `from.insert multiple` | [{"id":2},{"id":3}] |
| 5 | ✅ | `from.select *` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 6 | ✅ | `from.select columns` | [{"id":1,"name":"Alice","email":"alice@example.com"},{"id":2,"name":"Bob","email":"bob@example.com"},{"id":3,"name":"Carol","email":"carol@e… |
| 7 | ✅ | `from.select eq` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"}] |
| 8 | ✅ | `from.select neq` | [] |
| 9 | ✅ | `from.select gt` | [{"id":2,"name":"Bob","email":"bob@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":3,"name":"Carol","email":"carol@… |
| 10 | ✅ | `from.select gte` | [{"id":2,"name":"Bob","email":"bob@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":3,"name":"Carol","email":"carol@… |
| 11 | ✅ | `from.select lt` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 12 | ✅ | `from.select lte` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 13 | ✅ | `from.select like` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 14 | ✅ | `from.select ilike` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"}] |
| 15 | ✅ | `from.select in` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 16 | ✅ | `from.select match` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"}] |
| 17 | ✅ | `from.select order` | [{"id":3,"name":"Carol"},{"id":2,"name":"Bob"},{"id":1,"name":"Alice"}] |
| 18 | ✅ | `from.select limit` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 19 | ✅ | `from.select range` | [{"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"},{"id":2,"name":"Bob","email":"bob@… |
| 20 | ✅ | `from.select single` | {"id":1,"name":"Alice","email":"alice@example.com","status":"active","created_at":"2026-04-11 19:51:53"} |
| 21 | ✅ | `from.select maybeSingle (0 rows)` | null |
| 22 | ⚠️ | `from.select single (0 rows — must error)` | PGRST116 (406): Single-row query returned 0 rows. |
| 23 | ✅ | `from.update eq` | [{"id":1}] |
| 24 | ✅ | `from.upsert` | [{"id":4}] |
| 25 | ✅ | `from.delete eq` | [{"id":3}] |
| 26 | ⚠️ | `from invalid identifier (error)` | VALIDATION_ERROR (400): Somewhere: invalid identifier "u; DROP TABLE users; --". Only ASCII letters, digits, and underscores are allowed. |
| 27 | ✅ | `storage.upload` | {"path":"alice.png","fullPath":"avatars/alice.png","id":"avatars/alice.png"} |
| 28 | ✅ | `storage.list (root)` | [{"name":"alice.png","size":14,"updated_at":"2026-04-11T19:51:56.707Z","content_type":"application/octet-stream"}] |
| 29 | ✅ | `storage.download` | {"body":{},"contentType":"image/png"} |
| 30 | ✅ | `storage.download byte-exact round-trip` | bytes=14 text="fake png bytes" |
| 31 | ✅ | `storage.getPublicUrl` | {"data":{"publicUrl":"https://api.somewhere.tech/v1/storage/66dc4928-6e1e-4e7f-be72-ccb5597caf6b/avatars/alice.png"}} |
| 32 | ✅ | `storage.remove` | [{"name":"alice.png","size":0}] |
| 33 | ⚠️ | `storage.download missing (error)` | STORAGE_NOT_FOUND (404): Key does not exist in storage. |
| 34 | ✅ | `auth.signUp` | {"user":{"id":"9ea5ac70-8858-420e-924d-5b3401bfbb87","email":"auth-dvoq4u@example.com","display_name":null},"session":{"access_token":"eyJhb… |
| 35 | ✅ | `auth.getUser (post-signUp)` | {"user":{"id":"9ea5ac70-8858-420e-924d-5b3401bfbb87","email":"auth-dvoq4u@example.com","display_name":null,"email_verified":0,"created_at":1… |
| 36 | ✅ | `auth.getUser returns the signUp email` | email=auth-dvoq4u@example.com |
| 37 | ✅ | `auth.signOut` | null |
| 38 | ✅ | `auth.signInWithPassword` | {"user":{"id":"9ea5ac70-8858-420e-924d-5b3401bfbb87","email":"auth-dvoq4u@example.com","display_name":null},"session":{"access_token":"eyJhb… |
| 39 | ✅ | `auth.signInWithOAuth (google)` | {"provider":"google","url":"https://api.somewhere.tech/v1/auth/google?project_id=66dc4928-6e1e-4e7f-be72-ccb5597caf6b"} |
| 40 | ⚠️ | `auth.signInWithOAuth (unsupported provider)` | UNSUPPORTED_FEATURE (400): Provider github is not supported. Use 'google'. |
| 41 | ✅ | `auth.getSession` | {"session":{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZWE1YWM3MC04ODU4LTQyMGUtOTI0ZC01YjM0MDFiZmJiODciLCJwcm9qZWN0X2l… |
| 42 | ✅ | `auth.getSession reflects in-memory state` | match=true |
| 43 | ✅ | `auth.updateUser` | {"user":{"id":"9ea5ac70-8858-420e-924d-5b3401bfbb87","email":"auth-dvoq4u@example.com","display_name":"SDK Tester dvoq4u","email_verified":f… |
| 44 | ✅ | `auth.resetPasswordForEmail` | {"sent":true} |
| 45 | ✅ | `auth.setSession (rehydrate)` | {"session":{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZWE1YWM3MC04ODU4LTQyMGUtOTI0ZC01YjM0MDFiZmJiODciLCJwcm9qZWN0X2l… |
| 46 | ✅ | `from.select via rehydrated session` | [] |
| 47 | ✅ | `rehydrated session scopes to app_user` | [] |
| 48 | ✅ | `emails.send` | {"id":"5e29c955-c9ff-45cc-8d22-1d93a5120056"} |
| 49 | ✅ | `chat.completions.create` | {"id":"chatcmpl-371p3r4u4h2m6u5t5u3h725v","model":"claude-sonnet-4-6","content":"pong","usage":{"prompt_tokens":20,"completion_tokens":5,"to… |
| 50 | ✅ | `projects.requestDelete (cleanup via raw HTTP)` | code requested |
| 51 | ✅ | `projects.delete (cleanup via raw HTTP)` | deleted |
