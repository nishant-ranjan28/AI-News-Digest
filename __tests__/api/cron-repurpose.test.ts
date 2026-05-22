/** @jest-environment node */
import { GET } from '@/app/api/cron-repurpose/route'
import { NextRequest } from 'next/server'
import {
  getNewsletterIssue,
  saveExtractedSignal,
  upsertRepurposedPost,
} from '@/lib/db'
import { extractSignal } from '@/lib/extract-signal'
import { generateAllChannels, buildSlug } from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

jest.mock('@/lib/db', () => ({
  getNewsletterIssue: jest.fn(),
  saveExtractedSignal: jest.fn().mockResolvedValue(undefined),
  upsertRepurposedPost: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/extract-signal', () => ({
  extractSignal: jest.fn(),
}))
jest.mock('@/lib/repurpose', () => ({
  generateAllChannels: jest.fn(),
  buildSlug: jest.fn().mockReturnValue('2026-05-22-test-theme'),
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

describe('GET /api/cron-repurpose', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 with missing auth header', async () => {
    const req = new NextRequest('http://localhost/api/cron-repurpose', { method: 'GET' })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const req = new NextRequest('http://localhost/api/cron-repurpose', {
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 200 and exits cleanly when no newsletter_issue exists for today', async () => {
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/cron-repurpose', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(extractSignal).not.toHaveBeenCalled()
    expect(generateAllChannels).not.toHaveBeenCalled()
    expect(upsertRepurposedPost).not.toHaveBeenCalled()
  })

  it('extracts signal, persists it, generates 4 drafts, and saves them', async () => {
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-22',
      composed: composedFixture,
    })
    ;(extractSignal as jest.Mock).mockResolvedValue({
      fact: 'A fact.',
      shift: 'A shift.',
      whyCare: 'Why care.',
    })
    ;(generateAllChannels as jest.Mock).mockResolvedValue([
      { channel: 'linkedin', content: 'LI post' },
      { channel: 'twitter', content: 'tweet' },
      { channel: 'threads', content: 'threads post' },
      { channel: 'article', content: '# Article body' },
    ])

    const req = new NextRequest('http://localhost/api/cron-repurpose', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(extractSignal).toHaveBeenCalledTimes(1)
    const summaryArg = (extractSignal as jest.Mock).mock.calls[0][0] as string
    expect(summaryArg).toContain('Anchor headline')
    expect(summaryArg).toContain('Anchor body.')

    expect(saveExtractedSignal).toHaveBeenCalledTimes(1)
    const signalRow = (saveExtractedSignal as jest.Mock).mock.calls[0][0]
    expect(signalRow).toMatchObject({
      anchor_headline: 'Anchor headline',
      fact: 'A fact.',
      shift: 'A shift.',
      why_care: 'Why care.',
    })
    expect(signalRow.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(generateAllChannels).toHaveBeenCalledTimes(1)
    const [composedArg, signalArg] = (generateAllChannels as jest.Mock).mock.calls[0]
    expect(composedArg).toBe(composedFixture)
    expect(signalArg).toEqual({
      fact: 'A fact.',
      shift: 'A shift.',
      whyCare: 'Why care.',
    })

    expect(upsertRepurposedPost).toHaveBeenCalledTimes(4)
    const calls = (upsertRepurposedPost as jest.Mock).mock.calls.map((c) => c[0])
    const byChannel = Object.fromEntries(calls.map((c) => [c.channel, c]))
    expect(byChannel.linkedin).toMatchObject({ channel: 'linkedin', content: 'LI post', status: 'draft', slug: null })
    expect(byChannel.twitter).toMatchObject({ channel: 'twitter', content: 'tweet', status: 'draft', slug: null })
    expect(byChannel.threads).toMatchObject({ channel: 'threads', content: 'threads post', status: 'draft', slug: null })
    expect(byChannel.article).toMatchObject({ channel: 'article', content: '# Article body', status: 'draft', slug: '2026-05-22-test-theme' })

    // Signal extraction runs BEFORE generation
    const extractOrder = (extractSignal as jest.Mock).mock.invocationCallOrder[0]
    const generateOrder = (generateAllChannels as jest.Mock).mock.invocationCallOrder[0]
    expect(generateOrder).toBeGreaterThan(extractOrder)
  })

  it('still generates article when extractSignal returns null', async () => {
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-22',
      composed: composedFixture,
    })
    ;(extractSignal as jest.Mock).mockResolvedValue(null)
    ;(generateAllChannels as jest.Mock).mockResolvedValue([
      { channel: 'linkedin', content: null },
      { channel: 'twitter', content: null },
      { channel: 'threads', content: null },
      { channel: 'article', content: '# Article body' },
    ])

    const req = new NextRequest('http://localhost/api/cron-repurpose', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    expect(saveExtractedSignal).not.toHaveBeenCalled()
    const [, signalArg] = (generateAllChannels as jest.Mock).mock.calls[0]
    expect(signalArg).toBeNull()

    const calls = (upsertRepurposedPost as jest.Mock).mock.calls.map((c) => c[0])
    const byChannel = Object.fromEntries(calls.map((c) => [c.channel, c]))
    expect(byChannel.article).toMatchObject({ channel: 'article', content: '# Article body' })
    expect(byChannel.linkedin).toBeUndefined()
    expect(byChannel.twitter).toBeUndefined()
    expect(byChannel.threads).toBeUndefined()
  })

  it('still returns 200 if a single upsertRepurposedPost fails', async () => {
    ;(getNewsletterIssue as jest.Mock).mockResolvedValue({
      issue_date: '2026-05-22',
      composed: composedFixture,
    })
    ;(extractSignal as jest.Mock).mockResolvedValue({
      fact: 'A fact.',
      shift: 'A shift.',
      whyCare: 'Why care.',
    })
    ;(generateAllChannels as jest.Mock).mockResolvedValue([
      { channel: 'linkedin', content: 'LI post' },
      { channel: 'twitter', content: 'tweet' },
      { channel: 'threads', content: 'threads post' },
      { channel: 'article', content: '# Article body' },
    ])
    ;(upsertRepurposedPost as jest.Mock).mockRejectedValueOnce(new Error('db down'))

    const req = new NextRequest('http://localhost/api/cron-repurpose', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    // The other 3 should still be attempted
    expect(upsertRepurposedPost).toHaveBeenCalledTimes(4)
  })
})
