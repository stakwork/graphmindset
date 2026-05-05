import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CADENCE_PRESETS, snapToPreset } from "@/lib/cadence-presets"

// ---- Unit tests for snapToPreset ----
describe("snapToPreset", () => {
  it("returns exact cron for known presets", () => {
    expect(snapToPreset("*/10 * * * *")).toBe("*/10 * * * *")
    expect(snapToPreset("0 * * * *")).toBe("0 * * * *")
    expect(snapToPreset("0 */3 * * *")).toBe("0 */3 * * *")
    expect(snapToPreset("0 */6 * * *")).toBe("0 */6 * * *")
    expect(snapToPreset("0 */12 * * *")).toBe("0 */12 * * *")
    expect(snapToPreset("0 0 * * 0")).toBe("0 0 * * 0")
  })

  it("returns fallback (Every 6 hours) for unknown cron strings", () => {
    expect(snapToPreset("5 4 * * *")).toBe("0 */6 * * *")
    expect(snapToPreset("")).toBe("0 */6 * * *")
    expect(snapToPreset("@daily")).toBe("0 */6 * * *")
    expect(snapToPreset("0 2 * * 1")).toBe("0 */6 * * *")
  })
})

// ---- Component tests ----
// Mock modules before importing the component
vi.mock("@/lib/graph-api", () => ({
  getCronConfig: vi.fn(),
  updateCronConfig: vi.fn(),
  runCron: vi.fn(),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: vi.fn(() => true),
  MOCK_CRON_CONFIGS: [
    {
      source_type: "twitter_handle",
      kind: "source",
      enabled: true,
      cadence: "*/10 * * * *",
      updated_at: undefined,
    },
    {
      source_type: "rss",
      kind: "source",
      enabled: false,
      cadence: "0 */12 * * *",
      updated_at: undefined,
    },
  ],
}))

import { RadarSettings } from "@/components/modals/radar-settings"

describe("RadarRow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders a dropdown with the correct preset selected for a known cadence", async () => {
    render(<RadarSettings open={true} />)

    // Wait for the rows to appear
    const selects = await screen.findAllByRole("combobox")
    expect(selects.length).toBeGreaterThan(0)

    // Twitter row has cadence "*/10 * * * *" → "Every 10 minutes"
    const twitterSelect = selects[0] as HTMLSelectElement
    expect(twitterSelect.value).toBe("*/10 * * * *")
  })

  it("shows fallback preset for unknown cadence and does NOT call onUpdate on mount", async () => {
    const { isMocksEnabled } = await import("@/lib/mock-data")
    const { updateCronConfig } = await import("@/lib/graph-api")

    // Override mock to return an unknown cron
    vi.mocked(isMocksEnabled).mockReturnValue(false)
    const { getCronConfig } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [
        {
          source_type: "twitter_handle",
          kind: "source",
          enabled: true,
          cadence: "5 4 * * *", // unknown cron
          updated_at: undefined,
        },
      ],
    } as never)

    render(<RadarSettings open={true} />)

    const selects = await screen.findAllByRole("combobox")
    const select = selects[0] as HTMLSelectElement
    // Should snap to fallback "Every 6 hours"
    expect(select.value).toBe("0 */6 * * *")
    // updateCronConfig should NOT have been called on mount
    expect(updateCronConfig).not.toHaveBeenCalled()
  })

  it("calls onUpdate with correct cron value when user changes selection", async () => {
    const { updateCronConfig } = await import("@/lib/graph-api")
    const { isMocksEnabled } = await import("@/lib/mock-data")
    vi.mocked(isMocksEnabled).mockReturnValue(false)

    const { getCronConfig } = await import("@/lib/graph-api")
    vi.mocked(getCronConfig).mockResolvedValue({
      configs: [
        {
          source_type: "twitter_handle",
          kind: "source",
          enabled: true,
          cadence: "*/10 * * * *",
          updated_at: undefined,
        },
      ],
    } as never)
    vi.mocked(updateCronConfig).mockResolvedValue({
      config: {
        source_type: "twitter_handle",
        kind: "source",
        enabled: true,
        cadence: "0 * * * *",
        updated_at: undefined,
      },
    } as never)

    const user = userEvent.setup()
    render(<RadarSettings open={true} />)

    const selects = await screen.findAllByRole("combobox")
    await user.selectOptions(selects[0], "0 * * * *")

    expect(updateCronConfig).toHaveBeenCalledWith("twitter_handle", { cadence: "0 * * * *" })
  })

  it("disables dropdown and Run now button when source is disabled", async () => {
    const { isMocksEnabled } = await import("@/lib/mock-data")
    vi.mocked(isMocksEnabled).mockReturnValue(true)

    render(<RadarSettings open={true} />)

    // The RSS row (index 1) has enabled: false
    const selects = await screen.findAllByRole("combobox")
    expect((selects[1] as HTMLSelectElement).disabled).toBe(true)

    const buttons = screen.getAllByRole("button", { name: /run now/i })
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
  })
})
