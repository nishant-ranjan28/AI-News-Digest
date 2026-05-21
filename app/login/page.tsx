'use client'
import { useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/login/callback` },
    })
    if (error) { setErrorMsg(error.message); setStatus('error'); return }
    setStatus('sent')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6">Admin login</h1>
        {status === 'sent' ? (
          <p className="text-sm text-gray-700">Check your inbox for the magic link.</p>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-4 text-sm"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full bg-indigo-600 text-white rounded px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending...' : 'Send magic link'}
            </button>
            {status === 'error' && <p className="text-sm text-red-600 mt-3">{errorMsg}</p>}
          </>
        )}
      </form>
    </main>
  )
}
