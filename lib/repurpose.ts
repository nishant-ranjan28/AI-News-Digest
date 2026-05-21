import Groq from 'groq-sdk'
import OpenAI from 'openai'
import type { ComposedNewsletter } from './compose'
import type { RepurposedChannel } from './db'

export type ChannelConfig = {
  channel: RepurposedChannel
  maxChars: number
  buildPrompt: (composed: ComposedNewsletter, siteUrl: string) => string
}

const LINKEDIN_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Transform the following newsletter/news into ONE engaging LinkedIn post.

GOAL:
Make readers stop scrolling and think:
"Hmm, I never thought about it that way."

STRICT RULES:

1. Focus on ONE insight only
- Ignore secondary stories
- Do not summarize everything

2. Structure:

Hook (1 line)
Observation (1–2 short lines)
Implication (1–2 short lines)
Soft CTA

3. Hook rules:
- Must create curiosity or challenge assumptions
- Avoid clickbait
- Avoid fear tactics
- Avoid "What if..."
- Avoid "recipe for disaster"
- Avoid exaggerated claims

Good examples:
- Everyone thinks the AI race is about smarter models.
- I think people are watching the wrong metric.
- Something interesting is happening in AI.

4. Writing rules:
- Maximum 8–10 lines total
- Maximum 1–2 sentences per paragraph
- Short sentences
- No corporate language
- No analyst/report tone
- No generic statements
- No hashtags
- No emojis
- Do not repeat ideas

5. Fact rules:
- Never invent facts
- Never infer unsupported claims
- Never change company/product relationships

6. Language rules:
Banned phrases — never use:
- competitive edge
- game changer
- changing the landscape
- revolutionize
- next tech giants
- significant impact
- unlock potential

Replace abstract ideas with concrete observations.

Bad: "This creates a new landscape"
Good: "This changes the question from X to Y"

Bad: "gain a competitive edge"
Good: "save time and reduce cost"

If a sentence sounds like LinkedIn corporate jargon, rewrite it.

7. Self-edit pass (do this silently before output):
- Remove repeated ideas
- If two sentences express the same thought, keep only the stronger one
- Compress the post by ~20% — cut every word that doesn't earn its place
- Prefer contrast patterns: "Not X → but Y"

8. CTA:
Always end with:

"I break down AI shifts daily → ${siteUrl}"

Output ONLY the post text. No preface, no explanation, no markdown.

NEWS:

Theme: ${c.theme}
Signal: ${c.signal}
Stories:
${c.stories.map((s) => `- ${s.headline}: ${s.body}${s.hot_take ? ` [hot take: ${s.hot_take}]` : ''}`).join('\n')}
Takeaway: ${c.quick_takeaway}
`.trim()

const TWITTER_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Transform the newsletter below into a single tweet.

Rules:
- 240 characters MAX (leaving room for the URL)
- ONE sharp insight. No multi-thread output.
- No hashtags. At most one emoji.
- End with: ${siteUrl}

Output ONLY the tweet text.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Top story: ${c.stories[0]?.headline} — ${c.stories[0]?.body}
Takeaway: ${c.quick_takeaway}
`.trim()

const THREADS_PROMPT = (c: ComposedNewsletter, siteUrl: string) => `
Transform the newsletter below into a Threads post.

Rules:
- 4-6 lines, conversational
- 500 character max total
- No hashtags. At most one emoji.
- End with: ${siteUrl}

Output ONLY the post text.

NEWSLETTER:
Theme: ${c.theme}
Signal: ${c.signal}
Top story: ${c.stories[0]?.headline} — ${c.stories[0]?.body}
Takeaway: ${c.quick_takeaway}
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
  linkedin: { channel: 'linkedin', maxChars: 1300, buildPrompt: LINKEDIN_PROMPT },
  twitter:  { channel: 'twitter',  maxChars: 280,  buildPrompt: TWITTER_PROMPT  },
  threads:  { channel: 'threads',  maxChars: 500,  buildPrompt: THREADS_PROMPT  },
  article:  { channel: 'article',  maxChars: 8000, buildPrompt: ARTICLE_PROMPT  },
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
  siteUrl: string = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ai.iamnishant.in'
): Promise<string | null> {
  const cfg = CHANNEL_CONFIGS[channel]
  const prompt = cfg.buildPrompt(composed, siteUrl)
  try { return truncateForChannel(await callGroq(prompt), channel) } catch (e) {
    console.warn(`[repurpose:${channel}] Groq failed:`, (e as Error).message)
  }
  try { return truncateForChannel(await callOpenRouter(prompt), channel) } catch (e) {
    console.warn(`[repurpose:${channel}] OpenRouter failed:`, (e as Error).message)
    return null
  }
}

export type ChannelResult = { channel: RepurposedChannel; content: string | null }

export async function generateAllChannels(
  composed: ComposedNewsletter,
  siteUrl?: string
): Promise<ChannelResult[]> {
  const channels: RepurposedChannel[] = ['linkedin', 'twitter', 'threads', 'article']
  // Run in parallel — independent LLM calls
  return Promise.all(
    channels.map(async (channel) => ({ channel, content: await generateForChannel(channel, composed, siteUrl) }))
  )
}
