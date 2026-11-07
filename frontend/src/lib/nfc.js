// NFC stickers, the device side (what a sticker says and does: lib/nfc-tags.js).
//
// Phone app: NfcTagsPlugin (ios/App/App/NfcTagsPlugin.swift with Core NFC, android/.../
// NfcTagsPlugin.java with the NfcAdapter's reader mode) writes a sticker. Reading needs nothing
// running: Android starts the app for one of our links (the NDEF_DISCOVERED filter in the
// manifest, delivered by the plugin's `open` event), iOS reads stickers in the background and
// the link comes back as opengym://nfc?... through @capacitor/app's appUrlOpen.
// Web: Web NFC (NDEFReader), which only Chrome on Android has. It writes, and reads while the page
// is open and the site already has the NFC permission (asked when you first write a sticker).
// Anywhere else nfcSupport() answers false and the NFC rows stay away.
//
// Existing machine tags are read only during an explicit foreground scan; their URLs are never opened.
// Assignment reads are separate from the existing blank-sticker writing feature.
import { MOBILE } from './mobile.js'
import { platformNow } from './platform-now.js'

// Kept inside an object: a Capacitor plugin proxy answers `then` with a native call that never
// settles, so a promise resolved with the bare proxy would hang (the Coach hang, #42).
let pluginP = null
const nfcPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || !platformNow()) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { p: registerPlugin('NfcTags') }
})().catch(() => null))

const webNfc = () => !MOBILE && typeof globalThis.NDEFReader === 'function' && globalThis.isSecureContext !== false

/** { supported, enabled }: whether this device can write a sticker at all, and NFC is on.
 *  `supported` cannot change while the app runs, so a positive answer is asked once. */
let supportP = null
export function nfcSupport() {
  if (!supportP) supportP = askSupport().then(r => { if (!r.supported) supportP = null; return r })
  return supportP
}
async function askSupport() {
  if (webNfc()) return { supported: true, enabled: true, web: true }
  try {
    const w = await nfcPlugin()
    if (!w) return { supported: false, enabled: false }
    const r = await w.p.isAvailable()
    return { supported: !!r?.supported, enabled: r?.enabled !== false }
  } catch {
    return { supported: false, enabled: false }
  }
}

/** Why a write did not happen, as the plugins and Web NFC report it. */
export const WRITE_ERRORS = ['cancelled', 'read-only', 'too-small', 'disabled', 'denied', 'unsupported', 'failed']
export const writeErrorCode = e => {
  if (WRITE_ERRORS.includes(e?.code)) return e.code
  // Web NFC's DOMExceptions, and a bare string from a plugin.
  const s = String(e?.name || e?.message || e || '')
  if (/cancel|abort/i.test(s)) return 'cancelled'
  if (/read.?only/i.test(s)) return 'read-only'
  if (/too.?small/i.test(s)) return 'too-small'
  if (/disabled/i.test(s)) return 'disabled'
  if (/NotAllowed|permission/i.test(s)) return 'denied'
  if (/unsupported|NotSupported/i.test(s)) return 'unsupported'
  return 'failed'
}

let webAbort = null

/**
 * Writes `url` as the sticker's one record. iOS shows its own sheet with `alert` and `done`;
 * Android and the web wait for the sticker with the page's own sheet up. Resolves when written,
 * rejects with an Error whose `code` is one of writeErrorCode's.
 */
export async function writeTag(url, { alert = '', done = '' } = {}) {
  const fail = e => { const err = new Error(String(e?.message || e)); err.code = writeErrorCode(e); throw err }
  if (webNfc()) {
    webAbort?.abort()
    webAbort = typeof AbortController === 'function' ? new AbortController() : null
    try {
      await new globalThis.NDEFReader().write({ records: [{ recordType: 'url', data: url }] }, webAbort ? { signal: webAbort.signal, overwrite: true } : { overwrite: true })
      return true
    } catch (e) { fail(e) } finally { webAbort = null }
  }
  const w = await nfcPlugin()
  if (!w) fail('unsupported')
  try {
    await w.p.write({ url, alert, done })
    return true
  } catch (e) { fail(e) }
}

/** Stops a write still waiting for its sticker (the sheet's Cancel). */
export async function cancelWrite() {
  if (webAbort) { webAbort.abort(); webAbort = null; return }
  try { const w = await nfcPlugin(); await w?.p.cancel?.() } catch { /* nothing waiting */ }
}

