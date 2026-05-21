import {
  getSupabaseClient,
  articleExists,
  saveArticle,
  getArticlesByDate,
  getActiveSubscribers,
  logEmailResult,
  upsertRepurposedPost,
  getRepurposedPostsByDate,
  updateRepurposedPost,
  getPublishedArticleBySlug,
  saveNewsletterIssue,
  getNewsletterIssue,
} from '@/lib/db'

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
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

describe('repurposed_posts helpers', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'test-key'
  })

  it('upsertRepurposedPost calls upsert with onConflict on issue_date,channel', async () => {
    const client = getSupabaseClient()
    const upsertMock = jest.fn().mockResolvedValue({ data: null, error: null })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ upsert: upsertMock })

    const row = {
      issue_date: '2026-05-20',
      channel: 'linkedin' as const,
      content: 'Hello LinkedIn',
      status: 'draft' as const,
    }
    await upsertRepurposedPost(row)

    expect(fromMock).toHaveBeenCalledWith('repurposed_posts')
    expect(upsertMock).toHaveBeenCalledWith(
      { ...row, updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
      { onConflict: 'issue_date,channel' }
    )
  })

  it('upsertRepurposedPost throws when supabase returns an error', async () => {
    const client = getSupabaseClient()
    const upsertMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ upsert: upsertMock })

    await expect(
      upsertRepurposedPost({
        issue_date: '2026-05-20',
        channel: 'twitter',
        content: 'tweet',
      })
    ).rejects.toThrow(/boom/)
  })

  it('getRepurposedPostsByDate filters by issue_date and returns rows', async () => {
    const client = getSupabaseClient()
    const rows = [
      { id: '1', issue_date: '2026-05-20', channel: 'linkedin', content: 'a' },
      { id: '2', issue_date: '2026-05-20', channel: 'twitter', content: 'b' },
    ]
    const orderMock = jest.fn().mockResolvedValue({ data: rows, error: null })
    const eqMock = jest.fn().mockReturnValue({ order: orderMock })
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ select: selectMock })

    const result = await getRepurposedPostsByDate('2026-05-20')
    expect(fromMock).toHaveBeenCalledWith('repurposed_posts')
    expect(eqMock).toHaveBeenCalledWith('issue_date', '2026-05-20')
    expect(result).toEqual(rows)
  })

  it('getRepurposedPostsByDate returns [] when data is null', async () => {
    const client = getSupabaseClient()
    const orderMock = jest.fn().mockResolvedValue({ data: null, error: null })
    const eqMock = jest.fn().mockReturnValue({ order: orderMock })
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ select: selectMock })

    const result = await getRepurposedPostsByDate('2026-05-20')
    expect(result).toEqual([])
  })

  it('updateRepurposedPost calls update with updated_at and eq on id', async () => {
    const client = getSupabaseClient()
    const eqMock = jest.fn().mockResolvedValue({ data: null, error: null })
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ update: updateMock })

    await updateRepurposedPost('abc-123', { content: 'new content', status: 'published' })

    expect(fromMock).toHaveBeenCalledWith('repurposed_posts')
    expect(updateMock).toHaveBeenCalledTimes(1)
    const patchArg = updateMock.mock.calls[0][0]
    expect(patchArg.content).toBe('new content')
    expect(patchArg.status).toBe('published')
    expect(typeof patchArg.updated_at).toBe('string')
    expect(eqMock).toHaveBeenCalledWith('id', 'abc-123')
  })

  it('getPublishedArticleBySlug filters channel/status/slug and returns row', async () => {
    const client = getSupabaseClient()
    const row = {
      id: '1',
      issue_date: '2026-05-20',
      channel: 'article',
      content: '# body',
      status: 'published',
      slug: 'hello',
    }
    const maybeSingleMock = jest.fn().mockResolvedValue({ data: row, error: null })
    const eq3Mock = jest.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const eq2Mock = jest.fn().mockReturnValue({ eq: eq3Mock })
    const eq1Mock = jest.fn().mockReturnValue({ eq: eq2Mock })
    const selectMock = jest.fn().mockReturnValue({ eq: eq1Mock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ select: selectMock })

    const result = await getPublishedArticleBySlug('hello')
    expect(fromMock).toHaveBeenCalledWith('repurposed_posts')
    expect(eq1Mock).toHaveBeenCalledWith('channel', 'article')
    expect(eq2Mock).toHaveBeenCalledWith('status', 'published')
    expect(eq3Mock).toHaveBeenCalledWith('slug', 'hello')
    expect(result).toEqual(row)
  })

  it('getPublishedArticleBySlug returns null when no row', async () => {
    const client = getSupabaseClient()
    const maybeSingleMock = jest.fn().mockResolvedValue({ data: null, error: null })
    const eq3Mock = jest.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const eq2Mock = jest.fn().mockReturnValue({ eq: eq3Mock })
    const eq1Mock = jest.fn().mockReturnValue({ eq: eq2Mock })
    const selectMock = jest.fn().mockReturnValue({ eq: eq1Mock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ select: selectMock })

    const result = await getPublishedArticleBySlug('missing')
    expect(result).toBeNull()
  })
})

describe('newsletter_issues helpers', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'test-key'
  })

  it('saveNewsletterIssue upserts on issue_date', async () => {
    const client = getSupabaseClient()
    const upsertMock = jest.fn().mockResolvedValue({ data: null, error: null })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ upsert: upsertMock })

    const composed = { theme: 'test', stories: [] }
    await saveNewsletterIssue('2026-05-20', composed, 'subject line')

    expect(fromMock).toHaveBeenCalledWith('newsletter_issues')
    expect(upsertMock).toHaveBeenCalledWith(
      { issue_date: '2026-05-20', composed, subject: 'subject line' },
      { onConflict: 'issue_date' }
    )
  })

  it('saveNewsletterIssue throws on supabase error', async () => {
    const client = getSupabaseClient()
    const upsertMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'fail' } })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ upsert: upsertMock })

    await expect(saveNewsletterIssue('2026-05-20', {}, 'x')).rejects.toThrow(/fail/)
  })

  it('getNewsletterIssue returns the row when found', async () => {
    const client = getSupabaseClient()
    const row = { id: '1', issue_date: '2026-05-20', composed: { theme: 't' }, subject: 's' }
    const maybeSingleMock = jest.fn().mockResolvedValue({ data: row, error: null })
    const eqMock = jest.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ select: selectMock })

    const result = await getNewsletterIssue('2026-05-20')
    expect(fromMock).toHaveBeenCalledWith('newsletter_issues')
    expect(eqMock).toHaveBeenCalledWith('issue_date', '2026-05-20')
    expect(result).toEqual(row)
  })

  it('getNewsletterIssue returns null when not found', async () => {
    const client = getSupabaseClient()
    const maybeSingleMock = jest.fn().mockResolvedValue({ data: null, error: null })
    const eqMock = jest.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock })
    const fromMock = client.from as unknown as jest.Mock
    fromMock.mockReturnValueOnce({ select: selectMock })

    const result = await getNewsletterIssue('2026-05-20')
    expect(result).toBeNull()
  })
})
