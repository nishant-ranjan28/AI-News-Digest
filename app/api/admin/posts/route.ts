import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getRepurposedPostsByDate } from '@/lib/db'

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  const posts = await getRepurposedPostsByDate(date)
  return NextResponse.json({ posts })
}
