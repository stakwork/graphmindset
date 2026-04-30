import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// We need to extract the helpers — re-import from the module
// Since they're not exported, we test them indirectly via the component,
// but we also inline-test the logic here.

// ---- inline snapToPreset logic (mirrors the implementation) ----
const CADENCE_PRESETS = [
  { label: "Every 10 minutes", value: "*/10 * * * *" },
  { label: "Every hour",       value: "0 * * * *" },
  { label: "Every 3 hours",    value: "0 */3 * * *" },
  { label: "Every 6 hours",    value: "0 */6 * * *" },
  { label: "Every 12 hours",   value: "0 */12 * * *" },
  { label: "Weekly",           value: "0 0 * * 0" },
]

function snapToPreset(cron: string): string {
  const match = CADENCE_PRESETS.find((p) => p.value === cron)
  if (match) return cron
  return "0 */6 * * *"
}

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
  getRadarConfig: vi.fn(),
  updateRadarConfig: vi.fn(),
  runRadarNow: vi.fn(),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: vi.fn(() => true),
  MOCK_RADAR_CONFIGS: [
    {
      source_type: "twitter_handle",
      enabled: true,
      cadence: "*/10 * * * *",
      updated_at: undefined,
    },
    {
      source_type: "rss",
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
    const { isMocksEnabled, MOCK_RADAR_CONFIGS: _ } = await import("@/lib/mock-data")
    const { updateRadarConfig } = await import("@/lib/graph-api")

    // Override mock to return an unknown cron
    vi.mocked(isMocksEnabled).mockReturnValue(false)
    const { getRadarConfig } = await import("@/lib/graph-api")
    vi.mocked(getRadarConfig).mockResolvedValue({
      configs: [
        {
          source_type: "twitter_handle",
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
    // updateRadarConfig should NOT have been called on mount
    expect(updateRadarConfig).not.toHaveBeenCalled()
  })

  it("calls onUpdate with correct cron value when user changes selection", async () => {
    const { updateRadarConfig } = await import("@/lib/graph-api")
    const { isMocksEnabled } = await import("@/lib/mock-data")
    vi.mocked(isMocksEnabled).mockReturnValue(false)

    const { getRadarConfig } = await import("@/lib/graph-api")
    vi.mocked(getRadarConfig).mockResolvedValue({
      configs: [
        {
          source_type: "twitter_handle",
          enabled: true,
          cadence: "*/10 * * * *",
          updated_at: undefined,
        },
      ],
    } as never)
    vi.mocked(updateRadarConfig).mockResolvedValue({
      config: {
        source_type: "twitter_handle",
        enabled: true,
        cadence: "0 * * * *",
        updated_at: undefined,
      },
    } as never)

    const user = userEvent.setup()
    render(<RadarSettings open={true} />)

    const selects = await screen.findAllByRole("combobox")
    await user.selectOptions(selects[0], "0 * * * *")

    expect(updateRadarConfig).toHaveBeenCalledWith("twitter_handle", { cadence: "0 * * * *" })
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
