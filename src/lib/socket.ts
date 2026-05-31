import { io, Socket } from 'socket.io-client'
import { API_URL } from './api'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (typeof window === 'undefined') throw new Error('Socket not available in SSR')
  if (!socket) {
    const url = API_URL.replace(/\/api$/, '')
    socket = io(url, { transports: ['websocket'], autoConnect: true })
  }
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}