const urlOf = rec => {
  try {
    if (rec?.recordType !== 'url' && rec?.recordType !== 'absolute-url') return null
    return new TextDecoder().decode(rec.data)
  } catch { return null }
}

/**
 * Calls `cb(url)` for every link that opened the app or was read from a sticker: the cold start
 * one too (the native events are kept until a listener is there). Returns a function that stops.
 */
export function onTagLink(cb) {
  const handles = []
  let gone = false
  const keep = h => { if (gone) h?.remove?.(); else handles.push(h) }
  if (MOBILE) {
    import('@capacitor/app').then(({ App }) =>
      Promise.resolve(App.addListener('appUrlOpen', e => { if (e?.url) cb(String(e.url)) })).then(keep)).catch(() => {})
    nfcPlugin().then(w => {
      if (!w || platformNow() !== 'android') return
      return Promise.resolve(w.p.addListener('open', e => { if (e?.url) cb(String(e.url)) })).then(keep)
    }).catch(() => {})
  } else if (webNfc()) {
    // Only with the permission already given: a scan() that would ask has to come from a tap.
    let ctrl = typeof AbortController === 'function' ? new AbortController() : null
    keep({ remove: () => ctrl?.abort() })
    Promise.resolve(globalThis.navigator?.permissions?.query?.({ name: 'nfc' })).then(st => {
      if (gone || st?.state !== 'granted') return
      const reader = new globalThis.NDEFReader()
      reader.addEventListener('reading', ev => {
        if (webAbort||tagScanActive()) return // a write is on: the sticker is being written, not read
        for (const rec of ev?.message?.records || []) { const u = urlOf(rec); if (u) { cb(u); break } }
      })
      return reader.scan(ctrl ? { signal: ctrl.signal } : undefined)
    }).catch(() => {})
  }
  return () => { gone = true; handles.splice(0).forEach(h => { try { h?.remove?.() } catch { /* gone already */ } }) }
}

export function _resetNfcForTests() { pluginP = null; webAbort = null; supportP = null }

// An explicit reader owns NFC until stopped. Assignment and workout reading never
// race each other or the legacy link reader, and no scanned link is navigated.
let readOwner=null
export const tagScanActive=()=>!!readOwner
export async function startTagScan(onRead,{once=false,onError=()=>{},onEnd=()=>{}}={}){
 while(readOwner)await readOwner()
 let ended=false,ctrl=null,handle=null,endHandle=null,native=null,stop,stopping=null
 const finish=()=>{if(ended)return;ended=true;if(readOwner===stop)readOwner=null;ctrl?.abort();handle?.remove?.();endHandle?.remove?.();onEnd()}
 stop=()=>{
  if(stopping)return stopping
  if(ended)return Promise.resolve()
  ended=true;ctrl?.abort();handle?.remove?.();endHandle?.remove?.();onEnd()
  stopping=(async()=>{try{if(native)await native.cancel()}catch{}finally{if(readOwner===stop)readOwner=null}})()
  return stopping
 }
 readOwner=stop
 const deliver=raw=>{if(ended)return;onRead(raw);if(once)stop()}
 try{
  if(webNfc()){
   ctrl=new AbortController();const reader=new globalThis.NDEFReader()
   reader.addEventListener('reading',ev=>{if(ended)return;const urls=[];for(const record of ev?.message?.records||[]){const url=urlOf(record);if(url)urls.push(url)};deliver({serialNumber:ev.serialNumber||'',urls})})
   reader.addEventListener('readingerror',()=>{if(!ended)onError(Object.assign(Error('Could not read tag'),{code:'failed'}))})
   await reader.scan({signal:ctrl.signal})
  }else{
   const w=await nfcPlugin();if(!w)throw Object.assign(Error('NFC unavailable'),{code:'unsupported'})
   if(ended)return stop
   native=w.p
   if(platformNow()==='android'){
    handle=await native.addListener('scan',deliver)
    if(ended){handle.remove();return stop}
    endHandle=await native.addListener('scanStopped',finish)
    if(ended){endHandle.remove();return stop}
    await native.startScan()
   }else{
    // Core NFC is a foreground, user-started session and resolves one tag.
    native.read({alert:'Hold the top of your iPhone near the machine tag.'}).then(raw=>{deliver(raw);finish()}).catch(e=>{if(!ended){onError(e);finish()}})
   }
  }
 }catch(e){await stop();const err=Object.assign(new Error(e.message||'NFC failed'),{code:writeErrorCode(e)});throw err}
 if(ended)await stop()
 return stop
}
