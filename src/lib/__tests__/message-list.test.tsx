import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// ── Mock heavy dependencies ───────────────────────────────────────────────────
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}))

vi.mock("@/components/layout/node-row", () => ({
  NodeRow: () => <div data-testid="node-row" />,
}))

vi.mock("@/lib/unlock-node", () => ({
  unlockNode: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: { schemas: [] }) => unknown) => sel({ schemas: [] }),
}))

import { MessageList } from "@/components/agent/message-list"

describe("MessageList", () => {
  it("shows Thinking… placeholder when isStreaming=true and content is empty", () => {
    render(
      <MessageList
        messages={[{ role: "agent", content: "", isStreaming: true }]}
      />
    )
    expect(screen.getByText("Thinking…")).toBeInTheDocument()
  })

  it("does NOT show Thinking… when content is present, even while streaming", () => {
    render(
      <MessageList
        messages={[{ role: "agent", content: "Hello", isStreaming: true }]}
      />
    )
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument()
    expect(screen.getByText("Hello")).toBeInTheDocument()
  })

  it("renders cited sources after streaming completes", () => {
    render(
      <MessageList
        messages={[
          {
            role: "agent",
            content: "Hello",
            isStreaming: false,
            citedRefIds: ["abc"],
          },
        ]}
      />
    )
    expect(screen.getByText("Sources")).toBeInTheDocument()
  })

  it("does NOT render cited sources while still streaming", () => {
    render(
      <MessageList
        messages={[
          {
            role: "agent",
            content: "Hello",
            isStreaming: true,
            citedRefIds: ["abc"],
          },
        ]}
      />
    )
    expect(screen.queryByText("Sources")).not.toBeInTheDocument()
  })

  it("renders three skeleton dots in the Thinking placeholder", () => {
    render(
      <MessageList
        messages={[{ role: "agent", content: "", isStreaming: true }]}
      />
    )
    expect(screen.getAllByTestId("skeleton")).toHaveLength(3)
  })
})
