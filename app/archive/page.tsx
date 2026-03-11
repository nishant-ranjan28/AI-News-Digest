'use client'

import { useEffect, useState } from 'react'
import ArticleCard from '@/components/ArticleCard'
import CategoryFilter from '@/components/CategoryFilter'
import { Article } from '@/lib/db'

export default function ArchivePage() {
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(today)
  const [articles, setArticles] = useState<Article[]>([])
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/articles?date=${selectedDate}`)
      .then((r) => r.json())
      .then((data) => { setArticles(data.articles ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedDate])

  const filtered = category === 'All' ? articles : articles.filter((a) => a.category === category)

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <a href="/" className="text-sm text-indigo-600 hover:underline mb-4 block">← Back to Today</a>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Archive</h1>
          <p className="text-gray-500 text-sm">Browse past AI news digests</p>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Select Date</label>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="mb-6">
          <CategoryFilter selected={category} onSelect={setCategory} />
        </div>
        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">No articles found for this date.</div>
        ) : (
          <div className="space-y-4">
            {filtered.map((article) => (
              <ArticleCard key={article.id ?? article.url} article={article} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
