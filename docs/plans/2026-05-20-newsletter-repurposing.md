# Newsletter Repurposing & Admin Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert each daily newsletter into 4 repurposed drafts (LinkedIn, Twitter/X, Threads, long-form website article), gated behind a personal admin panel for review/edit/copy/publish, plus a public `/articles/[slug]` route for the long-form output.

**Architecture:**
- Cron pipeline already runs scrape → summarize → compose → email. We append one step: `repurpose(composed) → saveDrafts()`. Drafts persist in a single `repurposed_posts` table keyed by `channel`, `issue_date`, `status`. The newsletter `ComposedNewsletter` JSON is also persisted so we can re-render or regenerate.
- `/admin` lives in this Next.js app, protected by Supabase magic-link auth with an env-var email allowlist. The page lists today's drafts, lets you edit, copy, mark-published, or regenerate one channel.
- `/articles/[slug]` is a public SSR page rendering the long-form article from a published `repurposed_posts` row of channel `article`.
- LLM calls reuse `compose.ts`'s Groq → OpenRouter fallback pattern. Per project memory, never call Gemini.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase JS, Groq SDK, OpenRouter via OpenAI SDK, Jest + Testing Library, Tailwind v4.

**Out of scope:** Auto-publishing to social APIs, scheduling, analytics dashboards, admin user management beyond a single allowlisted email.

**Repo conventions to follow:**
- Tests live in `__tests__/{api,lib,components}/` mirroring source paths (e.g. `lib/repurpose.ts` → `__tests__/lib/repurpose.test.ts`).
- API route tests use `/** @jest-environment node */` and mock `@/lib/*` modules. See [__tests__/api/cron.test.ts](__tests__/api/cron.test.ts) for the pattern.
- DB access goes through `lib/db.ts`; never call Supabase directly from routes or `lib/compose.ts`-style modules.
- Server-only env vars: do NOT prefix with `NEXT_PUBLIC_`. Public-only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Commit cadence: one commit per task. Conventional commits (`feat:`, `fix:`, `test:`, `chore:`).

---

## Phase 0 — Prerequisites (manual, do once)

Before any code task, the operator must perform these in Supabase/Vercel — code tasks below assume they are done.

**Step 0.1:** In Supabase dashboard → Authentication → Providers → Email, ensure "Enable Email provider" is on and "Confirm email" is on. Magic links use this.

**Step 0.2:** In Supabase Authentication → URL Configuration, add `https://ai.iamnishant.in/admin/callback` and `http://localhost:3000/admin/callback` to the Redirect URLs allowlist.

**Step 0.3:** Add these env vars locally (`.env.local`) and in Vercel:
- `NEXT_PUBLIC_SUPABASE_URL` — same value as existing `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same value as existing `SUPABASE_ANON_KEY`
- `ADMIN_ALLOWLIST_EMAILS` — comma-separated emails permitted to use `/admin`. For now: `nishant.ranjan@roosterinc.com`
- `NEXT_PUBLIC_SITE_URL` — `https://ai.iamnishant.in` in prod, `http://localhost:3000` locally

**Verify:** `vercel env ls` (or settings UI) shows all four; local `.env.local` has them.

---

## Phase 1 — Database schema

### Task 1.1: Create `repurposed_posts` migration

**Files:**
- Create: `supabase/migrations/003_repurposed_posts.sql`
- Modify: `supabase/schema.sql` (append new table; existing file is the canonical full schema)

**Step 1: Write the migration**

`supabase/migrations/003_repurposed_posts.sql`:
```sql
create table repurposed_posts (
  id uuid default gen_random_uuid() primary key,
  issue_date date not null,
  channel text not null check (channel in ('linkedin', 'twitter', 'threads', 'article')),
  content text not null,
  metadata jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  slug text,
  published_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique (issue_date, channel)
);

create index repurposed_posts_issue_date_idx on repurposed_posts (issue_date desc);
create index repurposed_posts_status_idx on repurposed_posts (status);
create unique index repurposed_posts_slug_idx on repurposed_posts (slug) where slug is not null;

create table newsletter_issues (
  id uuid default gen_random_uuid() primary key,
  issue_date date not null unique,
  composed jsonb not null,
  subject text,
  created_at timestamp default now()
);

create index newsletter_issues_issue_date_idx on newsletter_issues (issue_date desc);
```

Notes on shape:
- One row per (date, channel). Re-running the cron upserts via `(issue_date, channel)`.
- `metadata` holds channel-specific extras (e.g. character count, hook line, regeneration count). Optional.
- `newsletter_issues` stores the full `ComposedNewsletter` JSON so the admin and article route can rebuild content without re-running the LLM.
- `slug` is only set for `channel = 'article'` and is the URL slug for `/articles/[slug]`.

**Step 2: Append the same DDL to `supabase/schema.sql`** so the canonical file stays in sync (this repo treats `schema.sql` as the source of truth — see migration `002_add_content_jsonb.sql` for the existing additive pattern).

**Step 3: Apply the migration**

Run in Supabase SQL editor (paste the migration body). Verify in Table Editor that both tables exist with expected columns and constraints.

**Step 4: Commit**

```bash
git add supabase/migrations/003_repurposed_posts.sql supabase/schema.sql
git commit -m "feat(db): add repurposed_posts and newsletter_issues tables"
```

