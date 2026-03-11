'use client'

import { useEffect, useState } from 'react'
import ArticleCard from '@/components/ArticleCard'
import CategoryFilter from '@/components/CategoryFilter'
import SubscribeBar from '@/components/SubscribeBar'
import { Article } from '@/lib/db'

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([])
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/articles')
      .then((r) => r.json())
      .then((data) => { setArticles(data.articles ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = category === 'All' ? articles : articles.filter((a) => a.category === category)
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">AI News Digest</h1>
          <p className="text-gray-500 text-sm">{today}</p>
        </div>
        <SubscribeBar />
        <div className="mb-6">
          <CategoryFilter selected={category} onSelect={setCategory} />
        </div>
        {loading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-5 border border-gray-200 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
                <div className="h-6 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-full mb-1" />
                <div className="h-4 bg-gray-200 rounded w-5/6" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No articles found for today.</p>
            <p className="text-sm mt-2">Check back tomorrow or browse the <a href="/archive" className="text-indigo-600 underline">archive</a>.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((article) => (
              <ArticleCard key={article.id ?? article.url} article={article} />
            ))}
          </div>
        )}
        <footer className="mt-12 text-center text-xs text-gray-400">
          <a href="/archive" className="hover:text-indigo-600">Archive</a>
          {' · '}
          <a href="/subscribe" className="hover:text-indigo-600">Subscribe</a>
        </footer>
      </div>
    </main>
  )
}
