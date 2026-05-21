'use client'
import { useEffect, useState } from 'react'
import PostCard from '@/components/admin/PostCard'
import type { RepurposedPost } from '@/lib/db'

export default function AdminPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [posts, setPosts] = useState<RepurposedPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/posts?date=${date}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { setPosts(j.posts ?? []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Drafts for {date}</h1>
        <input
          type="date" value={date} max={today}
          onChange={(e) => { setLoading(true); setPosts([]); setDate(e.target.value) }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        />
      </div>
      {loading ? <p className="text-gray-500">Loading…</p>
        : posts.length === 0 ? <p className="text-gray-500">No drafts for this date.</p>
        : posts.map((p) => (
            <PostCard key={p.id} post={p} onUpdate={(updated) =>
              setPosts((prev) => prev.map((x) => x.id === updated.id ? updated : x))
            } />
          ))
      }
    </>
  )
}
