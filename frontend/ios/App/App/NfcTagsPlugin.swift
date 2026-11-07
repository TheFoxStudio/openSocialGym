import Foundation
import Capacitor
#if canImport(CoreNFC)
import CoreNFC
#endif

/**
 * openGym's NFC stickers (lib/nfc.js, components/Nfc.jsx): writes one openGym link onto a sticker
 * with Core NFC's own sheet ("Hold the top of your iPhone near the sticker").
 *
 * Reading needs nothing here: an iPhone XS or newer reads NDEF stickers in the background, and the
 * https://gym.orktork.space/nfc link on ours comes back to the page as opengym://nfc?... (through
 * gym.orktork.space/nfc, or straight away once gym.orktork.space is an associated domain), via @capacitor/app.
 *
 * read() starts a foreground, read-only session for existing NDEF machine links.
 *
 * Usage from JS:
 *   const NfcTags = registerPlugin('NfcTags')
 *   await NfcTags.isAvailable()     // { supported, enabled }
 *   await NfcTags.write({ url, alert: 'Hold the top…', done: 'Sticker ready.' })
 *   await NfcTags.cancel()
 * A failed write rejects with code cancelled | read-only | too-small | unsupported | failed.
 */
@objc(NfcTagsPlugin)
public class NfcTagsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NfcTagsPlugin"
    public let jsName = "NfcTags"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    #if canImport(CoreNFC)
    private var session: NFCNDEFReaderSession?
    private var pending: CAPPluginCall?
    private var message: NFCNDEFMessage?
    private var doneText = ""
    #endif

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        let ok = NFCNDEFReaderSession.readingAvailable
        call.resolve(["supported": ok, "enabled": ok])
        #else
        call.resolve(["supported": false, "enabled": false])
        #endif
    }

    @objc func read(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        guard NFCNDEFReaderSession.readingAvailable else {call.reject("NFC unavailable","unsupported");return}
        DispatchQueue.main.async {
            self.settle(code:"cancelled",why:"replaced by a newer scan")
            self.session?.invalidate()
            self.pending=call;self.message=nil
            let s=NFCNDEFReaderSession(delegate:self,queue:nil,invalidateAfterFirstRead:false)
            s.alertMessage=call.getString("alert") ?? "Hold near the machine tag."
            self.session=s;s.begin()
        }
        #else
        call.reject("NFC unavailable","unsupported")
        #endif
    }

    @objc func write(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        guard NFCNDEFReaderSession.readingAvailable else {
            call.reject("this iPhone cannot write NFC stickers", "unsupported")
            return
        }
        guard let url = call.getString("url"), !url.isEmpty, url.count <= 512,
              let record = NFCNDEFPayload.wellKnownTypeURIPayload(string: url) else {
            call.reject("url is required", "failed")
            return
        }
        let alert = call.getString("alert") ?? ""
        let done = call.getString("done") ?? ""
        DispatchQueue.main.async {
            self.settle(code: "cancelled", why: "replaced by a newer write")
            self.session?.invalidate()
            self.pending = call
            self.message = NFCNDEFMessage(records: [record])
            self.doneText = done
            let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
            if !alert.isEmpty { s.alertMessage = alert }
            self.session = s
            s.begin()
        }
        #else
        call.reject("this iPhone cannot write NFC stickers", "unsupported")
        #endif
    }

    @objc func cancel(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        DispatchQueue.main.async {
            self.settle(code: "cancelled", why: "cancelled")
            self.session?.invalidate()
            self.session = nil
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    #if canImport(CoreNFC)
    /// Ends the waiting call once: resolved without a code, rejected with one.
    private func settle(code: String?, why: String = "") {
        guard let call = pending else { return }
        pending = nil
        message = nil
        if let code = code { call.reject(why, code) } else { call.resolve(["written": true]) }
    }

    /// Fails the write and closes the sheet with a short reason.
    private func fail(_ session: NFCNDEFReaderSession, _ code: String, _ why: String) {
        DispatchQueue.main.async {
            guard self.session === session else{return}
            self.settle(code: code, why: why)
            session.invalidate(errorMessage: why)
        }
    }
    #endif
}

#if canImport(CoreNFC)
extension NfcTagsPlugin: NFCNDEFReaderSessionDelegate {
    public func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // Cancel on the sheet, its timeout, or our own invalidate after a write (settled by then).
        let code = (error as? NFCReaderError)?.code
        let cancelled = code == .readerSessionInvalidationErrorUserCanceled || code == .readerSessionInvalidationErrorSessionTimeout
        DispatchQueue.main.async {
            // A session replaced by a newer write ends later: its end is not the new one's.
            guard self.session === session else { return }
            self.session = nil
            self.settle(code: cancelled ? "cancelled" : "failed", why: error.localizedDescription)
        }
    }

    // Required, never used: a session with tag detection gets didDetect tags instead.
    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard tags.count == 1, let tag = tags.first else {
            // Two stickers at once: wait for one.
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(500)) { session.restartPolling() }
            return
        }
        session.connect(to: tag) { error in
            if let error = error { self.fail(session, "failed", error.localizedDescription); return }
            tag.queryNDEFStatus { status, capacity, error in
                if let error = error { self.fail(session, "failed", error.localizedDescription); return }
                DispatchQueue.main.async {
                    guard self.session === session, self.pending != nil else {return}
                    // NDEF reads work on locked/read-only tags too. Never write in read mode.
                    if self.message == nil {
                        guard status != .notSupported else {self.fail(session,"unsupported","No readable NDEF message.");return}
                        tag.readNDEF { message,error in
                            if let error=error {self.fail(session,"failed",error.localizedDescription);return}
                            let urls=(message?.records ?? []).compactMap { $0.wellKnownTypeURIPayload()?.absoluteString }.filter{$0.count<=2048}
                            DispatchQueue.main.async {
                                guard self.session === session,let call=self.pending else{return}
                                self.pending=nil;self.session=nil
                                if urls.isEmpty {call.reject("No readable NFC link.","unsupported")}
                                else {call.resolve(["serialNumber":"","urls":Array(urls.prefix(8))])}
                                session.invalidate()
                            }
                        }
                        return
                    }
                    guard let message=self.message else{return}
                    switch status {
                    case .notSupported: self.fail(session, "unsupported", "This sticker can't hold a link.")
                    case .readOnly: self.fail(session, "read-only", "This sticker is locked.")
                    case .readWrite:
                        if capacity < message.length { self.fail(session, "too-small", "This sticker is too small."); return }
                        tag.writeNDEF(message) { error in
                            if let error = error { self.fail(session, "failed", error.localizedDescription); return }
                            DispatchQueue.main.async {
                                if !self.doneText.isEmpty { session.alertMessage = self.doneText }
                                self.settle(code: nil)
                                session.invalidate()
                            }
                        }
                    @unknown default: self.fail(session, "failed", "Unknown sticker.")
                    }
                }
            }
        }
    }
}
#endif
