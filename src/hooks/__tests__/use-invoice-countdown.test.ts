import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useInvoiceCountdown } from "@/hooks/use-invoice-countdown"

describe("useInvoiceCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns secondsLeft=0 and expired=false when expiresAt is null", () => {
    const { result } = renderHook(() => useInvoiceCountdown(null))
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.expired).toBe(false)
  })

  it("returns correct secondsLeft for a future expiresAt", () => {
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 120

    const { result } = renderHook(() => useInvoiceCountdown(expiresAt))
    expect(result.current.secondsLeft).toBe(120)
    expect(result.current.expired).toBe(false)
  })

  it("decrements secondsLeft each second", () => {
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 10

    const { result } = renderHook(() => useInvoiceCountdown(expiresAt))
    expect(result.current.secondsLeft).toBe(10)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current.secondsLeft).toBe(9)

    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.secondsLeft).toBe(6)
  })

  it("sets expired=true when secondsLeft reaches zero", () => {
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 2

    const { result } = renderHook(() => useInvoiceCountdown(expiresAt))
    expect(result.current.expired).toBe(false)

    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.expired).toBe(true)
  })

  it("clamps secondsLeft to 0 for already-expired invoices", () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 100
    const { result } = renderHook(() => useInvoiceCountdown(pastExpiry))
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.expired).toBe(true)
  })

  it("clears interval on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval")
    const now = Math.floor(Date.now() / 1000)
    const { unmount } = renderHook(() => useInvoiceCountdown(now + 60))

    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
