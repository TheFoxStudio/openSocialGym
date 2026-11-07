import{afterEach,it,expect,vi}from'vitest'
const h=vi.hoisted(()=>({platform:'android',callbacks:{},plugin:{}}))
vi.mock('./mobile.js',()=>({MOBILE:true}))
vi.mock('./platform-now.js',()=>({platformNow:()=>h.platform}))
vi.mock('@capacitor/core',()=>({registerPlugin:()=>h.plugin}))
import{startTagScan,_resetNfcForTests,tagScanActive}from'./nfc.js'
afterEach(()=>{_resetNfcForTests();vi.clearAllMocks()})
it('subscribes before Android reader mode, removes listeners on pause and ignores late tags',async()=>{
 h.platform='android';h.callbacks={};const remove=vi.fn();h.plugin={addListener:vi.fn(async(name,cb)=>{h.callbacks[name]=cb;return{remove}}),startScan:vi.fn(async()=>{expect(h.callbacks.scan).toBeTypeOf('function')}),cancel:vi.fn(async()=>{})};
 const read=vi.fn(),ended=vi.fn();await startTagScan(read,{onEnd:ended});h.callbacks.scan({serialNumber:'0102',urls:[]});expect(read).toHaveBeenCalledTimes(1);
 h.callbacks.scanStopped();expect(ended).toHaveBeenCalledOnce();expect(tagScanActive()).toBe(false);expect(remove).toHaveBeenCalledTimes(2);
 h.callbacks.scan({serialNumber:'0102',urls:[]});expect(read).toHaveBeenCalledTimes(1);
})
it('uses an explicit one-shot iPhone read session and cancels a waiting scan',async()=>{
 h.platform='ios';let resolve;h.plugin={read:vi.fn(()=>new Promise(r=>{resolve=r})),cancel:vi.fn(async()=>{})};
 const read=vi.fn(),ended=vi.fn();await startTagScan(read,{onEnd:ended});resolve({serialNumber:'',urls:['gymapp://machine/1']});await Promise.resolve();expect(read).toHaveBeenCalledOnce();expect(ended).toHaveBeenCalledOnce();
 const stop=await startTagScan(read);await stop();resolve({urls:['gymapp://late']});await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);expect(h.plugin.cancel).toHaveBeenCalledOnce();
})
