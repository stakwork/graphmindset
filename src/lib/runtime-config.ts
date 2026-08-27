/**
 * Runtime configuration.
 *
 * NEXT_PUBLIC_* variables are inlined by Next at build time, so they freeze
 * whatever value was present when the image was built. That makes a published
 * image unusable in any deployment with a different API host — which is why
 * the container could be handed the correct URL at runtime and still call the
 * compiled-in default.
 *
 * GRAPH_MINDSET_API_URL carries no NEXT_PUBLIC_ prefix, so it is never inlined:
 * the server reads it from the real environment on each boot and hands it to
 * the browser through a <script> tag in the document head. One image then works
 * in every environment, and changing the URL is a restart rather than a rebuild.
 */

export const RUNTIME_CONFIG_GLOBAL = "__GRAPH_MINDSET_CONFIG__"

export type RuntimeConfig = {
  apiUrl: string
}

declare global {
  interface Window {
    [RUNTIME_CONFIG_GLOBAL]?: Partial<RuntimeConfig>
  }
}

/**
 * Server-side only — reads the live environment. Called while rendering the
 * document so the value is embedded in the HTML the browser receives.
 */
export function readRuntimeConfig(): RuntimeConfig {
  return {
    // GRAPH_MINDSET_API_URL is read from the live environment on every render.
    //
    // The NEXT_PUBLIC_API_URL fallback only ever yields the value baked in at
    // build time — verified: starting this build with NEXT_PUBLIC_API_URL set to
    // a fresh value still produced the compiled-in one, because Next inlines
    // NEXT_PUBLIC_* in server code as well as client code. It is kept so images
    // built with --build-arg keep working; it cannot carry a runtime value.
    // Backwards compatibility for a swarm still setting the old name is handled
    // in sphinx-swarm, which forwards it as GRAPH_MINDSET_API_URL.
    apiUrl:
      process.env.GRAPH_MINDSET_API_URL?.trim() ||
      process.env.NEXT_PUBLIC_API_URL?.trim() ||
      "",
  }
}

/** The value injected into the document, or undefined when running server-side. */
export function injectedApiUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined
  }

  return window[RUNTIME_CONFIG_GLOBAL]?.apiUrl || undefined
}

/** Serialised for embedding in a <script> tag. */
export function serializeRuntimeConfig(config: RuntimeConfig): string {
  // JSON.stringify escapes quotes; guard the one sequence that could close the
  // surrounding <script> element early.
  return JSON.stringify(config).replace(/</g, "\\u003c")
}
