const EVENT = 'opengym-social-changed'
export function socialChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(EVENT))
  try { const channel = new BroadcastChannel(EVENT); channel.postMessage('invalidate'); channel.close() } catch {}
}
export function onSocialChange(callback) {
  window.addEventListener(EVENT, callback)
  let channel
  try { channel = new BroadcastChannel(EVENT); channel.onmessage = callback } catch {}
  return () => { window.removeEventListener(EVENT, callback); channel?.close() }
}
