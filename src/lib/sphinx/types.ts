export interface IsAdminResponse {
  isAdmin: boolean
  isPublic: boolean
  isMember: boolean
  trendingTopics: boolean
  queuedSources: boolean
  customSchema: boolean
  realtimeGraph: boolean
  chatInterface: boolean
  swarmUiUrl?: string
}

export interface SignedMessage {
  message: string
  signature: string
}
