import { summarizeArticle, SummarizeResult } from '@/lib/summarize'

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn(),
    }),
  })),
}))

jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }))
})

import { GoogleGenerativeAI } from '@google/generative-ai'
import Groq from 'groq-sdk'

describe('summarizeArticle', () => {
  const mockArticle = {
    title: 'GPT-5 Released',
    content: 'OpenAI has released GPT-5 with major improvements...',
  }

  const validResult: SummarizeResult = {
    summary: 'A 3-4 sentence summary of the article.',
    category: 'LLM',
    importance_score: 9,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    process.env.GROQ_API_KEY = 'test-groq-key'
  })

  it('returns parsed result from Gemini on success', async () => {
    const mockModel = {
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => JSON.stringify(validResult) },
      }),
    }
    ;(GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    }))

    const result = await summarizeArticle(mockArticle)
    expect(result.category).toBe('LLM')
    expect(result.importance_score).toBe(9)
    expect(result.summary).toBeDefined()
  })

  it('falls back to Groq when Gemini fails', async () => {
    ;(GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn().mockRejectedValue(new Error('Rate limit')),
      }),
    }))
    ;(Groq as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(validResult) } }],
          }),
        },
      },
    }))

    const result = await summarizeArticle(mockArticle)
    expect(result.summary).toBeDefined()
  })

  it('throws when all providers fail', async () => {
    ;(GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn().mockRejectedValue(new Error('fail')),
      }),
    }))
    ;(Groq as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new Error('fail')),
        },
      },
    }))

    await expect(summarizeArticle(mockArticle)).rejects.toThrow()
  })
})
