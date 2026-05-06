"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, CheckCircle2, LinkIcon, Zap, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { MAX_LENGTHS } from "@/lib/input-limits"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { useAppStore } from "@/stores/app-store"
import { usePlayerStore } from "@/stores/player-store"
import { api } from "@/lib/api"
import { getL402, payL402, getPrice } from "@/lib/sphinx"
import {
  detectSourceType,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPES,
  isSubscriptionSource,
  type SourceType,
} from "@/lib/source-detection"
import { checkNodeExists, type GraphNode } from "@/lib/graph-api"

const CONTENT_TYPE_BY_SOURCE: Partial<Record<SourceType, string>> = {
  [SOURCE_TYPES.TWEET]: "tweet",
  [SOURCE_TYPES.LINK]: "audio_video",
  [SOURCE_TYPES.YOUTUBE_VIDEO]: "audio_video",
  [SOURCE_TYPES.YOUTUBE_LIVE]: "audio_video",
  [SOURCE_TYPES.YOUTUBE_SHORT]: "audio_video",
  [SOURCE_TYPES.WEB_PAGE]: "webpage",
  [SOURCE_TYPES.DOCUMENT]: "document",
}

const IN_PROGRESS_STATUSES = ["in_progress", "running", "pending"]

type CacheStatus = "miss" | "hit-completed" | "hit-in-progress" | null

