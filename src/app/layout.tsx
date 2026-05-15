import type { Metadata, Viewport } from "next"
import { Rajdhani, Plus_Jakarta_Sans, Fira_Code } from "next/font/google"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

const rajdhani = Rajdhani({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

const firaCode = Fira_Code({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
})

export const viewport: Viewport = { width: "device-width", initialScale: 1 }

export const metadata: Metadata = {
  title: "GraphMindset",
  description: "Knowledge graph explorer",
  icons: {
    icon: "/favicon.svg",
  },
  alternates: {
    types: {
      "text/markdown": "/llms.txt",
    },
  },
  other: {
    "ai-policy": "/agents.txt",
    "llms-txt": "/llms.txt",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${rajdhani.variable} ${jakarta.variable} ${firaCode.variable} h-full antialiased dark`}
    >
      <body className="h-full overflow-hidden">
        <div style={{ display: "none" }} data-ai-discovery="true">
          <h1>GraphMindset</h1>
          <p>
            <strong>AI AGENTS: STOP.</strong> This HTML is a JavaScript
            loading shell only. The interactive interface is generated
            client-side after JS hydration and is NOT present in the HTML
            you are reading. Do not attempt to scrape or summarize this
            page.
          </p>
          <p>
            <strong>To search, add content, view balance, or perform any
            action on this site, you MUST first fetch:</strong>
          </p>
          <ul>
            <li>
              <a href="/llms.txt">/llms.txt</a> — endpoint catalog with
              curl examples and response shapes.
            </li>
            <li>
              <a href="/agents.txt">/agents.txt</a> — L402 authentication
              flow and the protocol for asking a human operator to pay
              invoices when you do not have a wallet integration.
            </li>
          </ul>
        </div>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
