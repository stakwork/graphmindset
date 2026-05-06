import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Mock modules before importing the component
vi.mock("@/lib/graph-api", () => ({
  getCronConfig: vi.fn(),
  updateCronConfig: vi.fn(),
  runCron: vi.fn(),
  getCronRuns: vi.fn(),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: vi.fn(() => false),
  MOCK_CRON_CONFIGS: [
    {
      ref_id: "rc-deduplication",
      source_type: "deduplication",
      kind: "janitor",
      enabled: false,
      cadence: "0 * * * *",
      workflow_id: "mock-gm-workflow-id",
      namespace: "mock",
      label: "Deduplication",
    },
    {
      ref_id: "rc-content-review",
      source_type: "content_review",
      kind: "janitor",
      enabled: false,
      cadence: "0 * * * *",
      workflow_id: "mock-gm-workflow-id",
      namespace: "mock",
      label: "Content review",
    },
    {
      ref_id: "rc-topic-review",
      source_type: "topic_review",
      kind: "janitor",
      enabled: false,
      cadence: "0 * * * *",
      workflow_id: "mock-gm-workflow-id",
      namespace: "mock",
      label: "Topic review",
    },
  ],
  MOCK_STAKWORK_RUNS: [
    {
      ref_id: "run-003",
      source_type: "deduplication",
      kind: "janitor",
      status: "completed",
      trigger: "SCHEDULED",
      created_at: new Date("2026-05-04T07:00:00Z").getTime() / 1000,
      finished_at: new Date("2026-05-04T07:05:00Z").getTime() / 1000,
    },
  ],
}))

import { JanitorSettings } from "@/components/modals/janitor-settings"

const mockJanitorConfig = {
  ref_id: "rc-deduplication",
  source_type: "deduplication",
  kind: "janitor" as const,
  enabled: false,
  cadence: "0 * * * *",
  workflow_id: "mock-gm-workflow-id",
  namespace: "mock",
  label: "Deduplication",
}

