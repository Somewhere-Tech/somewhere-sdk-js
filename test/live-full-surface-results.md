# JS SDK — Live Full-Surface Test Results

- Run ID: `togqtl`
- Test subdomain: `sdk-live-togqtl.somewhere.tech`
- API base: `https://api.somewhere.tech/v1`
- Timestamp: 2026-04-11T19:33:25.974Z

## Totals

| Outcome | Count |
|---|---|
| ✅ pass | 70 |
| ⚠️ expected error | 4 |
| ❌ fail | 0 |
| 💥 crash | 0 |
| **total** | **74** |

## Per-call results

| # | Outcome | Method | Detail |
|---|---|---|---|
| 1 | ✅ | `billing.status` | {"tier":"builder","included_apps":3,"additional_apps":0,"total_app_slots":3,"is_unlimited":true,"apps_used":6,"trial_active":false,"trial_en… |
| 2 | ✅ | `usage.summary` | {"tier":"builder","limits":{"storage_gb":100,"db_mb":10240,"emails_per_day":1000,"file_upload_mb":100,"custom_domain":true},"projects":[{"id… |
| 3 | ✅ | `projects.create` | {"id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","name":"SDK Live togqtl","slug":"sdk-live-togqtl","subdomain":"sdk-live-togqtl","status":"deplo… |
| 4 | ✅ | `projects.list` | {"projects":[{"id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","name":"SDK Live togqtl","description":"Full-surface SDK live test","subdomain":"s… |
| 5 | ✅ | `projects.get` | {"id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","name":"SDK Live togqtl","description":"Full-surface SDK live test","subdomain":"sdk-live-togqt… |
| 6 | ✅ | `projects.deploys` | {"deploys":[],"note":"Day-aggregated. A real per-deployment table is on the roadmap."} |
| 7 | ✅ | `projects.rename` | {"updated":true} |
| 8 | ✅ | `db.migrate` | {"statements_run":1,"results":[{"sql":"CREATE TABLE notes (\n         id INTEGER PRIMARY KEY,\n         title TEXT NOT NULL,\n         body … |
| 9 | ✅ | `db.query insert` | {"columns":[],"rows":[],"meta":{"served_by":"v3-prod","served_by_region":"WNAM","served_by_colo":"SJC","served_by_primary":true,"timings":{"… |
| 10 | ✅ | `db.query select` | {"columns":["id","title","body"],"rows":[{"id":1,"title":"first","body":"hello"},{"id":2,"title":"second","body":"world"}],"meta":{"served_b… |
| 11 | ✅ | `db.tables` | {"tables":["notes"]} |
| 12 | ✅ | `db.schema` | {"table":"notes","columns":[{"name":"id","type":"INTEGER","not_null":false,"default":null,"primary_key":true},{"name":"title","type":"TEXT",… |
| 13 | ✅ | `storage.put` | {"key":"test/blob.txt","size":24,"content_type":"text/plain; charset=utf-8"} |
| 14 | ✅ | `storage.get` | {"bytes":24,"contentType":"text/plain; charset=utf-8","text":"hello from sdk live test"} |
| 15 | ✅ | `storage.list` | {"objects":[{"key":"test/blob.txt","size":24,"uploaded":"2026-04-11T19:33:11.384Z","content_type":"application/octet-stream"}],"truncated":f… |
| 16 | ✅ | `storage.delete` | {"deleted":true,"key":"test/blob.txt"} |
| 17 | ✅ | `fs.write` | {"path":"/sdk-test/hello.txt","size_bytes":8,"content_type":"text/plain","version":1} |
| 18 | ✅ | `fs.write v2` | {"path":"/sdk-test/hello.txt","size_bytes":11,"content_type":"text/plain","version":2} |
| 19 | ✅ | `fs.stat` | {"path":"/sdk-test/hello.txt","name":"hello.txt","type":"file","size_bytes":11,"content_type":"text/plain","version":2,"created_at":"2026-04… |
| 20 | ✅ | `fs.versions` | {"path":"/sdk-test/hello.txt","current_version":2,"versions":[{"version":1,"size_bytes":8,"content_type":"text/plain","created_at":"2026-04-… |
| 21 | ✅ | `fs.read (file)` | {"bytes":11,"text":"hello fs v2"} |
| 22 | ✅ | `fs.read (directory)` | {"entries":1} |
| 23 | ✅ | `fs.copy` | {"from":"/sdk-test/hello.txt","to":"/sdk-test/copy.txt"} |
| 24 | ✅ | `fs.move` | {"from":"/sdk-test/copy.txt","to":"/sdk-test/moved.txt"} |
| 25 | ✅ | `fs.delete` | {"deleted":1,"type":"file","path":"/sdk-test/moved.txt"} |
| 26 | ✅ | `env.set` | {"project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","key":"SDK_TEST_VAR","set":true} |
| 27 | ✅ | `env.list` | {"project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","keys":[{"key":"SDK_TEST_VAR","created_at":"2026-04-11 19:33:13"}]} |
| 28 | ✅ | `env.delete` | {"project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","key":"SDK_TEST_VAR","deleted":true} |
| 29 | ✅ | `auth.signup` | {"user":{"id":"e0d1474c-f39d-4e32-99ac-866fa92e085d","email":"sdk-togqtl@example.com","display_name":null},"token":"eyJhbGciOiJIUzI1NiIsInR5… |
| 30 | ✅ | `auth.login` | {"user":{"id":"e0d1474c-f39d-4e32-99ac-866fa92e085d","email":"sdk-togqtl@example.com","display_name":null},"token":"eyJhbGciOiJIUzI1NiIsInR5… |
| 31 | ✅ | `auth.users` | {"users":[{"id":"e0d1474c-f39d-4e32-99ac-866fa92e085d","email":"sdk-togqtl@example.com","display_name":null,"email_verified":false,"created_… |
| 32 | ✅ | `auth.forgot (anti-enumeration — always ok)` | {"message":"If that email exists, a reset link has been sent."} |
| 33 | ✅ | `auth.logout` | {"logged_out":true} |
| 34 | ✅ | `auth.me (app-user JWT)` | {"user":{"id":"e0d1474c-f39d-4e32-99ac-866fa92e085d","email":"sdk-togqtl@example.com","display_name":null,"email_verified":0,"created_at":17… |
| 35 | ✅ | `db.query (app-user JWT, dual-auth)` | {"columns":["one"],"rows":[{"one":1}],"meta":{"served_by":"v3-prod","served_by_region":"WNAM","served_by_colo":"SJC","served_by_primary":tru… |
| 36 | ✅ | `deploy (static index.html)` | {"files":["index.html"],"url":"https://sdk-live-togqtl.somewhere.tech","environment":"dev","promote_url":"https://api.somewhere.tech/v1/prom… |
| 37 | ✅ | `deploy.status` | {"dev_updated_at":"2026-04-11T19:33:15.929Z","prod_updated_at":null,"in_sync":false,"dev_ahead":true,"files_changed":1,"dev_file_count":1,"p… |
| 38 | ✅ | `promote` | {"promoted_at":"2026-04-11T19:33:16.925Z","files_promoted":1,"files_archived":0,"has_functions":false,"functions":{},"rollback_available":tr… |
| 39 | ✅ | `promote.rollback` | {"rolled_back_at":"2026-04-11T19:33:17.317Z","files_restored":1,"message":"Production restored to previous version. Note: rollback is one le… |
| 40 | ✅ | `email.send` | {"id":"eb947ae4-7f2b-421f-b730-71eb42e6d4ed"} |
| 41 | ✅ | `ai.complete` | {"content":"pong","model":"claude-sonnet-4-6","provider":"anthropic","usage":{"input_tokens":17,"output_tokens":5},"cost":{"api_cost_cents":… |
| 42 | ⚠️ | `ai.embed (stub)` | NOT_FOUND (404): Endpoint not found. |
| 43 | ⚠️ | `ai.image (stub)` | NOT_FOUND (404): Endpoint not found. |
| 44 | ⚠️ | `ai.tts (stub)` | NOT_FOUND (404): Endpoint not found. |
| 45 | ✅ | `logs.write` | {"logged":true,"quota_used":1,"quota_limit":50000} |
| 46 | ✅ | `logs.read` | {"logs":[{"id":"26e6b79c-3cdd-4c72-ae14-733b78b8834a","level":"info","message":"sdk live test info entry","data":{"suffix":"togqtl"},"source… |
| 47 | ✅ | `jobs.create` | {"job_id":"job_60ecff4c4c264b65","status":"queued"} |
| 48 | ✅ | `jobs.status` | {"job_id":"job_60ecff4c4c264b65","project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","handler":"https://httpbin.org/post","status":"queued",… |
| 49 | ✅ | `jobs.list` | {"jobs":[{"job_id":"job_60ecff4c4c264b65","project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","handler":"https://httpbin.org/post","status":… |
| 50 | ✅ | `jobs.progress` | {"job_id":"job_60ecff4c4c264b65","progress":50,"progress_message":"halfway"} |
| 51 | ✅ | `jobs.cancel` | {"job_id":"job_60ecff4c4c264b65","status":"cancelled"} |
| 52 | ✅ | `cron.create` | {"cron_id":"cron_918d5b7241e04dfc","schedule":"0 0 1 1 *","next_run":"2027-01-01T00:00:00.000Z"} |
| 53 | ✅ | `cron.list` | {"crons":[{"cron_id":"cron_918d5b7241e04dfc","project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","name":"sdk-live-togqtl","schedule":"0 0 1 … |
| 54 | ✅ | `cron.update` | {"cron_id":"cron_918d5b7241e04dfc","project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","name":"sdk-live-togqtl","schedule":"0 0 1 1 *","hand… |
| 55 | ✅ | `cron.delete` | {"deleted":true,"cron_id":"cron_918d5b7241e04dfc"} |
| 56 | ✅ | `queue.push` | {"message_id":"msg_8c008a2a58524de7","status":"queued"} |
| 57 | ✅ | `preview.invite` | {"email":"preview-togqtl@example.com","invited_at":"2026-04-11T19:33:21.629Z","preview_url":"https://sdk-live-togqtl.somewhere.tech"} |
| 58 | ✅ | `preview.viewers` | {"viewers":[{"email":"preview-togqtl@example.com","invited_at":"2026-04-11T19:33:21.629Z","last_viewed_at":null}]} |
| 59 | ✅ | `preview.revoke` | {"revoked":true} |
| 60 | ✅ | `domains.add` | {"domain":"sdk-togqtl.example.com","cname_target":"proxy.somewhere.tech","verified":false,"instructions":"Point a CNAME record for sdk-togqt… |
| 61 | ✅ | `domains.list` | {"domains":[{"id":"1fec8491-833e-431f-bf47-15b91d582472","project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","domain":"sdk-togqtl.example.co… |
| 62 | ✅ | `domains.verify` | {"domain":"sdk-togqtl.example.com","verified":false,"expected_cname":"proxy.somewhere.tech","actual_cname":null,"next_step":"Set a CNAME rec… |
| 63 | ✅ | `domains.delete` | {"deleted":true,"domain":"sdk-togqtl.example.com"} |
| 64 | ✅ | `feedback.submit` | {"submitted":true} |
| 65 | ✅ | `feedback.list` | {"feedback":[{"id":"2df22869-ff13-4b0c-a85f-476574eb52fb","message":"sdk live test feedback togqtl","page_url":"https://example.com","resolv… |
| 66 | ✅ | `usage.get` | {"period":"30d","totals":{"deploys":1,"ai_calls":1,"ai_cost_cents":1,"api_proxy_cost_cents":0},"daily":[{"date":"2026-04-11","deploys":1,"ai… |
| 67 | ✅ | `projects.undeploy` | {"status":"draft","slug":"sdk-live-togqtl"} |
| 68 | ✅ | `projects.archive` | {"status":"archived"} |
| 69 | ✅ | `projects.unarchive` | {"status":"draft"} |
| 70 | ✅ | `auth.requestVerification (app-user)` | {"sent":true,"expires_in_seconds":900} |
| 71 | ⚠️ | `auth.verifyEmail (wrong code — must error)` | AUTH_INVALID_CREDS (401): Wrong code. |
| 72 | ✅ | `auth.updateMe (app-user)` | {"user":{"id":"e0d1474c-f39d-4e32-99ac-866fa92e085d","email":"sdk-togqtl@example.com","display_name":"SDK Tester togqtl","email_verified":fa… |
| 73 | ✅ | `projects.requestDelete (cleanup)` | {"code_sent":true,"expires_in_seconds":600} |
| 74 | ✅ | `projects.delete (cleanup)` | {"deleted":true,"cleanup":{"project_id":"13b97d75-0b7c-48a2-9148-9be5d189aa3c","r2_objects_deleted":4,"kv_subdomain_deleted":false,"d1_delet… |
