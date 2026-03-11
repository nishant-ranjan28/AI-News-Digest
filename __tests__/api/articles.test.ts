/** @jest-environment node */
import { GET } from '@/app/api/articles/route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/db', () => ({
  getArticlesByDate: jest.fn().mockResolvedValue([
    {
      id: '1',
      title: 'Test',
      url: 'https://example.com',
      summary: 'Summary',
      category: 'LLM',
      importance_score: 8,
      source: 'example.com',
    },
  ]),
}))

describe('GET /api/articles', () => {
  it('returns articles for today when no date param', async () => {
    const req = new NextRequest('http://localhost/api/articles')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.articles)).toBe(true)
  })

  it('returns articles for a specific date', async () => {
    const req = new NextRequest('http://localhost/api/articles?date=2026-03-11')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})
