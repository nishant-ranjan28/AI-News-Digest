import { render, screen, fireEvent } from '@testing-library/react'
import CategoryFilter from '@/components/CategoryFilter'

describe('CategoryFilter', () => {
  const categories = ['All', 'LLM', 'Tools', 'Research', 'Industry', 'Policy']

  it('renders all category tabs', () => {
    render(<CategoryFilter selected="All" onSelect={() => {}} />)
    categories.forEach((cat) => {
      expect(screen.getByText(cat)).toBeInTheDocument()
    })
  })

  it('calls onSelect when a tab is clicked', () => {
    const onSelect = jest.fn()
    render(<CategoryFilter selected="All" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('LLM'))
    expect(onSelect).toHaveBeenCalledWith('LLM')
  })

  it('marks the selected tab as active', () => {
    render(<CategoryFilter selected="LLM" onSelect={() => {}} />)
    const llmButton = screen.getByText('LLM').closest('button')
    expect(llmButton).toHaveClass('bg-indigo-600')
  })
})
