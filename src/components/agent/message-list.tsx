"use client"

import { useRef, useEffect } from "react"
import { Bot, User } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { NodeRow } from "@/components/layout/node-row"
import { ToolCallRow } from "./tool-call-row"
import { unlockNode } from "@/lib/unlock-node"
import { useSchemaStore } from "@/stores/schema-store"
import { cn } from "@/lib/utils"
import type { AgentMessage } from "@/lib/agent-api"
import type { GraphNode } from "@/lib/graph-api"

// Basic markdown renderer — bold, italic, inline code, line breaks, headings
function MarkdownText({ text }: { text: string }) {
  // Split on newlines and render paragraph by paragraph
  const paragraphs = text.split(/\n\n+/)
  return (
    <div className="space-y-2">
      {paragraphs.map((para, i) => {
        const lines = para.split("\n")
        return (
          <p key={i} className="text-sm leading-relaxed text-foreground/90">
            {lines.map((line, j) => (
              <span key={j}>
                {renderInline(line)}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function renderInline(text: string): React.ReactNode[] {
  // Handle **bold**, *italic*, `code` inline patterns
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2]) parts.push(<strong key={m.index} className="font-semibold">{m[2]}</strong>)
    else if (m[3]) parts.push(<em key={m.index} className="italic">{m[3]}</em>)
    else if (m[4]) parts.push(<code key={m.index} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

interface CitedNodesProps {
  refIds: string[]
}

function CitedNodes({ refIds }: CitedNodesProps) {
  const schemas = useSchemaStore((s) => s.schemas)

  if (refIds.length === 0) return null

  // Create minimal GraphNode stubs for display — real data fetched on click via unlockNode
  const stubNodes: GraphNode[] = refIds.map((ref_id) => ({
    ref_id,
    node_type: "Unknown",
    properties: { ref_id },
  }))

  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
        Sources
      </p>
      <div className="flex flex-col gap-0.5">
        {stubNodes.map((node) => (
          <NodeRow
            key={node.ref_id}
            node={node}
            schemas={schemas}
            onClick={() => unlockNode(node.ref_id).catch(() => {})}
            hideBoost
          />
        ))}
      </div>
    </div>
  )
}

interface MessageListProps {
  messages: AgentMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col gap-4 px-4 py-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
            {/* Avatar */}
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5",
                msg.role === "user"
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {msg.role === "user" ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}
            </div>

            {/* Bubble */}
            <div className={cn("flex flex-col max-w-[85%]", msg.role === "user" ? "items-end" : "items-start")}>
              {msg.role === "user" ? (
                <div className="bg-primary/15 border border-primary/20 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-foreground/90">
                  {msg.content}
                </div>
              ) : (
                <div className="w-full">
                  {/* Tool-call rows — shown inline during streaming */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-2">
                      {msg.toolCalls.map((tc) => (
                        <ToolCallRow key={tc.id} event={tc} />
                      ))}
                    </div>
                  )}

                  {/* Agent answer */}
                  {msg.content && (
                    <div
                      className={cn(
                        "bg-muted/40 border border-border/40 rounded-2xl rounded-tl-sm px-3 py-2.5",
                        msg.isStreaming && "animate-pulse-subtle"
                      )}
                    >
                      <MarkdownText text={msg.content} />
                      {msg.isStreaming && (
                        <span className="inline-block h-3.5 w-0.5 bg-primary ml-0.5 animate-blink" />
                      )}
                    </div>
                  )}

                  {/* Cited nodes */}
                  {!msg.isStreaming && msg.citedRefIds && msg.citedRefIds.length > 0 && (
                    <div className="mt-2 w-full">
                      <CitedNodes refIds={msg.citedRefIds} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
