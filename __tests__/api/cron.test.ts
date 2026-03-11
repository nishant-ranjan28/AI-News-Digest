/** @jest-environment node */
import { GET } from '@/app/api/cron/route'
import { NextRequest } from 'next/server'

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
jest.mock('@/lib/db', () => ({
  articleExists: jest.fn().mockResolvedValue(false),
  saveArticle: jest.fn().mockResolvedValue(undefined),
  getArticlesByDate: jest.fn().mockResolvedValue([]),
  getActiveSubscribers: jest.fn().mockResolvedValue([]),
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
})
