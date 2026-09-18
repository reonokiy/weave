import type { Session } from './types'
import { normalizeOrigin } from './api'

export function streamUrl(origin: string, local: boolean) {
  const url = new URL('/api/v1/streaming', normalizeOrigin(origin))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('stream', local ? 'public:local' : 'user')
  return url.href
}

export function connectStream(session: Session, local: boolean, event: (type: string, payload: string) => void, state: (connected: boolean) => void) {
  let stopped = false
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = 1000
  function connect() {
    if (stopped) return
    try {
      // GoToSocial accepts the token as a websocket subprotocol, avoiding query-string credentials.
      socket = new WebSocket(streamUrl(session.origin, local), session.token)
      socket.onopen = () => { if (!stopped) { delay = 1000; state(true) } }
      socket.onmessage = message => {
        if (stopped) return
        try { const data = JSON.parse(message.data); if (typeof data.event === 'string') event(data.event, typeof data.payload === 'string' ? data.payload : '') } catch { /* Ignore malformed stream events. */ }
      }
      socket.onclose = () => { if (!stopped) { state(false); timer = setTimeout(connect, delay); delay = Math.min(delay * 2, 30000) } }
      socket.onerror = () => { if (!stopped) { state(false); socket?.close() } }
    } catch { state(false) }
  }
  connect()
  return () => { stopped = true; clearTimeout(timer); socket?.close() }
}
