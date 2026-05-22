/** @jest-environment node */
import { GET } from '@/app/api/cron/route'
import { NextRequest } from 'next/server'
import { composeNewsletter } from '@/lib/compose'
import { getActiveSubscribers, saveNewsletterIssue } from '@/lib/db'
import { sendDigestEmail } from '@/lib/email'
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
}))
jest.mock('@/lib/email', () => ({
  sendDigestEmail: jest.fn().mockResolvedValue(undefined),
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

  describe('newsletter send + snapshot', () => {
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
    })

    it('sends email and saves newsletter_issues snapshot after compose', async () => {
      const req = new NextRequest('http://localhost/api/cron', {
        method: 'GET',
        headers: { Authorization: 'Bearer test-secret' },
      })
      const res = await GET(req)
      expect(res.status).toBe(200)

      expect(sendDigestEmail).toHaveBeenCalledTimes(1)
      expect(saveNewsletterIssue).toHaveBeenCalledTimes(1)
      const [dateArg, composedArg, subjectArg] =
        (saveNewsletterIssue as jest.Mock).mock.calls[0]
      expect(dateArg).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(composedArg).toBe(composedFixture)
      expect(subjectArg).toContain('Anchor teaser')

      // snapshot save happens AFTER email send
      const sendOrder = (sendDigestEmail as jest.Mock).mock.invocationCallOrder[0]
      const saveOrder = (saveNewsletterIssue as jest.Mock).mock.invocationCallOrder[0]
      expect(saveOrder).toBeGreaterThan(sendOrder)
    })

    it('still returns 200 if saveNewsletterIssue fails', async () => {
      ;(saveNewsletterIssue as jest.Mock).mockRejectedValueOnce(new Error('db down'))
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
