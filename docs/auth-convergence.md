# Authentication convergence

Decision: 2026-07-28 (`tsk_acd56ee8`).

## Only-path contract

| Environment | Session transport | Browser credentials | Data access |
|---|---|---:|---|
| Browser app | Same-origin `/api/auth` handler backed by `sw.auth.*WithCookie` / `fromRequest`; `HttpOnly` cookie session | Zero | Same-origin server functions using `sw.db` / `sw.fs` |
| Script, agent, CLI, server, native app | `Authorization: Bearer` plus explicit refresh rotation | Not applicable | SDK/platform API as allowed by the credential |

`@somewhere-tech/auth` is the optional cookie-native UI/handler adapter.
`@somewhere-tech/sdk` keeps Supabase-shaped compatibility APIs, but its browser
auth methods delegate to the same `/api/auth` cookie contract. Header auth and
direct browser database/files calls are compatibility modes, not additional
recommended architectures.

## Naming and result-shape alignment

| Intent | `@somewhere-tech/auth` | `@somewhere-tech/sdk` | Current status |
|---|---|---|---|
| Password sign-in | `signIn(input) → User` | `signInWithPassword(input) → Result<AuthResponse>` | `signIn` added as a non-breaking SDK alias; SDK keeps its Result envelope |
| Sign up | `signUp(input) → User` | `signUp(input) → Result<AuthResponse>` | Same transport; different envelope retained for compatibility |
| Start passwordless | `sendMagicLink(input) → void` | `sendMagicLink(input) → Result<{sent:true}>` | Same `/api/auth/magic-link` adapter route |
| Complete passwordless | `verifyMagicLink(input) → User` | `verifyMagicLink(input) → Result<AuthResponse>` | Same `/api/auth/magic-link/verify` adapter route |
| Password reset completion | Not currently exposed | `verifyPasswordReset(input)` | Clear name added |
| Historical `verifyOtp` | Passwordless runtime terminology | Password-reset alias | Deprecated but retained; delegates to `verifyPasswordReset` |
| Current user | `getUser() → User|null` | `getUser() → Result<{user}>` | Same `/api/auth/me` transport; envelope retained |
| Sign out | `signOut() → void` | `signOut() → Result<null>` | Same `/api/auth/logout` transport; envelope retained |

## Implemented without breaking users

- Browser password, passwordless, current-user, and sign-out calls share the
  `/api/auth` handler contract and cookie handshake used by
  `@somewhere-tech/auth/server`.
- Existing `signInWithPassword` remains; `signIn` is additive.
- Existing password-reset `verifyOtp` remains and warns through types/docs by
  being marked deprecated; `verifyPasswordReset` is the clear additive name.
- Direct browser database/files calls still execute, but warn once per surface
  and point to same-origin server functions. `functions.invoke` does not warn.
- Header mode remains unchanged for non-browser clients and legacy sessions.

## Requires a major version or explicit founder sign-off

- Removing `AuthClient` from this package in favor of
  `@somewhere-tech/auth` alone.
- Changing the SDK's `{ data, error, status }` contract to the auth package's
  throw/return-User convention, or changing the auth package in the opposite
  direction.
- Removing `signInWithPassword`, `verifyOtp`, header-mode browser fallback, or
  direct browser database/files calls.
- Making direct browser database/files warnings into deploy/runtime blockers.
  Rule 9 requires a warning cycle, migration evidence, and passing legitimate
  fixtures first.
- Replacing the current Google-only `signInWithOAuth` API with the auth
  package's provider-specific methods. Provider parity can be additive, but the
  callback contract must be designed and tested before it is advertised.
