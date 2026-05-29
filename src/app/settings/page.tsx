"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MAX_LENGTHS } from "@/lib/input-limits"
import { useAppStore } from "@/stores/app-store"
import { useUserStore } from "@/stores/user-store"
import { api } from "@/lib/api"

const RadarSettings = dynamic(
  () => import("@/components/modals/radar-settings").then((m) => m.RadarSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

const JanitorSettings = dynamic(
  () => import("@/components/modals/janitor-settings").then((m) => m.JanitorSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

const DomainSettings = dynamic(
  () => import("@/components/modals/domain-settings").then((m) => m.DomainSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

const VALID_TABS = ["general", "radar", "janitor", "domains"] as const
const ADMIN_ONLY_TABS = ["radar", "janitor", "domains"] as const
type TabId = (typeof VALID_TABS)[number]

function resolveTab(raw: string | null, isAdmin: boolean): TabId {
  if (!raw) return "general"
  if (!(VALID_TABS as readonly string[]).includes(raw)) return "general"
  if ((ADMIN_ONLY_TABS as readonly string[]).includes(raw) && !isAdmin) return "general"
  return raw as TabId
}

function SettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  const isAdmin = useUserStore((s) => s.isAdmin)
  const { graphName, graphDescription, setGraphMeta } = useAppStore()

  const [name, setName] = useState(graphName)
  const [description, setDescription] = useState(graphDescription)
  const [saving, setSaving] = useState(false)

  const activeTab = resolveTab(searchParams.get("tab"), isAdmin)

  // Sync local form state when global meta changes (e.g. after load)
  useEffect(() => {
    setName(graphName)
    setDescription(graphDescription)
  }, [graphName, graphDescription])

  // Admin guard
  useEffect(() => {
    if (isAuthenticated && !isAdmin) {
      router.replace("/")
    }
  }, [isAdmin, isAuthenticated, router])

  const handleTabChange = useCallback(
    (tab: string) => {
      router.replace(`/settings?tab=${tab}`)
    },
    [router]
  )

  const handleSave = useCallback(async () => {
    if (!isAdmin) return
    setSaving(true)
    try {
      await api.post("/about", { title: name, description })
      setGraphMeta(name, description)
    } catch (err) {
      console.error("Failed to save settings:", err)
    } finally {
      setSaving(false)
    }
  }, [name, description, isAdmin, setGraphMeta])

  const handleCancel = useCallback(() => {
    setName(graphName)
    setDescription(graphDescription)
  }, [graphName, graphDescription])

  if (isAuthenticated && !isAdmin) return null

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push("/")}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-heading font-semibold tracking-wide uppercase">
          Graph Settings
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full">
              <TabsTrigger value="general">General</TabsTrigger>
              {isAdmin && <TabsTrigger value="radar">Schedule</TabsTrigger>}
              {isAdmin && <TabsTrigger value="janitor">Janitors</TabsTrigger>}
              {isAdmin && <TabsTrigger value="domains">Domains</TabsTrigger>}
            </TabsList>

            <TabsContent value="general" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label
                  htmlFor="graph-name"
                  className="text-xs uppercase tracking-wider font-heading"
                >
                  Graph Name
                </Label>
                <Input
                  id="graph-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isAdmin}
                  maxLength={MAX_LENGTHS.GRAPH_NAME}
                  className="bg-muted/50 border-border/50 focus:border-primary/40"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="graph-desc"
                  className="text-xs uppercase tracking-wider font-heading"
                >
                  Description
                </Label>
                <textarea
                  id="graph-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!isAdmin}
                  rows={3}
                  maxLength={MAX_LENGTHS.GRAPH_DESCRIPTION}
                  className="w-full rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50 resize-none"
                />
              </div>

              {isAdmin && (
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={handleCancel} className="text-xs">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              )}
            </TabsContent>

            {isAdmin && (
              <TabsContent value="radar" className="pt-4">
                <RadarSettings open={activeTab === "radar"} />
              </TabsContent>
            )}

            {isAdmin && (
              <TabsContent value="janitor" className="pt-4">
                <JanitorSettings open={activeTab === "janitor"} />
              </TabsContent>
            )}

            {isAdmin && (
              <TabsContent value="domains" className="pt-4">
                <DomainSettings
                  open={activeTab === "domains"}
                  title={name}
                  description={description}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
