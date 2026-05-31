"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MAX_LENGTHS } from "@/lib/input-limits"
import { useModalStore } from "@/stores/modal-store"
import { useAppStore } from "@/stores/app-store"
import { useUserStore } from "@/stores/user-store"
import { api } from "@/lib/api"

// Admin-only, and pulls cronstrue + date-fns — defer so non-admins don't pay the bundle.
const RadarSettings = dynamic(
  () => import("./radar-settings").then((m) => m.RadarSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

const JanitorSettings = dynamic(
  () => import("./janitor-settings").then((m) => m.JanitorSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

const DomainSettings = dynamic(
  () => import("./domain-settings").then((m) => m.DomainSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

export function SettingsModal() {
  const { activeModal, close } = useModalStore()
  const { graphName, graphDescription, setGraphMeta } = useAppStore()
  const isAdmin = useUserStore((s) => s.isAdmin)
  const [name, setName] = useState(graphName)
  const [description, setDescription] = useState(graphDescription)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (activeModal === "settings") {
      setName(graphName)
      setDescription(graphDescription)
    }
  }, [activeModal, graphName, graphDescription])

  const handleSave = useCallback(async () => {
    if (!isAdmin) return
    setSaving(true)
    try {
      await api.post("/about", { title: name, description })
      setGraphMeta(name, description)
      close()
    } catch (err) {
      console.error("Failed to save settings:", err)
    } finally {
      setSaving(false)
    }
  }, [name, description, isAdmin, setGraphMeta, close])

  return (
    <Dialog open={activeModal === "settings"} onOpenChange={() => close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            Graph Settings
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Configure your knowledge graph."
              : "View graph configuration."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="pt-2">
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
                <Button variant="ghost" onClick={close} className="text-xs">
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
              <RadarSettings open={activeModal === "settings"} />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="janitor" className="pt-4">
              <JanitorSettings open={activeModal === "settings"} />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="domains" className="pt-4">
              <DomainSettings
                open={activeModal === "settings"}
                title={name}
                description={description}
              />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
