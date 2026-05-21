import { getServerSupabase } from './supabase-server'

export function isAllowlistedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const raw = process.env.ADMIN_ALLOWLIST_EMAILS ?? ''
  const allow = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (allow.length === 0) return false
  return allow.includes(email.trim().toLowerCase())
}

export async function requireAdmin(): Promise<{ email: string } | null> {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null
  if (!isAllowlistedEmail(user.email)) return null
  return { email: user.email }
}
