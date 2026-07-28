"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { getLatestStakworkRun } from "@/lib/graph-api"

// ── Types ─────────────────────────────────────────────────────────────────────

export type StakworkRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "ERROR"
  | "HALTED"
  | null

export interface UseStakworkRunStatusOptions {
  /**
   * Called when the run reaches COMPLETED so the caller can react
   * (e.g. bump a nonce to re-fetch node data).
   */
  onCompleted?: () => void
  /**
   * Called on each successful poll with the raw StakworkRun object,
   * useful for capturing metadata like `project_id` from the run.
   */
  onPoll?: (run: import("@/lib/graph-api").StakworkRun) => void
  /**
   * Called when the trigger request itself fails, with the server's message.
   * Without this the reason is swallowed and the user only sees a red retry
   * button — the backend returns real causes (INVALID_PAYLOAD when a node in
   * the merge no longer exists, DISPATCH_FAILED when Stakwork rejects it).
   */
  onTriggerError?: (message: string) => void
  /** Poll interval in milliseconds (default 5 000). */
  pollIntervalMs?: number
}

/** Pull a human-readable message out of a thrown fetch Response. */
async function errorMessage(err: unknown, fallback: string): Promise<string> {
  if (!(err instanceof Response)) return fallback
  const body = (await err.json().catch(() => ({}))) as {
    error?: string
    errorCode?: string
  }
  return body.error || body.errorCode || fallback
}

export interface UseStakworkRunStatusResult {
  /** Current mapped run status, or null if no run exists / not yet hydrated. */
  status: StakworkRunStatus
  /** True during the initial mount-time hydration fetch. */
  loading: boolean
  /** True while the run is PENDING or RUNNING (in-flight). */
  isInFlight: boolean
  /**
   * Call this to trigger the workflow. Pass a function that calls the API and
   * returns a run ref id (e.g. `() => triggerMergeWorkflow(refId)`).
   * The hook sets status to PENDING and starts polling automatically.
   */
  trigger: (triggerFn: () => Promise<{ stakwork_run_ref_id: string }>) => Promise<void>
  /** Whether a trigger call is currently in flight (loading spinner). */
  triggering: boolean
}

// ── Status normalizer ────────────────────────────────────────────────────────

export function mapRunStatus(raw: string): StakworkRunStatus {
  const s = raw.toUpperCase()
  if (s === "PENDING" || s === "IN_PROGRESS" || s === "RUNNING") return "RUNNING"
  if (s === "COMPLETED") return "COMPLETED"
  if (s === "FAILED" || s === "ERROR" || s === "HALTED") return "FAILED"
  return null
}

export function isInFlightStatus(status: StakworkRunStatus): boolean {
  return status === "PENDING" || status === "RUNNING"
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Shared hook for Stakwork run lifecycle: mount-time hydration + 5-second
 * polling while pending/running, terminal-state cleanup, and a trigger helper.
 *
 * Used by NodePreviewPanel (deep research / enrich) and ReviewRow
 * (human-review dispatch).
 */
export function useStakworkRunStatus(
  refId: string,
  jobType: string,
  options: UseStakworkRunStatusOptions = {}
): UseStakworkRunStatusResult {
  const { onCompleted, onPoll, onTriggerError, pollIntervalMs = 5000 } = options

  const [status, setStatus] = useState<StakworkRunStatus>(null)
  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompletedRef = useRef(onCompleted)
  onCompletedRef.current = onCompleted
  const onPollRef = useRef(onPoll)
  onPollRef.current = onPoll
  const onTriggerErrorRef = useRef(onTriggerError)
  onTriggerErrorRef.current = onTriggerError

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function startPoll(id: string) {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const run = await getLatestStakworkRun(id, jobType)
        if (!run) return
        const mapped = mapRunStatus(run.status)
        setStatus(mapped)
        onPollRef.current?.(run)
        if (!isInFlightStatus(mapped)) {
          stopPoll()
          if (mapped === "COMPLETED") {
            onCompletedRef.current?.()
          }
        }
      } catch {
        // silent — keep polling
      }
    }, pollIntervalMs)
  }

  // Mount-time hydration (and re-run when refId changes)
  useEffect(() => {
    setStatus(null)
    let cancelled = false
    setLoading(true)

    getLatestStakworkRun(refId, jobType)
      .then((run) => {
        if (cancelled) return
        if (!run) return
        const mapped = mapRunStatus(run.status)
        setStatus(mapped)
        if (isInFlightStatus(mapped)) {
          startPoll(refId)
        }
      })
      .catch(() => {
        // Hydration fetch error — leave status as null (neutral, retry-safe)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      stopPoll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId, jobType])

  const trigger = useCallback(
    async (triggerFn: () => Promise<{ stakwork_run_ref_id: string }>) => {
      if (isInFlightStatus(status)) return
      setTriggering(true)
      setStatus("PENDING")
      try {
        await triggerFn()
        startPoll(refId)
      } catch (err) {
        setStatus("FAILED")
        if (onTriggerErrorRef.current) {
          onTriggerErrorRef.current(await errorMessage(err, "Request failed"))
        }
      } finally {
        setTriggering(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refId, jobType, status]
  )

  return {
    status,
    loading,
    isInFlight: isInFlightStatus(status),
    trigger,
    triggering,
  }
}
