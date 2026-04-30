import sgMail from '@sendgrid/mail'
import { Resend } from 'resend'
import { EmailLog } from './db'
import { logEmailResult } from './db'
import { ComposedNewsletter } from './compose'

const ARCHIVE_URL = 'https://ai.iamnishant.in/archive'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function bodyToHtml(body: string): string {
  // Preserve line breaks the LLM intended
  return escapeHtml(body).replace(/\n/g, '<br/>')
}

function buildEmailHtml(composed: ComposedNewsletter, date: string): string {
  const storyBlocks = composed.stories
    .map((s, i) => {
      const headline = escapeHtml(s.headline)
      const body = bodyToHtml(s.body)
      const hotTake = s.hot_take
        ? `
        <p style="margin:8px 0 0;color:#7c3aed;font-size:14px;line-height:1.6;font-style:italic;">
          💭 ${escapeHtml(s.hot_take)}
        </p>`
        : ''

      return `
      <div style="padding:20px 0;border-bottom:1px solid #e5e7eb;">
        <h2 style="margin:0 0 10px;font-size:18px;color:#111827;line-height:1.4;font-weight:700;">
          🧠 ${i + 1}. <a href="${s.url}" style="color:#111827;text-decoration:none;">${headline}</a>
        </h2>
        <div style="margin:0;color:#374151;font-size:14px;line-height:1.7;">
          ${body}
        </div>
        ${hotTake}
        <a href="${s.url}" style="display:inline-block;margin-top:10px;color:#6366f1;font-size:13px;font-weight:600;text-decoration:none;">
          Read more →
        </a>
      </div>`
    })
    .join('')

  const greetingBlock = `
    <p style="margin:0 0 20px;color:#111827;font-size:16px;line-height:1.6;">
      Hey — Nishant here 👋
    </p>`

  const themeBlock = `
    <div style="margin-bottom:8px;">
      <span style="display:inline-block;background:#eef2ff;color:#4338ca;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:4px 10px;border-radius:999px;">
        Today's theme: ${escapeHtml(composed.theme)}
      </span>
    </div>`

  const signalBlock = `
    <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:18px 20px;margin-bottom:8px;">
      <div style="font-size:12px;font-weight:700;color:#92400e;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">🔥 Today's signal</div>
      <p style="margin:0;color:#78350f;font-size:15px;line-height:1.6;font-weight:500;">${escapeHtml(composed.signal)}</p>
    </div>`

  const toolBlock = composed.tool
    ? `
    <div style="border:1px solid #d1fae5;background:#ecfdf5;border-radius:10px;padding:18px 20px;margin-top:24px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:700;color:#065f46;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">🛠 Tool of the day</div>
      <div style="font-size:17px;font-weight:700;color:#064e3b;margin-bottom:10px;">${escapeHtml(composed.tool.name)}</div>
      <p style="margin:0 0 6px;color:#065f46;font-size:14px;line-height:1.6;">
        <span style="color:#064e3b;">👉 <strong>What it does:</strong></span> ${escapeHtml(composed.tool.what)}
      </p>
      <p style="margin:0;color:#065f46;font-size:14px;line-height:1.6;">
        <span style="color:#064e3b;">👉 <strong>Best for:</strong></span> ${escapeHtml(composed.tool.best_for)}
      </p>
    </div>`
    : ''

  const closingBlock = `
    <div style="border:1px solid #ddd6fe;background:#f5f3ff;border-radius:10px;padding:18px 20px;margin-top:${composed.tool ? '12px' : '24px'};margin-bottom:24px;">
      <p style="margin:0;color:#4c1d95;font-size:15px;line-height:1.6;font-weight:500;">
        ${composed.closing.kind === 'question' ? '❓' : '💡'} ${escapeHtml(composed.closing.text)}
      </p>
    </div>`

  const moreLink = `
    <p style="text-align:center;margin:20px 0 0;font-size:13px;">
      <a href="${ARCHIVE_URL}" style="color:#6366f1;font-weight:600;text-decoration:none;">+ More stories → ai.iamnishant.in/archive</a>
    </p>`

  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:20px;color:#111827;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <div style="text-align:center;margin-bottom:20px;">
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#111827;letter-spacing:-0.5px;">AI News Digest</h1>
        <p style="color:#6b7280;margin:6px 0 0;font-size:13px;">${escapeHtml(date)}</p>
      </div>
      ${greetingBlock}
      ${themeBlock}
      ${signalBlock}
      ${storyBlocks}
      ${toolBlock}
      ${closingBlock}
      ${moreLink}
      <p style="text-align:center;color:#9ca3af;font-size:11px;margin:24px 0 0;">
        You are receiving this because you subscribed to AI News Digest.
      </p>
    </div>
  </body>
  </html>`
}

type SendResult = { success: boolean; error?: string }
type Provider = EmailLog['provider']
type SendFn = (to: string, from: string, subject: string, html: string) => Promise<SendResult>

async function sendViaBrevo(
  to: string,
  from: string,
  subject: string,
  html: string
): Promise<SendResult> {
  try {
    const apiKey = process.env.BREVO_API_KEY
    if (!apiKey) return { success: false, error: 'Missing BREVO_API_KEY' }

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: from, name: 'AI News Digest' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { success: false, error: `Brevo ${res.status}: ${body.slice(0, 200)}` }
    }
    return { success: true }
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown Brevo error'
    return { success: false, error: message }
  }
}

async function sendViaSendGrid(
  to: string,
  from: string,
  subject: string,
  html: string
): Promise<SendResult> {
  try {
    const apiKey = process.env.SENDGRID_API_KEY
    if (!apiKey) return { success: false, error: 'Missing SENDGRID_API_KEY' }
    sgMail.setApiKey(apiKey)
    await sgMail.send({ to, from, subject, html })
    return { success: true }
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown SendGrid error'
    return { success: false, error: message }
  }
}

async function sendViaResend(
  to: string,
  from: string,
  subject: string,
  html: string
): Promise<SendResult> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return { success: false, error: 'Missing RESEND_API_KEY' }

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: `AI News Digest <${from}>`,
      to,
      subject,
      html,
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    const message = (err as Error).message?.slice(0, 200) ?? 'Unknown Resend error'
    return { success: false, error: message }
  }
}

async function runPhase(
  emails: string[],
  provider: Provider,
  sendFn: SendFn,
  from: string,
  subject: string,
  html: string
): Promise<string[]> {
  const failed: string[] = []
  for (const email of emails) {
    const result = await sendFn(email, from, subject, html)
    if (result.success) {
      console.log(`[email] ${provider} sent to ${email}`)
      await logEmailResult({ recipient: email, status: 'sent', provider })
    } else {
      console.error(`[email] ${provider} failed for ${email}: ${result.error}`)
      await logEmailResult({
        recipient: email,
        status: 'failed',
        provider,
        error_message: result.error,
      })
      failed.push(email)
    }
  }
  return failed
}

export async function sendDigestEmail(
  composed: ComposedNewsletter,
  subscriberEmails: string[]
): Promise<void> {
  if (subscriberEmails.length === 0) return

  const senderEmail = process.env.SENDER_EMAIL
  if (!senderEmail) throw new Error('Missing SENDER_EMAIL')

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const subject = `AI News Digest — ${composed.theme}`
  const html = buildEmailHtml(composed, date)

  const chain: { provider: Provider; sendFn: SendFn; enabled: boolean }[] = [
    { provider: 'brevo', sendFn: sendViaBrevo, enabled: !!process.env.BREVO_API_KEY },
    { provider: 'sendgrid', sendFn: sendViaSendGrid, enabled: !!process.env.SENDGRID_API_KEY },
    { provider: 'resend', sendFn: sendViaResend, enabled: !!process.env.RESEND_API_KEY },
  ]

  const active = chain.filter((p) => p.enabled)
  if (active.length === 0) throw new Error('No email provider configured (set BREVO_API_KEY, SENDGRID_API_KEY, or RESEND_API_KEY)')

  let pending = subscriberEmails
  for (const { provider, sendFn } of active) {
    if (pending.length === 0) break
    pending = await runPhase(pending, provider, sendFn, senderEmail, subject, html)
    if (pending.length > 0) {
      console.log(`[email] ${pending.length} email(s) failed via ${provider}, retrying with next provider`)
    }
  }
}
