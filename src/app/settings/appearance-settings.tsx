"use client"

import { useState, useCallback } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/stores/app-store"
import { useUserStore } from "@/stores/user-store"
import { api } from "@/lib/api"
import { SKINS, type SkinId } from "@/skins/index"
import { cn } from "@/lib/utils"

// Hardcoded swatch colours per skin — do not rely on CSS vars here because
// the active skin overrides them, which would make all swatch previews look
// identical when a skin is already active.
const SKIN_SWATCHES: Record<SkinId, { bg: string; primary: string; fg: string }> = {
  default: {
    bg: "oklch(0.08 0.022 260)",
    primary: "oklch(0.72 0.14 200)",
    fg: "oklch(0.92 0.015 260)",
  },
  legal: {
    bg: "oklch(0.09 0.03 250)",
    primary: "oklch(0.72 0.15 75)",
    fg: "oklch(0.92 0.02 55)",
  },
}

export function AppearanceSettings({ open }: { open: boolean }) {
  const isAdmin = useUserStore((s) => s.isAdmin)
  const activeSkin = useAppStore((s) => s.activeSkin)
  const setActiveSkin = useAppStore((s) => s.setActiveSkin)
  const graphName = useAppStore((s) => s.graphName)
  const graphDescription = useAppStore((s) => s.graphDescription)

  const [selectedSkin, setSelectedSkin] = useState<SkinId>(activeSkin)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(async () => {
    if (!isAdmin) return
    setSaving(true)
    setSaved(false)
    try {
      await api.post("/about", {
        title: graphName,
        description: graphDescription,
        ui_skin: selectedSkin,
      })
      setActiveSkin(selectedSkin)
      setSaved(true)
    } catch (err) {
      console.error("[appearance-settings] save failed:", err)
    } finally {
      setSaving(false)
    }
  }, [selectedSkin, graphName, graphDescription, setActiveSkin])

  if (!open) return null

  const skinEntries = Object.values(SKINS)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-heading font-semibold uppercase tracking-wider text-foreground mb-1">
          Interface Skin
        </h2>
        <p className="text-xs text-muted-foreground">
          Choose a visual theme for the graph explorer. Saved server-side — all users see the selected skin.
        </p>
      </div>

      {/* Skin cards — 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {skinEntries.map((skin) => {
          const swatches = SKIN_SWATCHES[skin.id]
          const isSelected = selectedSkin === skin.id
          return (
            <button
              key={skin.id}
              type="button"
              onClick={() => {
                setSelectedSkin(skin.id)
                setSaved(false)
              }}
              className={cn(
                "text-left rounded-xl border p-4 transition-all focus:outline-none focus:ring-2 focus:ring-primary/50",
                isSelected
                  ? "border-primary ring-2 ring-primary bg-primary/5"
                  : "border-border/50 hover:border-primary/40 hover:bg-muted/30"
              )}
            >
              {/* Color swatch preview */}
              <div
                className="mb-3 flex h-10 items-center justify-center gap-2 rounded-lg border border-border/30"
                style={{ backgroundColor: swatches.bg }}
              >
                <span
                  className="h-4 w-4 rounded-full border border-white/10"
                  style={{ backgroundColor: swatches.bg }}
                  title="Background"
                />
                <span
                  className="h-4 w-4 rounded-full border border-white/10"
                  style={{ backgroundColor: swatches.primary }}
                  title="Primary / Accent"
                />
                <span
                  className="h-4 w-4 rounded-full border border-white/10"
                  style={{ backgroundColor: swatches.fg }}
                  title="Foreground"
                />
              </div>

              <p className="text-sm font-heading font-semibold text-foreground">{skin.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{skin.description}</p>
            </button>
          )
        })}
      </div>

      {/* Save row */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {saved && (
          <span className="text-xs text-primary font-mono uppercase tracking-widest">
            Saved ✓
          </span>
        )}
        <Button
          onClick={handleSave}
          disabled={saving || selectedSkin === activeSkin}
          className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? (
            <>
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              Saving…
            </>
          ) : (
            "Save Appearance"
          )}
        </Button>
      </div>
    </div>
  )
}
