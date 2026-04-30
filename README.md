# AI News Digest

Daily AI newsletter live at **[ai.iamnishant.in](https://ai.iamnishant.in)**. Every morning a Vercel Cron fires the pipeline: Tavily fetches fresh AI news → Llama (via Groq, OpenRouter fallback) composes a single coherent newsletter (theme + 3 hand-picked stories + optional tool + takeaway + closing) → Brevo emails it to subscribers.

## Stack

- **Framework:** Next.js (App Router, TypeScript)
- **Database:** Supabase (Postgres)
- **News:** Tavily API
- **AI:** Llama 3.3 70B via Groq (primary) → OpenRouter (fallback)
- **Email:** Brevo (primary) → SendGrid → Resend (fallback chain)
- **Analytics:** Vercel Analytics
- **Hosting & cron:** Vercel + Vercel Cron

## How the pipeline works

1. **Fetch** — `lib/tavily.ts` runs three news queries against Tavily, dedupes by URL, returns up to 25 articles.
2. **Per-article summarize** — `lib/summarize.ts` runs each new article through Llama to produce `{headline, what_happened, why_it_matters, category, importance_score}`. These are saved to Supabase for the `/archive` page.
3. **Compose newsletter** — `lib/compose.ts` makes a single LLM call that:
   - picks **one theme** for the day,
   - selects **exactly 3 stories** from the pool with roles `anchor` / `supporting` / `contrast`,
   - writes them with deliberate structural variation (length and shape differ by role),
   - optionally surfaces a **Tool of the Day** (only if a real, useful product is implied),
   - adds a **Quick Takeaway** (one bold opinion line),
   - ends with a **closing** — either a real question or a strong statement.
4. **Send** — `lib/email.ts` renders the composed newsletter to HTML and sends via Brevo. If Brevo fails for any recipient, SendGrid is tried; if that fails, Resend.

## Setup

1. Clone and `cd ai-news-digest`
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in your API keys
4. Run `supabase/schema.sql` in the Supabase SQL editor (or, if upgrading, just `supabase/migrations/002_add_content_jsonb.sql`)
5. `npm run dev`

## Environment variables

| Variable | Where to get it | Required |
|---|---|---|
| `TAVILY_API_KEY` | tavily.com | yes |
| `GROQ_API_KEY` | console.groq.com | yes |
| `OPENROUTER_API_KEY` | openrouter.ai | optional fallback |
| `SUPABASE_URL` | supabase.com → Project Settings | yes |
| `SUPABASE_ANON_KEY` | supabase.com → Project Settings | yes |
| `BREVO_API_KEY` | Brevo → SMTP & API → API Keys | yes |
| `SENDER_EMAIL` | A verified sender on Brevo (e.g. `hello@iamnishant.in`) | yes |
| `SENDGRID_API_KEY` | sendgrid.com | optional fallback |
| `RESEND_API_KEY` | resend.com | optional fallback |
| `CRON_SECRET` | Any random string: `openssl rand -base64 32` | yes |

> Brevo's "Authorized IPs" must be **disabled** on the API key — Vercel's runtime IPs rotate, so allow-listing one breaks. Same applies to other serverless providers.

## Testing the pipeline manually

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron
```

Cron runs the pipeline in the background via Next.js `after()` and returns 200 immediately. Watch dev server logs for `[cron]` and `[email]` lines.

## Running tests

```bash
npm test
```

Two suites currently fail and are tracked separately — `__tests__/api/cron.test.ts` (Next `after()` requires a request scope the mocks don't provide) and parts of `__tests__/lib/email.test.ts` (older SendGrid-primary expectations from before the Brevo refactor). The remaining 35 tests pass.

## Deploy

1. Push to GitHub
2. Connect to Vercel
3. Add all env vars in the Vercel dashboard
4. Configure DNS for your subdomain (CNAME → `cname.vercel-dns.com`)
5. Vercel Cron auto-triggers `/api/cron` at 00:30 UTC (06:00 IST) daily — see `vercel.json`

## Repo layout

```
app/
  api/cron/route.ts      # the scheduled pipeline entrypoint
  api/articles/route.ts  # archive lookup by date
  api/subscribe/route.ts # email signup
  archive/page.tsx       # browse past articles
  subscribe/page.tsx     # signup form
  page.tsx               # today's view
lib/
  tavily.ts              # news fetch
  summarize.ts           # per-article LLM call (for archive)
  compose.ts             # single-call newsletter composition
  email.ts               # HTML render + Brevo/SendGrid/Resend send chain
  db.ts                  # Supabase client + queries
supabase/
  schema.sql             # full schema (fresh setups)
  migrations/            # additive migrations for existing DBs
```
