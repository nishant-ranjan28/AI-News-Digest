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
  cleanup,
  generateForChannel,
  generateAllChannels,
} from '@/lib/repurpose'
import type { ComposedNewsletter } from '@/lib/compose'
import type { Signal } from '@/lib/extract-signal'

describe('CHANNEL_CONFIGS', () => {
  it('has entries for all four channels', () => {
    expect(Object.keys(CHANNEL_CONFIGS).sort()).toEqual(['article', 'linkedin', 'threads', 'twitter'])
  })
  it('each config has a max length', () => {
    for (const cfg of Object.values(CHANNEL_CONFIGS)) {
      expect(typeof cfg.maxChars).toBe('number')
      expect(typeof cfg.channel).toBe('string')
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

describe('cleanup', () => {
  it('removes banned phrases case-insensitively', () => {
    const input = 'This Game Changer creates a competitive edge and revolution with significant impact today.'
    const out = cleanup(input)
    expect(out.toLowerCase()).not.toContain('game changer')
    expect(out.toLowerCase()).not.toContain('competitive edge')
    expect(out.toLowerCase()).not.toContain('revolution')
    expect(out.toLowerCase()).not.toContain('significant impact')
  })
  it('collapses double spaces produced by removals', () => {
    const out = cleanup('A revolution in AI today.')
    expect(out).not.toMatch(/  +/)
  })
  it('trims the final string', () => {
    const out = cleanup('  hello world  ')
    expect(out).toBe('hello world')
  })
  it('removes hyphenated game-changer variant', () => {
    const out = cleanup('This game-changer is amazing.')
    expect(out.toLowerCase()).not.toContain('game-changer')
    expect(out.toLowerCase()).not.toContain('game changer')
  })
  it('removes filler phrases the LLM slips through', () => {
    const out = cleanup("Something's changing in tech and it's worth paying attention to.")
    expect(out.toLowerCase()).not.toContain('worth paying attention to')
    expect(out.toLowerCase()).not.toContain("something's changing")
    expect(out.toLowerCase()).not.toContain('something is changing')
  })
  it('removes "changing the landscape" phrase', () => {
    const out = cleanup('AI is changing the landscape of work.')
    expect(out.toLowerCase()).not.toContain('changing the landscape')
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

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    fact: 'OpenAI shipped a new model.',
    shift: 'Frontier model cadence keeps accelerating.',
    whyCare: 'Teams must replan their evaluation budgets.',
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

    const result = await generateForChannel('linkedin', makeComposed(), makeSignal())
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

    const result = await generateForChannel('twitter', makeComposed(), makeSignal())
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

    const result = await generateForChannel('threads', makeComposed(), makeSignal())
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

    const result = await generateForChannel('twitter', makeComposed(), makeSignal())
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(CHANNEL_CONFIGS.twitter.maxChars)
  })

  it('does NOT truncate output for the article channel', async () => {
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

    const result = await generateForChannel('article', makeComposed(), null)
    expect(result).toBe(longArticle)
    expect(result!.length).toBe(8500)
  })

  it('article generation works even when signal is null', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: '# Article body' } }],
          }),
        },
      },
    }))

    const result = await generateForChannel('article', makeComposed(), null)
    expect(result).toBe('# Article body')
  })

  it('short-form channels return null when signal is null', async () => {
    const groqCreate = jest.fn()
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create: groqCreate } },
    }))

    const linkedin = await generateForChannel('linkedin', makeComposed(), null)
    const twitter = await generateForChannel('twitter', makeComposed(), null)
    const threads = await generateForChannel('threads', makeComposed(), null)
    expect(linkedin).toBeNull()
    expect(twitter).toBeNull()
    expect(threads).toBeNull()
    expect(groqCreate).not.toHaveBeenCalled()
  })

  it('linkedin generation works when signal is provided', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'Hook line.\nObservation.\nImplication.\nCTA.' } }],
          }),
        },
      },
    }))

    const result = await generateForChannel('linkedin', makeComposed(), makeSignal())
    expect(result).toBe('Hook line.\nObservation.\nImplication.\nCTA.')
  })

  it('applies cleanup to final output (removes banned phrases)', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'This is a real game changer for AI.' } }],
          }),
        },
      },
    }))

    const result = await generateForChannel('linkedin', makeComposed(), makeSignal())
    expect(result).not.toBeNull()
    expect(result!.toLowerCase()).not.toContain('game changer')
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

    const results = await generateAllChannels(makeComposed(), makeSignal())
    expect(results).toHaveLength(4)
    const channels = results.map((r) => r.channel).sort()
    expect(channels).toEqual(['article', 'linkedin', 'threads', 'twitter'])
    for (const r of results) {
      expect(typeof r.channel).toBe('string')
      expect(r.content).toBe('Generated content.')
    }
  })

  it('short-form channels are null when signal is null, but article still generates', async () => {
    ;(Groq as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: '# Article body' } }],
          }),
        },
      },
    }))

    const results = await generateAllChannels(makeComposed(), null)
    const byChannel = Object.fromEntries(results.map((r) => [r.channel, r.content]))
    expect(byChannel.linkedin).toBeNull()
    expect(byChannel.twitter).toBeNull()
    expect(byChannel.threads).toBeNull()
    expect(byChannel.article).toBe('# Article body')
  })
})
