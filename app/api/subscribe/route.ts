import { NextRequest, NextResponse } from 'next/server'
import { addSubscriber } from '@/lib/db'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = (body as any).email as string | undefined
  const bodyRef = (body as any).ref ?? (body as any).referred_by
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  const ref = (bodyRef ?? req.nextUrl.searchParams.get('ref') ?? req.headers.get('x-referral-code') ?? '').toString().trim().slice(0, 20) || null

  try {
    await addSubscriber(email.toLowerCase().trim(), ref)
    return NextResponse.json({ success: true, message: 'Successfully subscribed!' })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('already subscribed')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}
