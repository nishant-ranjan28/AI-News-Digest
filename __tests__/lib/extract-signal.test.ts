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
import { extractSignal } from '@/lib/extract-signal'

describe('extractSignal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
  })

  it('returns parsed Signal on Groq happy path', async () => {
    const payload = JSON.stringify({
      fact: 'OpenAI shipped a new model.',
      shift: 'Frontier-model cadence is accelerating.',
      whyCare: 'Teams must replan their evaluation budgets.',
    })
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: payload } }],
          }),
        },
      },
    }))

    const result = await extractSignal('Some anchor summary.')
    expect(result).toEqual({
      fact: 'OpenAI shipped a new model.',
      shift: 'Frontier-model cadence is accelerating.',
      whyCare: 'Teams must replan their evaluation budgets.',
    })
  })

  it('strips ```json code fences before parsing', async () => {
    const fenced = '```json\n' +
      JSON.stringify({ fact: 'f', shift: 's', whyCare: 'w' }) +
      '\n```'
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: fenced } }],
          }),
        },
      },
    }))

    const result = await extractSignal('summary')
    expect(result).toEqual({ fact: 'f', shift: 's', whyCare: 'w' })
  })

  it('falls back to OpenRouter when Groq throws', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new Error('Groq down')),
        },
      },
    }))
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({ fact: 'f', shift: 's', whyCare: 'w' }),
                },
              },
            ],
          }),
        },
      },
    }))

    const result = await extractSignal('summary')
    expect(result).toEqual({ fact: 'f', shift: 's', whyCare: 'w' })
  })

  it('returns null when both Groq and OpenRouter throw', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('Groq down')) } },
    }))
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('OpenRouter down')) } },
    }))

    const result = await extractSignal('summary')
    expect(result).toBeNull()
  })

  it('returns null when both providers return invalid JSON shape', async () => {
    const badPayload = JSON.stringify({ fact: 'ok', shift: 123, whyCare: 'ok' })
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: badPayload } }],
          }),
        },
      },
    }))
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: badPayload } }],
          }),
        },
      },
    }))

    const result = await extractSignal('summary')
    expect(result).toBeNull()
  })
})
