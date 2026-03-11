export type TavilyArticle = {
  title: string
  url: string
  content: string
  source: string
  published_date?: string
}

const SEARCH_QUERIES = [
  'artificial intelligence news today',
  'large language model release today',
  'AI tools launch today',
]

async function searchTavily(query: string, apiKey: string): Promise<TavilyArticle[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      topic: 'news',
      days: 3,
      search_depth: 'advanced',
      max_results: 9,
      include_raw_content: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status}`)
  }

  const data = await response.json()
  return (data.results ?? []).map((r: Record<string, string>) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    source: r.source ?? new URL(r.url).hostname,
    published_date: r.published_date,
  }))
}

export async function fetchAINews(): Promise<TavilyArticle[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error('Missing TAVILY_API_KEY')

  const results = await Promise.allSettled(
    SEARCH_QUERIES.map((q) => searchTavily(q, apiKey))
  )

  const articles: TavilyArticle[] = []
  const seen = new Set<string>()

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const article of result.value) {
        if (!seen.has(article.url)) {
          seen.add(article.url)
          articles.push(article)
        }
      }
    }
  }

  return articles.slice(0, 25)
}
