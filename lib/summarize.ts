import Groq from 'groq-sdk'
import OpenAI from 'openai'

export type ArticleContent = {
  headline: string
  what_happened: string
  why_it_matters: string
}

export type SummarizeResult = {
  content: ArticleContent
  category: 'LLM' | 'Tools' | 'Research' | 'Industry' | 'Policy'
  importance_score: number
}

const PROMPT = (title: string, content: string) => `
You are a top-tier newsletter writer.

Transform this raw AI news item into a sharp newsletter entry.

Strict rules:
- Concise and skimmable
- No corporate or journalistic tone
- Write like a smart creator explaining to a friend
- Be slightly opinionated, not neutral
- Insight > information
- No filler. No hedging. No "this could potentially..."
- BANNED phrases: "this signals a shift", "marks a turning point", "could revolutionize", "game-changer", "paradigm shift", "in the AI space", "as AI continues to evolve". If you write these you have failed.
- "Why it matters" must be specific and concrete — name actual products, numbers, companies, second-order effects. Vague = wrong.

Respond ONLY with a valid JSON object — no markdown, no explanation:

{
  "headline": "<simple, engaging rewrite — max 80 chars; no clickbait, no all-caps>",
  "what_happened": "<exactly 1 line, plain factual>",
  "why_it_matters": "<exactly 2 short sentences. Specific, concrete, slightly opinionated. Mention a real product/company/number/consequence — never abstract>",
  "category": "<one of: LLM | Tools | Research | Industry | Policy>",
  "importance_score": <integer 1-10 based on significance to AI practitioners>
}

Article Title: ${title}
Article Content: ${content}
`.trim()

function parseResult(text: string): SummarizeResult {
  const cleaned = text.replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (
    typeof parsed.headline !== 'string' ||
    typeof parsed.what_happened !== 'string' ||
    typeof parsed.why_it_matters !== 'string' ||
    typeof parsed.category !== 'string' ||
    typeof parsed.importance_score !== 'number'
  ) {
    throw new Error('Invalid AI response shape')
  }
  return {
    content: {
      headline: parsed.headline,
      what_happened: parsed.what_happened,
      why_it_matters: parsed.why_it_matters,
    },
    category: parsed.category,
    importance_score: parsed.importance_score,
  }
}

async function tryOpenRouter(title: string, content: string): Promise<SummarizeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY')

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: PROMPT(title, content) }],
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    response_format: { type: 'json_object' },
  })
  const text = completion.choices[0]?.message?.content ?? ''
  return parseResult(text)
}

async function tryGroq(title: string, content: string): Promise<SummarizeResult> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('Missing GROQ_API_KEY')

  const groq = new Groq({ apiKey })
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: PROMPT(title, content) }],
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
  })
  const text = completion.choices[0]?.message?.content ?? ''
  return parseResult(text)
}

export async function summarizeArticle(article: {
  title: string
  content: string
}): Promise<SummarizeResult> {
  const { title, content } = article
  const truncatedContent = content.slice(0, 3000)

  try {
    return await tryGroq(title, truncatedContent)
  } catch (e1) {
    console.warn('Groq failed, trying OpenRouter:', (e1 as Error).message)
  }

  try {
    return await tryOpenRouter(title, truncatedContent)
  } catch (e2) {
    throw new Error(`All AI providers failed: ${(e2 as Error).message}`)
  }
}
