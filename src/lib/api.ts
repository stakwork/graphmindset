import { getSignedMessage, getL402 } from "./sphinx"
import { injectedApiUrl } from "./runtime-config"

function resolveApiUrl(): string {
  if (typeof window === "undefined") {
    // Server render: read the live environment directly. GRAPH_MINDSET_API_URL
    // is not inlined at build time, so this reflects the running container.
    return (
      process.env.GRAPH_MINDSET_API_URL?.trim() ||
      process.env.NEXT_PUBLIC_API_URL ||
      "https://bitcoin.sphinx.chat/api"
    )
  }

  // Runtime value injected into the document by the root layout. Takes
  // precedence over NEXT_PUBLIC_API_URL, which is only ever what happened to be
  // set when the image was built.
  const injected = injectedApiUrl()

  if (injected) {
    return injected
  }

  // Still honoured for builds that bake the URL in via --build-arg.
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

let cachedApiUrl: string | undefined

/**
 * Resolved on first use rather than at module load, so the runtime value the
 * root layout injects into the document is guaranteed to be in place by the
 * time anything asks for it. Import this instead of a module-level constant.
 */
export function getApiUrl(): string {
  return (cachedApiUrl ??= resolveApiUrl())
}

/** Test seam — forces the next getApiUrl() call to re-resolve. */
export function resetApiUrlCache(): void {
  cachedApiUrl = undefined
}

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

  // Attach L402 token upfront if available.
  // Skip payment endpoints — /buy_lsat MUST return 402 with the invoice.
  // Callers that explicitly set Authorization (including "") opt out of auto-attach,
  // which lets probe calls force a 402 without debiting an existing balance.
  const existingHeaders = config?.headers as Record<string, string> | undefined
  const isPaymentEndpoint = parsed.pathname.endsWith("/buy_lsat") || parsed.pathname.endsWith("/top_up_lsat")
  const hasExplicitAuth = !!existingHeaders && "Authorization" in existingHeaders
  if (!hasExplicitAuth && !isPaymentEndpoint) {
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
  ) => request<Res>(`${getApiUrl()}${endpoint}`, headers ? { headers } : undefined, signal),

  post: <Res>(
    endpoint: string,
    body: unknown,
    headers?: RequestInit["headers"],
    signal?: AbortSignal
  ) =>
    request<Res>(
      `${getApiUrl()}${endpoint}`,
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
      `${getApiUrl()}${endpoint}`,
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
      `${getApiUrl()}${endpoint}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        method: "DELETE",
      },
      signal
    ),
}
