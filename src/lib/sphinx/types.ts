export interface IsAdminResponse {
  isAdmin: boolean
  isPublic: boolean
  isMember: boolean
}

export interface SignedMessage {
  message: string
  signature: string
}
