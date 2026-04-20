import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TypeEditor } from "@/app/ontology/type-editor"
import type { SchemaNode, SchemaEdge } from "@/app/ontology/page"

const baseSchema: SchemaNode = {
  ref_id: "s-1",
  type: "Article",
  parent: "Thing",
  color: "#6366f1",
  node_key: "name",
  attributes: [{ key: "name", type: "string", required: true }],
}

const defaultProps = {
  schema: baseSchema,
  allSchemas: [baseSchema],
  edges: [] as SchemaEdge[],
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
}

describe("TypeEditor – error prop", () => {
  it("renders error message as red text when error prop is provided", () => {
    render(
      <TypeEditor
        {...defaultProps}
        error="Error: 'status' is a reserved system property and cannot be used as a schema attribute."
      />
    )
    const msg = screen.getByText(/Error: 'status' is a reserved/)
    expect(msg).toBeTruthy()
    expect(msg.className).toMatch(/text-destructive/)
  })

  it("does not render error message when error prop is undefined", () => {
    render(<TypeEditor {...defaultProps} />)
    expect(screen.queryByText(/reserved/)).toBeNull()
  })

  it("calls onClearError when an attribute is edited", async () => {
    const onClearError = vi.fn()
    const onUpdate = vi.fn()
    render(
      <TypeEditor
        {...defaultProps}
        onUpdate={onUpdate}
        error="some error"
        onClearError={onClearError}
      />
    )
    const input = screen.getByPlaceholderText("key")
    await userEvent.clear(input)
    await userEvent.type(input, "title")
    expect(onClearError).toHaveBeenCalled()
  })
})
