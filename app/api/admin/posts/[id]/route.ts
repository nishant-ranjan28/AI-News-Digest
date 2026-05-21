import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { updateRepurposedPost } from '@/lib/db'

type PostStatus = 'draft' | 'published' | 'archived'
type PatchBody = { content?: string; status?: PostStatus; slug?: string }

const ALLOWED_STATUSES: PostStatus[] = ['draft', 'published', 'archived']

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const body = (await req.json()) as PatchBody
  if (body.status !== undefined && !ALLOWED_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  const patch: Record<string, unknown> = {}
  if (typeof body.content === 'string') patch.content = body.content
  if (typeof body.slug === 'string') {
    const trimmed = body.slug.trim()
    patch.slug = trimmed === '' ? null : trimmed
  }
  if (body.status) {
    patch.status = body.status
    if (body.status === 'published') {
      patch.published_at = new Date().toISOString()
    } else {
      // Clear stale publish timestamp when reverting to draft or archived.
      patch.published_at = null
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Empty patch' }, { status: 400 })
  await updateRepurposedPost(id, patch)
  return NextResponse.json({ ok: true })
}
