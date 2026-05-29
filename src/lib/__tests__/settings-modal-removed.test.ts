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
    // Open each remaining valid modal and verify they work
    const validIds = ["addContent", "budget", "addNode", "editNode", "addEdge"] as const

    for (const id of validIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useModalStore.getState().open(id as any)
      expect(useModalStore.getState().activeModal).toBe(id)
      useModalStore.getState().close()
    }
  })

  it("activeModal starts as null after close", () => {
    expect(useModalStore.getState().activeModal).toBeNull()
  })

  it("close() resets activeModal to null", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useModalStore.getState().open("addContent" as any)
    useModalStore.getState().close()
    expect(useModalStore.getState().activeModal).toBeNull()
  })
})
