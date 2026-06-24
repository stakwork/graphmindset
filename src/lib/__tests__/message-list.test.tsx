import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// ── Mock heavy dependencies ───────────────────────────────────────────────────
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className, ...props }: { className?: string; [key: string]: unknown }) => (
    <div data-testid="skeleton" className={className} {...props} />
  ),
}))

vi.mock("@/components/layout/node-row", () => ({
  NodeRow: ({ node }: { node: { properties?: { name?: string }; node_type?: string } }) => (
    <div data-testid="node-row">
      <span data-testid="node-label">{node.properties?.name}</span>
      <span data-testid="node-type">{node.node_type}</span>
    </div>
  ),
}))

vi.mock("@/lib/unlock-node", () => ({
  unlockNode: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: { schemas: [] }) => unknown) => sel({ schemas: [] }),
}))

// Mock graph-api getNode
const mockGetNode = vi.fn()
vi.mock("@/lib/graph-api", () => ({
  getNode: (...args: unknown[]) => mockGetNode(...args),
}))

import { MessageList } from "@/components/agent/message-list"

beforeEach(() => {
  vi.clearAllMocks()
  // Default: getNode resolves with a real node
  mockGetNode.mockResolvedValue({
    ref_id: "abc",
    node_type: "Episode",
    properties: { name: "Test Ep" },
  })
})

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

describe("CitedNodes — label resolution", () => {
  it("shows a loading skeleton per chip while getNode is pending", async () => {
    // Never resolves during this test
    mockGetNode.mockReturnValue(new Promise(() => {}))
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
    // The "cited-node-skeleton" should appear while fetch is in-flight
    expect(screen.getByTestId("cited-node-skeleton")).toBeInTheDocument()
  })

  it("renders the resolved node label and type badge", async () => {
    mockGetNode.mockResolvedValue({
      ref_id: "abc",
      node_type: "Episode",
      properties: { name: "Test Ep" },
    })
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
    await waitFor(() => {
      expect(screen.getByTestId("node-label")).toHaveTextContent("Test Ep")
      expect(screen.getByTestId("node-type")).toHaveTextContent("Episode")
    })
  })

  it("falls back to ref_id when getNode rejects", async () => {
    mockGetNode.mockRejectedValue(new Error("not found"))
    render(
      <MessageList
        messages={[
          {
            role: "agent",
            content: "Hello",
            isStreaming: false,
            citedRefIds: ["fallback-id"],
          },
        ]}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId("node-row")).toBeInTheDocument()
      // Label falls back to refId when node not found
      expect(screen.getByTestId("node-label")).toHaveTextContent("fallback-id")
    })
  })

  it("uses title property when name is absent", async () => {
    mockGetNode.mockResolvedValue({
      ref_id: "ep-99",
      node_type: "Article",
      properties: { title: "My Article Title" },
    })
    render(
      <MessageList
        messages={[
          {
            role: "agent",
            content: "Answer",
            isStreaming: false,
            citedRefIds: ["ep-99"],
          },
        ]}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId("node-label")).toHaveTextContent("My Article Title")
    })
  })
})
