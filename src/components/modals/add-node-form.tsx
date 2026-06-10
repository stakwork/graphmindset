"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SelectCustom } from "@/components/ui/select-custom"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { useSchemaStore } from "@/stores/schema-store"
import { getPrice, payL402 } from "@/lib/sphinx"
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
  addImageContent,
  checkNodeExists,
  createNode,
  getSchemaDomains,
  type SchemaDomainsResponse,
} from "@/lib/graph-api"
import type { SchemaNode, SchemaAttribute } from "@/app/ontology/page"
import {
  fieldsForSchema,
  humanizeFieldKey,
  fieldTypeHint,
  categorizeField,
  OPTIONAL_GROUP_ORDER,
  OPTIONAL_GROUP_LABELS,
} from "@/lib/node-schema-utils"
import { cn } from "@/lib/utils"

type Status = "idle" | "checking" | "submitting" | "success" | "error" | "uploading"

// Image is special-cased: the user picks a file directly in this modal and a
// single multipart POST to /v2/content/image handles upload + node creation +
// Stakwork dispatch. source_link/url are minted server-side from the upload,
// so we hide those form fields entirely.
const IMAGE_TYPE = "Image"
const IMAGE_AUTO_FIELDS = new Set(["source_link", "url"])

// Pre-submit gate. Backend re-validates with the same thresholds — these are
// just here to catch obvious mistakes before burning a multipart roundtrip.
const ALLOWED_IMAGE_TYPE_SET = new Set<string>(ALLOWED_IMAGE_TYPES)

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

