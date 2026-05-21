import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { updateRepurposedPost } from '@/lib/db'

type PatchBody = { content?: string; status?: 'draft' | 'published' | 'archived'; slug?: string }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const body = (await req.json()) as PatchBody
  const patch: Record<string, unknown> = {}
  if (typeof body.content === 'string') patch.content = body.content
  if (typeof body.slug === 'string') patch.slug = body.slug
  if (body.status) {
    patch.status = body.status
    if (body.status === 'published') patch.published_at = new Date().toISOString()
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Empty patch' }, { status: 400 })
  await updateRepurposedPost(id, patch)
  return NextResponse.json({ ok: true })
}
