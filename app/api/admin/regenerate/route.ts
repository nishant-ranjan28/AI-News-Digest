import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import {
  getNewsletterIssue,
  getRepurposedPostsByDate,
  updateRepurposedPost,
  upsertRepurposedPost,
  getExtractedSignalByDate,
  type RepurposedChannel,
} from '@/lib/db'
import { generateForChannel, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'
import type { Signal } from '@/lib/extract-signal'

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { channel, date } = (await req.json()) as { channel: RepurposedChannel; date: string }
  if (!channel || !date) return NextResponse.json({ error: 'Missing channel or date' }, { status: 400 })
  const ALLOWED: RepurposedChannel[] = ['linkedin', 'twitter', 'threads', 'article']
  if (!ALLOWED.includes(channel)) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
  }

  const issue = await getNewsletterIssue(date)
  if (!issue) return NextResponse.json({ error: 'No newsletter issue for that date' }, { status: 404 })

  const composed = issue.composed as ComposedNewsletter
  const signal = await getExtractedSignalByDate(date)
  const compatSignal: Signal | null = signal
    ? { fact: signal.fact, shift: signal.shift, whyCare: signal.why_care }
    : null
  const content = await generateForChannel(channel, composed, compatSignal)
  if (!content) return NextResponse.json({ error: 'Generation failed' }, { status: 502 })

  const slug = channel === 'article' ? buildSlug(composed.theme, date) : null
  const metadata = { chars: content.length, theme: composed.theme, regenerated: true }

  const existing = (await getRepurposedPostsByDate(date)).find((p) => p.channel === channel)
  if (existing?.id) {
    // Preserve status and published_at on an existing row (e.g. an article that's already published).
    await updateRepurposedPost(existing.id, { content, slug, metadata })
  } else {
    await upsertRepurposedPost({
      issue_date: date,
      channel,
      content,
      status: 'draft',
      slug,
      metadata,
    })
  }
  return NextResponse.json({ ok: true, content })
}
