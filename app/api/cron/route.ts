import { NextRequest, NextResponse } from 'next/server'
import { fetchAINews, TavilyArticle } from '@/lib/tavily'

export const maxDuration = 60

import { summarizeArticle } from '@/lib/summarize'
import { composeNewsletter } from '@/lib/compose'
import {
  articleExists,
  saveArticle,
  getActiveSubscribers,
  upsertRepurposedPost,
  saveNewsletterIssue,
} from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'
import { generateAllChannels, buildSlug } from '@/lib/repurpose'

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

        // Persist the issue + generate repurposed drafts (must not block/fail the email)
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

        step('Generating repurposed drafts (linkedin, twitter, threads, article)...')
        try {
          const results = await generateAllChannels(composed)
          let drafts = 0
          for (const { channel, content } of results) {
            if (!content) {
              step(`Skipped ${channel} — generation failed`)
              continue
            }
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
        } catch (e) {
          step(`Repurposing step failed: ${(e as Error).message.slice(0, 120)}`)
        }
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
