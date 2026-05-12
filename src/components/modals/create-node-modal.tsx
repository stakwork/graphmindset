"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { useSchemaStore } from "@/stores/schema-store"
import { getPrice, payL402 } from "@/lib/sphinx"
import { checkNodeExists, createNode, fetchSchemaByType } from "@/lib/graph-api"
import { MAX_LENGTHS } from "@/lib/input-limits"
import type { SchemaAttribute, SchemaNode } from "@/app/ontology/page"

type Status = "idle" | "checking" | "submitting" | "success" | "error"

/**
 * Derive the bare key-field name from `node_key`.
 * e.g. "topic-name" → "name", "episode-source_link" → "source_link", "name" → "name"
 */
function deriveKeyField(nodeKey: string, nodeType: string): string {
  const prefix = nodeType.toLowerCase() + "-"
  if (nodeKey.startsWith(prefix)) {
    return nodeKey.slice(prefix.length)
  }
  // Fallback: strip everything up to and including the first "-"
  const dashIdx = nodeKey.indexOf("-")
  if (dashIdx !== -1) {
    return nodeKey.slice(dashIdx + 1)
  }
  return nodeKey
}

function AttributeField({
  attr,
  value,
  onChange,
  disabled,
}: {
  attr: SchemaAttribute
  value: string
  onChange: (val: string) => void
  disabled: boolean
}) {
  const baseClass =
    "h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50"

  switch (attr.type) {
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          disabled={disabled}
          className="h-4 w-4 rounded border-border/50 accent-primary disabled:opacity-50"
        />
      )
    case "int":
    case "float":
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          step={attr.type === "float" ? "any" : "1"}
          className={baseClass}
        />
      )
    case "datetime":
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseClass}
        />
      )
    case "list":
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Comma-separated values"
          rows={2}
          className="w-full rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none resize-none disabled:opacity-50"
        />
      )
    default:
      // string
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={MAX_LENGTHS.SCHEMA_TYPE_NAME * 4} // reasonable cap for node values
          className={baseClass}
        />
      )
  }
}

