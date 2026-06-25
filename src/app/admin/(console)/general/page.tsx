"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAX_LENGTHS } from "@/lib/input-limits"
import { useAppStore } from "@/stores/app-store"
import { api } from "@/lib/api"

export default function GeneralSettingsPage() {
  const { graphName, graphDescription, setGraphMeta } = useAppStore()

  const [name, setName] = useState(graphName)
  const [description, setDescription] = useState(graphDescription)
  const [saving, setSaving] = useState(false)

  // Sync local form state when global meta changes (e.g. after load)
  useEffect(() => {
    setName(graphName)
    setDescription(graphDescription)
  }, [graphName, graphDescription])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await api.post("/about", { title: name, description })
      setGraphMeta(name, description)
    } catch (err) {
      console.error("Failed to save settings:", err)
    } finally {
      setSaving(false)
    }
  }, [name, description, setGraphMeta])

  const handleCancel = useCallback(() => {
    setName(graphName)
    setDescription(graphDescription)
  }, [graphName, graphDescription])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-heading font-semibold">General</h2>

      <div className="space-y-2">
        <Label htmlFor="graph-name" className="text-xs uppercase tracking-wider font-heading">
          Graph Name
        </Label>
        <Input
          id="graph-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_LENGTHS.GRAPH_NAME}
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
          rows={3}
          maxLength={MAX_LENGTHS.GRAPH_DESCRIPTION}
          className="w-full rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50 resize-none"
        />
      </div>

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
    </div>
  )
}
