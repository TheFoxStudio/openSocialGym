// Kept runtime-independent so the public post schema can also validate browser previews.
export class SocialError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
