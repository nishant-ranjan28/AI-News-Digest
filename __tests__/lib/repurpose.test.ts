import { CHANNEL_CONFIGS, buildSlug } from '@/lib/repurpose'

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
