"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Check, HelpCircle, AlertCircle, Trash2, ChevronDown, ImageIcon } from "lucide-react"
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
import { useSchemaStore } from "@/stores/schema-store"
import { useGraphStore } from "@/stores/graph-store"
import { useUserStore } from "@/stores/user-store"
import {
  adminUpdateNode,
  uploadImageToNode,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
  type GraphNode,
} from "@/lib/graph-api"
import { payL402 } from "@/lib/sphinx"
import { isMocksEnabled } from "@/lib/mock-data"
import { SYSTEM_ATTRIBUTES, fieldsForSchema } from "@/lib/node-schema-utils"
import { resolveNodeTitle } from "@/lib/node-display"
import {
  computeMappings,
  type ExactMapping,
  type FuzzyMapping,
  type UnmappedField,
} from "@/lib/node-remap"
import type { SchemaNode, SchemaAttribute } from "@/app/ontology/page"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function inputTypeFor(attrType: string): string {
  if (attrType === "int" || attrType === "integer" || attrType === "float" || attrType === "number") {
    return "number"
  }
  if (attrType === "datetime") return "datetime-local"
  if (attrType === "date") return "date"
  return "text"
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

// Every node exposes `image_url` (inherited from the root Thing schema), and it
// gets a file-upload affordance in place of the bare text input. Upload goes
// through POST /v2/nodes/<ref>/image: the backend stages to temp S3, sets
// image_url to the temp URL, and dispatches the workflow that swaps in the
// permanent URL via /v2/images/finalize. Pre-submit gate mirrors add-node-form;
// the backend re-validates with the same thresholds.
const IMAGE_FIELD_KEY = "image_url"
const ALLOWED_IMAGE_TYPE_SET = new Set<string>(ALLOWED_IMAGE_TYPES)

// image_url is treated as a universal field: the backend's image-upload
// endpoint resolves/falls back to image_url for any node type regardless of
// schema, so every node can carry one. Most schemas don't declare it (it isn't
// inherited from the root Thing type), so we append this synthetic row whenever
// the schema omits it.
const SYNTHETIC_IMAGE_FIELD: SchemaAttribute = {
  key: IMAGE_FIELD_KEY,
  type: "string",
  required: false,
}

// ---------------------------------------------------------------------------
// Sub-component: image upload / remove row
// ---------------------------------------------------------------------------
// Image is managed by action (upload a file, or remove), not by editing the URL
// string. Both upload and remove persist IMMEDIATELY (independent of the Save
// button) — `notice` surfaces that so it's clear the change already applied.
function ImageUploadRow({
  field,
  value,
  localPreview,
  uploading,
  error,
  notice,
  onPickFile,
  onRemove,
  disabled,
}: {
  field: SchemaAttribute
  value: string
  localPreview: string | null
  uploading: boolean
  error: string | null
  notice: null | "saved" | "removed"
  onPickFile: (file: File) => void
  onRemove: () => void
  disabled: boolean
}) {
  // Local object-URL wins during/just-after a pick so the user sees the new
  // image immediately; otherwise fall back to the persisted URL value.
  const preview = localPreview ?? (value.trim() ? value.trim() : null)
  const maxMb = Math.round(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground font-mono">
        {field.key}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
        <span className="ml-2 font-sans text-muted-foreground/40">
          JPEG / PNG / WebP / GIF · max {maxMb} MB
        </span>
      </label>

      {preview ? (
        <div className="relative w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Node image"
            className="max-h-40 w-full rounded-md border border-border/50 object-contain bg-muted/20"
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 text-xs text-muted-foreground">
              Uploading…
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/10 text-xs text-muted-foreground/50">
          {uploading ? "Uploading…" : "No image"}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label
          className={cn(
            "cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90",
            (disabled || uploading) && "pointer-events-none opacity-50"
          )}
        >
          {preview ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            disabled={disabled || uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPickFile(file)
              // Reset so re-picking the same file fires onChange again.
              e.target.value = ""
            }}
            className="hidden"
          />
        </label>
        {preview && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled || uploading}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Remove
          </Button>
        )}
      </div>

      {error ? (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      ) : notice ? (
        <p className="text-[11px] text-green-500 flex items-center gap-1">
          <Check className="h-3 w-3 shrink-0" />
          {notice === "saved" ? "Image saved" : "Image removed"} — applied immediately, no need to Save.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground/50">
          Image changes save immediately.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: collapsible image section
// ---------------------------------------------------------------------------
// Wraps ImageUploadRow in a disclosure that's collapsed by default. The header
// stays compact (small thumbnail + label) and visually distinct from the
// Save-gated property fields, reinforcing that image changes apply immediately.
function ImageSection({
  field,
  value,
  localPreview,
  uploading,
  error,
  notice,
  open,
  onToggle,
  onPickFile,
  onRemove,
  disabled,
}: {
  field: SchemaAttribute
  value: string
  localPreview: string | null
  uploading: boolean
  error: string | null
  notice: null | "saved" | "removed"
  open: boolean
  onToggle: () => void
  onPickFile: (file: File) => void
  onRemove: () => void
  disabled: boolean
}) {
  const thumb = localPreview ?? (value.trim() ? value.trim() : null)
  const summary = uploading
    ? "Working…"
    : thumb
      ? "Saved — click to replace or remove"
      : "Add an image · saves immediately"

  return (
    <div className="rounded-md border border-border/50 bg-muted/5 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/20"
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="h-9 w-9 shrink-0 rounded border border-border/50 object-cover bg-muted/20"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-border/50 text-muted-foreground/40">
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground/80">Image</p>
          <p className="truncate text-[11px] text-muted-foreground/60">{summary}</p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border/40 p-3">
          <ImageUploadRow
            field={field}
            value={value}
            localPreview={localPreview}
            uploading={uploading}
            error={error}
            notice={notice}
            onPickFile={onPickFile}
            onRemove={onRemove}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: field input row
// ---------------------------------------------------------------------------
function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SchemaAttribute
  value: string
  onChange: (key: string, val: string) => void
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-mono">
        {field.key}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <input
        type={inputTypeFor(field.type)}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.required ? "Required" : "Optional"}
        className={cn(
          "w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground",
          "border-border/60 focus:outline-none focus:ring-1 focus:ring-primary/60",
          "placeholder:text-muted-foreground/50"
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function EditNodeModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const editingNode = useModalStore((s) => s.editingNode)
  const close = useModalStore((s) => s.close)
  const schemas = useSchemaStore((s) => s.schemas)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const isAdmin = useUserStore((s) => s.isAdmin)
  const setBudget = useUserStore((s) => s.setBudget)

  const isOpen = activeModal === "editNode" && editingNode !== null && isAdmin

  // ----- selected type -----
  const [selectedType, setSelectedType] = useState<string>("")
  const originalType = editingNode?.node_type ?? ""

  // ----- Phase A: field values -----
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  // ----- Phase B: remap state -----
  // For fuzzy rows: null = pending, true = accepted, false = rejected
  const [fuzzyDecisions, setFuzzyDecisions] = useState<Record<string, boolean | null>>({})
  // For unmapped rows: "" = drop, or new-type field key
  const [unmappedAssignments, setUnmappedAssignments] = useState<Record<string, string>>({})

  // ----- Save state -----
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ----- Image upload state -----
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  // Local object-URL preview shown while/after a file is picked, before the
  // remote URL resolves. Revoked on change/unmount.
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  // User cleared the image via "Remove" — delete the property on Save.
  const [imageRemoved, setImageRemoved] = useState(false)
  // Inline confirmation under the image control: image changes persist
  // immediately (independent of Save), so we tell the user so.
  const [imageNotice, setImageNotice] = useState<null | "saved" | "removed">(null)
  // The image section is collapsed by default (open on demand) — it's a separate
  // concern from the Save-gated properties and shouldn't dominate the modal.
  const [imageSectionOpen, setImageSectionOpen] = useState(false)

  // ----- Schema lookups -----
  const originalSchema = useMemo(
    () => schemas.find((s) => s.type === originalType) ?? null,
    [schemas, originalType]
  )
  const selectedSchema = useMemo(
    () => schemas.find((s) => s.type === selectedType) ?? null,
    [schemas, selectedType]
  )

  // ----- Fields for each schema -----
  const originalFields = useMemo(
    () => (originalSchema ? fieldsForSchema(originalSchema) : []),
    [originalSchema]
  )
  const selectedFields = useMemo(
    () => (selectedSchema ? fieldsForSchema(selectedSchema) : []),
    [selectedSchema]
  )

  // image_url is handled by its own dedicated section (see below), never as a
  // Properties row — it persists immediately and shouldn't read as Save-gated.
  // So strip it from the Save-driven property fields here.
  const propertyFields = useMemo(
    () => selectedFields.filter((f) => f.key !== IMAGE_FIELD_KEY),
    [selectedFields]
  )
  // The field metadata for the image section: the schema's own image_url field
  // if it declares one, otherwise the synthetic universal field.
  const imageField = useMemo(
    () => selectedFields.find((f) => f.key === IMAGE_FIELD_KEY) ?? SYNTHETIC_IMAGE_FIELD,
    [selectedFields]
  )

  // ----- On modal open: initialise state -----
  useEffect(() => {
    if (!isOpen || !editingNode) return

    const type = editingNode.node_type ?? ""
    setSelectedType(type)
    setSaveError(null)

    // Pre-fill field values from node properties. Some fields (notably `name`)
    // are hoisted by the backend serializer to the node's top level and dropped
    // from `properties`, so fall back to the top-level field when absent.
    const schema = schemas.find((s) => s.type === type)
    const nodeRecord = editingNode as unknown as Record<string, unknown>
    const initValues: Record<string, string> = {}
    if (schema) {
      for (const field of fieldsForSchema(schema)) {
        const v = editingNode.properties?.[field.key] ?? nodeRecord[field.key]
        initValues[field.key] = stringifyValue(v)
      }
    }
    // Seed image_url even when the schema doesn't declare it, so the upload row
    // shows the existing image for property-only nodes.
    if (
      !(IMAGE_FIELD_KEY in initValues) &&
      editingNode.properties &&
      IMAGE_FIELD_KEY in editingNode.properties
    ) {
      initValues[IMAGE_FIELD_KEY] = stringifyValue(editingNode.properties[IMAGE_FIELD_KEY])
    }
    setFieldValues(initValues)
    setFuzzyDecisions({})
    setUnmappedAssignments({})
    setImageError(null)
    setImagePreview(null)
    setImageRemoved(false)
    setImageNotice(null)
    setImageSectionOpen(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Revoke the local preview object-URL when it's replaced or the modal closes.
  useEffect(() => {
    if (!imagePreview) return
    return () => URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  // Push an image change into the selected node so the preview panel reflects it
  // immediately (no page reload). Image changes persist server-side on their own
  // (upload endpoint / immediate delete), so this just mirrors that into the UI.
  const reflectImageInPreview = useCallback(
    (imageUrl: string | null) => {
      if (!editingNode) return
      const props = { ...editingNode.properties }
      if (imageUrl) props[IMAGE_FIELD_KEY] = imageUrl
      else delete props[IMAGE_FIELD_KEY]
      setSelectedNode({ ...editingNode, properties: props })
    },
    [editingNode, setSelectedNode]
  )

  // ----- Image upload handler -----
  const handleImageUpload = useCallback(
    async (fieldKey: string, file: File) => {
      if (!editingNode) return
      setImageError(null)
      // Picking a new file supersedes a pending removal.
      setImageRemoved(false)

      if (!ALLOWED_IMAGE_TYPE_SET.has(file.type)) {
        setImageError(
          `Unsupported format "${file.type || "unknown"}". Allowed: JPEG, PNG, WebP, GIF.`
        )
        return
      }
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        const maxMb = Math.round(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))
        const fileMb = (file.size / (1024 * 1024)).toFixed(1)
        setImageError(`File is ${fileMb} MB; max is ${maxMb} MB.`)
        return
      }

      // Immediate local preview.
      setImagePreview(URL.createObjectURL(file))
      setImageNotice(null)

      if (isMocksEnabled()) {
        console.log("[EditNodeModal] mock image upload", { ref_id: editingNode.ref_id, file })
        setImageNotice("saved")
        return
      }

      setImageUploading(true)
      const doUpload = async () => {
        // Backend stages to temp S3, sets image_url to the temp URL, and kicks
        // off the workflow that swaps in the permanent URL. The image is
        // persisted server-side here (independent of Save), so mirror it into
        // the form (preview) and into the selected node (live panel refresh).
        const res = await uploadImageToNode(editingNode.ref_id, file)
        setFieldValues((prev) => ({ ...prev, [fieldKey]: res.url }))
        reflectImageInPreview(res.url)
        setImageNotice("saved")
      }

      try {
        await doUpload()
      } catch (err) {
        if (err instanceof Response && err.status === 402) {
          try {
            await payL402(setBudget)
            await doUpload()
          } catch {
            setImageError("Payment failed. Please try again.")
          }
        } else if (err instanceof Response) {
          const body = (await err.json().catch(() => null)) as
            | { errorCode?: string; message?: string }
            | null
          setImageError(body?.message || body?.errorCode || `Upload failed (HTTP ${err.status})`)
        } else {
          setImageError("Upload failed. Try again or pick a different file.")
        }
      } finally {
        setImageUploading(false)
      }
    },
    [editingNode, setBudget, reflectImageInPreview]
  )

  // ----- Image remove handler -----
  // Removal persists immediately (like upload), so it's not tied to Save:
  // delete image_url server-side, then mirror the change into the form + panel.
  const handleImageRemove = useCallback(async () => {
    if (!editingNode || imageUploading) return
    setImageError(null)
    setImagePreview(null)
    setImageNotice(null)
    setImageUploading(true)
    try {
      if (!isMocksEnabled()) {
        await adminUpdateNode({
          // Use the node's existing type — never the pending type change — so a
          // removal can't accidentally relabel the node.
          ref_id: editingNode.ref_id,
          node_type: editingNode.node_type,
          node_data: {},
          properties_to_be_deleted: [IMAGE_FIELD_KEY],
        })
      }
      setFieldValues((prev) => ({ ...prev, [IMAGE_FIELD_KEY]: "" }))
      setImageRemoved(true)
      reflectImageInPreview(null)
      setImageNotice("removed")
    } catch {
      setImageError("Couldn't remove the image. Please try again.")
    } finally {
      setImageUploading(false)
    }
  }, [editingNode, imageUploading, reflectImageInPreview])

  // ----- Compute mappings when type changes -----
  const typeChanged = selectedType !== originalType && selectedType !== ""

  const rawMappings = useMemo(() => {
    if (!typeChanged) return null
    const currentValues: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fieldValues)) {
      currentValues[k] = v
    }
    return computeMappings(originalFields, selectedFields, currentValues)
  }, [typeChanged, originalFields, selectedFields, fieldValues])

  // When type changes, reset remap decisions and pre-fill Phase A with new schema fields
  const handleTypeChange = useCallback(
    (newType: string) => {
      setSelectedType(newType)
      setSaveError(null)
      setFuzzyDecisions({})
      setUnmappedAssignments({})

      // Keep existing field values; add empty slots for new schema fields not yet present
      const newSchema = schemas.find((s) => s.type === newType)
      if (!newSchema) return
      setFieldValues((prev) => {
        const next = { ...prev }
        for (const field of fieldsForSchema(newSchema)) {
          if (!(field.key in next)) {
            next[field.key] = ""
          }
        }
        return next
      })
    },
    [schemas]
  )

  // ----- Fuzzy + unmapped state helpers -----
  const acceptedFuzzy = useMemo(
    () => (rawMappings?.fuzzy ?? []).filter((m) => fuzzyDecisions[m.oldKey] === true),
    [rawMappings, fuzzyDecisions]
  )
  const rejectedFuzzy = useMemo(
    () => (rawMappings?.fuzzy ?? []).filter((m) => fuzzyDecisions[m.oldKey] === false),
    [rawMappings, fuzzyDecisions]
  )
  // After rejection, these move to "unmapped" for manual assignment
  const effectiveUnmapped: UnmappedField[] = useMemo(
    () => [
      ...(rawMappings?.unmapped ?? []),
      ...rejectedFuzzy.map((m) => ({ oldKey: m.oldKey, value: m.value })),
    ],
    [rawMappings, rejectedFuzzy]
  )

  // New-type fields claimed by exact or accepted-fuzzy (not available for manual selection)
  const claimedNewKeys = useMemo(() => {
    const s = new Set<string>()
    for (const m of rawMappings?.exact ?? []) s.add(m.newKey)
    for (const m of acceptedFuzzy) s.add(m.newKey)
    return s
  }, [rawMappings, acceptedFuzzy])

  const availableNewFieldsForManual = useMemo(
    () => selectedFields.filter((f) => !claimedNewKeys.has(f.key)),
    [selectedFields, claimedNewKeys]
  )

  // ----- Required-field guard -----
  const requiredNewFields = useMemo(
    () => selectedFields.filter((f) => f.required),
    [selectedFields]
  )

  const isSaveDisabled = useMemo(() => {
    if (saving) return true
    for (const req of requiredNewFields) {
      // Check Phase A field values
      const phaseAVal = (fieldValues[req.key] ?? "").trim()
      if (phaseAVal) continue

      if (typeChanged && rawMappings) {
        // Exact mapping satisfies it
        if (rawMappings.exact.some((m) => m.newKey === req.key)) continue
        // Accepted fuzzy satisfies it
        if (acceptedFuzzy.some((m) => m.newKey === req.key)) continue
        // Manual assignment satisfies it
        const manualKey = Object.entries(unmappedAssignments).find(([, v]) => v === req.key)?.[0]
        if (manualKey) continue
      }

      // Required field has no value
      return true
    }
    return false
  }, [saving, requiredNewFields, fieldValues, typeChanged, rawMappings, acceptedFuzzy, unmappedAssignments])

  // ----- Save -----
  async function handleSave() {
    if (!editingNode || isSaveDisabled || !isAdmin) return
    setSaving(true)
    setSaveError(null)

    try {
      // Build node_data
      const node_data: Record<string, unknown> = {}
      const properties_to_be_deleted: string[] = []

      if (typeChanged && rawMappings) {
        // Exact mappings
        for (const m of rawMappings.exact) {
          const v = parseFieldValue(
            selectedFields.find((f) => f.key === m.newKey)?.type ?? "string",
            stringifyValue(m.value)
          )
          if (v !== undefined) node_data[m.newKey] = v
        }
        // Accepted fuzzy
        for (const m of acceptedFuzzy) {
          const v = parseFieldValue(
            selectedFields.find((f) => f.key === m.newKey)?.type ?? "string",
            stringifyValue(m.value)
          )
          if (v !== undefined) node_data[m.newKey] = v
        }
        // Manual assignments
        for (const [oldKey, newKey] of Object.entries(unmappedAssignments)) {
          if (!newKey) {
            // Explicitly dropped — add to deletion list
            properties_to_be_deleted.push(oldKey)
            continue
          }
          const rawVal = rawMappings.unmapped.find((u) => u.oldKey === oldKey)?.value
            ?? rejectedFuzzy.find((u) => u.oldKey === oldKey)?.value
          const v = parseFieldValue(
            selectedFields.find((f) => f.key === newKey)?.type ?? "string",
            stringifyValue(rawVal)
          )
          if (v !== undefined) node_data[newKey] = v
        }
        // Unassigned unmapped fields (no assignment chosen yet = drop)
        for (const u of effectiveUnmapped) {
          if (!(u.oldKey in unmappedAssignments)) {
            properties_to_be_deleted.push(u.oldKey)
          }
        }
      }

      // Phase A field values (always applied, overrides mapped values if same key)
      for (const field of selectedFields) {
        const raw = fieldValues[field.key] ?? ""
        const v = parseFieldValue(field.type, raw)
        if (v !== undefined) node_data[field.key] = v
      }

      // Property-only image_url: persist it when neither schema declares the
      // field (so the loops above never touched it, and the remap logic can't
      // be deleting it). The upload endpoint already wrote it server-side; this
      // keeps a pasted URL edit in sync too.
      // image_url is managed out-of-band by the upload pipeline (temp →
      // workflow → permanent via /v2/images/finalize), so it must NEVER ride
      // along in the Save payload — doing so would clobber the permanent URL the
      // workflow writes with the stale temp URL. Strip it here regardless of how
      // it got into node_data (schema field or otherwise).
      delete node_data[IMAGE_FIELD_KEY]

      // Removal is the one image change Save is responsible for: delete the
      // property outright.
      if (imageRemoved && !(fieldValues[IMAGE_FIELD_KEY] ?? "").trim()) {
        if (!properties_to_be_deleted.includes(IMAGE_FIELD_KEY)) {
          properties_to_be_deleted.push(IMAGE_FIELD_KEY)
        }
      }

      // Build the post-save node so the preview reflects every change without a
      // reload. node_data already excludes image_url (managed out of band), so
      // re-apply the current image_url from fieldValues here.
      const updatedProps: Record<string, unknown> = { ...editingNode.properties, ...node_data }
      for (const k of properties_to_be_deleted) delete updatedProps[k]
      const imgVal = (fieldValues[IMAGE_FIELD_KEY] ?? "").trim()
      if (imgVal) updatedProps[IMAGE_FIELD_KEY] = imgVal
      else delete updatedProps[IMAGE_FIELD_KEY]
      const updatedNode = {
        ...editingNode,
        node_type: selectedType,
        properties: updatedProps,
        // name is hoisted to the node's top level by the serializer; mirror it.
        ...(typeof updatedProps.name === "string" ? { name: updatedProps.name } : {}),
      } as GraphNode

      if (isMocksEnabled()) {
        console.log("[EditNodeModal] mock save", { node_data, properties_to_be_deleted })
        close()
        clearSelection()
        setSelectedNode(updatedNode)
        return
      }

      await adminUpdateNode({
        ref_id: editingNode.ref_id,
        node_type: selectedType,
        node_data,
        ...(typeChanged ? { type_to_be_deleted: [originalType] } : {}),
        ...(properties_to_be_deleted.length > 0 ? { properties_to_be_deleted } : {}),
      })

      close()
      clearSelection()
      setSelectedNode(updatedNode)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "An unexpected error occurred. Please try again."
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  // ----- Required-field highlight helper -----
  function isRequiredUnmet(fieldKey: string): boolean {
    if (!typeChanged || !rawMappings) {
      return (
        (selectedFields.find((f) => f.key === fieldKey)?.required ?? false) &&
        !(fieldValues[fieldKey] ?? "").trim()
      )
    }
    const req = requiredNewFields.find((f) => f.key === fieldKey)
    if (!req) return false
    if ((fieldValues[fieldKey] ?? "").trim()) return false
    if (rawMappings.exact.some((m) => m.newKey === fieldKey)) return false
    if (acceptedFuzzy.some((m) => m.newKey === fieldKey)) return false
    if (Object.entries(unmappedAssignments).some(([, v]) => v === fieldKey)) return false
    return true
  }

  // ----- Schema options for type selector -----
  const schemaOptions = useMemo(
    () => schemas.map((s) => ({ value: s.type, label: s.type })),
    [schemas]
  )

  // ----- Render -----
  if (!isOpen || !editingNode) return null

  const displayTitle = resolveNodeTitle(editingNode, schemas)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-heading text-lg tracking-wide">Edit Node</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Update properties for <span className="font-mono text-foreground/80">{displayTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 space-y-5 pr-1">
          {/* Type selector */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-mono">node_type</label>
            <SelectCustom
              value={selectedType}
              onChange={handleTypeChange}
              options={schemaOptions}
              placeholder="Select type…"
            />
          </div>

          {/* Image — its own section, collapsed by default. Persists immediately
              (independent of Save), so it lives apart from the property fields. */}
          <ImageSection
            field={imageField}
            value={fieldValues[IMAGE_FIELD_KEY] ?? ""}
            localPreview={imagePreview}
            uploading={imageUploading}
            error={imageError}
            notice={imageNotice}
            open={imageSectionOpen}
            onToggle={() => setImageSectionOpen((v) => !v)}
            onPickFile={(file) => handleImageUpload(IMAGE_FIELD_KEY, file)}
            onRemove={handleImageRemove}
            disabled={saving}
          />

          {/* Phase A: schema-driven fields */}
          {propertyFields.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Properties
              </p>
              {propertyFields.map((field) => (
                <div key={field.key}>
                  <FieldRow
                    field={field}
                    value={fieldValues[field.key] ?? ""}
                    onChange={(key, val) =>
                      setFieldValues((prev) => ({ ...prev, [key]: val }))
                    }
                  />
                  {isRequiredUnmet(field.key) && (
                    <p className="text-[11px] text-destructive mt-0.5 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Required
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Phase B: remap section — only when type changed */}
          {typeChanged && rawMappings && (
            <div className="space-y-4 border-t border-border/40 pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Property Remapping
              </p>

              {/* Exact matches */}
              {rawMappings.exact.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Auto-matched</p>
                  {rawMappings.exact.map((m: ExactMapping) => (
                    <div
                      key={m.oldKey}
                      className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-1.5 text-xs"
                    >
                      <Check className="h-3 w-3 shrink-0 text-green-500" />
                      <span className="font-mono text-foreground/70">{m.oldKey}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-foreground/70">{m.newKey}</span>
                      <span className="ml-auto text-muted-foreground truncate max-w-[120px]">
                        {stringifyValue(m.value) || <em>empty</em>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Fuzzy suggestions */}
              {rawMappings.fuzzy.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Suggestions — accept or reject</p>
                  {rawMappings.fuzzy.map((m: FuzzyMapping) => {
                    const decision = fuzzyDecisions[m.oldKey] ?? null
                    return (
                      <div
                        key={m.oldKey}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs border",
                          decision === true && "bg-green-500/10 border-green-500/30",
                          decision === false && "bg-muted/20 border-border/30 opacity-60",
                          decision === null && "bg-muted/30 border-border/30"
                        )}
                      >
                        <HelpCircle className="h-3 w-3 shrink-0 text-amber-400" />
                        <span className="font-mono text-foreground/70">{m.oldKey}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-mono text-foreground/70">{m.newKey}</span>
                        <span className="text-muted-foreground/60 text-[10px]">
                          ({Math.round(m.score * 100)}%)
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            onClick={() =>
                              setFuzzyDecisions((prev) => ({ ...prev, [m.oldKey]: true }))
                            }
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] border transition-colors",
                              decision === true
                                ? "bg-green-600 text-white border-green-600"
                                : "border-border/50 text-muted-foreground hover:border-green-500/60 hover:text-green-400"
                            )}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() =>
                              setFuzzyDecisions((prev) => ({ ...prev, [m.oldKey]: false }))
                            }
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] border transition-colors",
                              decision === false
                                ? "bg-muted text-muted-foreground border-border/60"
                                : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                            )}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Unmapped old properties */}
              {effectiveUnmapped.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    Unmatched — map to a new field or drop
                  </p>
                  {effectiveUnmapped.map((u: UnmappedField) => (
                    <div
                      key={u.oldKey}
                      className="flex items-center gap-2 rounded-md bg-muted/20 border border-border/30 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono text-foreground/70 shrink-0">{u.oldKey}</span>
                      <span className="text-muted-foreground">→</span>
                      <select
                        value={unmappedAssignments[u.oldKey] ?? ""}
                        onChange={(e) =>
                          setUnmappedAssignments((prev) => ({
                            ...prev,
                            [u.oldKey]: e.target.value,
                          }))
                        }
                        className="ml-auto flex-1 min-w-0 max-w-[200px] rounded border border-border/50 bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
                        aria-label={`Map ${u.oldKey}`}
                      >
                        <option value="">— Drop —</option>
                        {availableNewFieldsForManual
                          .filter((f) => !(unmappedAssignments[u.oldKey] !== f.key && Object.values(unmappedAssignments).includes(f.key)))
                          .map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.key}{f.required ? " *" : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 pt-3 space-y-2 border-t border-border/30">
          {saveError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaveDisabled}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
