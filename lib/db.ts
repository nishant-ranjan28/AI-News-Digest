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
}

export type EmailLog = {
  recipient: string
  status: 'sent' | 'failed'
  provider: 'brevo' | 'sendgrid' | 'resend'
  error_message?: string
}

let supabaseInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
    supabaseInstance = createClient(url, key)
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

export async function getActiveSubscribers(): Promise<Subscriber[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('subscribers')
    .select('email')
    .eq('active', true)
  if (error) throw new Error(`DB error fetching subscribers: ${error.message}`)
  return data ?? []
}

export async function logEmailResult(log: EmailLog): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    await supabase.from('email_logs').insert(log)
  } catch (err) {
    console.error(`[email-log] Failed to log delivery: ${(err as Error).message}`)
  }
}

export async function addSubscriber(email: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('subscribers')
    .insert({ email })
  if (error) {
    if (error.code === '23505') throw new Error('Email already subscribed')
    throw new Error(`DB error adding subscriber: ${error.message}`)
  }
}
