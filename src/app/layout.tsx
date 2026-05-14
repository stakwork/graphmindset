import type { Metadata } from "next"
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
        <noscript>
          <h1>GraphMindset</h1>
          <p>
            This page is a JavaScript-rendered single-page app — interactive
            graph exploration requires a browser with JS enabled.
          </p>
          <p>
            <strong>AI agents and automated clients:</strong> the API is
            described in machine-readable form. See{" "}
            <a href="/llms.txt">/llms.txt</a> for the endpoint catalog with
            curl examples, and <a href="/agents.txt">/agents.txt</a> for the
            L402 authentication and Lightning payment policy (including the
            protocol for asking a human operator to pay the invoice when you
            do not have a wallet integration).
          </p>
        </noscript>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
