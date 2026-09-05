import { NextRequest, NextResponse } from 'next/server'
import { fetchAINews, TavilyArticle } from '@/lib/tavily'

export const maxDuration = 60

import { summarizeArticle } from '@/lib/summarize'
import { composeNewsletter } from '@/lib/compose'
import { selectForNewsletter, type SelectableArticle } from '@/lib/select-articles'
import {
  articleExists,
  saveArticle,
  getActiveSubscribers,
  saveNewsletterIssue,
  getRecentToolNames,
} from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'

const SUMMARIZE_CONCURRENCY = 2

// Hard bound on work per invocation. Vercel caps this function at 60s; LLM
// rate-limit (429) retries make per-article time unpredictable, so once we
// have enough fresh articles for compose we stop summarizing. Unsaved URLs
// reappear from Tavily's rolling 3-day window on a later run.
// Free-tier fix: 5 is exact need (anchor + 3 supporting + contrast),
// concurrency 2 + 800ms inter-batch delay stays under Groq 8000 TPM in parallel.
const MAX_FRESH_PER_RUN = 5

// Timeout wrapper for critical async operations
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

// A fresh article keeps its Tavily fields plus the importance score we compute
// while summarizing, so the newsletter can be ordered by recency then importance.
type ProcessResult =
  | { status: 'saved'; article: SelectableArticle }
  | { status: 'skipped' | 'failed' }

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return require('crypto').timingSafeEqual(bufA, bufB)
}

async function processArticle(
  article: TavilyArticle,
  step: (m: string) => void
): Promise<ProcessResult> {
  // An article already in the DB was saved (and sent) on a previous run — skip
  // it so it never lands in the newsletter a second time.
  if (await articleExists(article.url)) return { status: 'skipped' }

  try {
    step(`Summarizing: "${article.title.slice(0, 60)}"`)
    const result = await summarizeArticle({ title: article.title, content: article.content })
    await saveArticle({
      title: article.title,
      url: article.url,
      content: result.content,
      category: result.category,
      importance_score: result.importance_score,
      source: article.source,
      published_date: article.published_date,
    })
    return {
      status: 'saved',
      article: { ...article, importance_score: result.importance_score },
    }
  } catch (err) {
    step(`Failed article "${article.title.slice(0, 60)}": ${(err as Error).message?.slice(0, 100)}`)
    return { status: 'failed' }
  }
}

async function runPipeline(): Promise<{
  saved: number
  skipped: number
  failed: number
  subscribers: number
  candidates: number
  sent: boolean
  error?: string
}> {
  const step = (msg: string) => console.log(`[cron] ${msg}`)

  const stats = {
    saved: 0,
    skipped: 0,
    failed: 0,
    subscribers: 0,
    candidates: 0,
    sent: false,
    error: undefined as string | undefined,
  }

  try {
    step('Starting pipeline')

    step('Fetching articles from Tavily...')
    const articles = await fetchAINews()
    step(`Fetched ${articles.length} articles`)

    let saved = 0
    let skipped = 0
    let failed = 0
    const freshArticles: SelectableArticle[] = []

    for (let i = 0; i < articles.length && saved < MAX_FRESH_PER_RUN; i += SUMMARIZE_CONCURRENCY) {
      const batch = articles.slice(i, i + SUMMARIZE_CONCURRENCY)
      const results = await Promise.allSettled(batch.map((a) => processArticle(a, step)))
      for (const r of results) {
        if (r.status !== 'fulfilled') { failed++; continue }
        if (r.value.status === 'saved') { saved++; freshArticles.push(r.value.article) }
        else if (r.value.status === 'skipped') skipped++
        else failed++
      }
      // Free-tier pacing: space batches to avoid TPM burst at 06:00 IST peak
      if (saved < MAX_FRESH_PER_RUN && i + SUMMARIZE_CONCURRENCY < articles.length) {
        await new Promise(r => setTimeout(r, 800))
      }
    }

    stats.saved = saved
    stats.skipped = skipped
    stats.failed = failed

    step(`Processing done — saved: ${saved}, skipped: ${skipped}, failed: ${failed}`)

    step('Fetching subscribers...')
    const subscribers = await getActiveSubscribers()
    stats.subscribers = subscribers.length
    step(`Found ${subscribers.length} subscriber(s)`)

    // Compose ONLY from articles that are new this run, ordered newest-first with
    // near-duplicate headlines removed. Already-sent articles (skipped above) are
    // excluded, so subscribers never get the same story twice.
    const candidates = selectForNewsletter(freshArticles)
    stats.candidates = candidates.length

    if (subscribers.length > 0 && candidates.length > 0) {
      const bannedTools = await getRecentToolNames(14).catch(() => [] as string[])
      if (bannedTools.length) step(`Banned recent tools (14d): ${bannedTools.join(', ').slice(0, 80)}`)
      step(`Composing newsletter from ${candidates.length} fresh, deduped articles...`)
      let composed = await withTimeout(
        composeNewsletter(
          candidates.map((a) => ({ title: a.title, url: a.url, content: a.content, source: a.source })),
          bannedTools
        ),
        30000,
        'composeNewsletter'
      )

      if (!composed) {
        stats.error = 'composition_failed'
        step('Composition returned null — skipping email send')
      } else {
        step(`Theme: ${composed.theme}`)
        step('Sending digest emails...')
        try {
          await withTimeout(sendDigestEmail(composed, subscribers as any), 20000, 'sendDigestEmail')
          stats.sent = true
          step('Emails sent')
        } catch (e) {
          stats.error = (e as Error).message.slice(0, 200)
          step(`Email send failed: ${stats.error}`)
        }

        // Snapshot the issue so /api/cron-repurpose can pick it up.
        const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
        const subject = composed.subject_teasers
          .map((t) => `${t.text} ${t.emoji}`)
          .join(', ')

        step('Saving newsletter issue snapshot...')
        try {
          await saveNewsletterIssue(today, composed, subject)
        } catch (e) {
          step(
            `Failed to save newsletter_issue: ${(e as Error).message.slice(0, 120)}`
          )
        }
      }
    } else {
      step(
        `Skipped email — ${subscribers.length === 0 ? 'no subscribers' : 'no fresh articles since last run'}`
      )
    }

    step('Pipeline complete')
    return stats
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown error'
    stats.error = message
    console.error(`[cron] Pipeline failed: ${message}`)
    return stats
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || !authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stats = await runPipeline()

  return NextResponse.json({ success: !stats.error, ...stats })
}
