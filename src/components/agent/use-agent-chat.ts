"use client"

import { useCallback, useRef, useState } from "react"
import { streamAgent } from "@/lib/agent-api"
import type { AgentMessage, ToolCallEvent } from "@/lib/agent-api"

export interface AgentChatContext {
  selectedRefId: string
  nodeType: string
  title?: string
}

export function useAgentChat(context?: AgentChatContext) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const abortRef = useRef<AbortController | null>(null)

  const addUserMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "user", content }])
  }, [])

  const startAgentMessage = useCallback((): number => {
    setMessages((prev) => [
      ...prev,
      { role: "agent", content: "", toolCalls: [], isStreaming: true },
    ])
    return Date.now()
  }, [])

  const appendChunk = useCallback((text: string) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last?.role === "agent") {
        next[next.length - 1] = { ...last, content: last.content + text }
      }
      return next
    })
  }, [])

  const upsertToolCall = useCallback((event: ToolCallEvent) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== "agent") return prev

      const existing = last.toolCalls ?? []
      const idx = existing.findIndex((tc) => tc.id === event.id)
      const updated =
        idx >= 0
          ? existing.map((tc, i) => (i === idx ? event : tc))
          : [...existing, event]

      next[next.length - 1] = { ...last, toolCalls: updated }
      return next
    })
  }, [])

  const finaliseAgentMessage = useCallback(
    (
      result: { answer: string; cited_ref_ids: string[] },
      newSessionId?: string
    ) => {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === "agent") {
          next[next.length - 1] = {
            ...last,
            content: result.answer || last.content,
            citedRefIds: result.cited_ref_ids,
            isStreaming: false,
          }
        }
        return next
      })
      if (newSessionId) setSessionId(newSessionId)
    },
    []
  )

  const handleError = useCallback((err: Error) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last?.role === "agent") {
        next[next.length - 1] = {
          ...last,
          content: last.content || "An error occurred. Please try again.",
          isStreaming: false,
        }
      }
      return next
    })
    console.error("[agent-chat] error:", err)
  }, [])

  const resetSession = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setInput("")
    setStreaming(false)
    setSessionId(undefined)
  }, [])

  const handleSubmit = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim()
      if (!trimmed || streaming) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setInput("")
      setStreaming(true)
      addUserMessage(trimmed)
      startAgentMessage()

      try {
        await streamAgent(trimmed, {
          sessionId,
          signal: controller.signal,
          context,
          onChunk: appendChunk,
          onToolCall: upsertToolCall,
          onDone: (result) => {
            finaliseAgentMessage(result)
            setStreaming(false)
          },
          onError: (err) => {
            handleError(err)
            setStreaming(false)
          },
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setStreaming(false)
          return
        }
        handleError(err instanceof Error ? err : new Error(String(err)))
        setStreaming(false)
      }
    },
    [
      streaming,
      sessionId,
      context,
      addUserMessage,
      startAgentMessage,
      appendChunk,
      upsertToolCall,
      finaliseAgentMessage,
      handleError,
    ]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(input)
      }
    },
    [input, handleSubmit]
  )

  return {
    messages,
    input,
    setInput,
    streaming,
    handleSubmit,
    handleKeyDown,
    resetSession,
  }
}
