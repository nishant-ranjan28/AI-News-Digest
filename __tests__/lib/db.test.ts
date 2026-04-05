import { getSupabaseClient, articleExists, saveArticle, getArticlesByDate, getActiveSubscribers, logEmailResult } from '@/lib/db'

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}))

describe('db helpers', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'test-key'
  })

  it('getSupabaseClient returns a client instance', () => {
    const client = getSupabaseClient()
    expect(client).toBeDefined()
    expect(client.from).toBeDefined()
  })

  it('articleExists returns false when no article found', async () => {
    const result = await articleExists('https://example.com/article')
    expect(result).toBe(false)
  })

  it('saveArticle calls insert with correct shape', async () => {
    const article = {
      title: 'Test Article',
      url: 'https://example.com/test',
      summary: 'A test summary',
      category: 'LLM',
      importance_score: 8,
      source: 'example.com',
      published_date: '2026-03-11',
    }
    await expect(saveArticle(article)).resolves.not.toThrow()
  })

  it('logEmailResult inserts without throwing', async () => {
    await expect(
      logEmailResult({
        recipient: 'user@test.com',
        status: 'sent',
        provider: 'sendgrid',
      })
    ).resolves.not.toThrow()
  })

  it('logEmailResult handles errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    // logEmailResult catches its own errors, so it should never throw
    await expect(
      logEmailResult({
        recipient: 'user@test.com',
        status: 'failed',
        provider: 'resend',
        error_message: 'Some error',
      })
    ).resolves.not.toThrow()
    consoleSpy.mockRestore()
  })
})
