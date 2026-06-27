# Platform Intelligence

### What's next after Next.js

For a decade, "make the web fast" meant **make the developer do more work.**

Next.js, React Query, SWR, RSC, edge caching, `revalidateTag`, suspense
boundaries, hydration tuning — a generation of tools whose pitch is the same:
*here is a powerful system; learn it, wire it correctly, and your app will be
fast.* The intelligence lives in the framework, but the **labour** lives in
your codebase. Every team re-implements the same cache, the same dedup, the
same invalidation rules — and ships the same three bugs doing it.

somewhere takes the other path.

> **Your app is fast because the platform is intelligent — not because you
> wired a caching library.**

The SDK and the backend are one system that sees your whole data path: the
query you ran, the row you just wrote, the identity you're scoped to, the event
that just fired. A system that sees all of that can make your app fast *for*
you. So it does. By default. With zero code.

---

## The proof: caching you didn't write

Here is a complete, fast, correct data layer on somewhere:

```typescript
import { createClient } from '@somewhere-tech/sdk';
const sw = createClient(SOMEWHERE_URL, SOMEWHERE_KEY);

const { data } = await sw.from('todos').select('*').eq('done', false);
await sw.from('todos').insert({ title: 'ship it' });
```

That's the whole thing. No `QueryClient`, no `queryKey`, no `staleTime` config,
no `invalidateQueries(['todos'])`, no provider at the root of your tree. And yet
as of v0.5.0 that code already has:

- **Request deduplication.** Render that todo list in five components on one
  tick and the platform makes **one** request, not five.
- **A short-lived read cache.** Sub-second repeat reads are served instantly
  from memory instead of round-tripping.
- **Read-your-own-writes correctness.** The `insert` automatically invalidates
  `todos`, so the next read is fresh. No manual cache-busting, no stale list.
- **Auth-scoped isolation.** The cache lives on your client instance, which *is*
  your identity. One user can never see another user's cached rows. You didn't
  configure that. You couldn't get it wrong.

Compare the React Query version of "the same thing": a `QueryClient`, a
provider, a `useQuery` with a hand-picked key, a `useMutation` with an
`onSuccess` that calls `invalidateQueries` with a key that **must** match the
read's key or you ship a stale-data bug. Dozens of lines, one of them load-
bearing and easy to get wrong, multiplied across every screen.

We deleted all of it. The right default is no code.

---

## Why a platform can do this and a library can't

A caching *library* is blind. React Query sees the keys you hand it and nothing
else. It can't know that an `INSERT INTO todos` should invalidate
`SELECT * FROM todos` — because it never saw the SQL, the table, or the write.
So it makes *you* the integration layer. You are the glue that tells the cache
what a write means. That glue is where the bugs live.

The somewhere SDK isn't a library bolted onto a database. **It's the front
half of the platform.** It builds the query, so it knows the table, the
filters, and the shape. It issues the write, so it knows exactly what changed.
It holds the identity, so it knows the blast radius. With that knowledge,
invalidation isn't something you wire — it's something the system *infers*.

| | A caching library (React Query / SWR) | Platform intelligence (somewhere) |
|---|---|---|
| Who writes the cache keys | You | Nobody — derived from the query |
| Who invalidates on write | You (`onSuccess` → `invalidateQueries`) | The platform (the write knows its table) |
| Auth scoping | You (bake identity into keys) | Free (cache = client = identity) |
| Dedup | A provider + correct config | On, always |
| Default state of a new app | Uncached until you wire it | Fast |
| Where the bugs live | Your glue code | There is no glue code |

This is the difference between a *tool* and a *platform.* A tool gives you
power and hands you the work. A platform takes the work.

---

## The roadmap: it gets more intelligent, your code stays the same

The point of doing this in the platform is that we can keep making your app
faster **without you shipping anything.** The seam is already in place:

- **Realtime-driven invalidation.** somewhere already streams Postgres change
  events. The next step wires those events straight into the cache: when a row
  in `todos` changes anywhere, every client caching `todos` drops it and
  refetches — live, automatic, no `invalidate` call in your app. The hook is
  already public (`sw.invalidate(table)`); we're connecting the other end.
- **Adaptive staleTime.** The platform sees read/write frequency per table. A
  table that's written once an hour can be cached far longer than the 1s
  default; a hot table, shorter. The platform can tune this per table from real
  traffic — a number no developer should have to guess.
- **Prefetch on intent.** `prefetch()` is the manual version today. The platform
  can learn the common navigation paths and warm the next screen's data before
  the click.

Every one of these lands as a backend + SDK upgrade. Your application code —
`sw.from('todos').select('*')` — does not change. It just gets faster. That is
the promise of platform intelligence: **the floor keeps rising under apps that
were already written.**

---

## The positioning, in one line

> Next.js made you the performance engineer. somewhere makes the platform the
> performance engineer. You write `from('todos').select('*')` and ship a fast,
> correct app — because the intelligence is in the platform you build on, not
> the boilerplate you maintain.

Fast by default. Correct by default. Yours to opt out of (`{ cache: false }`,
`.fresh()`) on the rare day you need to — never yours to wire up.

*This is what's next after Next.js.*
