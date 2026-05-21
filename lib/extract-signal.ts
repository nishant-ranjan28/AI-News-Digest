import Groq from 'groq-sdk'
import OpenAI from 'openai'

export type Signal = {
  fact: string
  shift: string
  whyCare: string
}

const EXTRACT_PROMPT = (summary: string) => `
Read this AI news summary.

Return JSON only:

{
  "fact":"",
  "shift":"",
  "whyCare":""
}

Field rules:

Fact:
- Use the specific company, product, number, or event from the summary.
- Name names. Mention dollar amounts, percentages, dates if present.
- Do NOT generalize into a category ("companies", "tools", "the industry").

Shift:
- Identify the broader trend this event signals.
- One step more abstract than the fact, not three steps more abstract.

WhyCare:
- A concrete implication a reader can act on or argue with.
- Not a prediction. Not hype.

Length:
- 1 sentence each. Maximum.

Avoid:
- repeating ideas across fields
- corporate words
- hype
- predictions
- LinkedIn-style writing

Example of GOOD output (notice the specificity):

{
  "fact":"Meta reportedly saves millions by combining AI tools across its products.",
  "shift":"Companies may gain more from workflow design than model quality.",
  "whyCare":"Integration could become a bigger advantage than benchmark performance."
}

Example of BAD output (too abstract — never produce this):

{
  "fact":"Companies combine AI tools.",
  "shift":"Workflows matter more.",
  "whyCare":"Saves money."
}

Summary:

${summary}
`.trim()

function parseSignal(text: string): Signal {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  if (
    typeof parsed.fact !== 'string' ||
    typeof parsed.shift !== 'string' ||
    typeof parsed.whyCare !== 'string'
  ) {
    throw new Error('Invalid signal shape')
  }
  return { fact: parsed.fact, shift: parsed.shift, whyCare: parsed.whyCare }
}

async function viaGroq(prompt: string): Promise<Signal> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('Missing GROQ_API_KEY')
  const groq = new Groq({ apiKey })
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    top_p: 0.9,
    response_format: { type: 'json_object' },
  })
  return parseSignal(completion.choices[0]?.message?.content ?? '')
}

async function viaOpenRouter(prompt: string): Promise<Signal> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY')
  const client = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    temperature: 0.3,
    top_p: 0.9,
    response_format: { type: 'json_object' },
  })
  return parseSignal(completion.choices[0]?.message?.content ?? '')
}

export async function extractSignal(summary: string): Promise<Signal | null> {
  const prompt = EXTRACT_PROMPT(summary)
  try {
    return await viaGroq(prompt)
  } catch (e) {
    console.warn('[extract-signal] Groq failed:', (e as Error).message)
  }
  try {
    return await viaOpenRouter(prompt)
  } catch (e) {
    console.warn('[extract-signal] OpenRouter failed:', (e as Error).message)
    return null
  }
}
