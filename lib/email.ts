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

const ACCENT = '#6366f1'
const TEXT = '#111827'
const MUTED = '#6b7280'
const BODY_TEXT = '#374151'

function sectionLabel(emoji: string, label: string): string {
  return `
    <div style="text-align:center;margin:32px 0 14px;">
      <div style="display:inline-block;font-size:11px;font-weight:700;color:${TEXT};letter-spacing:1px;text-transform:uppercase;">
        ${emoji} ${label}
      </div>
    </div>`
}

function buildEmailHtml(composed: ComposedNewsletter, date: string): string {
  const storyBlocks = composed.stories
    .map((s, i) => {
      const headline = escapeHtml(s.headline)
      const body = bodyToHtml(s.body)
      const readTime = `(${s.read_time_minutes} minute read)`
      const hotTake = s.hot_take
        ? `
        <p style="margin:10px 0 0;color:${ACCENT};font-size:14px;line-height:1.6;font-style:italic;">
          💭 ${escapeHtml(s.hot_take)}
        </p>`
        : ''

      return `
      <div style="padding:18px 0;${i < composed.stories.length - 1 ? `border-bottom:1px solid #e5e7eb;` : ''}">
        <h2 style="margin:0 0 10px;font-size:17px;color:${TEXT};line-height:1.4;font-weight:700;">
          <a href="${s.url}" style="color:${TEXT};text-decoration:underline;text-underline-offset:3px;">${headline}</a>
          <span style="color:${MUTED};font-weight:400;font-size:13px;"> ${readTime}</span>
        </h2>
        <div style="margin:0;color:${BODY_TEXT};font-size:14px;line-height:1.7;">
          ${body}
        </div>
        ${hotTake}
      </div>`
    })
    .join('')

  const greetingBlock = `
    <p style="margin:0 0 20px;color:${TEXT};font-size:16px;line-height:1.6;">
      Hey — Nishant here 👋
    </p>`

  const themeLine = `
    <p style="margin:0 0 24px;color:${MUTED};font-size:13px;font-style:italic;">
      Today's theme: ${escapeHtml(composed.theme)}
    </p>`

  const signalBlock = `
    ${sectionLabel('🔥', "Today's signal")}
    <p style="margin:0;text-align:center;color:${TEXT};font-size:16px;line-height:1.6;font-weight:500;max-width:520px;margin-left:auto;margin-right:auto;">
      ${escapeHtml(composed.signal)}
    </p>`

  const storiesHeader = sectionLabel('📰', 'Stories')

  const toolBlock = `
    ${sectionLabel('🛠', 'Tool of the day')}
    <div style="text-align:center;">
      <div style="font-size:18px;font-weight:700;color:${TEXT};margin-bottom:10px;">${escapeHtml(composed.tool.name)}</div>
    </div>
    <p style="margin:0 0 6px;color:${BODY_TEXT};font-size:14px;line-height:1.6;">
      <strong style="color:${TEXT};">What it does:</strong> ${escapeHtml(composed.tool.what)}
    </p>
    <p style="margin:0 0 6px;color:${BODY_TEXT};font-size:14px;line-height:1.6;">
      <strong style="color:${TEXT};">Best for:</strong> ${escapeHtml(composed.tool.best_for)}
    </p>
    <p style="margin:0;color:${ACCENT};font-size:14px;line-height:1.6;font-style:italic;">
      <strong style="color:${TEXT};font-style:normal;">Why now:</strong> ${escapeHtml(composed.tool.why_now)}
    </p>`

  const takeawayBlock = `
    ${sectionLabel('💡', 'Quick takeaway')}
    <p style="margin:0;text-align:center;color:${TEXT};font-size:16px;line-height:1.6;font-weight:600;max-width:520px;margin-left:auto;margin-right:auto;">
      ${escapeHtml(composed.quick_takeaway)}
    </p>`

  const closingBlock = `
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 20px;"/>
    <p style="margin:0;text-align:center;color:${TEXT};font-size:15px;line-height:1.7;font-style:italic;">
      ${escapeHtml(composed.closing.text)}
    </p>`

  const moreLink = `
    <p style="text-align:center;margin:24px 0 0;font-size:13px;">
      <a href="${ARCHIVE_URL}" style="color:${ACCENT};font-weight:600;text-decoration:none;">+ More stories → ai.iamnishant.in/archive</a>
    </p>`

  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ffffff;margin:0;padding:20px;color:${TEXT};">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
        <h1 style="margin:0;font-size:24px;font-weight:800;color:${TEXT};letter-spacing:-0.5px;">AI News Digest</h1>
        <p style="color:${MUTED};margin:4px 0 0;font-size:12px;">${escapeHtml(date)}</p>
      </div>
      ${greetingBlock}
      ${themeLine}
      ${signalBlock}
      ${storiesHeader}
      ${storyBlocks}
      ${toolBlock}
      ${takeawayBlock}
      ${closingBlock}
      ${moreLink}
      <p style="text-align:center;color:${MUTED};font-size:11px;margin:32px 0 0;">
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
  const subject = composed.subject_teasers
    .map((t) => `${t.text} ${t.emoji}`)
    .join(', ')
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
