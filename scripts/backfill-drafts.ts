/**
 * One-off backfill script.
 *
 * Re-runs compose + repurpose against today's already-stored articles and
 * persists a newsletter_issues snapshot plus 4 repurposed_posts drafts.
 *
 * Use case: a deploy of the newsletter_issues / repurposed_posts persistence
 * landed AFTER a cron run had already sent the day's email. This script fills
 * in the missing rows without re-sending anything to subscribers.
 *
 * Run:
 *   npx ts-node --transpile-only scripts/backfill-drafts.ts
 *   npx ts-node --transpile-only scripts/backfill-drafts.ts --date=2026-05-21
 *   # If ts-node ESM/CJS complaints, fall back to:
 *   npx tsx scripts/backfill-drafts.ts
 *
 * IMPORTANT: This script does NOT send emails.
 */

import path from 'path'
import { loadEnvConfig } from '@next/env'

// Polyfill WebSocket for Supabase realtime-js v2.x. Its Node-version check is
// buggy and complains about "Node.js 20 without native WebSocket" even on Node
// 25+ (which has WebSocket natively). Always installing the `ws` polyfill is
// harmless and side-steps the check entirely.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebSocket: WSPolyfill } = require('ws')
;(globalThis as { WebSocket?: unknown }).WebSocket = WSPolyfill

// Load .env.local (and other Next.js env files) before importing modules
// that read process.env at module-init time.
loadEnvConfig(path.resolve(__dirname, '..'))

import {
  getArticlesByDate,
  saveNewsletterIssue,
  upsertRepurposedPost,
  saveExtractedSignal,
  type Article,
} from '@/lib/db'
import { composeNewsletter, type ComposeInput } from '@/lib/compose'
import { generateAllChannels, buildSlug } from '@/lib/repurpose'
import { extractSignal, type Signal } from '@/lib/extract-signal'

const log = (msg: string) => console.log(`[backfill] ${msg}`)
const err = (msg: string) => console.error(`[backfill] ${msg}`)

function parseDateArg(): string {
  const arg = process.argv.find((a) => a.startsWith('--date='))
  if (arg) {
    const v = arg.slice('--date='.length).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new Error(`--date must be YYYY-MM-DD, got: ${v}`)
    }
    return v
  }
  return new Date().toISOString().slice(0, 10)
}

function toComposeInput(a: Article): ComposeInput {
  const c = a.content
  const content = c
    ? `${c.headline}\n\n${c.what_happened}\n\n${c.why_it_matters}`
    : a.summary ?? ''
  return {
    title: a.title,
    url: a.url,
    content,
    source: a.source,
  }
}

async function main(): Promise<void> {
  const date = parseDateArg()
  log(`Backfilling for issue_date=${date}`)

  log('Fetching articles...')
  const articles = await getArticlesByDate(date)
  log(`Found ${articles.length} article(s) for ${date}`)
  if (articles.length === 0) {
    log('Nothing to do — exiting.')
    process.exit(0)
  }

  const inputs: ComposeInput[] = articles.map(toComposeInput)

  log(`Composing newsletter from ${inputs.length} article(s)...`)
  const composed = await composeNewsletter(inputs)
  if (!composed) {
    err('composeNewsletter returned null — aborting.')
    process.exit(1)
  }
  log(`Theme: ${composed.theme}`)

  const subject = composed.subject_teasers
    .map((t) => `${t.text} ${t.emoji}`)
    .join(', ')

  log('Saving newsletter_issues snapshot...')
  await saveNewsletterIssue(date, composed, subject)
  log('Snapshot saved.')

  log('Extracting daily signal from anchor story...')
  const anchor = composed.stories.find((s) => s.role === 'anchor')
  let signal: Signal | null = null
  if (anchor) {
    const anchorSummary = `${anchor.headline}\n\n${anchor.body}`
    signal = await extractSignal(anchorSummary)
    if (signal) {
      log(`Signal extracted: fact="${signal.fact.slice(0, 60)}..."`)
      try {
        await saveExtractedSignal({
          issue_date: date,
          anchor_headline: anchor.headline,
          fact: signal.fact,
          shift: signal.shift,
          why_care: signal.whyCare,
        })
        log('Signal saved.')
      } catch (e) {
        log(`Failed to save signal: ${(e as Error).message.slice(0, 120)}`)
      }
    } else {
      log('Signal extraction failed — short-form channels will be skipped.')
    }
  } else {
    log('No anchor story — signal extraction skipped.')
  }

  log('Generating repurposed drafts (linkedin, twitter, threads, article)...')
  const results = await generateAllChannels(composed, signal)

  const saved: string[] = []
  const skipped: string[] = []

  for (const { channel, content } of results) {
    if (!content) {
      log(`Skipped ${channel} — generation returned null`)
      skipped.push(channel)
      continue
    }
    const slug = channel === 'article' ? buildSlug(composed.theme, date) : null
    try {
      await upsertRepurposedPost({
        issue_date: date,
        channel,
        content,
        status: 'draft',
        slug,
        metadata: {
          chars: content.length,
          theme: composed.theme,
          source: 'backfill',
        },
      })
      saved.push(channel)
    } catch (e) {
      err(`Failed to save ${channel}: ${(e as Error).message?.slice(0, 160)}`)
      skipped.push(channel)
    }
  }

  log('--- Summary ---')
  log(`Articles:       ${articles.length}`)
  log(`Theme:          ${composed.theme}`)
  log(`Saved channels: ${saved.length ? saved.join(', ') : '(none)'}`)
  log(`Skipped:        ${skipped.length ? skipped.join(', ') : '(none)'}`)
  log('Backfill complete.')
  process.exit(0)
}

main().catch((e) => {
  err(`Fatal: ${(e as Error).message ?? e}`)
  process.exit(1)
})
