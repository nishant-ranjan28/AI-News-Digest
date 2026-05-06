import { NextRequest, NextResponse } from 'next/server'
import { fetchAINews, TavilyArticle } from '@/lib/tavily'

export const maxDuration = 60

import { summarizeArticle } from '@/lib/summarize'
import { composeNewsletter } from '@/lib/compose'
import { articleExists, saveArticle, getActiveSubscribers } from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'

const SUMMARIZE_CONCURRENCY = 5

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return require('crypto').timingSafeEqual(bufA, bufB)
}

async function processArticle(
  article: TavilyArticle,
  step: (m: string) => void
): Promise<'saved' | 'skipped' | 'failed'> {
  if (await articleExists(article.url)) return 'skipped'

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
    return 'saved'
  } catch (err) {
    step(`Failed article "${article.title.slice(0, 60)}": ${(err as Error).message?.slice(0, 100)}`)
    return 'failed'
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

    for (let i = 0; i < articles.length; i += SUMMARIZE_CONCURRENCY) {
      const batch = articles.slice(i, i + SUMMARIZE_CONCURRENCY)
      const results = await Promise.allSettled(batch.map((a) => processArticle(a, step)))
      for (const r of results) {
        if (r.status !== 'fulfilled') { failed++; continue }
        if (r.value === 'saved') saved++
        else if (r.value === 'skipped') skipped++
        else failed++
      }
    }

    step(`Processing done — saved: ${saved}, skipped: ${skipped}, failed: ${failed}`)

    step('Fetching subscribers...')
    const subscribers = await getActiveSubscribers()
    const emails = subscribers.map((s) => s.email)
    step(`Found ${emails.length} subscriber(s)`)

    if (emails.length > 0 && articles.length > 0) {
      step(`Composing newsletter from ${articles.length} fresh articles...`)
      const composed = await composeNewsletter(
        articles.map((a) => ({ title: a.title, url: a.url, content: a.content, source: a.source }))
      )

      if (!composed) {
        step('Composition returned null — skipping email send')
      } else {
        step(`Theme: ${composed.theme}`)
        step('Sending digest emails...')
        await sendDigestEmail(composed, emails)
        step('Emails sent')
      }
    } else {
      step('Skipped email — no subscribers or no articles')
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
