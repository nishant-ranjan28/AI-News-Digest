import { NextRequest, NextResponse } from 'next/server'
import { getArticlesByDate } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawDate = searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().split('T')[0]

  try {
    const articles = await getArticlesByDate(date)
    return NextResponse.json({ articles })
  } catch (err) {
    console.error('Failed to fetch articles:', err)
    return NextResponse.json({ error: 'Failed to fetch articles' }, { status: 500 })
  }
}
