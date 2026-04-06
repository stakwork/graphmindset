"use client"

import { create } from "zustand"

interface FeatureFlags {
  trendingTopics: boolean
  queuedSources: boolean
  customSchema: boolean
  realtimeGraph: boolean
  chatInterface: boolean
  addItem: boolean
  addContent: boolean
  settings: boolean
}

interface FeatureFlagActions {
  setFlags: (flags: Partial<FeatureFlags>) => void
}

export type FeatureFlagStore = FeatureFlags & FeatureFlagActions

const defaults: FeatureFlags = {
  trendingTopics: false,
  queuedSources: false,
  customSchema: false,
  realtimeGraph: false,
  chatInterface: false,
  addItem: false,
  addContent: false,
  settings: false,
}

export const useFeatureFlagStore = create<FeatureFlagStore>((set) => ({
  ...defaults,
  setFlags: (flags) => set((s) => ({ ...s, ...flags })),
}))
