// Selects and orders the articles that go into a newsletter issue.
//
// The cron pipeline already filters out articles that were saved (and therefore
// sent) on a previous run — this helper handles the rest: ordering the genuinely
// fresh articles newest-first and dropping near-identical headlines that slip in
// from syndicated copies on different URLs. Pure and side-effect free so it can
// be unit-tested without the DB or network.

export type SelectableArticle = {
  title: string
  url: string
  content: string
  source?: string
  published_date?: string
  importance_score?: number
}

// Words too common to distinguish one AI headline from another. Kept small on
// purpose — the goal is to compare the *distinctive* tokens of two titles.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'new', 'now', 'today',
  'this', 'that', 'its', 'it', 'into', 'over', 'after', 'amid', 'will',
])

// Two titles whose significant words overlap by this fraction (Jaccard) or more
// are treated as the same story. 0.7 is conservative — distinct stories rarely
// share that many distinctive words.
const SIMILARITY_THRESHOLD = 0.7

function significantTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // strip punctuation
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const t of a) if (b.has(t)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function publishedTime(article: SelectableArticle): number {
  if (!article.published_date) return 0
  const t = Date.parse(article.published_date)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Order articles newest-first (importance breaks date ties) and remove
 * near-duplicate headlines, keeping the earliest survivor in sorted order
 * (i.e. the newest / most important of each duplicate group).
 */
export function selectForNewsletter<T extends SelectableArticle>(articles: T[]): T[] {
  const sorted = [...articles].sort((a, b) => {
    const dt = publishedTime(b) - publishedTime(a)
    if (dt !== 0) return dt
    return (b.importance_score ?? 0) - (a.importance_score ?? 0)
  })

  const kept: T[] = []
  const keptTokens: Set<string>[] = []
  for (const article of sorted) {
    const tokens = significantTokens(article.title)
    const isDuplicate = keptTokens.some((k) => jaccard(k, tokens) >= SIMILARITY_THRESHOLD)
    if (isDuplicate) continue
    kept.push(article)
    keptTokens.push(tokens)
  }
  return kept
}
