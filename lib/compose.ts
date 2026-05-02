import Groq from 'groq-sdk'
import OpenAI from 'openai'

export type ComposedStory = {
  role: 'anchor' | 'supporting' | 'contrast'
  headline: string
  body: string
  url: string
  read_time_minutes: number
  hot_take?: string
}

export type SubjectTeaser = {
  text: string
  emoji: string
}

export type ComposedTool = {
  name: string
  what: string
  best_for: string
}

export type ComposedClosing = {
  kind: 'question' | 'statement'
  text: string
}

export type ComposedNewsletter = {
  subject_teasers: SubjectTeaser[]
  theme: string
  signal: string
  stories: ComposedStory[]
  tool: ComposedTool
  quick_takeaway: string
  closing: ComposedClosing
}

export type ComposeInput = {
  title: string
  url: string
  content: string
  source?: string
}

const PROMPT = (articles: ComposeInput[]) => {
  const items = articles
    .map(
      (a, i) =>
        `[${i + 1}] ${a.title}\nURL: ${a.url}\nSOURCE: ${a.source ?? ''}\nCONTENT: ${a.content.slice(0, 1500)}`
    )
    .join('\n\n')

  return `
You are a top-tier AI newsletter writer. You write the way a smart creator talks to a friend — sharp, opinionated, fast to read.

Your job: turn the raw articles below into ONE coherent daily newsletter.

# CORE PRINCIPLE
Every line must answer "why should I care?" in under 5 seconds. If it doesn't, cut or rewrite.

# DESIGN RULES (non-negotiable)

1. PICK ONE THEME first. Examples: "Competition is heating up", "AI is becoming trustworthy", "Money is moving to infra". This theme anchors everything.

2. SELECT EXACTLY 5 STORIES from the input — no more, no less:
   - 1 ANCHOR: the single biggest/most important story for the theme
   - 3 SUPPORTING: each reinforces or extends the anchor from a different angle
   - 1 CONTRAST: a counterpoint, outlier, or "meanwhile in another corner of AI" angle
   Skip anything that doesn't fit. Quality > quantity.

3. WRITE WITH VARIATION — STRUCTURAL RULE BY ROLE:
   - anchor.body: 2-4 lines. Full depth. Lead with the concrete fact, then 1-2 lines of interpretation. Often deserves a hot_take.
   - supporting.body: 1-2 lines each. ONE sharp observation or implication per story. NOT a summary — a "huh, didn't notice that" angle. The 3 supporting stories MUST themselves vary: one might be a comparison, one a stat-led punch, one a question or "meanwhile..." aside. Do NOT make all three the same shape.
   - contrast.body: 1-2 lines. A punchy take, comparison, or counterpoint. Slightly bold. Often deserves a hot_take.
   If all 5 stories end up the same length or shape, you have failed. Vary the rhythm.

4. AT LEAST ONE STRONG OPINION. Somewhere in the newsletter (a story body, a hot_take, the signal, or the closing) there MUST be one line where a reader thinks "huh, interesting take" or even disagrees. No opinion = no newsletter.

5. TOOL OF THE DAY IS REQUIRED. Always include one. If a useful AI tool/product/model surfaces from today's news, use that. If nothing surfaces, recommend a real, well-known AI tool that thematically fits today (e.g. Cursor when the theme is dev tools, Perplexity for search, Claude/ChatGPT for general LLMs, Gemini, v0, Replit Agent, Suno, Pika, Runway). Never invent fake tools. The reader should be able to actually try it today.

6. SUBJECT LINE — TLDR-STYLE TEASERS: produce exactly 3 short teasers (one for the anchor, two for the most click-worthy supporting/contrast stories). Each teaser is 4-7 words capturing the news + a relevant emoji. They render as: "Teaser one 💬, Teaser two 📱, Teaser three 🤖". Pick emojis that match the news topic specifically (💬 chat/leaks, 📱 mobile/UI, 🤖 AI tools, 💸 funding, ⚖️ policy/legal, 🧠 research, 📈 metrics, 🔥 hot, 🚀 launches, 🤝 partnerships, 🛠 dev tools). Avoid generic emojis like ✨ or 📰.

7. READ TIME: estimate read_time_minutes per story based on source article length. Rough heuristic: <800 chars = 1, 800-2000 = 2, 2000-4000 = 3, >4000 = 4. Cap at 6.

8. CLOSING: end with EITHER a real question to the reader OR a strong statement. Not both. No corporate "thanks for reading" — natural continuation only.

# BANNED PHRASES (auto-fail if used anywhere)
"signals a shift", "marks a turning point", "the AI space", "could revolutionize", "game-changer", "paradigm shift", "new era", "the beginning of", "might just be", "redefine the future", "as AI continues", "in the long run", "in the long term", "this could potentially", "vote of confidence", "promising development", "helping to accelerate", "clear signal that", "clear sign that", "clear sign", "remains to be seen", "play out", "stay tuned", "watch this space", "drive growth and innovation", "stay ahead of the curve", "transformative", "robust", "leveraging", "AI wars are escalating", "dominance is under threat", "ultimately decide", "be enough to"

# EXAMPLES — illustrative ONLY. DO NOT copy these phrases or topics in your output. They show TONE and SHAPE, not content. If your output contains any sentence from the examples below verbatim, you have failed.

BAD body shape: "Company X invested $Y. This is a clear signal that they want to stay competitive."
GOOD body shape: "Company X just dropped $Y on infra — more than competitors combined. Translation: someone got scared."

BAD hot_take: vague platitude, no stance, no number, no specific actor named.
GOOD hot_take: a defensible opinion citing a specific actor + a specific reason a smart reader could disagree with.

BAD signal: a vague statement about an industry trend.
GOOD signal: a single sharp observation pointing at a non-obvious second-order effect, with a real number or named entity.

BAD closing: "What do you think about AI?"
GOOD closing: a specific question with named actors and a concrete future event, OR a strong stance worth screenshotting.

# WRITING STYLE
- Punchy sentences. Cut every word that doesn't earn its place. If you can delete it, delete it.
- Be specific. Name real products, models, companies, numbers, percentages, dollar amounts.
- Slightly opinionated. Have a stance. If a smart reader can't disagree with any line, you wrote nothing.
- No corporate language, no journalist-speak, no hedging, no "could", no "may", no "potentially".
- VARIATION IS REQUIRED: the 5 stories MUST feel different in shape. If they're all the same length and structure, you have failed.
- hot_take is OPTIONAL per story but powerful. Only add it where you have a real opinion worth defending. No platitudes.

Respond ONLY with a valid JSON object — no markdown, no explanation:

{
  "subject_teasers": [
    { "text": "<4-7 words from anchor>", "emoji": "<topic-relevant>" },
    { "text": "<4-7 words from supporting>", "emoji": "<topic-relevant>" },
    { "text": "<4-7 words from contrast or another supporting>", "emoji": "<topic-relevant>" }
  ],
  "theme": "<3-6 word phrase that names today's angle>",
  "signal": "<exactly 1 sentence (15-25 words) framing the theme; a perspective, not a recap>",
  "stories": [
    {
      "role": "anchor",
      "headline": "<simple, engaging — max 80 chars>",
      "body": "<2-4 short lines. Mix factual + interpretive. Concrete and opinionated>",
      "url": "<exact URL of the chosen article from input>",
      "read_time_minutes": <integer 1-6>,
      "hot_take": "<optional: one sharp opinion line. Omit field if not warranted>"
    },
    { "role": "supporting", "headline": "...", "body": "...", "url": "...", "read_time_minutes": 1 },
    { "role": "supporting", "headline": "...", "body": "...", "url": "...", "read_time_minutes": 2 },
    { "role": "supporting", "headline": "...", "body": "...", "url": "...", "read_time_minutes": 1 },
    { "role": "contrast", "headline": "...", "body": "...", "url": "...", "read_time_minutes": 2 }
  ],
  "tool": {
    "name": "<a real, well-known AI tool the reader can try today (e.g. Cursor, Claude, ChatGPT, Perplexity, v0, Replit Agent, Suno, Pika, Runway)>",
    "what": "<exactly 1 short sentence — concrete capability, no marketing>",
    "best_for": "<exactly 1 short sentence naming the actual user or use case>"
  },
  "quick_takeaway": "<exactly ONE short sentence (8-18 words). Bold, memorable, screenshot-worthy. A stance with teeth, distinct from signal and closing>",
  "closing": {
    "kind": "question",
    "text": "<a real question worth answering, OR a bold closing statement (set kind to 'statement')>"
  }
}

# INPUT ARTICLES
${items}
`.trim()
}

