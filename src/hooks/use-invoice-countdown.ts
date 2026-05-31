"use client"

import { useState, useEffect } from "react"

export function useInvoiceCountdown(
  expiresAt: number | null
): { secondsLeft: number; expired: boolean } {
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    expiresAt ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000)) : 0
  )

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => setSecondsLeft(Math.max(0, expiresAt - Math.floor(Date.now() / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return { secondsLeft, expired: expiresAt !== null && secondsLeft === 0 }
}
