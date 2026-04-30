import { sendDigestEmail } from '@/lib/email'
import { ComposedNewsletter } from '@/lib/compose'

const mockSend = jest.fn()
const mockSetApiKey = jest.fn()

jest.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: {
    setApiKey: (...args: unknown[]) => mockSetApiKey(...args),
    send: (...args: unknown[]) => mockSend(...args),
  },
}))

const mockResendSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockResendSend(...args) },
  })),
}))

const mockLogEmailResult = jest.fn()
jest.mock('@/lib/db', () => ({
  ...jest.requireActual('@/lib/db'),
  logEmailResult: (...args: unknown[]) => mockLogEmailResult(...args),
}))

describe('sendDigestEmail', () => {
  const mockComposed: ComposedNewsletter = {
    theme: 'AI competition heats up',
    signal: 'Big Tech is racing to ship cheaper, faster models.',
    stories: [
      {
        role: 'anchor',
        headline: 'GPT-5 lands with sharper reasoning',
        body: 'OpenAI released GPT-5 today with major reasoning gains.\nIt sets a new bar for production LLMs.',
        url: 'https://example.com/gpt5',
      },
    ],
    tool: null,
    closing: { kind: 'statement', text: 'The race is no longer about smarts; it is about cost.' },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.SENDGRID_API_KEY = 'test-sendgrid-key'
    process.env.SENDER_EMAIL = 'test@example.com'
    process.env.RESEND_API_KEY = 'test-resend-key'
    mockSend.mockResolvedValue([{ statusCode: 202 }])
    mockResendSend.mockResolvedValue({ data: { id: 'email-123' }, error: null })
    mockLogEmailResult.mockResolvedValue(undefined)
  })

  it('sends via SendGrid and logs success', async () => {
    await sendDigestEmail(mockComposed, ['user@test.com'])

    expect(mockSetApiKey).toHaveBeenCalledWith('test-sendgrid-key')
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com', from: 'test@example.com' })
    )
    expect(mockLogEmailResult).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'user@test.com', status: 'sent', provider: 'sendgrid' })
    )
  })

  it('falls back to Resend on SendGrid failure', async () => {
    mockSend.mockRejectedValue(new Error('SendGrid down'))

    await sendDigestEmail(mockComposed, ['user@test.com'])

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(mockLogEmailResult).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'user@test.com', status: 'failed', provider: 'sendgrid' })
    )
    expect(mockLogEmailResult).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'user@test.com', status: 'sent', provider: 'resend' })
    )
  })

  it('only retries failed emails with Resend', async () => {
    mockSend
      .mockResolvedValueOnce([{ statusCode: 202 }])
      .mockRejectedValueOnce(new Error('SendGrid down'))

    await sendDigestEmail(mockComposed, ['ok@test.com', 'fail@test.com'])

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'fail@test.com' })
    )
  })

  it('throws when SENDGRID_API_KEY is missing', async () => {
    delete process.env.SENDGRID_API_KEY
    await expect(sendDigestEmail(mockComposed, ['user@test.com'])).rejects.toThrow('Missing SENDGRID_API_KEY')
  })

  it('throws when SENDER_EMAIL is missing', async () => {
    delete process.env.SENDER_EMAIL
    await expect(sendDigestEmail(mockComposed, ['user@test.com'])).rejects.toThrow('Missing SENDER_EMAIL')
  })

  it('does nothing when subscriber list is empty', async () => {
    await sendDigestEmail(mockComposed, [])
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('logs failure for both providers when both fail', async () => {
    mockSend.mockRejectedValue(new Error('SendGrid down'))
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'Resend down' } })

    await sendDigestEmail(mockComposed, ['user@test.com'])

    expect(mockLogEmailResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', provider: 'sendgrid' })
    )
    expect(mockLogEmailResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', provider: 'resend' })
    )
  })
})
