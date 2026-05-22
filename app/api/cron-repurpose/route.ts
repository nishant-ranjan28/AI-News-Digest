import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

import {
  getNewsletterIssue,
  saveExtractedSignal,
  upsertRepurposedPost,
} from '@/lib/db'
import { extractSignal, type Signal } from '@/lib/extract-signal'
import { generateAllChannels, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return require('crypto').timingSafeEqual(bufA, bufB)
}

async function runRepurpose() {
  const step = (msg: string) => console.log(`[cron-repurpose] ${msg}`)

  try {
    const today = new Date().toISOString().slice(0, 10)
    step(`Repurposing for issue_date=${today}`)

    const issue = await getNewsletterIssue(today)
    if (!issue) {
      step('No newsletter_issue for today — nothing to do.')
      return
    }
    const composed = issue.composed as ComposedNewsletter
    step(`Loaded issue: theme="${composed.theme}"`)

    // Extract a single daily signal from the anchor story
    const anchor = composed.stories.find((s) => s.role === 'anchor')
    let signal: Signal | null = null
    if (anchor) {
      step('Extracting signal from anchor story...')
      const anchorSummary = `${anchor.headline}\n\n${anchor.body}`
      signal = await extractSignal(anchorSummary)
      if (signal) {
        step(`Signal extracted: fact="${signal.fact.slice(0, 60)}..."`)
        try {
          await saveExtractedSignal({
            issue_date: today,
            anchor_headline: anchor.headline,
            fact: signal.fact,
            shift: signal.shift,
            why_care: signal.whyCare,
          })
          step('Signal saved.')
        } catch (e) {
          step(`Failed to save signal: ${(e as Error).message.slice(0, 120)}`)
        }
      } else {
        step('Signal extraction failed — short-form channels will be skipped.')
      }
    } else {
      step('No anchor story — signal extraction skipped.')
    }

    step('Generating drafts (linkedin, twitter, threads, article)...')
    try {
      const results = await generateAllChannels(composed, signal)
      let drafts = 0
      for (const { channel, content } of results) {
        if (!content) {
          step(`Skipped ${channel} — generation returned null`)
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
      step(`Saved ${drafts}/4 drafts`)
    } catch (e) {
      step(`Repurposing step failed: ${(e as Error).message.slice(0, 120)}`)
    }

    step('Repurpose pipeline complete')
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown error'
    console.error(`[cron-repurpose] Pipeline failed: ${message}`)
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || !authHeader || !timingSafeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await runRepurpose()

  return NextResponse.json({ success: true, message: 'Repurpose complete' })
}
