import { getSignedMessage, getL402 } from "./sphinx"

function resolveApiUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_URL || "https://bitcoin.sphinx.chat/api"
  }

  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL
  }

  const { host, origin } = window.location

  // Swarm deployments: rewrite nav.*.swarm.* or graph.*.swarm.* → boltwall.*.swarm.*
  if (host.includes("swarm") && (host.startsWith("nav") || host.startsWith("graph"))) {
    const parts = host.split(".")
    parts[0] = "boltwall"
    return `https://${parts.join(".")}/api`
  }

  // Port-based SSL: rewrite {host}:3100 or {host}:8000 → {host}:8444/api
  if (host.includes(":3100") || host.includes(":8000")) {
    const baseHost = host.split(":")[0]
    return `https://${baseHost}:8444/api`
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

  const response = await fetch(parsed.toString(), {
    ...config,
    signal: signal ?? new AbortController().signal,
  })

  // Handle 402 Payment Required — get L402 token and retry
  if (response.status === 402) {
    const l402 = await getL402()
    if (l402) {
      const retryResponse = await fetch(parsed.toString(), {
        ...config,
        headers: {
          ...config?.headers,
          Authorization: l402,
        },
        signal: signal ?? new AbortController().signal,
      })

      if (!retryResponse.ok) {
        throw retryResponse
      }

      return retryResponse.json()
    }
  }

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
