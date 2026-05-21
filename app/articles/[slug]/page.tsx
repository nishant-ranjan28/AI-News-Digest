// app/articles/[slug]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedArticleBySlug } from '@/lib/db'

export const revalidate = 300 // 5-min ISR

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const article = await getPublishedArticleBySlug(slug)
  if (!article) return { title: 'Article not found' }
  const title = (article.metadata as { theme?: string } | null)?.theme ?? 'AI News Digest'
  return {
    title: `${title} — AI News Digest`,
    description: article.content.slice(0, 160).replace(/[#*_`>]/g, '').trim(),
  }
}

function renderMarkdown(md: string): string {
  // Minimal renderer — escape, then convert ## headings, **bold**, *italic*, and paragraphs.
  // For richer output, swap in `marked` later. Keeping deps zero for now.
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc(md)
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .split(/\n{2,}/)
    .map((block) => block.startsWith('<h') ? block : `<p>${block.replace(/\n/g, '<br/>')}</p>`)
    .join('\n')
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const article = await getPublishedArticleBySlug(slug)
  if (!article) notFound()

  const theme = (article.metadata as { theme?: string } | null)?.theme ?? 'AI News Digest'
  const html = renderMarkdown(article.content)

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <a href="/archive" className="text-sm text-indigo-600 hover:underline">← Back to archive</a>
        <p className="text-xs uppercase tracking-wide text-gray-500 mt-6">{article.issue_date}</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1 mb-6">{theme}</h1>
        <article
          className="prose prose-neutral max-w-none [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:leading-7 [&_p]:my-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <hr className="my-12 border-gray-200" />
        <p className="text-sm text-gray-600">
          Want this in your inbox every morning?{' '}
          <Link href="/" className="text-indigo-600 font-semibold underline">Subscribe →</Link>
        </p>
      </div>
    </main>
  )
}
