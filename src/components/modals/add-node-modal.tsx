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
  addImageContent,
  checkNodeExists,
  createNode,
  getSchemaDomains,
  type SchemaDomainsResponse,
} from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"
import { fieldsForSchema } from "@/lib/node-schema-utils"

type Status = "idle" | "checking" | "submitting" | "success" | "error" | "uploading"

// Image is special-cased: the user picks a file directly in this modal and
// the multipart POST to /v2/content/image handles upload + node creation +
// Stakwork dispatch in one round trip. No source_link form field, no
// second phase.
const IMAGE_TYPE = "Image"

// The Image schema's node_key is "image-source_link" but for uploads the
// source URL doesn't exist until the file lands in S3. The backend mints
// it server-side, so we hide the form field entirely.
const IMAGE_AUTO_FIELDS = new Set(["source_link", "url"])

// Backend stores node_key as `{typeLower}-{attribute}` (e.g. "image-source_link",
// "transport-name"). The actual attribute name is the part after the dash.
function actualKeyField(schema: SchemaNode): string {
  const raw = schema.node_key || "name"
  const prefix = `${schema.type.toLowerCase()}-`
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
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
  // Selected image file for the single-shot /v2/content/image flow. Only
  // relevant when selectedType === IMAGE_TYPE.
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
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

  // What we actually render in the form. For Image, source_link/url are
  // populated server-side from the upload — no user input.
  const visibleFields = useMemo(() => {
    if (selectedSchema?.type === IMAGE_TYPE) {
      return fields.filter((f) => !IMAGE_AUTO_FIELDS.has(f.key))
    }
    return fields
  }, [selectedSchema, fields])

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
    setSelectedFile(null)
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

      const isImage = selectedSchema.type === IMAGE_TYPE

      // Image flow needs a file; nothing else does.
      if (isImage && !selectedFile) {
        setErrorMsg("Pick an image to upload")
        return
      }

      // Required attributes must all have values. For Image we skip
      // source_link/url since the backend mints them from the upload.
      const missing = visibleFields
        .filter((f) => f.required)
        .filter((f) => (fieldValues[f.key] ?? "").trim() === "")
        .map((f) => f.key)
      if (missing.length > 0) {
        setErrorMsg(`Missing required: ${missing.join(", ")}`)
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // Image path: single multipart POST. Backend handles upload + node
      // create + Stakwork dispatch.
      if (isImage) {
        const name = (fieldValues["name"] ?? "").trim() || selectedFile!.name
        const doUpload = async () => {
          await addImageContent(
            selectedFile!,
            { name },
            controller.signal
          )
          setStatus("success")
          setTimeout(() => handleClose(), 1500)
        }

        setStatus("uploading")
        setErrorMsg(null)
        try {
          await doUpload()
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return
          if (err instanceof Response && err.status === 402) {
            try {
              await payL402(setBudget)
              await doUpload()
            } catch {
              setStatus("error")
              setErrorMsg("Payment failed. Please try again.")
            }
            return
          }
          setStatus("error")
          if (err instanceof Response) {
            const body = await err.json().catch(() => null) as { errorCode?: string; message?: string } | null
            setErrorMsg(body?.message || body?.errorCode || `Upload failed (HTTP ${err.status})`)
          } else {
            setErrorMsg("Upload failed. Try again or pick a different file.")
          }
        }
        return
      }

      // Non-image path: existing checkNodeExists + createNode flow.
      const keyField = actualKeyField(selectedSchema)
      const keyValue = (fieldValues[keyField] ?? "").trim()
      if (!keyValue) {
        setErrorMsg(`"${keyField}" is required`)
        return
      }

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
    [selectedSchema, fields, visibleFields, fieldValues, selectedFile, setBudget, handleClose]
  )

  const isOpen = activeModal === "addNode"
  const busy = status === "checking" || status === "submitting" || status === "success" || status === "uploading"

  const isImageType = selectedSchema?.type === IMAGE_TYPE

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            Add Node
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Create a new node in the graph. Choose a type, then fill in its attributes.
          </DialogDescription>
        </DialogHeader>

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
                  setSelectedFile(null)
                  setErrorMsg(null)
                }}
                options={typeOptions}
                placeholder="Choose a type..."
              />
            )}
          </div>

          {/* Image file picker — only for Image type. Backend mints
              source_link/url from the upload, so we don't render those
              fields below. */}
          {isImageType && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
                File <span className="text-destructive">*</span>
                <span className="ml-2 normal-case text-muted-foreground/40 font-mono">
                  image/*
                </span>
              </label>
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => {
                  setSelectedFile(e.target.files?.[0] ?? null)
                  setErrorMsg(null)
                }}
                className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
              />
              {selectedFile && (
                <span className="text-xs text-muted-foreground/70 truncate">
                  {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                </span>
              )}
            </div>
          )}

          {/* Dynamic fields — appear once a type is chosen */}
          {selectedSchema && visibleFields.length > 0 && (
            <div className="space-y-3">
              {visibleFields.map((f) => (
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
                  : status === "uploading"
                    ? "Uploading..."
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
      </DialogContent>
    </Dialog>
  )
}
