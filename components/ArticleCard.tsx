import { Article } from '@/lib/db'

const CATEGORY_COLORS: Record<string, string> = {
  LLM: 'bg-indigo-100 text-indigo-800',
  Tools: 'bg-emerald-100 text-emerald-800',
  Research: 'bg-amber-100 text-amber-800',
  Industry: 'bg-blue-100 text-blue-800',
  Policy: 'bg-red-100 text-red-800',
}

export default function ArticleCard({ article }: { article: Article }) {
  const badgeClass = CATEGORY_COLORS[article.category ?? ''] ?? 'bg-gray-100 text-gray-800'

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${badgeClass}`}>
          {article.category}
        </span>
        <span className="text-xs text-gray-400">{article.source}</span>
        {article.importance_score && (
          <span className="ml-auto text-xs text-gray-400">
            ⭐ {article.importance_score}/10
          </span>
        )}
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2 leading-snug">
        {article.title}
      </h2>
      {article.summary && (
        <p className="text-sm text-gray-600 leading-relaxed mb-4">{article.summary}</p>
      )}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        Read More →
      </a>
    </div>
  )
}
