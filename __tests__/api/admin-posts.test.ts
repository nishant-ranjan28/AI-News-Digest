/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET as getPosts } from '@/app/api/admin/posts/route'
import { PATCH as patchPost } from '@/app/api/admin/posts/[id]/route'
import { POST as regenerate } from '@/app/api/admin/regenerate/route'
import { requireAdmin } from '@/lib/admin-auth'
import {
  getRepurposedPostsByDate,
  updateRepurposedPost,
  getNewsletterIssue,
  upsertRepurposedPost,
} from '@/lib/db'
import { generateForChannel, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

jest.mock('@/lib/admin-auth', () => ({
  requireAdmin: jest.fn(),
}))

jest.mock('@/lib/db', () => ({
  getRepurposedPostsByDate: jest.fn(),
  updateRepurposedPost: jest.fn(),
  getNewsletterIssue: jest.fn(),
  upsertRepurposedPost: jest.fn(),
}))

jest.mock('@/lib/repurpose', () => ({
  generateForChannel: jest.fn(),
  buildSlug: jest.fn(),
}))

const composedFixture: ComposedNewsletter = {
  subject_teasers: [
    { text: 'Anchor teaser', emoji: '🚀' },
    { text: 'Supporting teaser', emoji: '💬' },
    { text: 'Contrast teaser', emoji: '🤖' },
  ],
  theme: 'Test theme',
  signal: 'A test signal',
  stories: [
    {
      role: 'anchor',
      headline: 'Anchor headline',
      body: 'Anchor body.',
      url: 'https://example.com/a',
      read_time_minutes: 2,
      hot_take: 'Hot take.',
    },
  ],
  tool: {
    name: 'TestTool',
    what: 'Does things',
    best_for: 'devs',
    why_now: 'Just shipped',
  },
  quick_takeaway: 'Takeaway line.',
  closing: { kind: 'statement', text: 'Closing line.' },
}

describe('GET /api/admin/posts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when not admin', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/admin/posts')
    const res = await getPosts(req)
    expect(res.status).toBe(401)
  })

  it('returns posts for the given date', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getRepurposedPostsByDate as jest.Mock).mockResolvedValue([
      { id: 'p1', channel: 'linkedin', content: 'LI', issue_date: '2026-05-20', status: 'draft' },
    ])
    const req = new NextRequest('http://localhost/api/admin/posts?date=2026-05-20')
    const res = await getPosts(req)
    expect(res.status).toBe(200)
    expect(getRepurposedPostsByDate).toHaveBeenCalledWith('2026-05-20')
    const body = await res.json()
    expect(body.posts).toHaveLength(1)
    expect(body.posts[0].channel).toBe('linkedin')
  })

  it('defaults to today when date param is missing', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getRepurposedPostsByDate as jest.Mock).mockResolvedValue([])
    const req = new NextRequest('http://localhost/api/admin/posts')
    const res = await getPosts(req)
    expect(res.status).toBe(200)
    const today = new Date().toISOString().slice(0, 10)
    expect(getRepurposedPostsByDate).toHaveBeenCalledWith(today)
  })
})

