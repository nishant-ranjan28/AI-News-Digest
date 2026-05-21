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
import {
  CHANNEL_CONFIGS,
  buildSlug,
  generateForChannel,
  generateAllChannels,
} from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'

describe('CHANNEL_CONFIGS', () => {
  it('has entries for all four channels', () => {
    expect(Object.keys(CHANNEL_CONFIGS).sort()).toEqual(['article', 'linkedin', 'threads', 'twitter'])
  })
  it('each config has a max length and prompt builder', () => {
    for (const cfg of Object.values(CHANNEL_CONFIGS)) {
      expect(typeof cfg.maxChars).toBe('number')
      expect(typeof cfg.buildPrompt).toBe('function')
    }
  })
})

describe('buildSlug', () => {
  it('produces a url-safe slug from theme + date', () => {
    expect(buildSlug('AI is becoming trustworthy', '2026-05-20')).toBe('2026-05-20-ai-is-becoming-trustworthy')
  })
  it('truncates long themes to 60 chars total after the date prefix', () => {
    const slug = buildSlug('A'.repeat(200), '2026-05-20')
    expect(slug.length).toBeLessThanOrEqual(60 + '2026-05-20-'.length)
  })
  it('strips special chars', () => {
    expect(buildSlug("OpenAI's $50B bet?!", '2026-05-20')).toBe('2026-05-20-openai-s-50b-bet')
  })
  it('does not produce a trailing hyphen when theme is entirely special chars', () => {
    expect(buildSlug('!!!', '2026-05-20')).toBe('2026-05-20')
  })
  it('does not produce a trailing hyphen when truncation lands mid-hyphen-run', () => {
    const slug = buildSlug('a'.repeat(59) + ' word', '2026-05-20')
    expect(slug.endsWith('-')).toBe(false)
  })
})

// ---- LLM generation tests ----

function makeComposed(overrides: Partial<ComposedNewsletter> = {}): ComposedNewsletter {
  return {
    theme: 'AI is becoming trustworthy',
    signal: 'A sharp single-sentence framing of today.',
    subject_teasers: [
      { text: 'Anchor teaser one', emoji: '💬' },
      { text: 'Supporting teaser two', emoji: '📱' },
      { text: 'Contrast teaser three', emoji: '🤖' },
    ],
    stories: [
      {
        role: 'anchor',
        headline: 'Big anchor story',
        body: 'Anchor body with two lines of depth.',
        url: 'https://example.com/anchor',
        read_time_minutes: 2,
        hot_take: 'Anchor hot take.',
      },
      {
        role: 'supporting',
        headline: 'Supporting one',
        body: 'Sup body 1.',
        url: 'https://example.com/sup1',
        read_time_minutes: 1,
      },
      {
        role: 'supporting',
        headline: 'Supporting two',
        body: 'Sup body 2.',
        url: 'https://example.com/sup2',
        read_time_minutes: 2,
      },
      {
        role: 'supporting',
        headline: 'Supporting three',
        body: 'Sup body 3.',
        url: 'https://example.com/sup3',
        read_time_minutes: 1,
      },
      {
        role: 'contrast',
        headline: 'Contrast story',
        body: 'Contrast body.',
        url: 'https://example.com/contrast',
        read_time_minutes: 2,
        hot_take: 'Contrast hot take.',
      },
    ],
    tool: {
      name: 'Cursor',
      what: 'AI-first code editor.',
      best_for: 'Developers refactoring large codebases.',
      why_now: 'Just shipped a major model upgrade.',
    },
    quick_takeaway: 'A bold, memorable, screenshot-worthy line.',
    closing: { kind: 'statement', text: 'A strong closing statement.' },
    ...overrides,
  }
}

describe('generateForChannel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
  })

  it('returns the Groq response (trimmed) on success', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: '  Generated LinkedIn post text.  ' } }],
          }),
        },
      },
    }))

    const result = await generateForChannel('linkedin', makeComposed())
    expect(result).toBe('Generated LinkedIn post text.')
  })

  it('falls back to OpenRouter when Groq throws', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('Groq down')) } },
    }))
    const openRouterCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'Fallback tweet text.' } }],
    })
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: openRouterCreate } },
    }))

    const result = await generateForChannel('twitter', makeComposed())
    expect(result).toBe('Fallback tweet text.')
    expect(openRouterCreate).toHaveBeenCalledTimes(1)
  })

  it('returns null when both Groq and OpenRouter throw', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('Groq down')) } },
    }))
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('OpenRouter down')) } },
    }))

    const result = await generateForChannel('threads', makeComposed())
    expect(result).toBeNull()
  })

  it('truncates output longer than maxChars for short-form channels (twitter)', async () => {
    const longText = 'x'.repeat(400) // twitter maxChars is 280
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: longText } }],
          }),
        },
      },
    }))

    const result = await generateForChannel('twitter', makeComposed())
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(CHANNEL_CONFIGS.twitter.maxChars)
  })

  it('does NOT truncate output for the article channel', async () => {
    // article maxChars = 8000. Provide content > 8000 chars and expect it back unchanged.
    const longArticle = 'a'.repeat(8500)
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: longArticle } }],
          }),
        },
      },
    }))

    const result = await generateForChannel('article', makeComposed())
    expect(result).toBe(longArticle)
    expect(result!.length).toBe(8500)
  })
})

describe('generateAllChannels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GROQ_API_KEY = 'test-groq-key'
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
  })

  it('calls all 4 channels and returns ChannelResult[] with correct shape', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'Generated content.' } }],
          }),
        },
      },
    }))

    const results = await generateAllChannels(makeComposed())
    expect(results).toHaveLength(4)
    const channels = results.map((r) => r.channel).sort()
    expect(channels).toEqual(['article', 'linkedin', 'threads', 'twitter'])
    for (const r of results) {
      expect(typeof r.channel).toBe('string')
      expect(r.content).toBe('Generated content.')
    }
  })
})