---

### Task 1.2: Extend `lib/db.ts` with types + helpers

**Files:**
- Modify: `lib/db.ts` (add types + functions; do not change existing exports)
- Test: `__tests__/lib/db.test.ts` (extend existing file)

**Step 1: Write failing tests** in `__tests__/lib/db.test.ts`. Follow the existing mocking style in that file. Add a `describe('repurposed_posts helpers', ...)` block covering:
- `upsertRepurposedPost` calls `.from('repurposed_posts').upsert(row, { onConflict: 'issue_date,channel' })` and throws on error.
- `getRepurposedPostsByDate(date)` calls `.eq('issue_date', date)` and returns `data ?? []`.
- `updateRepurposedPost(id, patch)` calls `.update({...patch, updated_at: <iso>}).eq('id', id)`.
- `getPublishedArticleBySlug(slug)` filters `channel='article'`, `status='published'`, `slug=<slug>`, returns first row or null.
- `saveNewsletterIssue(date, composed, subject)` upserts on `issue_date`.
- `getNewsletterIssue(date)` returns the row or null.

Use the same chain-mock pattern already in `db.test.ts`.

**Step 2: Run tests, watch them fail**

```bash
npm test -- __tests__/lib/db.test.ts
```
Expected: failures referencing missing exports.

**Step 3: Add the implementations** in `lib/db.ts`:

```ts
export type RepurposedChannel = 'linkedin' | 'twitter' | 'threads' | 'article'
export type RepurposedStatus = 'draft' | 'published' | 'archived'

export type RepurposedPost = {
  id?: string
  issue_date: string         // YYYY-MM-DD
  channel: RepurposedChannel
  content: string
  metadata?: Record<string, unknown> | null
  status?: RepurposedStatus
  slug?: string | null
  published_at?: string | null
  created_at?: string
  updated_at?: string
}

export type NewsletterIssue = {
  id?: string
  issue_date: string
  composed: unknown          // ComposedNewsletter, but lib/db avoids importing compose to prevent a cycle
  subject?: string
  created_at?: string
}

export async function upsertRepurposedPost(
  post: Omit<RepurposedPost, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('repurposed_posts')
    .upsert(post, { onConflict: 'issue_date,channel' })
  if (error) throw new Error(`DB error upserting repurposed_post: ${error.message}`)
}

export async function getRepurposedPostsByDate(date: string): Promise<RepurposedPost[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('repurposed_posts')
    .select('*')
    .eq('issue_date', date)
    .order('channel', { ascending: true })
  if (error) throw new Error(`DB error fetching repurposed_posts: ${error.message}`)
  return (data ?? []) as RepurposedPost[]
}

export async function updateRepurposedPost(
  id: string,
  patch: Partial<Pick<RepurposedPost, 'content' | 'status' | 'slug' | 'published_at' | 'metadata'>>
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('repurposed_posts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`DB error updating repurposed_post: ${error.message}`)
}

export async function getPublishedArticleBySlug(slug: string): Promise<RepurposedPost | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('repurposed_posts')
    .select('*')
    .eq('channel', 'article')
    .eq('status', 'published')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`DB error fetching article: ${error.message}`)
  return (data as RepurposedPost) ?? null
}

export async function saveNewsletterIssue(
  date: string,
  composed: unknown,
  subject?: string
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('newsletter_issues')
    .upsert({ issue_date: date, composed, subject }, { onConflict: 'issue_date' })
  if (error) throw new Error(`DB error saving newsletter_issue: ${error.message}`)
}

export async function getNewsletterIssue(date: string): Promise<NewsletterIssue | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('newsletter_issues')
    .select('*')
    .eq('issue_date', date)
    .maybeSingle()
  if (error) throw new Error(`DB error fetching newsletter_issue: ${error.message}`)
  return (data as NewsletterIssue) ?? null
}
```

**Step 4: Run tests, expect green**

```bash
npm test -- __tests__/lib/db.test.ts
```

**Step 5: Commit**

```bash
git add lib/db.ts __tests__/lib/db.test.ts
git commit -m "feat(db): add repurposed_posts and newsletter_issues helpers"
```

---

## Phase 2 — Newsletter prompt audit

### Task 2.1: Audit `compose.ts` PROMPT against doc content rules

**Files:**
- Read-only audit: `lib/compose.ts:47-161`
- Reference: doc rules ("Today's signal", "3 strong stories max", "Why it matters", "Optional tool section", "Strong takeaway", "Website link", "short sentences", "no corporate tone", "focus on insight over summary")

