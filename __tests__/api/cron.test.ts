/** @jest-environment node */
import { GET } from '@/app/api/cron/route'
import { NextRequest } from 'next/server'
import { composeNewsletter } from '@/lib/compose'
import {
  getActiveSubscribers,
  saveNewsletterIssue,
  upsertRepurposedPost,
} from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'
import { generateAllChannels, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

jest.mock('@/lib/tavily', () => ({
  fetchAINews: jest.fn().mockResolvedValue([
    { title: 'Test', url: 'https://example.com', content: 'Content', source: 'example.com' },
  ]),
}))
jest.mock('@/lib/summarize', () => ({
  summarizeArticle: jest.fn().mockResolvedValue({
    summary: 'Test summary',
    category: 'LLM',
    importance_score: 8,
  }),
}))
jest.mock('@/lib/compose', () => ({
  composeNewsletter: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/db', () => ({
  articleExists: jest.fn().mockResolvedValue(false),
  saveArticle: jest.fn().mockResolvedValue(undefined),
  getArticlesByDate: jest.fn().mockResolvedValue([]),
  getActiveSubscribers: jest.fn().mockResolvedValue([]),
  saveNewsletterIssue: jest.fn().mockResolvedValue(undefined),
  upsertRepurposedPost: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/email', () => ({
  sendDigestEmail: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/repurpose', () => ({
  generateAllChannels: jest.fn().mockResolvedValue([
    { channel: 'linkedin', content: 'LI post' },
    { channel: 'twitter', content: 'tweet' },
    { channel: 'threads', content: 'threads post' },
    { channel: 'article', content: '# Article body' },
  ]),
  buildSlug: jest.fn().mockReturnValue('2026-05-20-test-theme'),
}))

describe('GET /api/cron', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 with missing auth header', async () => {
    const req = new NextRequest('http://localhost/api/cron', { method: 'GET' })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const req = new NextRequest('http://localhost/api/cron', {
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 200 and runs pipeline with valid auth', async () => {
    const req = new NextRequest('http://localhost/api/cron', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  describe('repurposing happy path', () => {
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

    beforeEach(() => {
      jest.clearAllMocks()
      ;(getActiveSubscribers as jest.Mock).mockResolvedValue([
        { email: 'subscriber@example.com' },
      ])
      ;(composeNewsletter as jest.Mock).mockResolvedValue(composedFixture)
      ;(sendDigestEmail as jest.Mock).mockResolvedValue(undefined)
      ;(saveNewsletterIssue as jest.Mock).mockResolvedValue(undefined)
      ;(upsertRepurposedPost as jest.Mock).mockResolvedValue(undefined)
      ;(generateAllChannels as jest.Mock).mockResolvedValue([
        { channel: 'linkedin', content: 'LI post' },
        { channel: 'twitter', content: 'tweet' },
        { channel: 'threads', content: 'threads post' },
        { channel: 'article', content: '# Article body' },
      ])
      ;(buildSlug as jest.Mock).mockReturnValue('2026-05-20-test-theme')
    })

    it('persists the issue and saves 4 repurposed drafts after sending email', async () => {
      const req = new NextRequest('http://localhost/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-secret' },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      expect(sendDigestEmail).toHaveBeenCalledTimes(1)

      // saveNewsletterIssue called once with (date, composed, subject)
      expect(saveNewsletterIssue).toHaveBeenCalledTimes(1)
      const [dateArg, composedArg, subjectArg] =
        (saveNewsletterIssue as jest.Mock).mock.calls[0]
      expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(composedArg).toBe(composedFixture)
      expect(typeof subjectArg).toBe('string')
      expect(subjectArg).toContain('Anchor teaser')

      // upsertRepurposedPost called 4 times — once per channel
      expect(upsertRepurposedPost).toHaveBeenCalledTimes(4)
      const calls = (upsertRepurposedPost as jest.Mock).mock.calls.map((c) => c[0])
      const byChannel = Object.fromEntries(calls.map((c) => [c.channel, c]))

      expect(byChannel.linkedin).toMatchObject({
        channel: 'linkedin',
        content: 'LI post',
        status: 'draft',
        slug: null,
      })
      expect(byChannel.twitter).toMatchObject({
        channel: 'twitter',
        content: 'tweet',
        status: 'draft',
        slug: null,
      })
      expect(byChannel.threads).toMatchObject({
        channel: 'threads',
        content: 'threads post',
        status: 'draft',
        slug: null,
      })
      expect(byChannel.article).toMatchObject({
        channel: 'article',
        content: '# Article body',
        status: 'draft',
        slug: '2026-05-20-test-theme',
      })

      // Repurposing runs AFTER sendDigestEmail
      const sendOrder = (sendDigestEmail as jest.Mock).mock.invocationCallOrder[0]
      const saveIssueOrder = (saveNewsletterIssue as jest.Mock).mock
        .invocationCallOrder[0]
      const firstUpsertOrder = (upsertRepurposedPost as jest.Mock).mock
        .invocationCallOrder[0]
      expect(saveIssueOrder).toBeGreaterThan(sendOrder)
      expect(firstUpsertOrder).toBeGreaterThan(sendOrder)
    })

    it('still returns 200 if a repurposed draft save fails', async () => {
      ;(upsertRepurposedPost as jest.Mock).mockRejectedValueOnce(
        new Error('db down')
      )
      const req = new NextRequest('http://localhost/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-secret' },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)
      expect(sendDigestEmail).toHaveBeenCalledTimes(1)
    })
  })
})
