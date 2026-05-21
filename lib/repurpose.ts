import Groq from 'groq-sdk'
import OpenAI from 'openai'
import type { ComposedNewsletter } from './compose'
import type { RepurposedChannel } from './db'
import type { Signal } from './extract-signal'

export type ChannelConfig = {
  channel: RepurposedChannel
  maxChars: number
}

const LINKEDIN_PROMPT = (signal: Signal, siteUrl: string) => `
Create ONE LinkedIn post from this signal:

Fact:
${signal.fact}

Shift:
${signal.shift}

Why people should care:
${signal.whyCare}

Structure:

1. Hook (challenge assumptions)
2. Observation
3. Implication
4. CTA

Rules:

- Maximum 8 lines
- Maximum 1 sentence per line
- Short sentences
- Human tone
- No hashtags
- No emojis
- No hype
- No predictions
- No corporate jargon

Do NOT use:

- game changer
- changing the landscape
- competitive edge
- significant impact
- worth paying attention to
- something is changing
- revolutionize

Prefer contrast:

- Not X, but Y
- Less X, more Y

End with:

"I break down AI shifts daily → ${siteUrl}"

IMPORTANT:
Do not restate the fact multiple times.
Turn the shift into the main idea.

After writing:
- Count unique ideas
- If the same idea appears twice, keep only the strongest sentence
- Prefer concrete language over abstract language

Output ONLY the post text. No preface, no explanation, no markdown.
`.trim()

const TWITTER_PROMPT = (signal: Signal, siteUrl: string) => `
Create one tweet using this data:

Fact: ${signal.fact}
Shift: ${signal.shift}
Why care: ${signal.whyCare}

Rules:
- 240 characters MAX (leaving room for the URL)
- ONE sharp insight
- No hashtags
- No predictions
- At most one emoji
- End with: ${siteUrl}

Output ONLY the tweet text.
`.trim()

const THREADS_PROMPT = (signal: Signal, siteUrl: string) => `
Create one Threads post using this data:

Fact: ${signal.fact}
Shift: ${signal.shift}
Why care: ${signal.whyCare}

Rules:
- 4-6 lines, conversational
- 500 character max total
- No hashtags
- No predictions
- At most one emoji
- End with: ${siteUrl}

Output ONLY the post text.
`.trim()

const ARTICLE_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Expand the newsletter below into a long-form blog article (700-1100 words) in Markdown.

Structure:
- Opening hook (2-3 sentences) — restate the signal in your own words, sharply
- "## The story so far" — synthesize the anchor + supporting stories into a flowing narrative (not a bulleted recap)
- "## What this actually means" — your interpretation. Cite specific actors, numbers, dates.
- "## The contrarian read" — use the contrast story as a counterpoint
- "## What to watch next" — 2-3 forward-looking observations
- Closing line — a single bold statement worth screenshotting

Rules:
- Markdown only. No frontmatter. No "as an AI" disclaimers.
- No hashtags, no corporate filler, no banned phrases from the compose prompt.
- Keep paragraphs short (2-4 sentences).
- Do NOT include the URL at the end — the page renders it separately.

Output ONLY the markdown body.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Stories:
${c.stories.map((s) => `- [${s.role}] ${s.headline}: ${s.body}${s.hot_take ? ` (hot take: ${s.hot_take})` : ''}`).join('\n')}
Tool of the day: ${c.tool.name} — ${c.tool.what} (why now: ${c.tool.why_now})
Takeaway: ${c.quick_takeaway}
Closing: ${c.closing.text}

Site URL (for context only, do not include in output): ${siteUrl}
`.trim()

export const CHANNEL_CONFIGS: Record<RepurposedChannel, ChannelConfig> = {
  linkedin: { channel: 'linkedin', maxChars: 1300 },
  twitter:  { channel: 'twitter',  maxChars: 280 },
  threads:  { channel: 'threads',  maxChars: 500 },
  article:  { channel: 'article',  maxChars: 8000 },
}

export function buildSlug(theme: string, isoDate: string): string {
  const cleaned = theme
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return cleaned ? `${isoDate}-${cleaned}` : isoDate
}

export function cleanup(text: string): string {
  return text
    .replace(/competitive edge/gi, '')
    .replace(/game[- ]?changer/gi, '')
    .replace(/revolution/gi, '')
    .replace(/significant impact/gi, '')
    .replace(/worth paying attention to/gi, '')
    .replace(/something(?:'s| is) changing/gi, '')
    .replace(/changing the landscape/gi, '')
    .replace(/  +/g, ' ')
    .trim()
}

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('Missing GROQ_API_KEY')
  const groq = new Groq({ apiKey })
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.5,
    top_p: 0.9,
  })
  return (completion.choices[0]?.message?.content ?? '').trim()
}

async function callOpenRouter(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY')
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    temperature: 0.5,
    top_p: 0.9,
  })
  return (completion.choices[0]?.message?.content ?? '').trim()
}

function truncateForChannel(text: string, channel: RepurposedChannel): string {
  const max = CHANNEL_CONFIGS[channel].maxChars
  if (text.length <= max) return text
  // For short-form channels, trim at last space within budget; for article, leave alone (LLM should already obey).
  if (channel === 'article') return text
  const slice = text.slice(0, max)
  const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '))
  return (lastBreak > max * 0.8 ? slice.slice(0, lastBreak) : slice).trim()
}

export async function generateForChannel(
  channel: RepurposedChannel,
  composed: ComposedNewsletter,
  signal: Signal | null,
  siteUrl: string = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ai.iamnishant.in'
): Promise<string | null> {
  let prompt: string
  if (channel === 'article') {
    prompt = ARTICLE_PROMPT(composed, siteUrl)
  } else {
    if (!signal) return null
    if (channel === 'linkedin') prompt = LINKEDIN_PROMPT(signal, siteUrl)
    else if (channel === 'twitter') prompt = TWITTER_PROMPT(signal, siteUrl)
    else prompt = THREADS_PROMPT(signal, siteUrl)
  }

  let raw: string | null = null
  try {
    raw = await callGroq(prompt)
  } catch (e) {
    console.warn(`[repurpose:${channel}] Groq failed:`, (e as Error).message)
  }
  if (raw === null) {
    try {
      raw = await callOpenRouter(prompt)
    } catch (e) {
      console.warn(`[repurpose:${channel}] OpenRouter failed:`, (e as Error).message)
      return null
    }
  }
  return truncateForChannel(cleanup(raw), channel)
}

export type ChannelResult = { channel: RepurposedChannel; content: string | null }

export async function generateAllChannels(
  composed: ComposedNewsletter,
  signal: Signal | null,
  siteUrl?: string
): Promise<ChannelResult[]> {
  const channels: RepurposedChannel[] = ['linkedin', 'twitter', 'threads', 'article']
  return Promise.all(
    channels.map(async (channel) => ({
      channel,
      content: await generateForChannel(channel, composed, signal, siteUrl),
    }))
  )
}
