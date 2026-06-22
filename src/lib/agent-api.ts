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

export interface AgentContext {
  selectedRefId: string
  nodeType: string
  title?: string
}

export interface StreamAgentOpts {
  sessionId?: string
  signal?: AbortSignal
  context?: AgentContext
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
  opts: StreamAgentOpts,
  // context accepted but unused in mock mode
  _context?: AgentContext
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

async function processSSEStream(response: Response, opts: StreamAgentOpts): Promise<void> {
  if (!response.body) {
    opts.onError(new Error("No response body for SSE stream"))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let accumulatedText = ""
  const inFlight = new Map<string, ToolCallEvent>()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split("\n\n")
      // Keep the last (possibly incomplete) chunk in the buffer
      buffer = events.pop() ?? ""

      for (const event of events) {
        const line = event.trim()
        if (!line.startsWith("data:")) continue

        const jsonStr = line.slice("data:".length).trim()
        let chunk: Record<string, unknown>
        try {
          chunk = JSON.parse(jsonStr)
        } catch {
          continue
        }

        switch (chunk.type) {
          case "text-delta": {
            const delta = (chunk.textDelta ?? chunk.delta ?? "") as string
            accumulatedText += delta
            opts.onChunk(delta)
            break
          }
          case "tool-input-available": {
            const id = (chunk.toolCallId ?? `${chunk.toolName}-${Date.now()}`) as string
            const event: ToolCallEvent = {
              id,
              tool: chunk.toolName as string,
              params: (chunk.input ?? {}) as Record<string, unknown>,
              status: "in-flight",
            }
            inFlight.set(id, event)
            opts.onToolCall(event)
            break
          }
          case "finish-step": {
            for (const stored of inFlight.values()) {
              opts.onToolCall({ ...stored, status: "done" })
            }
            inFlight.clear()
            break
          }
          case "finish-message": {
            opts.onDone({ answer: accumulatedText, cited_ref_ids: [] })
            return
          }
        }
      }
    }
    // Fallback if stream ends without finish-message
    opts.onDone({ answer: accumulatedText, cited_ref_ids: [] })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return
    opts.onError(err instanceof Error ? err : new Error(String(err)))
  } finally {
    reader.releaseLock()
  }
}

export async function streamAgent(
  prompt: string,
  opts: StreamAgentOpts
): Promise<void> {
  if (isMocksEnabled()) {
    return mockStreamAgent(prompt, opts, opts.context)
  }

  const doRequest = async (isRetry = false): Promise<void> => {
    const url = await buildSignedUrl("/v2/agent")
    const l402 = await getL402()

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    }
    if (l402) headers["Authorization"] = l402

    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt,
          stream: true,
          sessionId: opts.sessionId,
          ...(opts.context ? { context: opts.context } : {}),
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

    await processSSEStream(response, opts)
  }

  return doRequest()
}
