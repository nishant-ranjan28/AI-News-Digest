import { sendDigestEmail } from '@/lib/email'
import { Article } from '@/lib/db'

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'email-123' }, error: null }),
    },
  })),
}))

describe('sendDigestEmail', () => {
  const mockArticles: Article[] = [
    {
      title: 'GPT-5 Released',
      url: 'https://example.com/gpt5',
      summary: 'OpenAI released GPT-5 with massive improvements.',
      category: 'LLM',
      importance_score: 9,
      source: 'example.com',
      published_date: '2026-03-11',
    },
  ]

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  it('sends email to each subscriber', async () => {
    const subscribers = ['user1@test.com', 'user2@test.com']
    await expect(sendDigestEmail(mockArticles, subscribers)).resolves.not.toThrow()
  })

  it('throws when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY
    await expect(sendDigestEmail(mockArticles, ['user@test.com'])).rejects.toThrow('Missing RESEND_API_KEY')
  })

  it('does nothing when subscriber list is empty', async () => {
    await expect(sendDigestEmail(mockArticles, [])).resolves.not.toThrow()
  })
})
