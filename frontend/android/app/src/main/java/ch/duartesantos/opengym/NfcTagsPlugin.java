package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.nfc.FormatException;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;

/**
 * openGym's NFC stickers (lib/nfc.js, components/Nfc.jsx): writes one openGym link onto a sticker,
 * and passes on the link of a sticker that started or reached the app.
 *
 * Reading needs no session: the manifest's NDEF_DISCOVERED filter (https://gym.orktork.space/nfc...)
 * makes Android start the app for one of our stickers, with the app closed too, and the link goes
 * to the page as the `open` event (kept until the page listens, so a cold start arrives). An
 * opengym:// link from gym.orktork.space/nfc comes through the same way.
 *
 * Writing uses the adapter's reader mode while the page's sheet waits: the sticker comes straight
 * here, not to the system's tag dispatch, and is written as one NDEF URI record (a blank sticker
 * is NDEF-formatted first). startScan reads machine tag IDs and NDEF links without writing.
 *
 * Usage from JS:
 *   const NfcTags = registerPlugin('NfcTags')
 *   await NfcTags.isAvailable()               // { supported: true, enabled: true }
 *   await NfcTags.write({ url: 'https://gym.orktork.space/nfc?do=start' })
 *   await NfcTags.cancel()
 */
@CapacitorPlugin(name = "NfcTags")
public class NfcTagsPlugin extends Plugin {
    private volatile PluginCall pending;
    private volatile boolean scanning;
    private volatile int scanEpoch;

    @Override
    public void load() {
        Activity a = getActivity();
        if (a != null) passOn(a.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        passOn(intent);
    }

    /** Whether `uri` is one of the links openGym puts on a sticker (or gym.orktork.space/nfc hands over). */
    static boolean isOurLink(Uri uri) {
        if (uri == null || uri.getScheme() == null) return false;
        String scheme = uri.getScheme().toLowerCase();
        if (scheme.equals("opengym")) return true;
        if (!scheme.equals("https") && !scheme.equals("http")) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (host.startsWith("www.")) host = host.substring(4);
        String path = uri.getPath() == null ? "" : uri.getPath();
        return host.equals("gym.orktork.space") && (path.equals("/nfc") || path.equals("/nfc/") || path.equals("/nfc.html"));
    }

    private void passOn(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) && !Intent.ACTION_VIEW.equals(action)) return;
        Uri uri = intent.getData();
        if (!isOurLink(uri)) return;
        JSObject ev = new JSObject();
        ev.put("url", uri.toString());
        notifyListeners("open", ev, true);
    }

    private NfcAdapter adapter() {
        return getActivity() == null ? null : NfcAdapter.getDefaultAdapter(getActivity());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        NfcAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("supported", a != null);
        r.put("enabled", a != null && a.isEnabled());
        call.resolve(r);
    }

    /** Read-only foreground mode intercepts the gym app's tag without opening its URL. */
    @PluginMethod
    public void startScan(PluginCall call) {
        NfcAdapter a=adapter();
        if(a==null){call.reject("this phone has no NFC","unsupported");return;}
        if(!a.isEnabled()){call.reject("NFC is disabled","disabled");return;}
        Activity act=getActivity();
        act.runOnUiThread(()->{
            if(pending!=null){pending.reject("replaced by scan","cancelled");pending=null;}
            scanning=true;final int epoch=++scanEpoch;
            int flags=NfcAdapter.FLAG_READER_NFC_A|NfcAdapter.FLAG_READER_NFC_B|NfcAdapter.FLAG_READER_NFC_F|NfcAdapter.FLAG_READER_NFC_V;
            try {
                a.enableReaderMode(act,tag->readTag(tag,epoch),flags,null);call.resolve();
            }catch(RuntimeException e){scanning=false;call.reject("Could not start NFC reader","failed");}
        });
    }

    private void readTag(Tag tag,int epoch){
        if(!scanning||epoch!=scanEpoch)return;
        JSObject result=new JSObject();StringBuilder serial=new StringBuilder();
        for(byte b:tag.getId())serial.append(String.format("%02x",b&0xff));
        result.put("serialNumber",serial.toString());JSArray urls=new JSArray();
        Ndef ndef=Ndef.get(tag);
        if(ndef!=null){
            try {
                ndef.connect();NdefMessage message=ndef.getNdefMessage();
                if(message!=null)for(NdefRecord record:message.getRecords()){
                    Uri uri=record.toUri();if(uri!=null&&uri.toString().length()<=2048&&urls.length()<8)urls.put(uri.toString());
                }
            }catch(Exception ignored){ /* A readable UID can identify a tag without an NDEF URL. */ }
            finally{try{ndef.close();}catch(Exception ignored){}}
        }
        result.put("urls",urls);
        if(scanning&&epoch==scanEpoch)notifyListeners("scan",result);
    }

    private void endScan(){
        boolean wasScanning=scanning;scanning=false;scanEpoch++;
        if(wasScanning)notifyListeners("scanStopped",new JSObject());
    }

    @PluginMethod
    public void write(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty() || url.length() > 512) {
            call.reject("url is required", "failed");
            return;
        }
        NfcAdapter a = adapter();
        if (a == null) {
            call.reject("this phone has no NFC", "unsupported");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("NFC is disabled", "disabled");
            return;
        }
        final NdefMessage message = new NdefMessage(new NdefRecord[] { NdefRecord.createUri(url) });
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            if (pending != null) pending.reject("replaced by a newer write", "cancelled");
            endScan();
            pending = call;
            int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F
                    | NfcAdapter.FLAG_READER_NFC_V | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
            a.enableReaderMode(act, tag -> writeTo(tag, message, call), flags, null);
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        endScan();
        stopReader();
        if (pending != null) {
            pending.reject("cancelled", "cancelled");
            pending = null;
        }
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if(scanning){endScan();stopReader();}
        // Reader mode belongs to a resumed activity; a write left waiting ends with it.
        if (pending != null) {
            stopReader();
            pending.reject("cancelled", "cancelled");
            pending = null;
        }
    }

    private void stopReader() {
        Activity act = getActivity();
        NfcAdapter a = adapter();
        if (act == null || a == null) return;
        act.runOnUiThread(() -> {
            try { a.disableReaderMode(act); } catch (Exception ignored) { /* not on */ }
        });
    }

    /** On the adapter's own thread: one sticker, written or refused, ends the write. */
    private void writeTo(Tag tag, NdefMessage message, PluginCall call) {
        if (call != pending) return;
        String code = null, why = null;
        try {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                try {
                    if (!ndef.isWritable()) { code = "read-only"; why = "the sticker is read-only"; }
                    else if (ndef.getMaxSize() < message.getByteArrayLength()) { code = "too-small"; why = "the sticker is too small"; }
                    else ndef.writeNdefMessage(message);
                } finally {
                    try { ndef.close(); } catch (IOException ignored) { /* gone already */ }
                }
            } else {
                NdefFormatable blank = NdefFormatable.get(tag);
                if (blank == null) { code = "unsupported"; why = "the sticker cannot hold NDEF"; }
                else {
                    blank.connect();
                    try { blank.format(message); }
                    finally { try { blank.close(); } catch (IOException ignored) { /* gone already */ } }
                }
            }
        } catch (IOException | FormatException | RuntimeException e) {
            // Moved away too soon, or a sticker that answered oddly: the sheet offers to try again.
            code = "failed";
            why = String.valueOf(e.getMessage());
        }
        stopReader();
        pending = null;
        if (code != null) call.reject(why, code);
        else {
            JSObject r = new JSObject();
            r.put("written", true);
            call.resolve(r);
        }
    }
}
