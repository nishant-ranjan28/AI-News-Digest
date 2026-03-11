import { render, screen } from '@testing-library/react'
import ArticleCard from '@/components/ArticleCard'

const mockArticle = {
  id: '1',
  title: 'GPT-5 Released',
  url: 'https://openai.com/gpt5',
  summary: 'OpenAI released GPT-5 with significant improvements.',
  category: 'LLM',
  importance_score: 9,
  source: 'openai.com',
  published_date: '2026-03-11',
}

describe('ArticleCard', () => {
  it('renders title', () => {
    render(<ArticleCard article={mockArticle} />)
    expect(screen.getByText('GPT-5 Released')).toBeInTheDocument()
  })

  it('renders category badge', () => {
    render(<ArticleCard article={mockArticle} />)
    expect(screen.getByText('LLM')).toBeInTheDocument()
  })

  it('renders summary', () => {
    render(<ArticleCard article={mockArticle} />)
    expect(screen.getByText(/OpenAI released GPT-5/)).toBeInTheDocument()
  })

  it('renders Read More link pointing to article URL', () => {
    render(<ArticleCard article={mockArticle} />)
    const link = screen.getByRole('link', { name: /read more/i })
    expect(link).toHaveAttribute('href', 'https://openai.com/gpt5')
  })
})
