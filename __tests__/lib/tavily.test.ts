import { fetchAINews } from '@/lib/tavily'

global.fetch = jest.fn()

describe('fetchAINews', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TAVILY_API_KEY = 'test-key'
  })

  it('returns an array of articles', async () => {
    const mockResponse = {
      results: [
        {
          title: 'GPT-5 Released',
          url: 'https://example.com/gpt5',
          content: 'OpenAI released GPT-5...',
          source: 'example.com',
          published_date: '2026-03-11',
        },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const articles = await fetchAINews()
    expect(Array.isArray(articles)).toBe(true)
    expect(articles.length).toBeGreaterThan(0)
    expect(articles[0]).toHaveProperty('title')
    expect(articles[0]).toHaveProperty('url')
    expect(articles[0]).toHaveProperty('content')
  })

  it('throws on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
    })
    const articles = await fetchAINews()
    expect(articles).toEqual([])
  })

  it('throws when TAVILY_API_KEY is missing', async () => {
    delete process.env.TAVILY_API_KEY
    await expect(fetchAINews()).rejects.toThrow('Missing TAVILY_API_KEY')
  })
})
