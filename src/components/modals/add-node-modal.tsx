"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SelectCustom } from "@/components/ui/select-custom"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { useSchemaStore } from "@/stores/schema-store"
import { getPrice, payL402 } from "@/lib/sphinx"
import {
  checkNodeExists,
  createNode,
  getSchemaDomains,
  uploadImageToNode,
  type SchemaDomainsResponse,
} from "@/lib/graph-api"
import type { SchemaNode, SchemaAttribute } from "@/app/ontology/page"

type Status = "idle" | "checking" | "submitting" | "success" | "error" | "uploading"

// Image type triggers a second phase: after node creation we ask for a file
// to upload to /v2/images/<ref_id>/upload. Constant lives here so other parts
// of the modal can branch on the same name without typos.
const IMAGE_TYPE = "Image"

// Inherited Thing attributes that are book-keeping the user never touches —
// owner_reference_id is set by the backend from the LSAT, weight/is_muted
// are graph-internal moderation knobs, unique_source_id is for dedup of
// ingested content (Stakwork) and gets re-derived from source_link anyway.
// Surface name though — it's universally relevant.
const SYSTEM_ATTRIBUTES = new Set([
  "weight",
  "is_muted",
  "unique_source_id",
  "owner_reference_id",
  "date_added_to_graph",
])

// Backend stores node_key as `{typeLower}-{attribute}` (e.g. "image-source_link",
// "transport-name"). The actual attribute name is the part after the dash.
function actualKeyField(schema: SchemaNode): string {
  const raw = schema.node_key || "name"
  const prefix = `${schema.type.toLowerCase()}-`
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

function extractRefId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null
  const r = response as Record<string, unknown>
  const data = r.data as Record<string, unknown> | undefined
  if (data && typeof data.ref_id === "string") return data.ref_id
  const nodes = r.nodes as Array<Record<string, unknown>> | undefined
  if (Array.isArray(nodes) && nodes[0] && typeof nodes[0].ref_id === "string") {
    return nodes[0].ref_id
  }
  return null
}

// Merge own + inherited attributes into one form-field list, with own
// attributes first. Duplicate keys are deduped (own wins). System-level
// inherited attrs (weight, is_muted, etc.) are filtered out — they're
// backend-managed book-keeping, not user input.
function fieldsForSchema(schema: SchemaNode): SchemaAttribute[] {
  const seen = new Set<string>()
  const out: SchemaAttribute[] = []
  for (const a of schema.attributes) {
    if (seen.has(a.key) || SYSTEM_ATTRIBUTES.has(a.key)) continue
    seen.add(a.key)
    out.push(a)
  }
  for (const a of schema.inherited_attributes ?? []) {
    if (seen.has(a.key) || SYSTEM_ATTRIBUTES.has(a.key)) continue
    seen.add(a.key)
    out.push(a)
  }
  return out
}

// Coerce a raw form value into the JSON shape the backend wants. Empty
// strings become "not provided" — dropped from the payload entirely.
function parseFieldValue(type: string, raw: string): unknown {
  const t = raw.trim()
  if (t === "") return undefined
  if (type === "int" || type === "integer") {
    const n = Number(t)
    return Number.isFinite(n) ? Math.trunc(n) : t
  }
  if (type === "float" || type === "number") {
    const n = Number(t)
    return Number.isFinite(n) ? n : t
  }
  if (type === "bool" || type === "boolean") {
    return t.toLowerCase() === "true" || t === "1"
  }
  return t
}

