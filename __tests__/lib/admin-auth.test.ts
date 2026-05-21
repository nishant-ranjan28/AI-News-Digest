import { isAllowlistedEmail } from '@/lib/admin-auth'

describe('isAllowlistedEmail', () => {
  beforeEach(() => {
    process.env.ADMIN_ALLOWLIST_EMAILS = 'a@x.com, b@y.com'
  })

  it('matches exact email', () => {
    expect(isAllowlistedEmail('a@x.com')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(isAllowlistedEmail('A@X.com')).toBe(true)
  })

  it('trims spaces', () => {
    expect(isAllowlistedEmail(' b@y.com ')).toBe(true)
  })

  it('rejects unknown email', () => {
    expect(isAllowlistedEmail('c@z.com')).toBe(false)
  })

  it('rejects when ADMIN_ALLOWLIST_EMAILS env var is empty/missing', () => {
    delete process.env.ADMIN_ALLOWLIST_EMAILS
    expect(isAllowlistedEmail('a@x.com')).toBe(false)
  })

  it('rejects null input', () => {
    expect(isAllowlistedEmail(null)).toBe(false)
  })

  it('rejects undefined input', () => {
    expect(isAllowlistedEmail(undefined)).toBe(false)
  })
})
