import { summarizeArticle, SummarizeResult } from '@/lib/summarize'

jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }))
})

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }))
})

import Groq from 'groq-sdk'
import OpenAI from 'openai'

describe('summarizeArticle', () => {
  const mockArticle = {
    title: 'GPT-5 Released',
    content: 'OpenAI has released GPT-5 with major improvements...',
  }

  const validResult: SummarizeResult = {
    content: {
      headline: 'GPT-5 lands with sharper reasoning',
      what_happened: 'OpenAI released GPT-5 today with major reasoning gains.',
      why_it_matters: 'Sets a new bar for production LLMs and forces open-source to catch up fast.',
    },
    category: 'LLM',
    importance_score: 9,
  }

  const validRawResponse = JSON.stringify({
    headline: validResult.content.headline,
    what_happened: validResult.content.what_happened,
    why_it_matters: validResult.content.why_it_matters,
    category: validResult.category,
    importance_score: validResult.importance_score,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
  })

  it('returns parsed result from Groq on success', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: validRawResponse } }],
          }),
        },
      },
    }))

    const result = await summarizeArticle(mockArticle)
    expect(result.category).toBe('LLM')
    expect(result.importance_score).toBe(9)
    expect(result.content.headline).toBeDefined()
  })

  it('falls back to OpenRouter when Groq fails', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('Rate limit')) } },
    }))
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: validRawResponse } }],
          }),
        },
      },
    }))

    const result = await summarizeArticle(mockArticle)
    expect(result.content.headline).toBeDefined()
  })

  it('throws when all providers fail', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('fail')) } },
    }))
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('fail')) } },
    }))

    await expect(summarizeArticle(mockArticle)).rejects.toThrow()
  })
})