**Step 1: Compare existing prompt to doc rules.** Produce a short table (in this task's PR description) of: doc rule → prompt status (✅ already enforced / ⚠️ partially / ❌ missing).

Likely findings (verify before acting):
- ✅ "Today's signal" — `signal` field exists
- ⚠️ "3 strong stories max" — prompt enforces exactly 5 stories (1 anchor + 3 supporting + 1 contrast). Doc says 3 max. **Decision point: defer to doc and reduce, or keep 5?**
- ✅ "Why it matters" — covered by hot_takes + signal
- ✅ Tool section
- ✅ Strong takeaway (`quick_takeaway`)
- ⚠️ "Website link" — current email has archive link; doc means a back-to-website CTA per issue. Already partially present.
- ✅ Short sentences, no corporate tone, focus on insight — banned phrases list enforces this.

**Step 2: Resolve story-count question with the user.** Open `/docs/plans/...` (this file), comment in PR, or ask directly. Default: keep 5 stories (current depth) unless user prefers 3.

**Step 3: If changes needed, edit `lib/compose.ts:67-71` and corresponding output schema lines 131-144.** Otherwise: this task is a no-op and we skip Step 4.

**Step 4: Run full test suite to confirm no regressions**

```bash
npm test
```

**Step 5: Commit (only if changes were made)**

```bash
git commit -m "chore(compose): align newsletter prompt with content rules doc"
```

---

## Phase 3 — Repurposing library

### Task 3.1: Channel config + types

**Files:**
- Create: `lib/repurpose.ts`
- Test: `__tests__/lib/repurpose.test.ts`

**Step 1: Write the failing test** for pure helpers (no LLM yet):

```ts
import { CHANNEL_CONFIGS, buildSlug } from '@/lib/repurpose'

describe('CHANNEL_CONFIGS', () => {
  it('has entries for all four channels', () => {
    expect(Object.keys(CHANNEL_CONFIGS).sort()).toEqual(['article', 'linkedin', 'threads', 'twitter'])
  })
  it('each config has a max length and prompt builder', () => {
    for (const cfg of Object.values(CHANNEL_CONFIGS)) {
      expect(typeof cfg.maxChars).toBe('number')
      expect(typeof cfg.buildPrompt).toBe('function')
    }
  })
})

describe('buildSlug', () => {
  it('produces a url-safe slug from theme + date', () => {
    expect(buildSlug('AI is becoming trustworthy', '2026-05-20')).toBe('2026-05-20-ai-is-becoming-trustworthy')
  })
  it('truncates long themes to 60 chars total after the date prefix', () => {
    const slug = buildSlug('A'.repeat(200), '2026-05-20')
    expect(slug.length).toBeLessThanOrEqual(60 + '2026-05-20-'.length)
  })
  it('strips special chars', () => {
    expect(buildSlug("OpenAI's $50B bet?!", '2026-05-20')).toBe('2026-05-20-openai-s-50b-bet')
  })
})
```

**Step 2: Run test, watch fail**

```bash
npm test -- __tests__/lib/repurpose.test.ts
```

**Step 3: Implement** the configs in `lib/repurpose.ts`:

```ts
import type { ComposedNewsletter } from './compose'
import type { RepurposedChannel } from './db'

export type ChannelConfig = {
  channel: RepurposedChannel
  maxChars: number
  buildPrompt: (composed: ComposedNewsletter, siteUrl: string) => string
}

const LINKEDIN_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Transform the newsletter below into a LinkedIn post.

Rules:
- First line must stop scrolling (a sharp claim, a number, or a named actor — not a question)
- Focus on ONE insight from the newsletter. Pick the strongest.
- 6-8 lines maximum, each line a complete thought
- Short sentences. No hashtags. No emojis except at most one.
- No corporate / promotional language.
- End with EXACTLY this line on its own:
"I break down AI shifts daily → ${siteUrl}"

Output ONLY the post text. No preface, no explanation, no markdown.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Stories:
${c.stories.map((s) => `- ${s.headline}: ${s.body}${s.hot_take ? ` [hot take: ${s.hot_take}]` : ''}`).join('\n')}
Takeaway: ${c.quick_takeaway}
`.trim()

const TWITTER_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Transform the newsletter below into a single tweet.

Rules:
- 240 characters MAX (leaving room for the URL)
- ONE sharp insight. No multi-thread output.
- No hashtags. At most one emoji.
- End with: ${siteUrl}

Output ONLY the tweet text.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Top story: ${c.stories[0]?.headline} — ${c.stories[0]?.body}
Takeaway: ${c.quick_takeaway}
`.trim()

const THREADS_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Transform the newsletter below into a Threads post.

Rules:
- 4-6 lines, conversational
- 500 character max total
- No hashtags. At most one emoji.
- End with: ${siteUrl}

Output ONLY the post text.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Top story: ${c.stories[0]?.headline} — ${c.stories[0]?.body}
Takeaway: ${c.quick_takeaway}
`.trim()

const ARTICLE_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Expand the newsletter below into a long-form blog article (700-1100 words) in Markdown.

Structure:
- Opening hook (2-3 sentences) — restate the signal in your own words, sharply
- "## The story so far" — synthesize the anchor + supporting stories into a flowing narrative (not a bulleted recap)
- "## What this actually means" — your interpretation. Cite specific actors, numbers, dates.
- "## The contrarian read" — use the contrast story as a counterpoint
- "## What to watch next" — 2-3 forward-looking observations
- Closing line — a single bold statement worth screenshotting

Rules:
- Markdown only. No frontmatter. No "as an AI" disclaimers.
- No hashtags, no corporate filler, no banned phrases from the compose prompt.
- Keep paragraphs short (2-4 sentences).
- Do NOT include the URL at the end — the page renders it separately.

Output ONLY the markdown body.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Stories:
${c.stories.map((s) => `- [${s.role}] ${s.headline}: ${s.body}${s.hot_take ? ` (hot take: ${s.hot_take})` : ''}`).join('\n')}
Tool of the day: ${c.tool.name} — ${c.tool.what} (why now: ${c.tool.why_now})
Takeaway: ${c.quick_takeaway}
Closing: ${c.closing.text}

Site URL (for context only, do not include in output): ${siteUrl}
`.trim()

export const CHANNEL_CONFIGS: Record<RepurposedChannel, ChannelConfig> = {
  linkedin: { channel: 'linkedin', maxChars: 1300, buildPrompt: LINKEDIN_PROMPT },
  twitter:  { channel: 'twitter',  maxChars: 280,  buildPrompt: TWITTER_PROMPT  },
  threads:  { channel: 'threads',  maxChars: 500,  buildPrompt: THREADS_PROMPT  },
  article:  { channel: 'article',  maxChars: 8000, buildPrompt: ARTICLE_PROMPT  },
}

export function buildSlug(theme: string, isoDate: string): string {
  const cleaned = theme
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
  return `${isoDate}-${cleaned}`
}
```

**Step 4: Verify tests pass**

```bash
npm test -- __tests__/lib/repurpose.test.ts
```

**Step 5: Commit**

```bash
git add lib/repurpose.ts __tests__/lib/repurpose.test.ts
git commit -m "feat(repurpose): add channel configs and slug builder"
```

---

### Task 3.2: LLM generation per channel (Groq + OpenRouter fallback)

**Files:**
- Modify: `lib/repurpose.ts` (add `generateForChannel` + `generateAllChannels`)
- Modify: `__tests__/lib/repurpose.test.ts`

**Step 1: Write failing tests.** Mock the Groq SDK and OpenAI (OpenRouter) SDK module-level the same way you'd write tests against `compose.ts`. Cover:
- `generateForChannel('linkedin', composed)` calls Groq, returns trimmed text.
- If Groq throws, OpenRouter is called as fallback.
- If both throw, returns `null`.
- Output longer than `maxChars` is truncated (we deliberately allow the LLM to slightly overshoot then we trim).

A minimal mock pattern (mirror `compose.ts`'s structure):
```ts
jest.mock('groq-sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'Generated LinkedIn post text.' } }],
    }) } },
  })),
}))
```

**Step 2: Run, expect fail.**

**Step 3: Implement** in `lib/repurpose.ts`:

```ts
import Groq from 'groq-sdk'
import OpenAI from 'openai'

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('Missing GROQ_API_KEY')
  const groq = new Groq({ apiKey })
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.5,
    top_p: 0.9,
  })
  return (completion.choices[0]?.message?.content ?? '').trim()
}

async function callOpenRouter(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY')
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    temperature: 0.5,
    top_p: 0.9,
  })
  return (completion.choices[0]?.message?.content ?? '').trim()
}

function truncateForChannel(text: string, channel: RepurposedChannel): string {
  const max = CHANNEL_CONFIGS[channel].maxChars
  if (text.length <= max) return text
  // For short-form channels, trim at last space within budget; for article, leave alone (LLM should already obey).
  if (channel === 'article') return text
  const slice = text.slice(0, max)
  const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '))
  return (lastBreak > max * 0.8 ? slice.slice(0, lastBreak) : slice).trim()
}

export async function generateForChannel(
  channel: RepurposedChannel,
  composed: ComposedNewsletter,
  siteUrl: string = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ai.iamnishant.in'
): Promise<string | null> {
  const cfg = CHANNEL_CONFIGS[channel]
  const prompt = cfg.buildPrompt(composed, siteUrl)
  try { return truncateForChannel(await callGroq(prompt), channel) } catch (e) {
    console.warn(`[repurpose:${channel}] Groq failed:`, (e as Error).message)
  }
  try { return truncateForChannel(await callOpenRouter(prompt), channel) } catch (e) {
    console.warn(`[repurpose:${channel}] OpenRouter failed:`, (e as Error).message)
    return null
  }
}

export type ChannelResult = { channel: RepurposedChannel; content: string | null }

export async function generateAllChannels(
  composed: ComposedNewsletter,
  siteUrl?: string
): Promise<ChannelResult[]> {
  const channels: RepurposedChannel[] = ['linkedin', 'twitter', 'threads', 'article']
  // Run in parallel — independent LLM calls
  return Promise.all(
    channels.map(async (channel) => ({ channel, content: await generateForChannel(channel, composed, siteUrl) }))
  )
}
```

**Step 4: Run tests, expect green.**

**Step 5: Commit**

```bash
git add lib/repurpose.ts __tests__/lib/repurpose.test.ts
git commit -m "feat(repurpose): add Groq+OpenRouter generation per channel"
```

---

## Phase 4 — Cron pipeline integration

### Task 4.1: Wire repurposing into cron

**Files:**
- Modify: `app/api/cron/route.ts` (extend `runPipeline`)
- Modify: `__tests__/api/cron.test.ts`

**Step 1: Write the failing test.** Add a case to `cron.test.ts` that:
- Mocks `composeNewsletter` to return a valid `ComposedNewsletter`.
- Mocks `generateAllChannels` to return 4 results.
- Mocks `upsertRepurposedPost` and `saveNewsletterIssue`.
- Asserts both are called the expected number of times with the expected shapes.

Add to the existing top-level `jest.mock` block:
```ts
jest.mock('@/lib/repurpose', () => ({
  generateAllChannels: jest.fn().mockResolvedValue([
    { channel: 'linkedin', content: 'LI post' },
    { channel: 'twitter',  content: 'tweet' },
    { channel: 'threads',  content: 'threads post' },
    { channel: 'article',  content: '# Article body' },
  ]),
  buildSlug: jest.fn().mockReturnValue('2026-05-20-test-theme'),
}))
```

And extend the existing `@/lib/db` mock to include `upsertRepurposedPost` and `saveNewsletterIssue` jest.fn()s.

**Step 2: Run test, watch fail.**

**Step 3: Modify [app/api/cron/route.ts](app/api/cron/route.ts).** After the existing `await sendDigestEmail(composed, emails)` block (around line 89), add:

```ts
// Persist the issue + generate repurposed drafts
const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
const subject = composed.subject_teasers.map((t) => `${t.text} ${t.emoji}`).join(', ')

step('Saving newsletter issue snapshot...')
try {
  await saveNewsletterIssue(today, composed, subject)
} catch (e) {
  step(`Failed to save newsletter_issue: ${(e as Error).message.slice(0, 120)}`)
}

step('Generating repurposed drafts (linkedin, twitter, threads, article)...')
const results = await generateAllChannels(composed)
let drafts = 0
for (const { channel, content } of results) {
  if (!content) { step(`Skipped ${channel} — generation failed`); continue }
  const slug = channel === 'article' ? buildSlug(composed.theme, today) : null
  try {
    await upsertRepurposedPost({
      issue_date: today,
      channel,
      content,
      status: 'draft',
      slug,
      metadata: { chars: content.length, theme: composed.theme },
    })
    drafts++
  } catch (e) {
    step(`Failed to save ${channel}: ${(e as Error).message.slice(0, 120)}`)
  }
}
step(`Saved ${drafts}/4 repurposed drafts`)
```

Add imports at the top:
```ts
import { generateAllChannels, buildSlug } from '@/lib/repurpose'
// extend existing db import:
import { articleExists, saveArticle, getActiveSubscribers, upsertRepurposedPost, saveNewsletterIssue } from '@/lib/db'
```

**Important:** repurposing runs *after* email send, never blocking the email. If it fails, subscribers still got their digest.

**Step 4: Run tests**

```bash
npm test -- __tests__/api/cron.test.ts
```

**Step 5: Commit**

```bash
git add app/api/cron/route.ts __tests__/api/cron.test.ts
git commit -m "feat(cron): persist newsletter issue and generate repurposed drafts"
```

---

## Phase 5 — Public `/articles/[slug]` route

### Task 5.1: Server-rendered article page

**Files:**
- Create: `app/articles/[slug]/page.tsx`
- Create: `__tests__/api/articles-slug.test.ts` (optional — Next.js page tests are awkward; the DB helper is already tested. SKIP page-level test unless adding an `app/api/articles/[slug]/route.ts` first.)

**Step 1: Implement the page** (Server Component, no client JS, simple Markdown rendering):

```tsx
// app/articles/[slug]/page.tsx
import { notFound } from 'next/navigation'
import { getPublishedArticleBySlug } from '@/lib/db'

export const revalidate = 300 // 5-min ISR

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const article = await getPublishedArticleBySlug(slug)
  if (!article) return { title: 'Article not found' }
  const title = (article.metadata as { theme?: string } | null)?.theme ?? 'AI News Digest'
  return {
    title: `${title} — AI News Digest`,
    description: article.content.slice(0, 160).replace(/[#*_`>]/g, '').trim(),
  }
}

