"use client"

import { API_URL } from "./api"
import { getSignedMessage, getL402, payL402 } from "./sphinx"
import { useModalStore } from "@/stores/modal-store"
import { isMocksEnabled } from "./mock-data"

export interface ToolCallEvent {
  id: string
  tool: "graph_search" | "graph_node" | "graph_map" | string
  params: Record<string, unknown>
  status: "in-flight" | "done" | "error"
  resultCount?: number
}

export interface AgentMessage {
  role: "user" | "agent"
  content: string
  toolCalls?: ToolCallEvent[]
  citedRefIds?: string[]
  isStreaming?: boolean
}

export interface StreamAgentOpts {
  sessionId?: string
  signal?: AbortSignal
  onChunk: (text: string) => void
  onToolCall: (event: ToolCallEvent) => void
  onDone: (result: { answer: string; cited_ref_ids: string[] }) => void
  onError: (err: Error) => void
}

// Builds a signed URL for a given API path
async function buildSignedUrl(path: string): Promise<string> {
  const url = new URL(`${API_URL}${path}`)
  const signed = await getSignedMessage()
  if (signed.signature) {
    url.searchParams.append("sig", signed.signature)
    url.searchParams.append("msg", signed.message)
  }
  return url.toString()
}

// Mock SSE stream for development
async function mockStreamAgent(
  prompt: string,
  opts: StreamAgentOpts
): Promise<void> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  await delay(300)
  opts.onToolCall({
    id: "mock-1",
    tool: "graph_search",
    params: { q: prompt, limit: 10 },
    status: "in-flight",
  })

  await delay(800)
  opts.onToolCall({
    id: "mock-1",
    tool: "graph_search",
    params: { q: prompt, limit: 10 },
    status: "done",
    resultCount: 5,
  })

  await delay(200)
  opts.onToolCall({
    id: "mock-2",
    tool: "graph_node",
    params: { ref_id: "mock-node-1" },
    status: "in-flight",
  })

  await delay(500)
  opts.onToolCall({
    id: "mock-2",
    tool: "graph_node",
    params: { ref_id: "mock-node-1" },
    status: "done",
    resultCount: 1,
  })

  const answer =
    `Based on my search of the knowledge graph for **"${prompt}"**, I found several relevant nodes.\n\n` +
    `The graph contains discussions spanning multiple topics including Bitcoin, AI, and open-source software. ` +
    `The most prominent nodes relate to recent episodes and community discussions.\n\n` +
    `*(This is a mock response — connect to a real backend to get live answers.)*`

  for (const word of answer.split(" ")) {
    await delay(40)
    opts.onChunk(word + " ")
  }

  await delay(200)
  opts.onDone({ answer, cited_ref_ids: ["mock-node-1", "mock-node-2"] })
}

export async function streamAgent(
  prompt: string,
  opts: StreamAgentOpts
): Promise<void> {
  if (isMocksEnabled()) {
    return mockStreamAgent(prompt, opts)
  }

  const doRequest = async (isRetry = false): Promise<void> => {
    const url = await buildSignedUrl("/v2/agent")
    const l402 = await getL402()

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    }
    if (l402) headers["Authorization"] = l402

    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt,
          sessionId: opts.sessionId,
        }),
        signal: opts.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      opts.onError(err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (response.status === 402 && !isRetry) {
      // Try to pay L402 and retry once
      try {
        await payL402(() => {})
        return doRequest(true)
      } catch {
        useModalStore.getState().open("budget")
        opts.onError(new Error("Payment required"))
        return
      }
    }

    if (!response.ok) {
      opts.onError(new Error(`Agent request failed: ${response.status}`))
      return
    }

    let data: { answer?: string; cited_ref_ids?: string[] }
    try {
      data = await response.json()
    } catch {
      opts.onError(new Error("Invalid JSON from agent"))
      return
    }

    opts.onDone({
      answer: data.answer ?? "",
      cited_ref_ids: data.cited_ref_ids ?? [],
    })
  }

  return doRequest()
}
