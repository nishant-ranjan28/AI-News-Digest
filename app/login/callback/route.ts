import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/login?error=missing_code', req.url))

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url))

  return NextResponse.redirect(new URL('/admin', req.url))
}