export function AddNodeForm() {
  const { close } = useModalStore()
  const setBudget = useUserStore((s) => s.setBudget)
  const pubKey = useUserStore((s) => s.pubKey)
  const schemas = useSchemaStore((s) => s.schemas)

  const [selectedType, setSelectedType] = useState<string>("")
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [domains, setDomains] = useState<SchemaDomainsResponse | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Whether optional fields are expanded. Required fields always show.
  const [showOptional, setShowOptional] = useState(false)
  // Image-only: the file picked by the user, validated client-side before
  // we hit the multipart endpoint.
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  // Object URL for the in-modal preview. Created from the local File so the
  // user sees the image before any network roundtrip. Revoked on change/close.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Object-URL lifecycle is a genuine external-system sync: mint a preview URL
  // when a file is picked, revoke it on change/unmount.
  useEffect(() => {
    if (!selectedFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale object-URL preview
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(selectedFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedFile])

  // Visible schemas: drop hidden types and anything in a hidden domain. A
  // schema's domain is the lowercased name of its root ancestor under Thing.
  // Hidden lists arrive after the domains fetch resolves; until then, show
  // every schema rather than blocking the picker.
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

  // Required fields show immediately; optional ones collapse behind a toggle.
  const requiredFields = useMemo(
    () => visibleFields.filter((f) => f.required),
    [visibleFields]
  )
  const optionalFields = useMemo(
    () => visibleFields.filter((f) => !f.required),
    [visibleFields]
  )

  // Optional attributes bucketed into labelled sections (Content / Metadata /
  // Signals & scoring), preserving group order and dropping empty groups.
  const optionalGroups = useMemo(
    () =>
      OPTIONAL_GROUP_ORDER.map((group) => ({
        group,
        label: OPTIONAL_GROUP_LABELS[group],
        fields: optionalFields.filter((f) => categorizeField(f.key, f.type) === group),
      })).filter((g) => g.fields.length > 0),
    [optionalFields]
  )
  const filledOptional = useMemo(
    () => optionalFields.filter((f) => (fieldValues[f.key] ?? "").trim() !== "").length,
    [optionalFields, fieldValues]
  )

  // Fetch price + domains on mount
  useEffect(() => {
    getPrice("v2/nodes", "post").then(setPrice).catch(() => setPrice(null))
    const controller = new AbortController()
    getSchemaDomains(controller.signal)
      .then(setDomains)
      // Non-fatal: without the domains list we just show every schema.
      .catch(() => setDomains(null))
    return () => controller.abort()
  }, [])

  const typeOptions = useMemo(
    () => visibleSchemas.map((s) => ({ value: s.type, label: s.type })),
    [visibleSchemas]
  )

  const renderField = useCallback(
    (f: SchemaAttribute) => (
      <div key={f.key} className="flex flex-col gap-1.5">
        <label className="flex items-baseline gap-2">
          <span className="font-heading text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground whitespace-nowrap">
            {humanizeFieldKey(f.key)}
          </span>
          {f.required ? (
            <span className="text-[11px] text-destructive">required</span>
          ) : (
            <span className="text-[10px] text-muted-foreground/60">optional</span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/50">
            {fieldTypeHint(f.type)}
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
          placeholder={f.required ? "Required" : "Optional"}
          maxLength={1000}
          disabled={status === "checking" || status === "submitting" || status === "success" || status === "uploading"}
          className="h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50"
        />
      </div>
    ),
    [fieldValues, status]
  )

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!selectedSchema) {
        setErrorMsg("Choose a type first")
        return
      }

      const isImage = selectedSchema.type === IMAGE_TYPE

      // Image flow: needs a file, and the file has to pass format + size
      // gates before we burn a paid roundtrip.
      if (isImage) {
        if (!selectedFile) {
          setErrorMsg("Pick an image to upload")
          return
        }
        if (!ALLOWED_IMAGE_TYPE_SET.has(selectedFile.type)) {
          setErrorMsg(
            `Unsupported format "${selectedFile.type || "unknown"}". Allowed: JPEG, PNG, WebP, GIF.`
          )
          return
        }
        if (selectedFile.size > MAX_IMAGE_UPLOAD_BYTES) {
          const maxMb = Math.round(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))
          const fileMb = (selectedFile.size / (1024 * 1024)).toFixed(1)
          setErrorMsg(`File is ${fileMb} MB; max is ${maxMb} MB.`)
          return
        }
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
          setTimeout(() => close(), 1500)
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
        setErrorMsg(`"${humanizeFieldKey(keyField)}" is required`)
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
          setErrorMsg(`A ${selectedSchema.type} with this ${humanizeFieldKey(keyField)} already exists.`)
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
          setErrorMsg(`A ${selectedSchema.type} with this ${humanizeFieldKey(keyField)} already exists.`)
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
    [selectedSchema, fields, visibleFields, fieldValues, selectedFile, setBudget, close]
  )

  const busy = status === "checking" || status === "submitting" || status === "success" || status === "uploading"
  const isImageType = selectedSchema?.type === IMAGE_TYPE

  // Whether all required inputs are satisfied — drives the footer status hint.
  const nodeReady =
    !!selectedSchema &&
    requiredFields.every((f) => (fieldValues[f.key] ?? "").trim() !== "") &&
    (!isImageType || !!selectedFile)
  const statusHint = !selectedSchema
    ? "Pick a type to begin"
    : status === "success"
      ? "Created"
      : nodeReady
        ? "Ready to create"
        : "Fill the required fields"

  return (
    <form onSubmit={handleSubmit} className="relative z-10 space-y-4 pt-1">
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
              // Different schemas have different keys — drop any value the
              // user already entered so validation matches the new attribute
              // set cleanly.
              setSelectedType(v)
              setFieldValues({})
              setSelectedFile(null)
              setShowOptional(false)
              setErrorMsg(null)
            }}
            options={typeOptions}
            placeholder="Choose a type..."
            searchable
          />
        )}
      </div>

      {/* Image file picker — only for Image type. */}
      {isImageType && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
            File <span className="text-destructive">*</span>
            <span className="ml-2 normal-case text-muted-foreground/40 font-mono">
              JPEG / PNG / WebP / GIF · max {Math.round(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))} MB
            </span>
          </label>
          <input
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            disabled={busy}
            onChange={(e) => {
              setSelectedFile(e.target.files?.[0] ?? null)
              setErrorMsg(null)
            }}
            className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:text-primary-foreground hover:file:bg-primary/90 disabled:opacity-50"
          />
          {selectedFile && (
            <span className="text-xs text-muted-foreground/70 truncate">
              {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
            </span>
          )}
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Preview of selected image — local only, not yet uploaded"
              className="mt-1 max-h-40 w-full rounded-md border border-border/50 object-contain bg-muted/20"
            />
          )}
        </div>
      )}

      {/* Empty state — before a type is picked, only its required fields show */}
      {typeOptions.length > 0 && !selectedSchema && (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/[0.03] px-4 py-5 text-center text-[13px] text-muted-foreground">
          Pick a type and we&apos;ll show only the fields it needs.
        </div>
      )}

      {/* Required fields — always shown once a type is chosen */}
      {selectedSchema && requiredFields.length > 0 && (
        <div className="space-y-3.5">{requiredFields.map(renderField)}</div>
      )}

      {/* Optional attributes — collapsed, grouped into Content / Metadata / Signals */}
      {selectedSchema && optionalFields.length > 0 && (
        <div className="border-t border-border/50 pt-3.5">
          <button
            type="button"
            onClick={() => setShowOptional((s) => !s)}
            className="flex w-full items-center gap-2.5 text-left text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                showOptional && "rotate-90"
              )}
            />
            <span className="text-[13px] font-medium text-foreground whitespace-nowrap">
              Optional attributes
            </span>
            <span className="text-xs text-muted-foreground">
              {filledOptional ? `${filledOptional} of ${optionalFields.length} set` : optionalFields.length}
            </span>
            {!showOptional && (
              <span className="ml-auto text-xs text-primary">Add details</span>
            )}
          </button>
          {showOptional && (
            <div className="mt-3.5 space-y-5">
              {optionalGroups.map(({ group, label, fields: groupFields }) => (
                <div key={group}>
                  <div className="mb-2.5 flex items-center gap-2 font-heading text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70 whitespace-nowrap">
                    {label}
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                  <div className="space-y-3.5">{groupFields.map(renderField)}</div>
                </div>
              ))}
            </div>
          )}
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

      {/* Footer — contextual status hint + actions, bled to the modal edges */}
      <div className="-mx-4 -mb-4 mt-1 flex items-center gap-3 rounded-b-xl border-t border-border/50 bg-muted/30 px-4 py-3">
        <span className="text-xs text-muted-foreground">{statusHint}</span>
        <span className="flex-1" />
        {price !== null && price > 0 && (
          <span className="font-mono text-xs text-muted-foreground">{price} sats</span>
        )}
        <Button type="button" variant="ghost" onClick={() => close()} className="text-xs" disabled={busy}>
          Cancel
        </Button>
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
  )
}