function renderMarkdown(md: string): string {
  // Minimal renderer — escape, then convert ## headings, **bold**, *italic*, and paragraphs.
  // For richer output, swap in `marked` later. Keeping deps zero for now.
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc(md)
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split(/\n{2,}/)
    .map((block) => block.startsWith('<h') ? block : `<p>${block.replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await getPublishedArticleBySlug(slug)
  if (!article) notFound()

  const theme = (article.metadata as { theme?: string } | null)?.theme ?? 'AI News Digest'
  const html = renderMarkdown(article.content)

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <a href="/archive" className="text-sm text-indigo-600 hover:underline">← Back to archive</a>
        <p className="text-xs uppercase tracking-wide text-gray-500 mt-6">{article.issue_date}</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1 mb-6">{theme}</h1>
        <article
          className="prose prose-neutral max-w-none [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-7 [&_p]:my-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <hr className="my-12 border-gray-200" />
        <p className="text-sm text-gray-600">
          Want this in your inbox every morning?{' '}
          <a href="/" className="text-indigo-600 font-semibold underline">Subscribe →</a>
        </p>
      </div>
    </main>
  )
}
```

**Step 2: Manual verify locally**

```bash
npm run dev
```
- Insert a test row in `repurposed_posts` (channel='article', status='published', slug='test', content='# Hello\n\nBody.') via Supabase Studio.
- Open `http://localhost:3000/articles/test`. Should render.
- Visit `http://localhost:3000/articles/nope`. Should 404.

**Step 3: Commit**

```bash
git add app/articles/
git commit -m "feat(articles): add public /articles/[slug] page"
```

---

### Task 5.2 (optional): Upgrade Markdown rendering

Only do this if Task 5.1's minimal renderer produces ugly output for real article bodies.

**Files:**
- Modify: `app/articles/[slug]/page.tsx`
- Add dep: `marked` (~30 KB, server-only)

```bash
npm install marked
```

Replace `renderMarkdown` with:
```ts
import { marked } from 'marked'
// ...
const html = marked.parse(article.content, { async: false }) as string
```

Commit: `chore(articles): use marked for markdown rendering`.

---

## Phase 6 — Admin auth (Supabase magic link)

### Task 6.1: Install Supabase auth helpers + types

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/supabase-browser.ts`
- Create: `lib/supabase-server.ts`

**Step 1:** Install:

```bash
npm install @supabase/ssr
```

**Step 2: Create the two clients.**

`lib/supabase-browser.ts`:
```ts
'use client'
import { createBrowserClient } from '@supabase/ssr'

export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

`lib/supabase-server.ts`:
```ts
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function getServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(items) {
          try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch { /* called from a server component; allowed to no-op */ }
        },
      },
    }
  )
}
```

**Step 3: Commit**

```bash
git add package.json package-lock.json lib/supabase-browser.ts lib/supabase-server.ts
git commit -m "feat(auth): add Supabase SSR clients"
```

---

### Task 6.2: Allowlist check helper + tests

**Files:**
- Create: `lib/admin-auth.ts`
- Create: `__tests__/lib/admin-auth.test.ts`

**Step 1: Write failing tests**

```ts
import { isAllowlistedEmail } from '@/lib/admin-auth'

describe('isAllowlistedEmail', () => {
  beforeEach(() => { process.env.ADMIN_ALLOWLIST_EMAILS = 'a@x.com, b@y.com' })

  it('matches exact', () => { expect(isAllowlistedEmail('a@x.com')).toBe(true) })
  it('is case insensitive', () => { expect(isAllowlistedEmail('A@X.com')).toBe(true) })
  it('trims spaces', () => { expect(isAllowlistedEmail(' b@y.com ')).toBe(true) })
  it('rejects unknown', () => { expect(isAllowlistedEmail('c@z.com')).toBe(false) })
  it('rejects when env empty', () => {
    delete process.env.ADMIN_ALLOWLIST_EMAILS
    expect(isAllowlistedEmail('a@x.com')).toBe(false)
  })
})
```

**Step 2: Run, fail.**

**Step 3: Implement** in `lib/admin-auth.ts`:

```ts
export function isAllowlistedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const raw = process.env.ADMIN_ALLOWLIST_EMAILS ?? ''
  const allow = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (allow.length === 0) return false
  return allow.includes(email.trim().toLowerCase())
}

import { getServerSupabase } from './supabase-server'

export async function requireAdmin(): Promise<{ email: string } | null> {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null
  if (!isAllowlistedEmail(user.email)) return null
  return { email: user.email }
}
```

**Step 4: Run tests, expect green.**

**Step 5: Commit**

```bash
git add lib/admin-auth.ts __tests__/lib/admin-auth.test.ts
git commit -m "feat(admin): add email allowlist + requireAdmin helper"
```

---

### Task 6.3: Login page + callback route

**Files:**
- Create: `app/admin/login/page.tsx` (client component, sends magic link)
- Create: `app/admin/callback/route.ts` (exchanges the code from the magic link)

**Step 1:** `app/admin/login/page.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin/callback` },
    })
    if (error) { setErrorMsg(error.message); setStatus('error'); return }
    setStatus('sent')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6">Admin login</h1>
        {status === 'sent' ? (
          <p className="text-sm text-gray-700">Check your inbox for the magic link.</p>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-4 text-sm"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending...' : 'Send magic link'}
            </button>
            {status === 'error' && <p className="text-sm text-red-600 mt-3">{errorMsg}</p>}
          </>
        )}
      </form>
    </main>
  )
}
```

**Step 2:** `app/admin/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/admin/login?error=missing_code', req.url))

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(new URL(`/admin/login?error=${encodeURIComponent(error.message)}`, req.url))

  return NextResponse.redirect(new URL('/admin', req.url))
}
```

**Step 3: Manual verify**

```bash
npm run dev
```
Visit `http://localhost:3000/admin/login`, enter your email, click link in your inbox, confirm redirect to `/admin` (which doesn't exist yet — 404 is fine for now).