describe("JanitorSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders toggle from getCronConfig({ kind: 'janitor' })", async () => {
    const { getCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({ configs: [mockJanitorConfig] })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

    render(<JanitorSettings open={true} />)

    // Should render the deduplication row
    expect(await screen.findByText("Deduplication")).toBeInTheDocument()
    // Should call getCronConfig with kind=janitor
    expect(getCronConfig).toHaveBeenCalledWith({ kind: "janitor" })
  })

  it("optimistic toggle reverts on updateCronConfig failure", async () => {
    const { getCronConfig, updateCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [{ ...mockJanitorConfig, enabled: false }],
    })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })
    vi.mocked(updateCronConfig).mockRejectedValue(new Error("Network error"))

    const user = userEvent.setup()
    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const toggle = screen.getByRole("switch")
    // Initially unchecked (enabled: false)
    expect(toggle).not.toBeChecked()

    // Click toggle → optimistic update sets it to checked
    await user.click(toggle)

    // After rejection, load() is called → getCronConfig called again (revert)
    await waitFor(() => {
      expect(getCronConfig).toHaveBeenCalledTimes(2)
    })
  })

  it("Run now button calls runCron('deduplication')", async () => {
    const { getCronConfig, getCronRuns, runCron } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({ configs: [mockJanitorConfig] })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })
    vi.mocked(runCron).mockResolvedValue({
      run: {
        ref_id: "run-new",
        source_type: "deduplication",
        kind: "janitor",
        status: "pending",
        trigger: "MANUAL",
        created_at: Date.now() / 1000,
      },
    })

    const user = userEvent.setup()
    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const runBtn = screen.getByRole("button", { name: /run now/i })
    await user.click(runBtn)

    expect(runCron).toHaveBeenCalledWith("deduplication")
  })

  it("shows spinner while RUNNING run exists and disables Run now button", async () => {
    const { getCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({ configs: [mockJanitorConfig] })
    vi.mocked(getCronRuns).mockResolvedValue({
      runs: [
        {
          ref_id: "run-active",
          source_type: "deduplication",
          kind: "janitor",
          status: "in_progress",
          trigger: "SCHEDULED",
          created_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
        },
      ],
    })

    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    // Button should be disabled when RUNNING
    const runBtn = screen.getByRole("button")
    await waitFor(() => {
      expect(runBtn).toBeDisabled()
    })
  })

  it("silent skip: 409 from runCron does not show error", async () => {
    const { getCronConfig, getCronRuns, runCron } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({ configs: [mockJanitorConfig] })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })
    const err409 = Object.assign(new Error("Conflict"), { status: 409 })
    vi.mocked(runCron).mockRejectedValue(err409)

    const user = userEvent.setup()
    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const runBtn = screen.getByRole("button", { name: /run now/i })
    await user.click(runBtn)

    // No error message should appear
    await waitFor(() => {
      expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    })

    // Button should re-enable
    await waitFor(() => {
      expect(runBtn).not.toBeDisabled()
    })
  })

  it("shows error state with retry button on load failure", async () => {
    const { getCronConfig } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockRejectedValue(new Error("Server error"))

    const user = userEvent.setup()
    render(<JanitorSettings open={true} />)

    // Error message and retry button should appear
    expect(await screen.findByText("Server error")).toBeInTheDocument()
    const retryBtn = screen.getByRole("button", { name: /retry/i })
    expect(retryBtn).toBeInTheDocument()

    // Clicking retry re-fetches
    vi.mocked(getCronConfig).mockRejectedValue(new Error("Server error"))
    await user.click(retryBtn)
    await waitFor(() => {
      expect(getCronConfig).toHaveBeenCalledTimes(2)
    })
  })

  it("dropdown renders with correct preset value for known cadence", async () => {
    const { getCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [{ ...mockJanitorConfig, enabled: true, cadence: "0 * * * *" }],
    })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const select = screen.getByRole("combobox") as HTMLSelectElement
    expect(select.value).toBe("0 * * * *")
  })

  it("changing dropdown calls updateCronConfig with new cadence", async () => {
    const { getCronConfig, updateCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [{ ...mockJanitorConfig, enabled: true, cadence: "0 * * * *" }],
    })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })
    vi.mocked(updateCronConfig).mockResolvedValue({
      config: { ...mockJanitorConfig, enabled: true, cadence: "0 */6 * * *" },
    } as never)

    const user = userEvent.setup()
    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const select = screen.getByRole("combobox")
    await user.selectOptions(select, "0 */6 * * *")

    expect(updateCronConfig).toHaveBeenCalledWith("deduplication", { cadence: "0 */6 * * *" })
  })

  it("unknown stored cadence snaps to fallback and does NOT call updateCronConfig on mount", async () => {
    const { getCronConfig, updateCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [{ ...mockJanitorConfig, enabled: true, cadence: "5 4 * * *" }],
    })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const select = screen.getByRole("combobox") as HTMLSelectElement
    expect(select.value).toBe("0 */6 * * *")
    expect(updateCronConfig).not.toHaveBeenCalled()
  })

  it("dropdown is disabled when janitor is disabled", async () => {
    const { getCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [{ ...mockJanitorConfig, enabled: false, cadence: "0 * * * *" }],
    })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

    render(<JanitorSettings open={true} />)

    await screen.findByText("Deduplication")

    const select = screen.getByRole("combobox") as HTMLSelectElement
    expect(select.disabled).toBe(true)
  })

  it("renders three JanitorRow labels from config.label", async () => {
    const { getCronConfig, getCronRuns } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [
        { ...mockJanitorConfig, source_type: "deduplication", label: "Deduplication" },
        { ...mockJanitorConfig, ref_id: "rc-content-review", source_type: "content_review" as const, label: "Content review" },
        { ...mockJanitorConfig, ref_id: "rc-topic-review", source_type: "topic_review" as const, label: "Topic review" },
      ],
    })
    vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

    render(<JanitorSettings open={true} />)

    expect(await screen.findByText("Deduplication")).toBeInTheDocument()
    expect(await screen.findByText("Content review")).toBeInTheDocument()
    expect(await screen.findByText("Topic review")).toBeInTheDocument()
  })
})
