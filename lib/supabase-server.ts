import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function getServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(items) {
          try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch { /* called from a server component; allowed to no-op */ }
        },
      },
    }
  )
}
