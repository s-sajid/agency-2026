import type { Metadata } from 'next'
import { Fraunces, DM_Sans } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { ThemeProvider } from '@/components/ThemeProvider'

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-syne',
  weight: ['700', '800', '900'],
  style: ['normal'],
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  weight: ['300', '400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'Agency 2026 — Vendor Concentration',
  description: 'Canadian government spending concentration analysis',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${dmSans.variable}`}>
      <body className="bg-background text-foreground font-sans" suppressHydrationWarning>
        <ThemeProvider>
          <Navbar />
          <main className="pt-20 min-h-screen px-8 pb-20 max-w-[1400px] mx-auto">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  )
}
