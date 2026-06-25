import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { DomainPanel, type DomainRow } from "@/app/admin/domains/domain-panel"
import type { SchemaNode } from "@/lib/schema-types"

function schema(type: string, domain?: string): SchemaNode {
  return {
    ref_id: `s-${type}`,
    type,
    parent: "Thing",
    domain,
    color: "#6366f1",
    node_key: "name",
    attributes: [{ key: "name", type: "string", required: true }],
  }
}

const members = [schema("TwitterAccount", "Content"), schema("Tweet", "Content")]
const domain: DomainRow = {
  key: "content",
  label: "Content",
  members,
  hidden: false,
}

const allTypes: SchemaNode[] = [
  ...members,
  schema("Person", "Entity"),
  schema("Repository", "CodeArtifact"),
]

const defaultProps = {
  domain,
  allTypes,
  onRename: vi.fn(),
  onAddTypes: vi.fn(),
  onRemoveType: vi.fn(),
  onToggleHidden: vi.fn(),
  hiddenTypes: new Set<string>(),
  onToggleTypeHidden: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
}

describe("DomainPanel", () => {
  it("renders the domain label, key, and member types", () => {
    render(<DomainPanel {...defaultProps} />)
    expect(screen.getByDisplayValue("Content")).toBeTruthy()
    expect(screen.getByText("content")).toBeTruthy()
    expect(screen.getByText("TwitterAccount")).toBeTruthy()
    expect(screen.getByText("Tweet")).toBeTruthy()
  })

  it("rename requires confirmation, then fires onRename with the new name", async () => {
    const onRename = vi.fn()
    render(<DomainPanel {...defaultProps} onRename={onRename} />)
    const input = screen.getByDisplayValue("Content")
    await userEvent.clear(input)
    await userEvent.type(input, "Social")
    await userEvent.click(screen.getByRole("button", { name: "Rename" }))
    // Confirmation step — not yet called
    expect(onRename).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Rename" }))
    expect(onRename).toHaveBeenCalledWith("Social")
  })

  it("removing a member calls onRemoveType with the type name", async () => {
    const onRemoveType = vi.fn()
    render(<DomainPanel {...defaultProps} onRemoveType={onRemoveType} />)
    const row = screen.getByText("TwitterAccount").closest("div")!.parentElement!
    const removeBtn = within(row).getByTitle(/Remove from domain/)
    await userEvent.click(removeBtn)
    expect(onRemoveType).toHaveBeenCalledWith("TwitterAccount")
  })

  it("toggling visibility calls onToggleHidden", async () => {
    const onToggleHidden = vi.fn()
    render(<DomainPanel {...defaultProps} onToggleHidden={onToggleHidden} />)
    await userEvent.click(screen.getByRole("switch"))
    expect(onToggleHidden).toHaveBeenCalledWith(true)
  })

  it("hiding a member type calls onToggleTypeHidden", async () => {
    const onToggleTypeHidden = vi.fn()
    render(<DomainPanel {...defaultProps} onToggleTypeHidden={onToggleTypeHidden} />)
    const row = screen.getByText("TwitterAccount").closest("div")!.parentElement!
    const hideBtn = within(row).getByTitle(/Hide type from search/)
    await userEvent.click(hideBtn)
    expect(onToggleTypeHidden).toHaveBeenCalledWith("TwitterAccount", true)
  })

  it("shows a hidden member type as toggleable back on", async () => {
    const onToggleTypeHidden = vi.fn()
    render(
      <DomainPanel
        {...defaultProps}
        hiddenTypes={new Set(["TwitterAccount"])}
        onToggleTypeHidden={onToggleTypeHidden}
      />
    )
    const row = screen.getByText("TwitterAccount").closest("div")!.parentElement!
    const showBtn = within(row).getByTitle(/Show type in search/)
    await userEvent.click(showBtn)
    expect(onToggleTypeHidden).toHaveBeenCalledWith("TwitterAccount", false)
  })

  it("delete is unavailable while the domain has members", () => {
    render(<DomainPanel {...defaultProps} />)
    expect(screen.queryByText(/Delete empty domain/)).toBeNull()
    expect(screen.getByText(/Remove all member types to delete/)).toBeTruthy()
  })

  it("delete is available once the domain is empty", async () => {
    const onDelete = vi.fn()
    render(
      <DomainPanel
        {...defaultProps}
        domain={{ ...domain, members: [] }}
        onDelete={onDelete}
      />
    )
    const btn = screen.getByRole("button", { name: /Delete empty domain/ })
    await userEvent.click(btn)
    expect(onDelete).toHaveBeenCalled()
  })
})
