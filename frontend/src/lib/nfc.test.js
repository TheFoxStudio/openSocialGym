import { afterEach, describe, expect, it, vi } from 'vitest'
import { nfcSupport, writeTag, writeErrorCode, _resetNfcForTests } from './nfc.js'

afterEach(() => { delete globalThis.NDEFReader; _resetNfcForTests() })

describe('writeErrorCode', () => {
  it('keeps the plugins’ own codes and reads Web NFC’s errors', () => {
    expect(writeErrorCode({ code: 'too-small' })).toBe('too-small')
    expect(writeErrorCode({ name: 'AbortError' })).toBe('cancelled')
    expect(writeErrorCode({ name: 'NotAllowedError' })).toBe('denied')
    expect(writeErrorCode({ name: 'NotSupportedError' })).toBe('unsupported')
    expect(writeErrorCode('NFC is disabled')).toBe('disabled')
    expect(writeErrorCode(new Error('tag lost'))).toBe('failed')
  })
})

describe('Web NFC (Chrome on Android)', () => {
  it('is off without NDEFReader, as in every other browser', async () => {
    expect(await nfcSupport()).toEqual({ supported: false, enabled: false })
  })

  it('writes the link as one url record', async () => {
    const write = vi.fn(() => Promise.resolve())
    globalThis.NDEFReader = function NDEFReader() { this.write = write }
    expect((await nfcSupport()).supported).toBe(true)
    await writeTag('https://gym.orktork.space/nfc?do=start')
    expect(write.mock.calls[0][0]).toEqual({ records: [{ recordType: 'url', data: 'https://gym.orktork.space/nfc?do=start' }] })
  })

  it('rejects with a code the sheet understands', async () => {
    globalThis.NDEFReader = function NDEFReader() { this.write = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) }
    await expect(writeTag('https://gym.orktork.space/nfc?do=start')).rejects.toMatchObject({ code: 'denied' })
  })
})

it('scans existing tags read-only and cancels replaced readers',async()=>{
 const {startTagScan}=await import('./nfc.js'),readers=[];
 globalThis.NDEFReader=function(){this.events={};this.addEventListener=(k,cb)=>this.events[k]=cb;this.scan=vi.fn(async opts=>{this.signal=opts.signal});this.write=vi.fn();readers.push(this)};
 const first=vi.fn(),second=vi.fn();const stopFirst=await startTagScan(first);await startTagScan(second,{once:true});
 expect(readers[0].signal.aborted).toBe(true);
 readers[0].events.reading({serialNumber:'0102',message:{records:[]}});expect(first).not.toHaveBeenCalled();
 readers[1].events.reading({serialNumber:'0304',message:{records:[{recordType:'url',data:new TextEncoder().encode('gymapp://machine/5')}]}});
 expect(second).toHaveBeenCalledWith({serialNumber:'0304',urls:['gymapp://machine/5']});expect(readers[1].signal.aborted).toBe(true);
 expect(readers.every(r=>r.write.mock.calls.length===0)).toBe(true);await stopFirst();
});
