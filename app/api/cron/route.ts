import { NextRequest, NextResponse } from 'next/server'
import { fetchAINews } from '@/lib/tavily'
import { summarizeArticle } from '@/lib/summarize'
import { articleExists, saveArticle, getArticlesByDate, getActiveSubscribers } from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return require('crypto').timingSafeEqual(bufA, bufB)
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || !authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const log: string[] = []
  const step = (msg: string) => { log.push(msg); console.log(`[cron] ${msg}`) }

  try {
    step('Starting pipeline')

    step('Fetching articles from Tavily...')
    const articles = await fetchAINews()
    step(`Fetched ${articles.length} articles`)

    let saved = 0
    let skipped = 0

    for (const article of articles) {
      const exists = await articleExists(article.url)
      if (exists) { skipped++; continue }

      try {
        step(`Summarizing: "${article.title.slice(0, 60)}"`)
        const result = await summarizeArticle({ title: article.title, content: article.content })
        await saveArticle({
          title: article.title,
          url: article.url,
          summary: result.summary,
          category: result.category,
          importance_score: result.importance_score,
          source: article.source,
          published_date: article.published_date,
        })
        saved++
        await sleep(500)
      } catch (err) {
        step(`Failed article "${article.title.slice(0, 60)}": ${(err as Error).message?.slice(0, 100)}`)
      }
    }

    step(`Processing done — saved: ${saved}, skipped: ${skipped}`)

    const today = new Date().toISOString().split('T')[0]
    step(`Fetching today's articles (${today})...`)
    const todayArticles = await getArticlesByDate(today)
    const top10 = todayArticles.slice(0, 10)
    step(`Found ${todayArticles.length} articles, using top ${top10.length}`)

    step('Fetching subscribers...')
    const subscribers = await getActiveSubscribers()
    const emails = subscribers.map((s) => s.email)
    step(`Found ${emails.length} subscriber(s)`)

    if (emails.length > 0 && top10.length > 0) {
      step('Sending digest emails...')
      await sendDigestEmail(top10, emails)
      step('Emails sent')
    } else {
      step('Skipped email — no subscribers or no articles')
    }

    return NextResponse.json({ success: true, saved, skipped, emailsSent: emails.length, log })
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown error'
    step(`Pipeline failed: ${message}`)
    return NextResponse.json(
      { error: 'Pipeline failed', details: message, log },
      { status: 500 }
    )
  }
}
