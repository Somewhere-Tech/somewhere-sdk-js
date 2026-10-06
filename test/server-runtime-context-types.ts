// Type contract: the server adapter accepts the platform's actual generated runtime
// context. test/fixtures/somewhere-runtime-context.d.ts is a frozen exact extract of
// the platform's RUNTIME_CONTEXT_DECLARATION + ENDPOINT_DECLARATION (provenance and
// hashes in somewhere-runtime-context.json); it supplies the global
// SomewhereRuntimeContext and ServerFunction types used here.
import type * as server from '../dist/types/auth/server.js';

declare const somewhereAuth: typeof server.somewhereAuth;
declare const ctx: SomewhereRuntimeContext;

// The canonical deployed handler shape, as a function module default export.
const handler: ServerFunction<{ input: unknown; output: Response }> = somewhereAuth;
const wrapped: ServerFunction<{ input: unknown; output: Response }> = (req, sw) => somewhereAuth(req, sw);
const namespace: server.SwAuthNamespace = ctx;
void handler; void wrapped; void namespace;

// The extract resolves to exact runtime types (the .d.ts is not itself checked under
// skipLibCheck, so these prove the members above did not collapse to unchecked types).
const oauthUrl: Promise<string> = ctx.auth.oauthStart('google', { redirect_uri: 'https://app.example/api/auth/callback' });
// @ts-expect-error oauthStart resolves the provider start URL as a string.
const oauthUrlIsNotNumber: Promise<number> = ctx.auth.oauthStart('github', { redirect_uri: 'https://app.example/api/auth/callback' });
// @ts-expect-error Only google, github and discord start social sign-in.
void ctx.auth.oauthStart('twitter', { redirect_uri: 'https://app.example/api/auth/callback' });
type CheckoutUrl = Awaited<ReturnType<SomewhereRuntimeContext['payments']['checkoutForUser']>>['url'];
const checkoutUrl: CheckoutUrl = null;
// @ts-expect-error A checkout session url is string | null, never a number.
const checkoutUrlIsNotNumber: CheckoutUrl = 1;
void oauthUrl; void oauthUrlIsNotNumber; void checkoutUrl; void checkoutUrlIsNotNumber;

// A minimal adapter without oauthStart still fits (the handler then answers 501).
const legacy: server.SwAuthNamespace = {
  auth: {
    signup: async () => ({}),
    login: async () => ({}),
    logout: async () => ({}),
    fromRequest: async () => null,
    googleExchange: async () => ({}),
    githubExchange: async () => ({}),
    discordExchange: async () => ({}),
    signInWithOtp: async () => ({}),
    verifyOtp: async () => ({}),
  },
  payments: {
    checkoutForUser: async () => ({ url: 'https://checkout.example/s' }),
    portalForUser: async () => ({ url: 'https://billing.example/p' }),
  },
};
void legacy;

// Incorrect namespaces are still refused.
// @ts-expect-error A namespace without auth is not an auth adapter.
const noAuth: server.SwAuthNamespace = { billing: { plans: async () => ({}) } };
// @ts-expect-error oauthStart must resolve a string URL, not a number.
const numericUrl: server.SwAuthNamespace = { auth: { ...legacy.auth, oauthStart: async () => 42 } };
// @ts-expect-error A checkout url must be a string or null.
const badCheckout: server.SwAuthNamespace = { auth: legacy.auth, payments: { checkoutForUser: async () => ({ url: 42 }), portalForUser: async () => ({}) } };
// @ts-expect-error A context missing auth.login cannot be passed to the handler.
void somewhereAuth(new Request('https://app.example/api/auth/me'), { auth: { ...legacy.auth, login: undefined } });
void noAuth; void numericUrl; void badCheckout;
