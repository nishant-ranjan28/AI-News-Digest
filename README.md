# AI News Digest

Daily AI news digest powered by Tavily + Gemini → Groq → Gemini fallback chain. Automatically fetches, summarizes, and emails the top AI stories every morning.

## Stack

- **Framework:** Next.js (App Router, TypeScript)
- **Database:** Supabase (Postgres)
- **News:** Tavily API
- **AI:** Gemini 2.5 Flash → Groq llama-3.3-70b → Gemini paid (fallback chain)
- **Email:** Resend
- **Hosting:** Vercel + Vercel Cron

## Setup

1. Clone and `cd ai-news-digest`
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in your API keys
4. Run the schema in your Supabase SQL editor: `supabase/schema.sql`
5. `npm run dev`

## Environment Variables

| Variable | Where to get it |
|---|---|
| `TAVILY_API_KEY` | tavily.com |
| `GEMINI_API_KEY` | aistudio.google.com |
| `GROQ_API_KEY` | console.groq.com |
| `SUPABASE_URL` | supabase.com → Project Settings |
| `SUPABASE_ANON_KEY` | supabase.com → Project Settings |
| `RESEND_API_KEY` | resend.com |
| `CRON_SECRET` | Any random string: `openssl rand -base64 32` |

## Testing the Pipeline Manually

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron
```

## Running Tests

```bash
npm test
```

## Deploy

1. Push to GitHub
2. Connect to Vercel
3. Add all env vars in Vercel dashboard
4. Vercel Cron auto-triggers at 00:30 UTC (06:00 AM IST) daily
