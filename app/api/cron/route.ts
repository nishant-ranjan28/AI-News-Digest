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
} from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'

const SUMMARIZE_CONCURRENCY = 5

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

async function runPipeline() {
  const step = (msg: string) => console.log(`[cron] ${msg}`)

  try {
    step('Starting pipeline')

    step('Fetching articles from Tavily...')
    const articles = await fetchAINews()
    step(`Fetched ${articles.length} articles`)

    let saved = 0
    let skipped = 0
    let failed = 0
    const freshArticles: SelectableArticle[] = []

    for (let i = 0; i < articles.length; i += SUMMARIZE_CONCURRENCY) {
      const batch = articles.slice(i, i + SUMMARIZE_CONCURRENCY)
      const results = await Promise.allSettled(batch.map((a) => processArticle(a, step)))
      for (const r of results) {
        if (r.status !== 'fulfilled') { failed++; continue }
        if (r.value.status === 'saved') { saved++; freshArticles.push(r.value.article) }
        else if (r.value.status === 'skipped') skipped++
        else failed++
      }
    }

    step(`Processing done — saved: ${saved}, skipped: ${skipped}, failed: ${failed}`)

    step('Fetching subscribers...')
    const subscribers = await getActiveSubscribers()
    const emails = subscribers.map((s) => s.email)
    step(`Found ${emails.length} subscriber(s)`)

    // Compose ONLY from articles that are new this run, ordered newest-first with
    // near-duplicate headlines removed. Already-sent articles (skipped above) are
    // excluded, so subscribers never get the same story twice.
    const candidates = selectForNewsletter(freshArticles)

    if (emails.length > 0 && candidates.length > 0) {
      step(`Composing newsletter from ${candidates.length} fresh, deduped articles...`)
      const composed = await composeNewsletter(
        candidates.map((a) => ({ title: a.title, url: a.url, content: a.content, source: a.source }))
      )

      if (!composed) {
        step('Composition returned null — skipping email send')
      } else {
        step(`Theme: ${composed.theme}`)
        step('Sending digest emails...')
        await sendDigestEmail(composed, emails)
        step('Emails sent')

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
        `Skipped email — ${emails.length === 0 ? 'no subscribers' : 'no fresh articles since last run'}`
      )
    }

    step('Pipeline complete')
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown error'
    console.error(`[cron] Pipeline failed: ${message}`)
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || !authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await runPipeline()

  return NextResponse.json({ success: true, message: 'Pipeline complete' })
}
