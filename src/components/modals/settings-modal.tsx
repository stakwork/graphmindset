"use client"

import { useCallback, useEffect, useState } from "react"
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
import { useModalStore } from "@/stores/modal-store"
import { useAppStore } from "@/stores/app-store"
import { useUserStore } from "@/stores/user-store"
import { api } from "@/lib/api"

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
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
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

        <div className="relative z-10 space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="graph-name" className="text-xs uppercase tracking-wider font-heading">
              Graph Name
            </Label>
            <Input
              id="graph-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              className="bg-muted/50 border-border/50 focus:border-primary/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="graph-desc" className="text-xs uppercase tracking-wider font-heading">
              Description
            </Label>
            <textarea
              id="graph-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isAdmin}
              rows={3}
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
