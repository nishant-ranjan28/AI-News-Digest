jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  }))
})
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  }))
})

import Groq from 'groq-sdk'
import { composeNewsletter, MAX_COMPOSE_ARTICLES, type ComposeInput } from '@/lib/compose'

function makeArticles(n: number): ComposeInput[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `ARTICLE_TITLE_${i}`,
    url: `https://example.com/${i}`,
    content: 'x'.repeat(2000),
    source: 'example.com',
  }))
}

const validComposed = {
  subject_teasers: [{ text: 'a', emoji: '🚀' }],
  theme: 'Theme',
  signal: 'Signal.',
  stories: [
    { role: 'anchor', headline: 'H', body: 'B', url: 'https://example.com/0', read_time_minutes: 2 },
  ],
  tool: { name: 'T', what: 'w', best_for: 'b', why_now: 'n' },
  quick_takeaway: 'Q',
  closing: { kind: 'statement', text: 'C' },
}

describe('composeNewsletter article cap', () => {
  let groqCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GROQ_API_KEY = 'test-groq-key'
    groqCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validComposed) } }],
    })
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: groqCreate } },
    }))
  })

  it('caps the number of articles embedded in the prompt', async () => {
    await composeNewsletter(makeArticles(25))
    expect(groqCreate).toHaveBeenCalledTimes(1)
    const prompt = groqCreate.mock.calls[0][0].messages[0].content as string

    // Only the first MAX_COMPOSE_ARTICLES titles should appear
    for (let i = 0; i < MAX_COMPOSE_ARTICLES; i++) {
      expect(prompt).toContain(`ARTICLE_TITLE_${i}`)
    }
    expect(prompt).not.toContain(`ARTICLE_TITLE_${MAX_COMPOSE_ARTICLES}`)
  })

  it('passes all articles through when under the cap', async () => {
    await composeNewsletter(makeArticles(4))
    const prompt = groqCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('ARTICLE_TITLE_0')
    expect(prompt).toContain('ARTICLE_TITLE_3')
  })

  it('returns null for empty input', async () => {
    const result = await composeNewsletter([])
    expect(result).toBeNull()
    expect(groqCreate).not.toHaveBeenCalled()
  })

  it('MAX_COMPOSE_ARTICLES is small enough to stay under free-tier TPM', () => {
    expect(MAX_COMPOSE_ARTICLES).toBeLessThanOrEqual(15)
  })
})
