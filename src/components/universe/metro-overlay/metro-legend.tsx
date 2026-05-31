"use client"

import { GlowBullet } from "./glow-bullet"
import { STATION_GLOW, STATION_STATE_LABEL, type StationState } from "./constants"

export function MetroLegend({
  hoveredState,
  onHoverState,
}: {
  hoveredState: StationState | null
  onHoverState: (state: StationState | null) => void
}) {
  const stationStates: StationState[] = [
    "inhabited",
    "neutral",
    "anomaly",
    "scorched",
    "flood",
    "quarantine",
    "lost",
  ]
  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        width: 180,
        padding: "10px 12px 10px 12px",
        background:
          "linear-gradient(180deg, rgba(12,15,22,0.92) 0%, rgba(8,10,16,0.94) 100%)",
        border: "1px solid rgba(120, 100, 70, 0.22)",
        borderRadius: 6,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: "#d9d2c5",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', sans-serif",
        pointerEvents: "auto",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,160,0.04)",
        userSelect: "none",
      }}
      onMouseLeave={() => onHoverState(null)}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.32em",
          color: "#8a8275",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Stations
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {stationStates.map((state) => {
          const isHovered = hoveredState === state
          const isFaded = hoveredState !== null && !isHovered
          return (
            <div
              key={state}
              onMouseEnter={() => onHoverState(state)}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr",
                alignItems: "center",
                columnGap: 10,
                padding: "3px 6px",
                marginLeft: -6,
                marginRight: -6,
                borderRadius: 4,
                cursor: "pointer",
                background: isHovered ? "rgba(232,156,74,0.08)" : "transparent",
                opacity: isFaded ? 0.4 : 1,
                transition: "opacity 120ms, background 120ms",
              }}
            >
              <GlowBullet
                glow={STATION_GLOW[state]}
                glyph={state === "lost" ? "☠" : undefined}
              />
              <span
                style={{
                  fontSize: 11,
                  color: isHovered ? "#f5efde" : "#cfc7b5",
                  letterSpacing: "0.04em",
                }}
              >
                {STATION_STATE_LABEL[state]}
              </span>
            </div>
          )
        })}
      </div>

      <div
        style={{
          height: 1,
          marginTop: 10,
          background:
            "linear-gradient(90deg, rgba(170,130,80,0) 0%, rgba(170,130,80,0.3) 50%, rgba(170,130,80,0) 100%)",
        }}
      />

      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.32em",
          color: "#8a8275",
          textTransform: "uppercase",
          marginTop: 10,
          marginBottom: 6,
        }}
      >
        Tunnels
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "18px 1fr",
            alignItems: "center",
            columnGap: 10,
          }}
        >
          <div
            style={{
              width: 16,
              height: 2,
              background: "#d9d2c5",
              borderRadius: 1,
              boxShadow: "0 0 4px rgba(217,210,197,0.4)",
            }}
          />
          <span style={{ fontSize: 11, color: "#cfc7b5", letterSpacing: "0.04em" }}>
            Open
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "18px 1fr",
            alignItems: "center",
            columnGap: 10,
          }}
        >
          <div
            style={{
              width: 16,
              height: 2,
              background: "rgba(217,210,197,0.22)",
              borderRadius: 1,
            }}
          />
          <span style={{ fontSize: 11, color: "#807a6f", letterSpacing: "0.04em" }}>
            Blocked
          </span>
        </div>
      </div>
    </div>
  )
}
