import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SubscribeBar from '@/components/SubscribeBar'

global.fetch = jest.fn()

describe('SubscribeBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
  })

  it('renders email input and subscribe button', () => {
    render(<SubscribeBar />)
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument()
  })

  it('submits the form with email', async () => {
    render(<SubscribeBar />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), {
      target: { value: 'test@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/subscribe', expect.objectContaining({
        method: 'POST',
      }))
    })
  })
})