describe('PATCH /api/admin/posts/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function makeCtx(id: string) {
    return { params: Promise.resolve({ id }) }
  }

  it('returns 401 when not admin', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/admin/posts/abc', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'x' }),
    })
    const res = await patchPost(req, makeCtx('abc'))
    expect(res.status).toBe(401)
  })

  it('updates content', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(updateRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/posts/abc', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'new content' }),
    })
    const res = await patchPost(req, makeCtx('abc'))
    expect(res.status).toBe(200)
    expect(updateRepurposedPost).toHaveBeenCalledWith('abc', { content: 'new content' })
  })

  it('updates status to published and sets published_at', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(updateRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/posts/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'published' }),
    })
    const res = await patchPost(req, makeCtx('abc'))
    expect(res.status).toBe(200)
    expect(updateRepurposedPost).toHaveBeenCalledTimes(1)
    const [idArg, patchArg] = (updateRepurposedPost as jest.Mock).mock.calls[0]
    expect(idArg).toBe('abc')
    expect(patchArg.status).toBe('published')
    expect(typeof patchArg.published_at).toBe('string')
    expect(() => new Date(patchArg.published_at).toISOString()).not.toThrow()
  })

  it('clears published_at when status transitions to draft', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(updateRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/posts/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
    })
    const res = await patchPost(req, makeCtx('abc'))
    expect(res.status).toBe(200)
    expect(updateRepurposedPost).toHaveBeenCalledWith('abc', {
      status: 'draft',
      published_at: null,
    })
  })

  it('clears published_at when status transitions to archived', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(updateRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/posts/abc', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    })
    const res = await patchPost(req, makeCtx('abc'))
    expect(res.status).toBe(200)
    expect(updateRepurposedPost).toHaveBeenCalledWith('abc', {
      status: 'archived',
      published_at: null,
    })
  })

  it('returns 400 with empty body', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    const req = new NextRequest('http://localhost/api/admin/posts/abc', {
      method: 'PATCH',
      body: JSON.stringify({}),
    })
    const res = await patchPost(req, makeCtx('abc'))
    expect(res.status).toBe(400)
    expect(updateRepurposedPost).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/regenerate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 when not admin', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'linkedin', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 when channel missing', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when date missing', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'linkedin' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when no newsletter issue exists', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'linkedin', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(404)
  })

  it('returns 502 when generation fails', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-20',
      composed: composedFixture,
    })
    ;(generateForChannel as jest.Mock).mockResolvedValue(null)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'linkedin', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(502)
  })

  it('upserts a draft post (non-article: slug null)', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-20',
      composed: composedFixture,
    })
    ;(getRepurposedPostsByDate as jest.Mock).mockResolvedValue([])
    ;(generateForChannel as jest.Mock).mockResolvedValue('regenerated LI')
    ;(upsertRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'linkedin', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(200)
    expect(upsertRepurposedPost).toHaveBeenCalledTimes(1)
    const arg = (upsertRepurposedPost as jest.Mock).mock.calls[0][0]
    expect(arg).toMatchObject({
      issue_date: '2026-05-20',
      channel: 'linkedin',
      content: 'regenerated LI',
      status: 'draft',
      slug: null,
    })
  })

  it('upserts an article draft with computed slug', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-20',
      composed: composedFixture,
    })
    ;(getRepurposedPostsByDate as jest.Mock).mockResolvedValue([])
    ;(generateForChannel as jest.Mock).mockResolvedValue('# Markdown article body')
    ;(buildSlug as jest.Mock).mockReturnValue('2026-05-20-test-theme')
    ;(upsertRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'article', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(200)
    expect(buildSlug).toHaveBeenCalledWith('Test theme', '2026-05-20')
    const arg = (upsertRepurposedPost as jest.Mock).mock.calls[0][0]
    expect(arg).toMatchObject({
      issue_date: '2026-05-20',
      channel: 'article',
      content: '# Markdown article body',
      status: 'draft',
      slug: '2026-05-20-test-theme',
    })
  })

  it('creates a draft when no row exists yet', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-20',
      composed: composedFixture,
    })
    ;(getRepurposedPostsByDate as jest.Mock).mockResolvedValue([])
    ;(generateForChannel as jest.Mock).mockResolvedValue('fresh LI content')
    ;(upsertRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'linkedin', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(200)
    expect(upsertRepurposedPost).toHaveBeenCalledTimes(1)
    expect(updateRepurposedPost).not.toHaveBeenCalled()
    const arg = (upsertRepurposedPost as jest.Mock).mock.calls[0][0]
    expect(arg.status).toBe('draft')
  })

  it('preserves published status when regenerating an already-published article', async () => {
    ;(requireAdmin as jest.Mock).mockResolvedValue({ email: 'admin@example.com' })
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-20',
      composed: composedFixture,
    })
    ;(getRepurposedPostsByDate as jest.Mock).mockResolvedValue([
      {
        id: 'existing-id-123',
        issue_date: '2026-05-20',
        channel: 'article',
        content: 'old content',
        status: 'published',
        slug: '2026-05-20-test-theme',
        published_at: '2026-05-01T00:00:00Z',
      },
    ])
    ;(generateForChannel as jest.Mock).mockResolvedValue('# regenerated article body')
    ;(buildSlug as jest.Mock).mockReturnValue('2026-05-20-test-theme')
    ;(updateRepurposedPost as jest.Mock).mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/admin/regenerate', {
      method: 'POST',
      body: JSON.stringify({ channel: 'article', date: '2026-05-20' }),
    })
    const res = await regenerate(req)
    expect(res.status).toBe(200)
    expect(updateRepurposedPost).toHaveBeenCalledTimes(1)
    expect(upsertRepurposedPost).not.toHaveBeenCalled()
    const [idArg, patchArg] = (updateRepurposedPost as jest.Mock).mock.calls[0]
    expect(idArg).toBe('existing-id-123')
    expect(patchArg).toEqual({
      content: '# regenerated article body',
      slug: '2026-05-20-test-theme',
      metadata: { chars: '# regenerated article body'.length, theme: 'Test theme', regenerated: true },
    })
    expect(patchArg).not.toHaveProperty('status')
    expect(patchArg).not.toHaveProperty('published_at')
  })
})
