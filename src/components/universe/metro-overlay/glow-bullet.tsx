"use client"

export function GlowBullet({
  glow,
  glyph,
  size = 14,
}: {
  glow: string
  glyph?: string
  size?: number
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at center, #060709 0%, #060709 38%, #0c0e14 70%)",
        boxShadow: `
          inset 0 0 4px ${glow},
          0 0 0 1px ${glow}66,
          0 0 6px ${glow}aa,
          0 0 14px ${glow}55
        `,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.55),
        color: glow,
        textShadow: `0 0 3px ${glow}`,
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  )
}
