import { createClient, SupabaseClient } from '@supabase/supabase-js'

export type ArticleContent = {
  headline: string
  what_happened: string
  why_it_matters: string
}

export type Article = {
  id?: string
  title: string
  url: string
  summary?: string
  content?: ArticleContent
  category?: string
  importance_score?: number
  source?: string
  published_date?: string
  created_at?: string
}

export type Subscriber = {
  id?: string
  email: string
  subscribed_at?: string
  active?: boolean
  referral_code?: string | null
  referred_by?: string | null
  referral_count?: number
}

export type EmailLog = {
  recipient: string
  status: 'sent' | 'failed'
  provider: 'brevo' | 'sendgrid' | 'resend'
  error_message?: string
}

export type RepurposedChannel = 'linkedin' | 'twitter' | 'threads' | 'article'
export type RepurposedStatus = 'draft' | 'published' | 'archived'

export type RepurposedPost = {
  id?: string
  issue_date: string         // YYYY-MM-DD
  channel: RepurposedChannel
  content: string
  metadata?: Record<string, unknown> | null
  status?: RepurposedStatus
  slug?: string | null
  published_at?: string | null
  created_at?: string
  updated_at?: string
}

export type NewsletterIssue = {
  id?: string
  issue_date: string
  composed: unknown          // ComposedNewsletter, but lib/db avoids importing compose to prevent a cycle
  subject?: string
  created_at?: string
}

export type ExtractedSignal = {
  id?: string
  issue_date: string
  anchor_headline: string
  fact: string
  shift: string
  why_care: string
  created_at?: string
}

let supabaseInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL
    // Server-side only. The service-role key has BYPASSRLS, so these queries keep
    // working now that RLS is enabled (migration 005). Never expose this key to
    // the browser — it is not prefixed NEXT_PUBLIC_ and must stay server-side.
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    supabaseInstance = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return supabaseInstance
}

export async function articleExists(url: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('articles')
    .select('id')
    .eq('url', url)
    .maybeSingle()
  if (error) throw new Error(`DB error checking article: ${error.message}`)
  return data !== null
}

export async function saveArticle(article: Omit<Article, 'id' | 'created_at'>): Promise<void> {
  const supabase = getSupabaseClient()
  const row = {
    ...article,
    summary: article.summary ?? article.content?.what_happened ?? null,
  }
  const { error } = await supabase.from('articles').insert(row)
  if (error) throw new Error(`DB error saving article: ${error.message}`)
}

export async function getArticlesByDate(date: string): Promise<Article[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .gte('created_at', `${date}T00:00:00`)
    .lte('created_at', `${date}T23:59:59`)
    .order('importance_score', { ascending: false })
  if (error) throw new Error(`DB error fetching articles: ${error.message}`)
  return data ?? []
}

export async function getRecentArticles(limit = 12): Promise<Article[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`DB error fetching recent articles: ${error.message}`)
  return data ?? []
}

export function generateReferralCode(email: string): string {
  // Deterministic 8-char code from email — no DB needed for old rows
  const hash = Buffer.from(email.toLowerCase()).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()
  return hash.padEnd(8, '0')
}

export async function getActiveSubscribers(): Promise<Subscriber[]> {
  const supabase = getSupabaseClient()
  // Try with referral columns, fall back to email-only if migration not yet applied
  const { data, error } = await supabase
    .from('subscribers')
    .select('email, referral_code, referral_count')
    .eq('active', true)
  if (error) {
    if (error.message?.includes('referral_code')) {
      const { data: fallback, error: e2 } = await supabase.from('subscribers').select('email').eq('active', true)
      if (e2) throw new Error(`DB error fetching subscribers: ${e2.message}`)
      return (fallback ?? []).map((r: any) => ({ email: r.email, referral_code: generateReferralCode(r.email), referral_count: 0 }))
    }
    throw new Error(`DB error fetching subscribers: ${error.message}`)
  }
  return (data ?? []).map((r: any) => ({
    email: r.email,
    referral_code: r.referral_code ?? generateReferralCode(r.email),
    referral_count: r.referral_count ?? 0,
  }))
}

export async function logEmailResult(log: EmailLog): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    await supabase.from('email_logs').insert(log)
  } catch (err) {
    console.error(`[email-log] Failed to log delivery: ${(err as Error).message}`)
  }
}