**Step 4: Commit**

```bash
git add app/admin/login/ app/admin/callback/
git commit -m "feat(admin): add magic-link login + callback route"
```

---

## Phase 7 — Admin panel UI

### Task 7.1: Admin layout with auth gate

**Files:**
- Create: `app/admin/layout.tsx`

**Step 1:** Implement:

```tsx
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/admin-auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  if (!admin) redirect('/admin/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <a href="/admin" className="font-bold text-gray-900">Admin</a>
          <span className="text-xs text-gray-500">{admin.email}</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
```

Note: login page lives at `/admin/login`, callback at `/admin/callback`. Both will inherit this layout's auth gate. To exempt them:
- Move the auth gate from `app/admin/layout.tsx` into a server component wrapper used only for the dashboard pages, OR
- Add a check `if (pathname === '/admin/login' || '/admin/callback') return children` — but that requires `usePathname` from a client component.

**Simpler fix:** restructure so login + callback live OUTSIDE `app/admin/`:
- Move `app/admin/login/page.tsx` → `app/login/page.tsx`
- Move `app/admin/callback/route.ts` → `app/login/callback/route.ts`
- Update the redirect in `signInWithOtp({ options: { emailRedirectTo: '${origin}/login/callback' }})`
- Update the Supabase Redirect URLs in Phase 0 accordingly: `https://ai.iamnishant.in/login/callback` (and localhost).