export function CreateNodeModal() {
  const { activeModal, close } = useModalStore()
  const setBudget = useUserStore((s) => s.setBudget)
  const pubKey = useUserStore((s) => s.pubKey)
  const allSchemas = useSchemaStore((s) => s.schemas)

  const [selectedType, setSelectedType] = useState("")
  const [schema, setSchema] = useState<SchemaNode | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [price, setPrice] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const isOpen = activeModal === "createNode"

  // Eligible types: exclude "Thing" and types with no node_key
  const eligibleTypes = allSchemas
    .filter((s) => s.type !== "Thing" && s.node_key)
    .sort((a, b) => a.type.localeCompare(b.type))

  // Fetch price on open
  useEffect(() => {
    if (!isOpen) return
    getPrice("v2/nodes", "post").then(setPrice).catch(() => setPrice(null))
  }, [isOpen])

  // Reset all state on close
  useEffect(() => {
    if (!isOpen) {
      setSelectedType("")
      setSchema(null)
      setFormValues({})
      setErrorMsg(null)
      setStatus("idle")
      setLoadingSchema(false)
      abortRef.current?.abort()
    }
  }, [isOpen])

  // Fetch schema when type changes
  useEffect(() => {
    if (!selectedType) {
      setSchema(null)
      setFormValues({})
      return
    }
    setLoadingSchema(true)
    setSchema(null)
    setFormValues({})
    setErrorMsg(null)

    fetchSchemaByType(selectedType).then((result) => {
      setSchema(result)
      if (result) {
        // Initialise form values — booleans default false
        const allAttrs: SchemaAttribute[] = [
          ...(result.attributes ?? []),
          ...(result.inherited_attributes ?? []),
        ]
        const initial: Record<string, string> = {}
        for (const attr of allAttrs) {
          initial[attr.key] = attr.type === "boolean" ? "false" : ""
        }
        setFormValues(initial)
      }
      setLoadingSchema(false)
    })
  }, [selectedType])

  const allAttributes: SchemaAttribute[] = schema
    ? [...(schema.attributes ?? []), ...(schema.inherited_attributes ?? [])]
    : []

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!schema || !selectedType) return

      // Required-field validation
      const missing = allAttributes.filter(
        (a) => a.required && a.type !== "boolean" && !(formValues[a.key] ?? "").trim()
      )
      if (missing.length > 0) {
        setErrorMsg(`Required fields missing: ${missing.map((a) => a.key).join(", ")}`)
        return
      }

      // Derive key-field value for preflight
      const keyFieldName = deriveKeyField(schema.node_key, selectedType)
      const keyFieldValue = (formValues[keyFieldName] ?? "").trim()

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // 1. Preflight duplicate check (free)
      setStatus("checking")
      setErrorMsg(null)
      if (keyFieldValue) {
        try {
          const check = await checkNodeExists(selectedType, keyFieldValue, controller.signal)
          if (check.exists) {
            setStatus("error")
            setErrorMsg(`A ${selectedType} with this value already exists in the graph.`)
            return
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return
          // Non-fatal: proceed
        }
      }

      // Build node_data payload — coerce types, skip empty optional fields
      const nodeData: Record<string, unknown> = {}
      for (const attr of allAttributes) {
        const raw = formValues[attr.key] ?? ""
        if (attr.type === "boolean") {
          nodeData[attr.key] = raw === "true"
        } else if (attr.type === "int") {
          if (raw.trim()) nodeData[attr.key] = parseInt(raw, 10)
          else if (attr.required) nodeData[attr.key] = 0
        } else if (attr.type === "float") {
          if (raw.trim()) nodeData[attr.key] = parseFloat(raw)
          else if (attr.required) nodeData[attr.key] = 0
        } else if (attr.type === "list") {
          if (raw.trim()) nodeData[attr.key] = raw.split(",").map((v) => v.trim()).filter(Boolean)
          else if (attr.required) nodeData[attr.key] = []
        } else {
          if (raw.trim()) nodeData[attr.key] = raw.trim()
        }
      }

      // 2. Submit with L402 payment
      const doCreate = async () => {
        const response = await createNode(selectedType, nodeData, controller.signal)
        if ((response as Record<string, unknown>)?.status === "Warning") {
          setStatus("error")
          setErrorMsg(`A ${selectedType} with this value already exists in the graph.`)
          return
        }
        setStatus("success")
        setTimeout(() => close(), 1500)
      }

      setStatus("submitting")
      try {
        await doCreate()
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (err instanceof Response && err.status === 402) {
          try {
            await payL402(setBudget)
            await doCreate()
          } catch {
            setStatus("error")
            setErrorMsg("Payment failed. Please try again.")
          }
          return
        }
        setStatus("error")
        setErrorMsg("Something went wrong. Please try again.")
      }
    },
    [schema, selectedType, allAttributes, formValues, setBudget, close]
  )

  const busy = status === "checking" || status === "submitting" || status === "success"

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">Create Node</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Create a new node of any schema-defined type.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4 pt-2">
          {/* Type selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Node Type <span className="text-destructive">*</span>
            </label>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value)
                setErrorMsg(null)
              }}
              disabled={busy}
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50 appearance-none cursor-pointer"
            >
              <option value="">Select a type...</option>
              {eligibleTypes.map((s) => (
                <option key={s.ref_id} value={s.type}>
                  {s.type}
                </option>
              ))}
            </select>
          </div>

          {/* Loading schema */}
          {loadingSchema && (
            <p className="text-xs text-muted-foreground animate-pulse">Loading fields...</p>
          )}

          {/* Dynamic fields */}
          {schema && allAttributes.length > 0 && (
            <div className="space-y-3">
              {allAttributes.map((attr) => (
                <div key={attr.key} className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
                    {attr.key.replace(/_/g, " ")}
                    {attr.required ? (
                      <span className="text-destructive"> *</span>
                    ) : (
                      <span className="normal-case text-muted-foreground/60"> (optional)</span>
                    )}
                  </label>
                  <AttributeField
                    attr={attr}
                    value={formValues[attr.key] ?? ""}
                    onChange={(val) => {
                      setFormValues((prev) => ({ ...prev, [attr.key]: val }))
                      setErrorMsg(null)
                    }}
                    disabled={busy}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

          {/* Anon-loss disclosure */}
          {!pubKey && (
            <p className="text-xs text-muted-foreground mt-2">
              Earnings are credited to this browser&#39;s L402. Clearing storage will lose your sats.
            </p>
          )}

          {/* Price + Submit */}
          <div className="flex items-center justify-between pt-1">
            {price !== null && price > 0 ? (
              <span className="text-xs text-muted-foreground font-mono">{price} sats</span>
            ) : (
              <span />
            )}
            <Button
              type="submit"
              disabled={busy || !selectedType || loadingSchema}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {status === "checking"
                ? "Checking..."
                : status === "submitting"
                  ? "Creating..."
                  : status === "success"
                    ? "Created!"
                    : price && price > 0
                      ? `Create Node · ${price} sats`
                      : "Create Node"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
