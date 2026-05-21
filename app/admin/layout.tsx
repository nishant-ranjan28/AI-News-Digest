import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/admin-auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  if (!admin) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <a href="/admin" className="font-bold text-gray-900">Admin</a>
          <span className="text-xs text-gray-500">{admin.email}</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
