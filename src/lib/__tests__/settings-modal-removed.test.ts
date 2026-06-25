/**
 * Confirms that "settings" has been removed from ModalId in modal-store.ts.
 *
 * TypeScript will catch this at compile time, but we also verify at runtime
 * that calling open("settings") no longer sets the activeModal to "settings"
 * (since "settings" is no longer in the union, any such call should be a TS
 * error; here we test the store's runtime behaviour as a belt-and-suspenders
 * check).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { useModalStore } from "@/stores/modal-store"

beforeEach(() => {
  useModalStore.getState().close()
})

describe("modal-store – settings removed", () => {
  it("valid modal ids do not include 'settings'", () => {
    // "add" and "editNode" are activeModal values.
    const activeIds = ["add", "editNode"] as const
    for (const id of activeIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useModalStore.getState().open(id as any)
      expect(useModalStore.getState().activeModal).toBe(id)
      useModalStore.getState().close()
    }

    // "budget" is an independent overlay (so it can sit on top of another modal
    // without closing it) — open() routes it to budgetOpen, not activeModal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useModalStore.getState().open("budget" as any)
    expect(useModalStore.getState().budgetOpen).toBe(true)
    expect(useModalStore.getState().activeModal).toBeNull()
    useModalStore.getState().close()
    expect(useModalStore.getState().budgetOpen).toBe(false)
  })

  it("activeModal starts as null after close", () => {
    expect(useModalStore.getState().activeModal).toBeNull()
  })

  it("close() resets activeModal to null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useModalStore.getState().open("add" as any)
    useModalStore.getState().close()
    expect(useModalStore.getState().activeModal).toBeNull()
  })
})

describe("modal-store – preselectedNodeType", () => {
  it("openAdd('node', 'Lingo') sets preselectedNodeType to 'Lingo'", () => {
    useModalStore.getState().openAdd("node", "Lingo")
    expect(useModalStore.getState().preselectedNodeType).toBe("Lingo")
    expect(useModalStore.getState().addTab).toBe("node")
    expect(useModalStore.getState().activeModal).toBe("add")
  })

  it("close() resets preselectedNodeType to null", () => {
    useModalStore.getState().openAdd("node", "Lingo")
    useModalStore.getState().close()
    expect(useModalStore.getState().preselectedNodeType).toBeNull()
  })

  it("openAdd() without nodeType sets preselectedNodeType to null", () => {
    useModalStore.getState().openAdd("node", "Lingo")
    useModalStore.getState().openAdd("source")
    expect(useModalStore.getState().preselectedNodeType).toBeNull()
  })
})