export async function addSubscriber(email: string, referredBy?: string | null): Promise<void> {
  const supabase = getSupabaseClient()
  const referral_code = generateReferralCode(email)
  const row: any = { email, referral_code }
  if (referredBy) row.referred_by = referredBy
  const { error } = await supabase.from('subscribers').insert(row)
  if (error) {
    if (error.message?.includes('referral_code') || error.message?.includes('referred_by')) {
      // Migration not applied yet — fallback to email-only
      const { error: e2 } = await supabase.from('subscribers').insert({ email })
      if (e2) {
        if (e2.code === '23505') throw new Error('Email already subscribed')
        throw new Error(`DB error adding subscriber: ${e2.message}`)
      }
      return
    }
    if (error.code === '23505') throw new Error('Email already subscribed')
    throw new Error(`DB error adding subscriber: ${error.message}`)
  }
  // Increment referrer count (best-effort)
  if (referredBy) {
    try {
      const { data: ref } = await supabase.from('subscribers').select('referral_count').eq('referral_code', referredBy).maybeSingle()
      if (ref) {
        await supabase.from('subscribers').update({ referral_count: (ref.referral_count ?? 0) + 1 }).eq('referral_code', referredBy)
      }
    } catch {}
  }
}

export async function upsertRepurposedPost(
  post: Omit<RepurposedPost, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  const supabase = getSupabaseClient()
  const row = { ...post, updated_at: new Date().toISOString() }
  const { error } = await supabase
    .from('repurposed_posts')
    .upsert(row, { onConflict: 'issue_date,channel' })
  if (error) throw new Error(`DB error upserting repurposed_post: ${error.message}`)
}

export async function getRepurposedPostsByDate(date: string): Promise<RepurposedPost[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('repurposed_posts')
    .select('*')
    .eq('issue_date', date)
    .order('channel', { ascending: true })
  if (error) throw new Error(`DB error fetching repurposed_posts: ${error.message}`)
  return (data ?? []) as RepurposedPost[]
}

export async function updateRepurposedPost(
  id: string,
  patch: Partial<Pick<RepurposedPost, 'content' | 'status' | 'slug' | 'published_at' | 'metadata'>>
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('repurposed_posts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`DB error updating repurposed_post: ${error.message}`)
}

export async function getPublishedArticleBySlug(slug: string): Promise<RepurposedPost | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('repurposed_posts')
    .select('*')
    .eq('channel', 'article')
    .eq('status', 'published')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`DB error fetching article: ${error.message}`)
  return (data as RepurposedPost) ?? null
}

export async function saveNewsletterIssue(
  date: string,
  composed: unknown,
  subject?: string
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('newsletter_issues')
    .upsert({ issue_date: date, composed, subject }, { onConflict: 'issue_date' })
  if (error) throw new Error(`DB error saving newsletter_issue: ${error.message}`)
}

export async function getNewsletterIssue(date: string): Promise<NewsletterIssue | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('newsletter_issues')
    .select('*')
    .eq('issue_date', date)
    .maybeSingle()
  if (error) throw new Error(`DB error fetching newsletter_issue: ${error.message}`)
  return (data as NewsletterIssue) ?? null
}

export async function saveExtractedSignal(
  signal: Omit<ExtractedSignal, 'id' | 'created_at'>
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('extracted_signals')
    .upsert(signal, { onConflict: 'issue_date' })
  if (error) throw new Error(`DB error saving extracted_signal: ${error.message}`)
}

export async function getExtractedSignalByDate(date: string): Promise<ExtractedSignal | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('extracted_signals')
    .select('*')
    .eq('issue_date', date)
    .maybeSingle()
  if (error) throw new Error(`DB error fetching extracted_signal: ${error.message}`)
  return (data as ExtractedSignal) ?? null
}

export async function getRecentToolNames(days = 14): Promise<string[]> {
  const supabase = getSupabaseClient()
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('newsletter_issues')
    .select('composed')
    .gte('issue_date', sinceStr)
    .order('issue_date', { ascending: false })
    .limit(20)
  if (error) {
    console.warn('[db] getRecentToolNames failed:', error.message)
    return []
  }
  const names: string[] = []
  for (const row of data ?? []) {
    const tool = (row.composed as any)?.tool?.name
    if (typeof tool === 'string' && tool.trim()) names.push(tool.trim())
  }
  return [...new Set(names)]
}