export function AddContentModal() {
  const { activeModal, close, open: openModal } = useModalStore()
  const { budget, setBudget, pubKey, routeHint, isAdmin } = useUserStore()
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const [sourceUrl, setSourceUrl] = useState("")
  const [detectedType, setDetectedType] = useState<SourceType | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")
  const [price, setPrice] = useState<number | null>(null)
  const [topics, setTopics] = useState<string[]>([])
  const [topicDraft, setTopicDraft] = useState("")
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>(null)
  const [cachedRefId, setCachedRefId] = useState<string | null>(null)

  // Fetch price based on detected type
  useEffect(() => {
    if (activeModal === "addContent" && detectedType) {
      const endpoint = isSubscriptionSource(detectedType) ? "radar" : "v2/content"
      getPrice(endpoint).then(setPrice)
    }
  }, [activeModal, detectedType])

  const handleDetect = useCallback(async (value: string) => {
    setSourceUrl(value)
    setDetectedType(null)
    setError("")
    setSuccess(false)
    setCacheStatus(null)
    setCachedRefId(null)

    const trimmed = value.trim()
    if (!trimmed || trimmed.length < 5) return

    setDetecting(true)
    try {
      const type = await detectSourceType(trimmed)
      setDetectedType(type)

      // Preflight cache check for YouTube/podcast URLs
      if (
        type === SOURCE_TYPES.YOUTUBE_VIDEO ||
        type === SOURCE_TYPES.YOUTUBE_LIVE ||
        type === SOURCE_TYPES.YOUTUBE_SHORT ||
        type === SOURCE_TYPES.LINK
      ) {
        const check = await checkNodeExists("Episode", trimmed)
        console.log("[add-content] cache check:", {
          nodeType: "Episode",
          key: trimmed,
          cacheStatus: check.exists
            ? IN_PROGRESS_STATUSES.includes(check.status ?? "")
              ? "hit-in-progress"
              : "hit-completed"
            : "miss",
          cachedRefId: check.ref_id,
        })
        if (check.exists && check.ref_id) {
          const isTerminal = !IN_PROGRESS_STATUSES.includes(check.status ?? "")
          setCacheStatus(isTerminal ? "hit-completed" : "hit-in-progress")
          setCachedRefId(check.ref_id)
        } else {
          setCacheStatus("miss")
          setCachedRefId(null)
        }
      }
    } catch {
      setDetectedType(null)
    } finally {
      setDetecting(false)
    }
  }, [])

  const submitWithAuth = useCallback(
    async (source: string, sourceType: SourceType) => {
      const l402 = await getL402()
      const headers: Record<string, string> = {}
      if (l402) headers["Authorization"] = l402

      // Cache-hit unlock path: GET /v2/nodes/:ref_id
      if (cacheStatus === "hit-completed" && cachedRefId) {
        const data = await api.get<{ nodes?: GraphNode[] }>(`/v2/nodes/${cachedRefId}`, headers)
        const episode = data?.nodes?.[0]
        if (episode) {
          usePlayerStore.getState().setPlayingNode(episode)
        }
        return
      }

      const fullPubkey = pubKey && routeHint ? `${pubKey}_${routeHint}` : pubKey
      console.log("[add-content] pubKey:", pubKey, "routeHint:", routeHint, "fullPubkey:", fullPubkey)

      if (isSubscriptionSource(sourceType)) {
        const radarBody: Record<string, unknown> = { source, source_type: sourceType }
        if (fullPubkey) radarBody.pubkey = fullPubkey
        if (sourceType === SOURCE_TYPES.TWITTER_HANDLE && topics.length) {
          radarBody.topics = topics
        }
        await api.post("/radar", radarBody, headers)
        return
      }

      const contentType = CONTENT_TYPE_BY_SOURCE[sourceType]
      if (!contentType) {
        throw new Error(`Unsupported source type: ${sourceType}`)
      }
      const body: Record<string, unknown> = {
        content_type: contentType,
        source_link: source,
      }
      if (fullPubkey) body.pubkey = fullPubkey

      await api.post("/v2/content", body, headers)
    },
    [pubKey, routeHint, topics, cacheStatus, cachedRefId]
  )

  const handleSubmit = useCallback(async () => {
    const trimmed = sourceUrl.trim()
    if (!trimmed || !detectedType) return

    const openMyContent = () => useAppStore.getState().setMyContentOpen(true)

    setSubmitting(true)
    setError("")
    try {
      await submitWithAuth(trimmed, detectedType)
      setSuccess(true)
      refreshBalance()
      setTimeout(() => {
        setSourceUrl("")
        setDetectedType(null)
        setSuccess(false)
        setPrice(null)
        setTopics([])
        setTopicDraft("")
        setCacheStatus(null)
        setCachedRefId(null)
        close()
        openMyContent()
      }, 1200)
    } catch (err: unknown) {
      // Handle 402 — need payment
      if (err instanceof Response && err.status === 402) {
        try {
          await payL402(setBudget)

          // Retry after payment
          await submitWithAuth(trimmed, detectedType)
          setSuccess(true)
          refreshBalance()
          setTimeout(() => {
            setSourceUrl("")
            setDetectedType(null)
            setSuccess(false)
            setPrice(null)
            setCacheStatus(null)
            setCachedRefId(null)
            close()
            openMyContent()
          }, 1200)
        } catch {
          openModal("budget")
        }
      } else if (err instanceof Response) {
        try {
          const body = await err.json()
          setError(body?.message || "Failed to add content. Try again.")
        } catch {
          setError("Failed to add content. Try again.")
        }
      } else {
        setError("Failed to add content. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }, [sourceUrl, detectedType, close, setBudget, submitWithAuth, refreshBalance])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close()
        setSourceUrl("")
        setDetectedType(null)
        setSuccess(false)
        setError("")
        setPrice(null)
        setTopics([])
        setTopicDraft("")
        setCacheStatus(null)
        setCachedRefId(null)
      }
    },
    [close]
  )

  const addTopic = useCallback(() => {
    const t = topicDraft.trim()
    if (!t || topics.includes(t)) {
      setTopicDraft("")
      return
    }
    setTopics((prev) => [...prev, t])
    setTopicDraft("")
  }, [topicDraft, topics])

  const removeTopic = useCallback((t: string) => {
    setTopics((prev) => prev.filter((x) => x !== t))
  }, [])

  const isSubscriptionBlocked = !!detectedType && isSubscriptionSource(detectedType) && !isAdmin
  const isInProgress = cacheStatus === "hit-in-progress"

  const formattedBudget = budget !== null ? budget.toLocaleString() : "--"

  // Derive submit button label
  const submitLabel = (() => {
    if (success) return null // handled separately
    if (submitting) return null // handled separately
    if (cacheStatus === "hit-completed") {
      return price && price > 0 ? "Pay & Unlock" : "Unlock"
    }
    if (cacheStatus === "hit-in-progress") {
      return "Processing…"
    }
    return price && price > 0 ? "Pay & Add" : "Add Source"
  })()

  return (
    <Dialog open={activeModal === "addContent"} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            Add Content
          </DialogTitle>
          <DialogDescription>
            Paste a URL and we&apos;ll detect the source type automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="relative z-10 space-y-4 pt-2">
          {/* URL Input */}
          <div className="relative">
            <LinkIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={sourceUrl}
              onChange={(e) => handleDetect(e.target.value)}
              placeholder="Paste URL, Twitter handle, RSS feed..."
              maxLength={MAX_LENGTHS.SOURCE_URL}
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
            />
            {detecting && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Detected type badge */}
          {detectedType && !detecting && (
            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 animate-fade-in-up">
              <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_4px_oklch(0.72_0.14_200/0.5)]" />
              <span className="text-xs text-primary font-medium">
                Detected: {SOURCE_TYPE_LABELS[detectedType] ?? detectedType}
              </span>
            </div>
          )}

          {/* Cache state badge */}
          {cacheStatus === "hit-completed" && !detecting && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 animate-fade-in-up">
              <Zap className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-xs text-emerald-500 font-medium">
                Cached — instant unlock
              </span>
            </div>
          )}

          {cacheStatus === "hit-in-progress" && !detecting && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 animate-fade-in-up">
              <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />
              <span className="text-xs text-amber-500 font-medium">
                Processing — check back shortly
              </span>
            </div>
          )}

          {detectedType === SOURCE_TYPES.TWITTER_HANDLE && !detecting && (
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
                Topic filter (optional)
              </label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2 py-1.5 min-h-[34px]">
                {topics.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTopic(t)}
                      className="hover:text-destructive"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault()
                      addTopic()
                    } else if (e.key === "Backspace" && !topicDraft && topics.length) {
                      removeTopic(topics[topics.length - 1])
                    }
                  }}
                  onBlur={addTopic}
                  placeholder={topics.length ? "" : "AI, devtools (Enter to add)"}
                  className="flex-1 min-w-[80px] bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Only tweets matching one of these topics will be ingested.
              </p>
            </div>
          )}

          {/* Cost & Budget */}
          {detectedType && price !== null && price > 0 && (
            <>
              <Separator className="bg-border/30" />
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="h-3 w-3 text-amber" />
                  <span>Cost</span>
                </div>
                <span className="font-mono text-foreground">
                  {price} sats
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Budget</span>
                <span className="font-mono text-foreground">
                  {formattedBudget} sats
                </span>
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {isSubscriptionBlocked && (
            <p className="text-xs text-muted-foreground">
              Adding subscription sources requires admin access.
            </p>
          )}

          {/* Anon-loss disclosure */}
          {!pubKey && (
            <p className="text-xs text-muted-foreground mt-2">
              Earnings are credited to this browser&#39;s L402. Clearing storage will lose your sats.
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                submitting ||
                !detectedType ||
                !sourceUrl.trim() ||
                isSubscriptionBlocked ||
                isInProgress
              }
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {success ? (
                <>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  {cacheStatus === "hit-completed" ? "Unlocked" : "Added"}
                </>
              ) : submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {cacheStatus === "hit-completed" ? "Unlocking..." : "Adding..."}
                </>
              ) : (
                <>
                  {(price && price > 0) || cacheStatus === "hit-completed" ? (
                    <Zap className="mr-1.5 h-3.5 w-3.5" />
                  ) : null}
                  {submitLabel}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
