/** @jest-environment node */
import { POST } from '@/app/api/subscribe/route'
import { NextRequest } from 'next/server'

const mockAddSubscriber = jest.fn()
jest.mock('@/lib/db', () => ({
  addSubscriber: (...args: unknown[]) => mockAddSubscriber(...args),
}))

describe('POST /api/subscribe', () => {
  beforeEach(() => jest.clearAllMocks())

  it('subscribes a valid email', async () => {
    mockAddSubscriber.mockResolvedValue(undefined)
    const req = new NextRequest('http://localhost/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 400 for missing email', async () => {
    const req = new NextRequest('http://localhost/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid email format', async () => {
    const req = new NextRequest('http://localhost/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 409 for already subscribed email', async () => {
    mockAddSubscriber.mockRejectedValue(new Error('Email already subscribed'))
    const req = new NextRequest('http://localhost/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
  })
})
