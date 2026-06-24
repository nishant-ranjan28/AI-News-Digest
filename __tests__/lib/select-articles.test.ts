import { selectForNewsletter, type SelectableArticle } from '@/lib/select-articles'

function a(overrides: Partial<SelectableArticle>): SelectableArticle {
  return {
    title: 'Some AI headline',
    url: `https://example.com/${Math.random()}`,
    content: 'body',
    ...overrides,
  }
}

describe('selectForNewsletter', () => {
  it('returns empty array for empty input', () => {
    expect(selectForNewsletter([])).toEqual([])
  })

  it('orders newest articles first by published_date', () => {
    const out = selectForNewsletter([
      a({ title: 'Old', url: 'u1', published_date: '2026-06-20' }),
      a({ title: 'Newest', url: 'u2', published_date: '2026-06-24' }),
      a({ title: 'Middle', url: 'u3', published_date: '2026-06-22' }),
    ])
    expect(out.map((x) => x.title)).toEqual(['Newest', 'Middle', 'Old'])
  })

  it('uses importance_score to break date ties', () => {
    const out = selectForNewsletter([
      a({ title: 'Low', url: 'u1', published_date: '2026-06-24', importance_score: 3 }),
      a({ title: 'High', url: 'u2', published_date: '2026-06-24', importance_score: 9 }),
    ])
    expect(out.map((x) => x.title)).toEqual(['High', 'Low'])
  })

  it('places articles with no published_date last', () => {
    const out = selectForNewsletter([
      a({ title: 'Undated', url: 'u1' }),
      a({ title: 'Dated', url: 'u2', published_date: '2026-06-20' }),
    ])
    expect(out.map((x) => x.title)).toEqual(['Dated', 'Undated'])
  })

  it('drops exact duplicate headlines from different URLs, keeping the newest', () => {
    const out = selectForNewsletter([
      a({ title: 'OpenAI launches GPT-5', url: 'u1', published_date: '2026-06-24' }),
      a({ title: 'OpenAI launches GPT-5', url: 'u2', published_date: '2026-06-23' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('u1')
  })

  it('treats headlines differing only in punctuation/case as duplicates', () => {
    const out = selectForNewsletter([
      a({ title: 'OpenAI Launches GPT-5!', url: 'u1', published_date: '2026-06-24' }),
      a({ title: 'openai launches gpt-5', url: 'u2', published_date: '2026-06-23' }),
    ])
    expect(out).toHaveLength(1)
  })

  it('drops near-duplicate headlines that share most significant words', () => {
    const out = selectForNewsletter([
      a({ title: 'OpenAI launches GPT-5 reasoning model today', url: 'u1', published_date: '2026-06-24' }),
      a({ title: 'OpenAI launches new GPT-5 reasoning model', url: 'u2', published_date: '2026-06-23' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('u1')
  })

  it('keeps genuinely distinct stories', () => {
    const out = selectForNewsletter([
      a({ title: 'OpenAI launches GPT-5', url: 'u1', published_date: '2026-06-24' }),
      a({ title: 'Google ships Gemini 3 Ultra', url: 'u2', published_date: '2026-06-24' }),
      a({ title: 'Anthropic raises $10B at new valuation', url: 'u3', published_date: '2026-06-24' }),
    ])
    expect(out).toHaveLength(3)
  })

  it('does not mutate the input array', () => {
    const input = [
      a({ title: 'B', url: 'u1', published_date: '2026-06-20' }),
      a({ title: 'A', url: 'u2', published_date: '2026-06-24' }),
    ]
    const snapshot = input.map((x) => x.title)
    selectForNewsletter(input)
    expect(input.map((x) => x.title)).toEqual(snapshot)
  })
})
