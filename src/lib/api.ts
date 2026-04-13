import { getSignedMessage, getL402 } from "./sphinx"

function resolveApiUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_URL || "https://bitcoin.sphinx.chat/api"
  }

  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL
  }

  const { host, origin } = window.location

  // Swarm deployments: rewrite nav.*.swarm.* → boltwall.*.swarm.*
  if (host.includes("swarm") && host.startsWith("nav")) {
    const parts = host.split(".")
    parts[0] = "boltwall"
    return `https://${parts.join(".")}/api`
  }

  if (origin.includes("localhost")) {
    return "https://bitcoin.sphinx.chat/api"
  }

  return `${origin}/api`
}

export const API_URL = resolveApiUrl()

async function request<Res>(
  url: string,
  config?: RequestInit,
  signal?: AbortSignal
): Promise<Res> {
  const parsed = new URL(url)
  const signed = await getSignedMessage()

  if (signed.signature) {
    parsed.searchParams.append("sig", signed.signature)
    parsed.searchParams.append("msg", signed.message)
  }

  // Attach L402 token upfront if available
  // Skip payment endpoints — /buy_lsat MUST return 402 with the invoice
  const existingHeaders = config?.headers as Record<string, string> | undefined
  const isPaymentEndpoint = parsed.pathname.endsWith("/buy_lsat") || parsed.pathname.endsWith("/top_up_lsat")
  if (!existingHeaders?.Authorization && !isPaymentEndpoint) {
    const l402 = await getL402()
    if (l402) {
      config = {
        ...config,
        headers: { ...existingHeaders, Authorization: l402 },
      }
    }
  }

  const response = await fetch(parsed.toString(), {
    ...config,
    signal: signal ?? new AbortController().signal,
  })

  if (!response.ok) {
    throw response
  }

  return response.json()
}

export const api = {
  get: <Res>(
    endpoint: string,
    headers?: RequestInit["headers"],
    signal?: AbortSignal
  ) => request<Res>(`${API_URL}${endpoint}`, headers ? { headers } : undefined, signal),

  post: <Res>(
    endpoint: string,
    body: unknown,
    headers?: RequestInit["headers"],
    signal?: AbortSignal
  ) =>
    request<Res>(
      `${API_URL}${endpoint}`,
      {
        body: JSON.stringify(body),
        headers: { ...headers, "Content-Type": "application/json" },
        method: "POST",
      },
      signal
    ),

  put: <Res>(
    endpoint: string,
    body: unknown,
    headers?: RequestInit["headers"],
    signal?: AbortSignal
  ) =>
    request<Res>(
      `${API_URL}${endpoint}`,
      {
        body: JSON.stringify(body),
        headers: { ...headers, "Content-Type": "application/json" },
        method: "PUT",
      },
      signal
    ),

  delete: <Res>(
    endpoint: string,
    headers?: RequestInit["headers"],
    signal?: AbortSignal
  ) =>
    request<Res>(
      `${API_URL}${endpoint}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        method: "DELETE",
      },
      signal
    ),
}
