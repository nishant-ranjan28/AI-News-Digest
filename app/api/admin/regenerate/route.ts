import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getNewsletterIssue, upsertRepurposedPost, type RepurposedChannel } from '@/lib/db'
import { generateForChannel, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { channel, date } = (await req.json()) as { channel: RepurposedChannel; date: string }
  if (!channel || !date) return NextResponse.json({ error: 'Missing channel or date' }, { status: 400 })

  const issue = await getNewsletterIssue(date)
  if (!issue) return NextResponse.json({ error: 'No newsletter issue for that date' }, { status: 404 })

  const composed = issue.composed as ComposedNewsletter
  const content = await generateForChannel(channel, composed)
  if (!content) return NextResponse.json({ error: 'Generation failed' }, { status: 502 })

  const slug = channel === 'article' ? buildSlug(composed.theme, date) : null
  await upsertRepurposedPost({
    issue_date: date,
    channel,
    content,
    status: 'draft',
    slug,
    metadata: { chars: content.length, theme: composed.theme, regenerated: true },
  })
  return NextResponse.json({ ok: true, content })
}
