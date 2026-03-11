'use client'

import { useState } from 'react'

export default function SubscribePage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus('success')
        setMessage("You're subscribed! You'll receive the digest every morning.")
      } else {
        setStatus('error')
        setMessage(data.error ?? 'Something went wrong.')
      }
    } catch {
      setStatus('error')
      setMessage('Network error. Please try again.')
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <a href="/" className="text-sm text-indigo-600 hover:underline mb-6 block">← Back to Digest</a>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Subscribe to AI News Digest</h1>
        <p className="text-gray-500 text-sm mb-6">
          Get the top 10 AI stories delivered to your inbox every morning at 6 AM IST.
        </p>
        {status === 'success' ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-700 text-sm">{message}</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {status === 'loading' ? 'Subscribing...' : 'Subscribe for Free'}
            </button>
            {status === 'error' && <p className="text-red-600 text-sm text-center">{message}</p>}
          </form>
        )}
      </div>
    </main>
  )
}
