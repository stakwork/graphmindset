import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MultiSelectCustom } from "@/components/ui/multi-select-custom"

const options = [
  { value: "name", label: "name" },
  { value: "timestamp", label: "timestamp" },
  { value: "episode_title", label: "episode_title", disabled: true },
]

describe("MultiSelectCustom", () => {
  it("shows placeholder when no values selected", () => {
    render(
      <MultiSelectCustom value={[]} onChange={vi.fn()} options={options} placeholder="Pick attrs" />
    )
    expect(screen.getByText("Pick attrs")).toBeTruthy()
  })

  it("shows comma-joined labels for selected values", () => {
    render(
      <MultiSelectCustom value={["name", "timestamp"]} onChange={vi.fn()} options={options} />
    )
    expect(screen.getByText("name, timestamp")).toBeTruthy()
  })

  it("opens dropdown on trigger click", async () => {
    render(
      <MultiSelectCustom value={[]} onChange={vi.fn()} options={options} />
    )
    await userEvent.click(screen.getByRole("button"))
    expect(screen.getByText("name")).toBeTruthy()
    expect(screen.getByText("timestamp")).toBeTruthy()
  })

  it("toggles an option on — calls onChange with added value", async () => {
    const onChange = vi.fn()
    render(
      <MultiSelectCustom value={[]} onChange={onChange} options={options} />
    )
    await userEvent.click(screen.getByRole("button")) // open
    const nameBtn = screen.getAllByRole("button").find((b) => b.textContent?.includes("name") && !b.textContent?.includes("episode"))!
    await userEvent.click(nameBtn)
    expect(onChange).toHaveBeenCalledWith(["name"])
  })

  it("toggles an option off — calls onChange with value removed", async () => {
    const onChange = vi.fn()
    render(
      <MultiSelectCustom value={["name", "timestamp"]} onChange={onChange} options={options} />
    )
    await userEvent.click(screen.getByRole("button")) // open
    // The trigger shows "name, timestamp"; the dropdown option for "name" does NOT contain "timestamp"
    const nameBtn = screen.getAllByRole("button").find(
      (b) => b.textContent?.includes("name") && !b.textContent?.includes("timestamp") && !b.textContent?.includes("episode")
    )!
    await userEvent.click(nameBtn)
    expect(onChange).toHaveBeenCalledWith(["timestamp"])
  })

  it("does not call onChange when a disabled option is clicked", async () => {
    const onChange = vi.fn()
    render(
      <MultiSelectCustom value={[]} onChange={onChange} options={options} />
    )
    await userEvent.click(screen.getByRole("button")) // open
    const disabledBtn = screen.getByText("episode_title").closest("button")!
    await userEvent.click(disabledBtn)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("renders hint text beside option label when hint is provided", async () => {
    const optionsWithHint = [
      { value: "source_link", label: "source_link", hint: "from Show" },
    ]
    render(
      <MultiSelectCustom value={[]} onChange={vi.fn()} options={optionsWithHint} />
    )
    await userEvent.click(screen.getByRole("button"))
    expect(screen.getByText("from Show")).toBeTruthy()
  })
})
