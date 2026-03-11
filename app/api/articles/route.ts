import { NextRequest, NextResponse } from 'next/server'
import { getArticlesByDate } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0]

  try {
    const articles = await getArticlesByDate(date)
    return NextResponse.json({ articles })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch articles', details: (err as Error).message },
      { status: 500 }
    )
  }
}
