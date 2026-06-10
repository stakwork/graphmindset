"use client"

import { useCallback, useRef } from "react"
import { X, Bot, Send, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { MessageList } from "./message-list"
import { useAgentChat } from "./use-agent-chat"

const EXAMPLE_QUESTIONS = [
  "What are the most discussed topics?",
  "Who talks about Bitcoin?",
  "Summarise recent clips about AI",
]

interface AgentPanelProps {
  onClose: () => void
}

export function AgentPanel({ onClose }: AgentPanelProps) {
  const { messages, input, setInput, streaming, handleSubmit, handleKeyDown } =
    useAgentChat()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleExampleClick = useCallback(
    (question: string) => {
      setInput(question)
      textareaRef.current?.focus()
      handleSubmit(question)
    },
    [handleSubmit, setInput]
  )

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-full bg-background/60 noise-bg">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-none">Graph Agent</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">AI-powered knowledge explorer</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close agent panel"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isEmpty ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">Ask anything about the graph</p>
              <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                The agent searches nodes, expands connections, and synthesises a grounded answer.
              </p>
            </div>

            <div className="flex flex-col gap-2 w-full max-w-xs">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleExampleClick(q)}
                  className={cn(
                    "text-left text-xs px-3 py-2.5 rounded-lg border border-border/60",
                    "bg-muted/30 hover:bg-muted/60 text-foreground/80 hover:text-foreground",
                    "transition-colors leading-relaxed"
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      {/* Input footer */}
      <div className="shrink-0 border-t border-border/60 px-3 py-3">
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2",
            "focus-within:border-primary/50 transition-colors"
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Ask the graph a question…"
            rows={1}
            className={cn(
              "flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60",
              "min-h-[20px] max-h-[120px] overflow-y-auto leading-5",
              streaming && "opacity-50"
            )}
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = "auto"
              el.style.height = `${el.scrollHeight}px`
            }}
          />
          <button
            type="button"
            disabled={!input.trim() || streaming}
            onClick={() => handleSubmit(input)}
            aria-label="Send message"
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
              input.trim() && !streaming
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {streaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
