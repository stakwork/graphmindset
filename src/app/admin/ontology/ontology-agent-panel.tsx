"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Sparkles, X, ArrowUp, Loader2 } from "lucide-react"
import {
  triggerOntologyAgent,
  getStakworkRun,
  listReviews,
  type OntologyAgentMessage,
  type Review,
  type StakworkRun,
} from "@/lib/graph-api"
import { ReviewRow } from "@/components/admin/review-row"
import { useSchemaStore } from "@/stores/schema-store"
import type { SchemaNode } from "@/lib/schema-types"

type TurnStatus = "running" | "completed" | "failed"

interface AgentTurn {
  id: string
  runRef?: string
  status: TurnStatus
  reviews: Review[]
  response?: string
  error?: string
}

interface UserTurn {
  id: string
  text: string
}

type Turn = ({ role: "user" } & UserTurn) | ({ role: "agent" } & AgentTurn)

const POLL_INTERVAL_MS = 5000

// Normalize any backend status casing to the three states the panel tracks.
function mapRunStatus(status: StakworkRun["status"]): TurnStatus {
  const s = String(status).toUpperCase()
  if (s === "COMPLETED") return "completed"
  if (s === "FAILED" || s === "ERROR" || s === "HALTED") return "failed"
  return "running"
}

export function OntologyAgentPanel({ onClose }: { onClose: () => void }) {
  const schemas = useSchemaStore((s) => s.schemas)
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  // One stable session_id per mounted chat thread. This relies on
  // OntologyAgentPanel being unmounted/remounted by its parent (OntologyPage
  // renders `{showAgent ? <OntologyAgentPanel /> : …}`), which naturally resets
  // this state on close. If a future "New Chat" action clears `turns` without
  // unmounting, it must also explicitly reset (or re-key) this state — otherwise
  // the session_id will silently persist across what the user sees as a new
  // conversation.
  const [sessionId] = useState(() => crypto.randomUUID())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Clear any in-flight poll on unmount.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Keep the transcript scrolled to the latest turn.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [turns])

  const patchAgentTurn = useCallback((id: string, patch: Partial<AgentTurn>) => {
    setTurns((prev) =>
      prev.map((t) => (t.role === "agent" && t.id === id ? { ...t, ...patch } : t))
    )
  }, [])

  // Re-fetch this run's pending proposals (called after an approve/dismiss) and
  // refresh the schema store so the graph + type list reflect any applied change.
  const refreshTurn = useCallback(
    async (turnId: string, runRef: string) => {
      try {
        const res = await listReviews({ run_ref_id: runRef, status: "pending" })
        patchAgentTurn(turnId, { reviews: res.reviews })
      } catch {
        /* keep existing cards on transient failure */
      }
      useSchemaStore.getState().fetchAll()
    },
    [patchAgentTurn]
  )

  const startPoll = useCallback(
    (turnId: string, runRef: string) => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const run = await getStakworkRun(runRef)
          const status = run ? mapRunStatus(run.status) : "running"
          if (status === "running") return
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setBusy(false)
          if (status === "failed") {
            patchAgentTurn(turnId, { status: "failed", error: run?.error_message ?? "The agent run failed." })
            return
          }
          const res = await listReviews({ run_ref_id: runRef, status: "pending" })
          patchAgentTurn(turnId, {
            status: "completed",
            reviews: res.reviews,
            response: run?.response,
          })
        } catch {
          /* swallow — keep polling until a terminal state or unmount */
        }
      }, POLL_INTERVAL_MS)
    },
    [patchAgentTurn]
  )

  const handleSubmit = useCallback(async (raw: string) => {
    const instruction = raw.trim()
    if (!instruction || busy) return
    setBusy(true)

    const history: OntologyAgentMessage[] = turns.map((t) =>
      t.role === "user"
        ? { role: "user", content: t.text }
        : { role: "agent", content: agentSummary(t) }
    )

    const userId = `u-${Date.now()}`
    const agentId = `a-${Date.now()}`
    setTurns((prev) => [
      ...prev,
      { role: "user", id: userId, text: instruction },
      { role: "agent", id: agentId, status: "running", reviews: [] },
    ])

    try {
      const { stakwork_run_ref_id } = await triggerOntologyAgent({ instruction, history, sessionId })
      patchAgentTurn(agentId, { runRef: stakwork_run_ref_id })
      startPoll(agentId, stakwork_run_ref_id)
    } catch {
      setBusy(false)
      patchAgentTurn(agentId, { status: "failed", error: "Could not start the ontology agent." })
    }
  }, [busy, turns, patchAgentTurn, startPoll])

  return (
    <div className="w-[440px] shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">Edit ontology with AI</p>
            <p className="text-[11px] text-muted-foreground">Describe a change; approve the proposals.</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground max-w-[240px]">
              e.g. &ldquo;Add a Podcast type that extends Media with an episode_count number, and a
              HOSTED_BY relationship to Person.&rdquo;
            </p>
          </div>
        )}

        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-sm text-foreground">
                {t.text}
              </div>
            </div>
          ) : (
            <AgentTurnView
              key={t.id}
              turn={t}
              schemas={schemas}
              onRefresh={() => t.runRef && refreshTurn(t.id, t.runRef)}
            />
          )
        )}
      </div>

      {/* Composer — owns its own text state so keystrokes don't re-render the transcript */}
      <Composer busy={busy} onSubmit={handleSubmit} />
    </div>
  )
}

// Isolating the input's state here is the fix for typing lag: the transcript
// (which renders heavy ReviewRow cards) no longer re-renders on every keystroke.
const Composer = memo(function Composer({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState("")

  const submit = () => {
    const value = text.trim()
    if (!value || busy) return
    setText("")
    onSubmit(value)
  }

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Describe an ontology change…"
          rows={2}
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          title="Send"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-muted-foreground/70">
        Proposed changes appear as reviews here — approve to apply them to the schema.
      </p>
    </div>
  )
})

function agentSummary(t: AgentTurn): string {
  if (t.status === "running") return "Working on the proposal…"
  if (t.status === "failed") return t.error ?? "The run failed."
  const n = t.reviews.length
  const suffix = n === 0 ? "" : ` (proposed ${n} change${n === 1 ? "" : "s"})`
  if (t.response) return `${t.response}${suffix}`
  return n === 0 ? "No changes proposed." : `Proposed ${n} change${n === 1 ? "" : "s"}.`
}

function AgentTurnView({
  turn,
  schemas,
  onRefresh,
}: {
  turn: AgentTurn
  schemas: SchemaNode[]
  onRefresh: () => void
}) {
  const completed = turn.status === "completed"
  // Show a fallback line only when the agent returned neither text nor cards.
  const showEmptyNote = completed && !turn.response && turn.reviews.length === 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary/70" />
        {turn.status === "running" ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Reasoning over the schema…
          </span>
        ) : turn.status === "failed" ? (
          <span className="text-red-400">{turn.error ?? "The run failed."}</span>
        ) : (
          <span>Ontology agent</span>
        )}
      </div>

      {completed && turn.response && (
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted/50 px-3 py-2 text-sm text-foreground">
          {turn.response}
        </div>
      )}

      {showEmptyNote && (
        <p className="text-xs text-muted-foreground">No changes proposed.</p>
      )}

      {completed && turn.reviews.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/60">
          {turn.reviews.map((review) => (
            <ReviewRow
              key={review.ref_id}
              review={review}
              schemas={schemas}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}