Recommended: do this restructure as part of Task 7.1.

**Step 2: Commit**

```bash
git add app/admin/ app/login/
git commit -m "feat(admin): gate /admin behind allowlisted magic-link auth"
```

---

### Task 7.2: Admin dashboard — today's drafts

**Files:**
- Create: `app/admin/page.tsx`
- Create: `components/admin/PostCard.tsx`
- Create: `app/api/admin/posts/route.ts` (GET)
- Create: `app/api/admin/posts/[id]/route.ts` (PATCH)
- Create: `app/api/admin/regenerate/route.ts` (POST)
- Test: `__tests__/api/admin-posts.test.ts`

**Step 1: Write failing tests** for the API routes. Mirror the `cron.test.ts` style. Verify:
- All `/api/admin/*` routes return 401 when `requireAdmin()` returns null.
- `GET /api/admin/posts?date=YYYY-MM-DD` calls `getRepurposedPostsByDate(date)` and returns `{ posts }`.
- `PATCH /api/admin/posts/[id]` with `{ content }` calls `updateRepurposedPost(id, { content })`.
- `PATCH` with `{ status: 'published' }` calls `updateRepurposedPost` with `status: 'published'` and a `published_at` timestamp.
- `POST /api/admin/regenerate` with `{ channel, date }` looks up the issue via `getNewsletterIssue(date)`, runs `generateForChannel`, upserts the new content.

