'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

const LS_SUBSCRIBED = 'digest_subscribed'
const SS_DISMISS_COUNT = 'digest_modal_dismiss_count'
const INITIAL_DELAY_MS = 3000

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function SubscribeModal() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const exitIntentArmedRef = useRef(false)

  // Helpers — guarded for SSR
  const isSubscribed = () =>
    typeof window !== 'undefined' && localStorage.getItem(LS_SUBSCRIBED) === '1'

  const getDismissCount = () => {
    if (typeof window === 'undefined') return 0
    return parseInt(sessionStorage.getItem(SS_DISMISS_COUNT) ?? '0', 10) || 0
  }

  const setDismissCount = (n: number) => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(SS_DISMISS_COUNT, String(n))
  }

  // Skip on the dedicated subscribe page
  const shouldEverShow = pathname !== '/subscribe'

  // First-show timer
  useEffect(() => {
    if (!shouldEverShow) return
    if (isSubscribed()) return
    if (getDismissCount() > 0) {
      // Already dismissed this session — arm exit-intent if only dismissed once
      if (getDismissCount() === 1) exitIntentArmedRef.current = true
      return
    }
    const t = setTimeout(() => setOpen(true), INITIAL_DELAY_MS)
    return () => clearTimeout(t)
  }, [shouldEverShow])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Exit-intent re-show
  useEffect(() => {
    if (!shouldEverShow) return
    if (isSubscribed()) return

    const onMouseOut = (e: MouseEvent) => {
      if (!exitIntentArmedRef.current) return
      // Mouse left the window through the top edge
      if (e.clientY <= 0 && !e.relatedTarget) {
        exitIntentArmedRef.current = false
        setOpen(true)
      }
    }
    document.addEventListener('mouseout', onMouseOut)
    return () => document.removeEventListener('mouseout', onMouseOut)
  }, [shouldEverShow])

  function handleClose() {
    const next = getDismissCount() + 1
    setDismissCount(next)
    // First dismiss arms exit-intent for the second show; second dismiss disarms permanently
    exitIntentArmedRef.current = next === 1
    setOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus('success')
        if (typeof window !== 'undefined') localStorage.setItem(LS_SUBSCRIBED, '1')
        exitIntentArmedRef.current = false
      } else {
        setStatus('error')
        setErrorMsg(data.error ?? 'Something went wrong.')
      }
    } catch {
      setStatus('error')
      setErrorMsg('Network error. Please try again.')
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscribe-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={handleClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100"
        >
          ✕
        </button>

        {status === 'success' ? (
          <div className="text-center py-2">
            <div className="text-3xl mb-3">🎉</div>
            <h2 id="subscribe-modal-title" className="text-xl font-bold text-gray-900 mb-2">
              You&rsquo;re in.
            </h2>
            <p className="text-gray-600 text-sm mb-5">
              Tomorrow at 6 AM IST you&rsquo;ll get the first digest.
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-5 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h2 id="subscribe-modal-title" className="text-xl font-bold text-gray-900 mb-2">
              Get the daily AI digest
            </h2>
            <p className="text-gray-600 text-sm mb-5">
              5 hand-picked AI stories every morning. Sharp takes, no fluff.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                required
                autoFocus
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
                {status === 'loading' ? 'Subscribing…' : 'Subscribe for free'}
              </button>
              {status === 'error' && (
                <p className="text-red-600 text-sm text-center">{errorMsg}</p>
              )}
            </form>
            <p className="mt-4 text-center text-xs text-gray-500">
              ✨ No spam. One email per day. Unsubscribe anytime.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
