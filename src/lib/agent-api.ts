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

// Parse a single SSE line and return { event, data } or null
function parseSseLine(line: string): { event: string; data: string } | null {
  if (!line || line.startsWith(":")) return null
  if (line.startsWith("data: ")) {
    return { event: "message", data: line.slice(6) }
  }
  return null
}

// Process a stream of SSE data using ReadableStream
async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts: StreamAgentOpts,
  retryFn: () => Promise<void>
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  let finalAnswer = ""
  let citedRefIds: string[] = []
  const activeToolCalls = new Map<string, ToolCallEvent>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const parsed = parseSseLine(line.trim())
      if (!parsed) continue

      const raw = parsed.data
      if (raw === "[DONE]") continue

      try {
        const chunk = JSON.parse(raw)

        // AI SDK UI stream format
        if (typeof chunk === "object" && chunk !== null) {
          // Text delta
          if (chunk.type === "text-delta" || chunk.type === "0") {
            const delta = chunk.textDelta ?? chunk.value ?? ""
            if (delta) {
              finalAnswer += delta
              opts.onChunk(delta)
            }
          }
          // Tool call start
          else if (chunk.type === "tool-call" || chunk.type === "9") {
            const toolName = chunk.toolName ?? chunk.tool ?? ""
            const toolCallId = chunk.toolCallId ?? chunk.id ?? String(Date.now())
            const toolCall: ToolCallEvent = {
              id: toolCallId,
              tool: toolName,
              params: chunk.args ?? chunk.params ?? {},
              status: "in-flight",
            }
            activeToolCalls.set(toolCallId, toolCall)
            opts.onToolCall({ ...toolCall })
          }
          // Tool result
          else if (chunk.type === "tool-result" || chunk.type === "a") {
            const toolCallId = chunk.toolCallId ?? chunk.id ?? ""
            const existing = activeToolCalls.get(toolCallId)
            if (existing) {
              const resultCount =
                chunk.result?.nodes?.length ?? chunk.result?.count ?? undefined
              const updated: ToolCallEvent = {
                ...existing,
                status: "done",
                resultCount,
              }
              activeToolCalls.set(toolCallId, updated)
              opts.onToolCall({ ...updated })
            }
          }
          // Done / finish
          else if (chunk.type === "done" || chunk.type === "finish-message") {
            if (chunk.answer) finalAnswer = chunk.answer
            if (Array.isArray(chunk.cited_ref_ids)) citedRefIds = chunk.cited_ref_ids
          }
          // Error
          else if (chunk.type === "error") {
            opts.onError(new Error(chunk.error ?? "Agent error"))
            return
          }
        }
      } catch {
        // Non-JSON lines are plain text deltas (some SSE formats)
        if (raw && raw !== "[DONE]") {
          finalAnswer += raw
          opts.onChunk(raw)
        }
      }
    }
  }

  opts.onDone({ answer: finalAnswer, cited_ref_ids: citedRefIds })
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

    const reader = response.body?.getReader()
    if (!reader) {
      opts.onError(new Error("No response body"))
      return
    }

    await processSSEStream(reader, opts, () => doRequest(true))
  }

  return doRequest()
}