Mock `@/lib/admin-auth` and `@/lib/db` and `@/lib/repurpose`.

**Step 2: Run tests, watch fail.**

**Step 3: Implement routes.**

`app/api/admin/posts/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getRepurposedPostsByDate } from '@/lib/db'

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const posts = await getRepurposedPostsByDate(date)
  return NextResponse.json({ posts })
}
```

`app/api/admin/posts/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { updateRepurposedPost } from '@/lib/db'

type PatchBody = { content?: string; status?: 'draft' | 'published' | 'archived'; slug?: string }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const body = (await req.json()) as PatchBody
  const patch: Record<string, unknown> = {}
  if (typeof body.content === 'string') patch.content = body.content
  if (typeof body.slug === 'string') patch.slug = body.slug
  if (body.status) {
    patch.status = body.status
    if (body.status === 'published') patch.published_at = new Date().toISOString()
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Empty patch' }, { status: 400 })
  await updateRepurposedPost(id, patch)
  return NextResponse.json({ ok: true })
}
```

`app/api/admin/regenerate/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getNewsletterIssue, upsertRepurposedPost, type RepurposedChannel } from '@/lib/db'
import { generateForChannel, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { channel, date } = (await req.json()) as { channel: RepurposedChannel; date: string }
  if (!channel || !date) return NextResponse.json({ error: 'Missing channel or date' }, { status: 400 })

  const issue = await getNewsletterIssue(date)
  if (!issue) return NextResponse.json({ error: 'No newsletter issue for that date' }, { status: 404 })

  const composed = issue.composed as ComposedNewsletter
  const content = await generateForChannel(channel, composed)
  if (!content) return NextResponse.json({ error: 'Generation failed' }, { status: 502 })

  const slug = channel === 'article' ? buildSlug(composed.theme, date) : null
  await upsertRepurposedPost({
    issue_date: date,
    channel,
    content,
    status: 'draft',
    slug,
    metadata: { chars: content.length, theme: composed.theme, regenerated: true },
  })
  return NextResponse.json({ ok: true, content })
}
```

**Step 4: Run tests, expect green.**

**Step 5: Build the UI.**