export function AddNodeModal() {
  const { activeModal, close } = useModalStore()
  const setBudget = useUserStore((s) => s.setBudget)
  const pubKey = useUserStore((s) => s.pubKey)
  const schemas = useSchemaStore((s) => s.schemas)

  const [selectedType, setSelectedType] = useState<string>("")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [domains, setDomains] = useState<SchemaDomainsResponse | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // When non-null, the modal is in "upload phase": Image node already created,
  // waiting for the user to pick a file to attach.
  const [pendingImage, setPendingImage] = useState<{ refId: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Visible schemas: drop hidden types and anything in a hidden domain. A
  // schema's domain is the lowercased name of its root ancestor under Thing
  // (e.g. Function → Codeartifact → "codeartifact"). hidden_domains returns
  // domain names lowercased, so we have to lowercase the walked root before
  // checking. Hidden lists arrive after the domains fetch resolves; until
  // then, show every schema rather than blocking the picker.
  const visibleSchemas = useMemo(() => {
    const hiddenTypes = new Set(domains?.hidden_types ?? [])
    const hiddenDomains = new Set(domains?.hidden_domains ?? [])
    const parentOf = new Map<string, string>()
    for (const s of schemas) {
      if (s.type && s.parent) parentOf.set(s.type, s.parent)
    }
    const rootDomain = (type: string): string => {
      let cur = type
      const seen = new Set<string>()
      while (true) {
        if (seen.has(cur)) return cur
        seen.add(cur)
        const p = parentOf.get(cur)
        if (!p || p === "Thing") return cur
        cur = p
      }
    }
    return schemas
      .filter((s) => s.type && !hiddenTypes.has(s.type))
      .filter((s) => !hiddenDomains.has(rootDomain(s.type).toLowerCase()))
      .slice()
      .sort((a, b) => a.type.localeCompare(b.type))
  }, [schemas, domains])

  const selectedSchema = useMemo(
    () => visibleSchemas.find((s) => s.type === selectedType) ?? null,
    [visibleSchemas, selectedType]
  )

  const fields = useMemo(
    () => (selectedSchema ? fieldsForSchema(selectedSchema) : []),
    [selectedSchema]
  )

  // Fetch price + domains on open
  useEffect(() => {
    if (activeModal !== "addNode") return
    getPrice("v2/nodes", "post").then(setPrice).catch(() => setPrice(null))
    const controller = new AbortController()
    getSchemaDomains(controller.signal)
      .then(setDomains)
      // Non-fatal: without the domains list we just show every schema.
      .catch(() => setDomains(null))
    return () => controller.abort()
  }, [activeModal])

  // All close paths funnel through here so the modal's internal state stays
  // fresh on each open without needing a reset-in-effect.
  const handleClose = useCallback(() => {
    setSelectedType("")
    setFieldValues({})
    setErrorMsg(null)
    setStatus("idle")
    setPendingImage(null)
    abortRef.current?.abort()
    close()
  }, [close])

  const typeOptions = useMemo(
    () => visibleSchemas.map((s) => ({ value: s.type, label: s.type })),
    [visibleSchemas]
  )

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!selectedSchema) {
        setErrorMsg("Choose a type first")
        return
      }

      // Required attributes must all have values.
      const missing = fields
        .filter((f) => f.required)
        .filter((f) => (fieldValues[f.key] ?? "").trim() === "")
        .map((f) => f.key)
      if (missing.length > 0) {
        setErrorMsg(`Missing required: ${missing.join(", ")}`)
        return
      }

      // The node_key (usually `name`) is what the server matches duplicates
      // on. Backend stores it type-prefixed (e.g. "transport-name") — strip
      // that to recover the actual attribute name the form is using.
      const keyField = actualKeyField(selectedSchema)
      const keyValue = (fieldValues[keyField] ?? "").trim()
      if (!keyValue) {
        setErrorMsg(`"${keyField}" is required`)
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Build the payload: only fields with non-empty trimmed values, coerced
      // by their declared attribute type.
      const nodeData: Record<string, unknown> = {}
      for (const f of fields) {
        const v = parseFieldValue(f.type, fieldValues[f.key] ?? "")
        if (v !== undefined) nodeData[f.key] = v
      }

      // 1. Preflight duplicate check (free, no payment)
      setStatus("checking")
      setErrorMsg(null)
      try {
        const check = await checkNodeExists(
          selectedSchema.type,
          keyValue,
          controller.signal
        )
        if (check.exists) {
          setStatus("error")
          setErrorMsg(`A ${selectedSchema.type} with this ${keyField} already exists.`)
          return
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        // Non-fatal: server will catch on submit
      }

      // 2. Submit with payment retry on 402
      const doCreate = async () => {
        const response = await createNode(
          selectedSchema.type,
          nodeData,
          controller.signal
        )
        if ((response as Record<string, unknown>)?.status === "Warning") {
          setStatus("error")
          setErrorMsg(`A ${selectedSchema.type} with this ${keyField} already exists.`)
          return
        }
        // Image nodes flip into the upload phase instead of auto-closing.
        // Every other type closes after a brief success flash.
        if (selectedSchema.type === IMAGE_TYPE) {
          const refId = extractRefId(response)
          if (refId) {
            setStatus("idle")
            setPendingImage({ refId })
            return
          }
          // No ref_id in the response — treat as a soft error so the user
          // sees we got partway. Node likely exists; they'd need to re-find
          // it to attach the image, which isn't possible from this modal.
          setStatus("error")
          setErrorMsg("Image node created but ref_id missing — can't attach file. Reload and try again.")
          return
        }
        setStatus("success")
        setTimeout(() => handleClose(), 1500)
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
    [selectedSchema, fields, fieldValues, setBudget, handleClose]
  )

  // File-pick handler for the upload phase. Uploads immediately and closes
  // the modal on success; failures keep the phase open so the user can retry
  // with a different file.
  const handleFilePick = useCallback(
    async (file: File | null) => {
      if (!file || !pendingImage) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setStatus("uploading")
      setErrorMsg(null)
      try {
        await uploadImageToNode(pendingImage.refId, file, controller.signal)
        setStatus("success")
        setTimeout(() => handleClose(), 800)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        setStatus("error")
        if (err instanceof Response) {
          const body = await err.json().catch(() => null) as { errorCode?: string; message?: string } | null
          setErrorMsg(body?.message || body?.errorCode || `Upload failed (HTTP ${err.status})`)
        } else {
          setErrorMsg("Upload failed. Try again or pick a different file.")
        }
      }
    },
    [pendingImage, handleClose]
  )

  const isOpen = activeModal === "addNode"
  const busy = status === "checking" || status === "submitting" || status === "success" || status === "uploading"

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            {pendingImage ? "Attach Image" : "Add Node"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {pendingImage
              ? "Image node created. Pick a file to upload — it'll be resized and stored automatically."
              : "Create a new node in the graph. Choose a type, then fill in its attributes."}
          </DialogDescription>
        </DialogHeader>

        {pendingImage ? (
          <div className="relative z-10 space-y-4 pt-2">
            <label className="block">
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
              />
            </label>

            {status === "uploading" && (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            )}
            {status === "success" && (
              <p className="text-xs text-primary">Uploaded. Closing…</p>
            )}
            {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

            <p className="text-xs text-muted-foreground/70">
              Skip the upload to leave the node imageless — you can come back
              later to attach a file.
            </p>

            <div className="flex justify-end pt-1">
              <Button
                type="button"
                onClick={handleClose}
                disabled={status === "uploading"}
                className="text-xs bg-muted text-foreground hover:bg-muted/80"
              >
                {status === "success" ? "Done" : "Skip"}
              </Button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="relative z-10 space-y-4 pt-2">
          {/* Type picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Type <span className="text-destructive">*</span>
            </label>
            {typeOptions.length === 0 ? (
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                No node types available. Load schemas or check the Domains settings.
              </div>
            ) : (
              <SelectCustom
                value={selectedType}
                onChange={(v) => {
                  // Different schemas have different keys — drop any value
                  // the user already entered so validation matches the new
                  // attribute set cleanly.
                  setSelectedType(v)
                  setFieldValues({})
                  setErrorMsg(null)
                }}
                options={typeOptions}
                placeholder="Choose a type..."
              />
            )}
          </div>

          {/* Dynamic fields — appear once a type is chosen */}
          {selectedSchema && fields.length > 0 && (
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
                    {f.key}{" "}
                    {f.required ? (
                      <span className="text-destructive">*</span>
                    ) : (
                      <span className="normal-case text-muted-foreground/60">
                        (optional)
                      </span>
                    )}
                    <span className="ml-2 normal-case text-muted-foreground/40 font-mono">
                      {f.type}
                    </span>
                  </label>
                  <input
                    type={
                      f.type === "int" || f.type === "integer" || f.type === "float" || f.type === "number"
                        ? "number"
                        : "text"
                    }
                    step={f.type === "float" || f.type === "number" ? "any" : undefined}
                    value={fieldValues[f.key] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value
                      setFieldValues((prev) => ({ ...prev, [f.key]: val }))
                      setErrorMsg(null)
                    }}
                    placeholder={f.required ? "Required" : ""}
                    maxLength={1000}
                    disabled={busy}
                    className="h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50"
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
              disabled={busy || !selectedSchema}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {status === "checking"
                ? "Checking..."
                : status === "submitting"
                  ? "Adding..."
                  : status === "success"
                    ? "Added!"
                    : (() => {
                        const verb = selectedSchema
                          ? `Add ${selectedSchema.type}`
                          : "Add"
                        return price && price > 0 ? `${verb} · ${price} sats` : verb
                      })()}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
