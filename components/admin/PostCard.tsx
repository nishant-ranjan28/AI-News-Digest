'use client'
import { useState } from 'react'
import type { RepurposedPost } from '@/lib/db'

export default function PostCard({ post, onUpdate }: { post: RepurposedPost; onUpdate: (p: RepurposedPost) => void }) {
  const [content, setContent] = useState(post.content)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  async function save(patch: Partial<RepurposedPost>) {
    setSaving(true)
    await fetch(`/api/admin/posts/${post.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    })
    setSaving(false)
    onUpdate({ ...post, ...patch })
  }

  async function regenerate() {
    setSaving(true)
    const res = await fetch('/api/admin/regenerate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: post.channel, date: post.issue_date }),
    })
    const json = await res.json()
    setSaving(false)
    if (json.content) { setContent(json.content); onUpdate({ ...post, content: json.content }) }
  }

  async function copy() {
    await navigator.clipboard.writeText(content)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold text-gray-900 capitalize">{post.channel}</h2>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500">{content.length} chars</span>
          <span className={`text-xs px-2 py-0.5 rounded ${post.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{post.status}</span>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={post.channel === 'article' ? 18 : 8}
        className="w-full border border-gray-300 rounded p-3 text-sm font-mono"
      />
      <div className="flex gap-2 mt-3 flex-wrap">
        <button onClick={() => save({ content })} disabled={saving} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded disabled:opacity-50">Save</button>
        <button onClick={copy} className="px-3 py-1.5 text-sm border border-gray-300 rounded">{copied ? 'Copied!' : 'Copy'}</button>
        <button onClick={regenerate} disabled={saving} className="px-3 py-1.5 text-sm border border-gray-300 rounded disabled:opacity-50">Regenerate</button>
        {post.status !== 'published' && (
          <button onClick={() => save({ status: 'published' })} disabled={saving} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded disabled:opacity-50">Mark published</button>
        )}
      </div>
    </section>
  )
}