`components/admin/PostCard.tsx`:
```tsx
'use client'
import { useState } from 'react'
import type { RepurposedPost } from '@/lib/db'

export default function PostCard({ post, onUpdate }: { post: RepurposedPost; onUpdate: (p: RepurposedPost) => void }) {
  const [content, setContent] = useState(post.content)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  async function save(patch: Partial<RepurposedPost>) {
    setSaving(true)
    await fetch(`/api/admin/posts/${post.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    })
    setSaving(false)
    onUpdate({ ...post, ...patch })
  }

  async function regenerate() {
    setSaving(true)
    const res = await fetch('/api/admin/regenerate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: post.channel, date: post.issue_date }),
    })
    const json = await res.json()
    setSaving(false)
    if (json.content) { setContent(json.content); onUpdate({ ...post, content: json.content }) }
  }

  async function copy() {
    await navigator.clipboard.writeText(content)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold text-gray-900 capitalize">{post.channel}</h2>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500">{content.length} chars</span>
          <span className={`text-xs px-2 py-0.5 rounded ${post.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{post.status}</span>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={post.channel === 'article' ? 18 : 8}
        className="w-full border border-gray-300 rounded p-3 text-sm font-mono"
      />
      <div className="flex gap-2 mt-3 flex-wrap">
        <button onClick={() => save({ content })} disabled={saving} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">Save</button>
        <button onClick={copy} className="px-3 py-1.5 text-sm border border-gray-300 rounded">{copied ? 'Copied!' : 'Copy'}</button>
        <button onClick={regenerate} disabled={saving} className="px-3 py-1.5 text-sm border border-gray-300 rounded disabled:opacity-50">Regenerate</button>
        {post.status !== 'published' && (
          <button onClick={() => save({ status: 'published' })} disabled={saving} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded disabled:opacity-50">Mark published</button>
        )}
      </div>
    </section>
  )
}
```

`app/admin/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import PostCard from '@/components/admin/PostCard'
import type { RepurposedPost } from '@/lib/db'

export default function AdminPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [posts, setPosts] = useState<RepurposedPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/posts?date=${date}`)
      .then((r) => r.json())
      .then((j) => { setPosts(j.posts ?? []); setLoading(false) })
  }, [date])

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Drafts for {date}</h1>
        <input
          type="date" value={date} max={today}
          onChange={(e) => setDate(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        />
      </div>
      {loading ? <p className="text-gray-500">Loading…</p>
        : posts.length === 0 ? <p className="text-gray-500">No drafts for this date.</p>
        : posts.map((p) => (
            <PostCard key={p.id} post={p} onUpdate={(updated) =>
              setPosts((prev) => prev.map((x) => x.id === updated.id ? updated : x))
            } />
          ))
      }
    </>
  )
}
```

**Step 6: Manual verify**

```bash
npm run dev
```
1. Visit `/login`, get magic link, log in.
2. Land on `/admin`. If today has no drafts, pick a date that does (or trigger cron locally with `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron`).
3. Edit a draft → Save → reload, confirm persistence.
4. Click Copy → paste somewhere, confirm clipboard.
5. Click Regenerate → confirm content changes.
6. Click Mark published on the article channel → visit `/articles/<slug>` → confirm public page renders.

**Step 7: Commit**

```bash
git add app/admin/page.tsx components/admin/ app/api/admin/ __tests__/api/admin-posts.test.ts
git commit -m "feat(admin): dashboard with edit/copy/regenerate/publish per channel"
```

---

## Phase 8 — Final polish

### Task 8.1: Add admin link from main site (optional, for your convenience)

If desired, add a small link to `/admin` from the home page footer, only visible to you. Skip if it's clutter — the URL is bookmarkable.

### Task 8.2: Sanity sweep

**Step 1:** Run full test + lint:

```bash
npm test && npm run lint && npm run build
```

**Step 2:** Verify production env vars are set in Vercel (Phase 0 list).

**Step 3:** Verify the Vercel cron in `vercel.json` is unchanged and still runs the pipeline. The new repurposing step runs inline within the same request — within `maxDuration = 60` it should fit (4 parallel LLM calls × ~5-10s each).

**Step 4:** If cron starts timing out, raise `maxDuration` in [app/api/cron/route.ts](app/api/cron/route.ts#L4) to 120 (Vercel Hobby allows up to 60; Pro allows 300). Or split repurposing into a separate cron-triggered endpoint that runs after the digest endpoint.

---

## Open questions / decisions deferred

1. **Story count in newsletter prompt** — doc says "3 max", current is 5. Task 2.1 surfaces this; resolve with user before changing.
2. **OG images for `/articles/[slug]`** — not in scope. Add later if SEO/sharing matters.
3. **`marked` dependency** — only add if Task 5.1's minimal renderer produces poor output (Task 5.2).
4. **Rate limiting on `/api/admin/regenerate`** — single-user admin, low risk for now. Add later if it ever has multiple users.

---

## File map (final state)

**New files:**
- `supabase/migrations/003_repurposed_posts.sql`
- `lib/repurpose.ts`
- `lib/admin-auth.ts`
- `lib/supabase-browser.ts`
- `lib/supabase-server.ts`
- `app/articles/[slug]/page.tsx`
- `app/login/page.tsx`
- `app/login/callback/route.ts`
- `app/admin/layout.tsx`
- `app/admin/page.tsx`
- `app/api/admin/posts/route.ts`
- `app/api/admin/posts/[id]/route.ts`
- `app/api/admin/regenerate/route.ts`
- `components/admin/PostCard.tsx`
- `__tests__/lib/repurpose.test.ts`
- `__tests__/lib/admin-auth.test.ts`
- `__tests__/api/admin-posts.test.ts`

**Modified files:**
- `supabase/schema.sql` (append new tables)
- `lib/db.ts` (new types + helpers)
- `app/api/cron/route.ts` (repurpose step appended)
- `__tests__/lib/db.test.ts` (new tests)
- `__tests__/api/cron.test.ts` (new assertions + mocks)
- `package.json` (add `@supabase/ssr`, optionally `marked`)

**Total tasks:** 16 (Phase 0 manual + Tasks 1.1, 1.2, 2.1, 3.1, 3.2, 4.1, 5.1, 5.2 optional, 6.1, 6.2, 6.3, 7.1, 7.2, 8.1 optional, 8.2)
