"use client"

import { useEffect, useRef, useState } from "react"
import { MessageCircle, Send, Loader2, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { MessageList } from "./message-list"
import { useAgentChat } from "./use-agent-chat"
import type { AgentChatContext } from "./use-agent-chat"

export type { AgentChatContext }

interface TranscriptChatWidgetProps {
  context: AgentChatContext
}

export function TranscriptChatWidget({ context }: TranscriptChatWidgetProps) {
  const [expanded, setExpanded] = useState(false)
  const { messages, input, setInput, streaming, handleSubmit, handleKeyDown, resetSession } =
    useAgentChat(context)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset conversation whenever the user navigates to a different node
  useEffect(() => {
    resetSession()
    setExpanded(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.selectedRefId])

  const handleExpand = () => {
    setExpanded(true)
    // Focus textarea after expansion animation
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  if (!expanded) {
    return (
      <div className="border-t border-border/30 bg-muted/20 px-3 py-2.5">
        <button
          type="button"
          onClick={handleExpand}
          className={cn(
            "flex items-center gap-2 w-full text-left rounded-lg px-3 py-2",
            "border border-border/40 bg-background/40 hover:bg-muted/40",
            "text-xs text-muted-foreground hover:text-foreground transition-colors"
          )}
        >
          <MessageCircle className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          <span className="flex-1 font-mono text-[11px] tracking-wide">Ask about this content</span>
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-border/30 bg-muted/20">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <MessageCircle className="h-3 w-3 text-primary/70" />
          Ask about this content
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse chat"
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Input at top */}
      <div className="px-3 py-2.5 border-b border-border/20">
        <div
          className={cn(
            "flex items-end gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5",
            "focus-within:border-primary/40 transition-colors"
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Ask a question about this transcript…"
            rows={1}
            className={cn(
              "flex-1 resize-none bg-transparent text-xs outline-none placeholder:text-muted-foreground/50",
              "min-h-[18px] max-h-[80px] overflow-y-auto leading-[18px]",
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
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
              input.trim() && !streaming
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {streaming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* Message list — only shown once there are messages */}
      {messages.length > 0 && (
        <div className="max-h-[320px] overflow-hidden flex flex-col">
          <MessageList messages={messages} />
        </div>
      )}
    </div>
  )
}