function parse(text: string): ComposedNewsletter {
  const cleaned = text.replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)

  if (
    !Array.isArray(parsed.subject_teasers) ||
    parsed.subject_teasers.length === 0 ||
    typeof parsed.theme !== 'string' ||
    typeof parsed.signal !== 'string' ||
    !Array.isArray(parsed.stories) ||
    parsed.stories.length === 0 ||
    typeof parsed.quick_takeaway !== 'string' ||
    !parsed.closing ||
    typeof parsed.closing.text !== 'string' ||
    (parsed.closing.kind !== 'question' && parsed.closing.kind !== 'statement')
  ) {
    throw new Error('Invalid compose response shape')
  }

  for (const t of parsed.subject_teasers) {
    if (typeof t.text !== 'string' || typeof t.emoji !== 'string') {
      throw new Error('Invalid subject_teaser shape')
    }
  }

  for (const s of parsed.stories) {
    if (
      typeof s.headline !== 'string' ||
      typeof s.body !== 'string' ||
      typeof s.url !== 'string' ||
      typeof s.read_time_minutes !== 'number' ||
      (s.role !== 'anchor' && s.role !== 'supporting' && s.role !== 'contrast')
    ) {
      throw new Error('Invalid story shape')
    }
  }

  if (
    !parsed.tool ||
    typeof parsed.tool.name !== 'string' ||
    typeof parsed.tool.what !== 'string' ||
    typeof parsed.tool.best_for !== 'string'
  ) {
    throw new Error('Invalid tool shape — tool is required')
  }

  return parsed as ComposedNewsletter
}

async function viaGroq(prompt: string): Promise<ComposedNewsletter> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('Missing GROQ_API_KEY')
  const groq = new Groq({ apiKey })
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.4,
    top_p: 0.9,
    response_format: { type: 'json_object' },
  })
  return parse(completion.choices[0]?.message?.content ?? '')
}

async function viaOpenRouter(prompt: string): Promise<ComposedNewsletter> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY')
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    temperature: 0.4,
    top_p: 0.9,
    response_format: { type: 'json_object' },
  })
  return parse(completion.choices[0]?.message?.content ?? '')
}

export async function composeNewsletter(articles: ComposeInput[]): Promise<ComposedNewsletter | null> {
  if (articles.length === 0) return null
  const prompt = PROMPT(articles)

  try { return await viaGroq(prompt) } catch (e) {
    console.warn('[compose] Groq failed:', (e as Error).message)
  }
  try { return await viaOpenRouter(prompt) } catch (e) {
    console.warn('[compose] OpenRouter failed:', (e as Error).message)
    return null
  }
}
