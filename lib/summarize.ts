import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'
import OpenAI from 'openai'

export type SummarizeResult = {
  summary: string
  category: 'LLM' | 'Tools' | 'Research' | 'Industry' | 'Policy'
  importance_score: number
}

const PROMPT = (title: string, content: string) => `
You are an AI news curator for developers and QA engineers.
Given the article below, respond ONLY with a valid JSON object — no markdown, no explanation.

{
  "summary": "<3-4 sentence plain English summary>",
  "category": "<one of: LLM | Tools | Research | Industry | Policy>",
  "importance_score": <integer 1-10 based on significance to AI practitioners>
}

Article Title: ${title}
Article Content: ${content}
`.trim()

function parseResult(text: string): SummarizeResult {
  const cleaned = text.replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!parsed.summary || !parsed.category || typeof parsed.importance_score !== 'number') {
    throw new Error('Invalid AI response shape')
  }
  return parsed as SummarizeResult
}

async function tryGemini(title: string, content: string): Promise<SummarizeResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  const result = await model.generateContent(PROMPT(title, content))
  return parseResult(result.response.text())
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
    console.warn('OpenRouter failed, trying Gemini:', (e2 as Error).message)
  }

  try {
    return await tryGemini(title, truncatedContent)
  } catch (e3) {
    throw new Error(`All AI providers failed: ${(e3 as Error).message}`)
  }
}
