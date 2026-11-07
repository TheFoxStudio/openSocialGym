import { createWindow } from '../rate-limit.js';
import { SocialError } from './store.js';
import { processAvatar, processPostPhoto, readAvatar } from './avatar.js';
import crypto from 'node:crypto';

export function socialRoutes({ store, json, readBody, readSession, requireAdmin, audit = () => {} }) {
  const writes = createWindow({ max: 30, windowMs: 60000 });
  const avatars = createWindow({ max: 6, windowMs: 60000 });
  const reads = createWindow({ max: 120, windowMs: 60000 });
  const reports = createWindow({ max: 10, windowMs: 3600000 });
  let uploads = 0;
  const guard = (fn, { admin = false, readOnly = false } = {}) => async (req, res) => {
    if (!store) return json(res, 404, { error: 'Social profiles are disabled.', code: 'social-disabled' });
    const user = admin ? requireAdmin(req, res) : readSession(req);
    if (admin && !user) return;
    if (!user) return json(res, 401, { error: 'Not signed in.', code: 'not-signed-in' });
    try {
      if (req.method === 'GET' || readOnly) {
        const wait = reads.take(user.id);
        if (wait) return json(res, 429, { error: 'Try again shortly.', code: 'social-rate-limit', retryAfter: wait }, { 'Retry-After': String(wait) });
      }
      if (req.method !== 'GET' && !readOnly) {
        const wait = writes.take(user.id);
        if (wait) return json(res, 429, { error: 'Try again shortly.', code: 'social-rate-limit', retryAfter: wait }, { 'Retry-After': String(wait) });
      }
      await fn(req, res, user);
    } catch (e) {
      if (!(e instanceof SocialError)) throw e;
      json(res, e.status, { error: e.message, code: e.code });
    }
  };
  const options = req => {
    const q = new URL(req.url, 'http://localhost').searchParams;
    return { cursor: q.get('cursor') || undefined, limit: q.has('limit') ? Number(q.get('limit')) : 20 };
  };
  const profileEnvelope = (viewer, id) => {
    const profile = store.get(id, viewer);
    return profile ? { profile, relationship: store.relationship(viewer, id), overview: store.profileOverview(viewer, id) } : { profile: null };
  };
  return {
    'PUT /api/social/posts/{post}/like': guard(async(req,res,user)=>json(res,200,store.likePost(user.id,req.socialPost,true))),
    'DELETE /api/social/posts/{post}/like': guard(async(req,res,user)=>json(res,200,store.likePost(user.id,req.socialPost,false))),
    'GET /api/social/posts/{post}/comments': guard(async(req,res,user)=>json(res,200,store.comments(user.id,req.socialPost,options(req)))),
    'PUT /api/social/posts/{post}/comments/{comment}': guard(async(req,res,user)=>{
      const body=await readBody(req);
      if(readSession(req)?.id!==user.id)throw new SocialError(401,'not-signed-in','Not signed in.');
      json(res,200,store.putComment(user.id,req.socialPost,req.socialComment,body));
    }),
    'DELETE /api/social/posts/{post}/comments/{comment}': guard(async(req,res,user)=>json(res,200,store.deleteComment(user.id,req.socialPost,req.socialComment))),
    'GET /api/social/feed': guard(async (req, res, user) => json(res, 200, store.feed(user.id, options(req)))),
    'POST /api/social/feed/check': guard(async (req, res, user) => {
      const body = await readBody(req);
      if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
      json(res, 200, store.checkFeed(user.id, body.ids));
    }, { readOnly: true }),
    'POST /api/social/reports': guard(async (req, res, user) => {
      const wait = reports.take(user.id);
      if (wait) return json(res, 429, { error: 'Try again shortly.', code: 'social-rate-limit', retryAfter: wait }, { 'Retry-After': String(wait) });
      const body = await readBody(req);
      if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
      json(res, 200, store.report(user.id, body)); audit(req, 'social.report', { user });
    }),
    'GET /api/social/export': guard(async (req, res, user) => json(res, 200, store.exportSocial(user.id, new URL(req.url, 'http://localhost').searchParams.get('section'), options(req)))),
    'GET /api/admin/social/reports': guard(async (req, res, user) => json(res, 200, store.reports(user.id, options(req))), { admin: true }),
    'GET /api/admin/social/reports/{report}': guard(async (req, res, user) => json(res, 200, { viewerId: user.id, ...store.reviewReport(req.socialReport) }), { admin: true }),
    'PUT /api/admin/social/reports/{report}': guard(async (req, res, user) => {
      const body = await readBody(req);
      if (requireAdmin(req, res)?.id !== user.id) return;
      const result = store.resolveReport(req.socialReport, body.action);
      json(res, 200, { viewerId: user.id, ...result }); audit(req, 'social.report.resolve', { user, msg: req.socialReport + ':' + body.action });
    }, { admin: true }),
    'GET /api/admin/social/reports/{report}/photo': guard(async (req, res) => {
      const bytes = store.reportPhoto(req.socialReport);
      if (!bytes) return json(res, 404, { error: 'Photo not found.', code: 'photo-missing' });
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes);
    }, { admin: true }),
    'GET /api/social/posts': guard(async (req, res, user) => {
      const source = new URL(req.url, 'http://localhost').searchParams.get('workoutId');
      if (!source || source.length > 160) throw new SocialError(400, 'post-invalid', 'Invalid workout reference.');
      json(res, 200, { post: store.ownPost(user.id, source) });
    }),
    'POST /api/social/posts': guard(async (req, res, user) => {
      const body = await readBody(req);
      if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
      json(res, 200, { post: store.publishPost(user.id, body) });
      audit(req, 'social.post.publish', { user });
    }),
    'GET /api/social/posts/{post}': guard(async (req, res, user) => json(res, 200, { post: store.getPost(user.id, req.socialPost) })),
    'PUT /api/social/posts/{post}': guard(async (req, res, user) => {
      const body = await readBody(req);
      if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
      json(res, 200, { post: store.editPost(user.id, req.socialPost, body) });
      audit(req, 'social.post.edit', { user });
    }),
    'DELETE /api/social/posts/{post}': guard(async (req, res, user) => {
      store.deletePost(user.id, req.socialPost); store.sweepPostAssets();
      json(res, 200, { ok: true }); audit(req, 'social.post.delete', { user });
    }),
    'GET /api/social/profiles/{id}/posts': guard(async (req, res, user) => json(res, 200, store.profilePosts(user.id, req.socialId, options(req)))),
    'PUT /api/social/uploads/{asset}': guard(async (req, res, user) => {
      if (!store.get(user.id)) throw new SocialError(409, 'profile-required', 'Create your profile first.');
      if (avatars.take(user.id)) throw new SocialError(429, 'social-rate-limit', 'Try again shortly.');
      if (uploads >= 2) throw new SocialError(503, 'avatar-busy', 'An image is being uploaded. Try again shortly.');
      uploads++;
      try {
        const raw = await readAvatar(req), bytes = await processPostPhoto(raw);
        if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
        store.sweepPostAssets();
        json(res, 200, store.putPostAsset(user.id, req.socialAsset, bytes, crypto.createHash('sha256').update(raw).digest('hex')));
      } finally { uploads--; }
    }),
    'DELETE /api/social/uploads/{asset}': guard(async (req, res, user) => {
      store.discardPostAsset(user.id, req.socialAsset); json(res, 200, { ok: true });
    }),
    'GET /api/social/posts/{post}/photo': guard(async (req, res, user) => {
      const expected = new URL(req.url, 'http://localhost').searchParams.get('asset');
      if (expected && store.getPost(user.id, req.socialPost).assetId !== expected) throw new SocialError(404, 'photo-missing', 'Photo changed.');
      const bytes = store.postPhoto(user.id, req.socialPost);
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes);
    }),
    'GET /api/social/me': guard(async (req, res, user) => json(res, 200, profileEnvelope(user.id, user.id))),
    'GET /api/social/people': guard(async (req, res, user) => {
      const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
      json(res, 200, store.people(user.id, q, options(req)));
    }),
    'GET /api/social/blocks': guard(async (req, res, user) => json(res, 200, store.blocks(user.id, options(req)))),
    'PUT /api/social/blocks/{id}': guard(async (req, res, user) => {
      store.block(user.id, req.socialId, true); audit(req, 'social.block', { user }); json(res, 200, { ok: true });
    }),
    'DELETE /api/social/blocks/{id}': guard(async (req, res, user) => {
      store.block(user.id, req.socialId, false); audit(req, 'social.unblock', { user }); json(res, 200, { ok: true });
    }),
    'PUT /api/social/follows/{id}': guard(async (req, res, user) => {
      json(res, 200, { relationship: store.follow(user.id, req.socialId, true) });
    }),
    'DELETE /api/social/follows/{id}': guard(async (req, res, user) => {
      json(res, 200, { relationship: store.follow(user.id, req.socialId, false) });
    }),
    'GET /api/social/profiles/{id}/followers': guard(async (req, res, user) => json(res, 200, store.list(user.id, req.socialId, 'followers', options(req)))),
    'GET /api/social/profiles/{id}/following': guard(async (req, res, user) => json(res, 200, store.list(user.id, req.socialId, 'following', options(req)))),
    'PUT /api/social/me': guard(async (req, res, user) => {
      const body = await readBody(req);
      if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
      const profile = store.save(user.id, body);
      audit(req, 'social.profile.save', { user });
      json(res, 200, { profile });
    }),
    'DELETE /api/social/me': guard(async (req, res, user) => {
      store.remove(user.id);
      audit(req, 'social.profile.remove', { user });
      json(res, 200, { ok: true });
    }),
    'GET /api/social/profiles/{id}': guard(async (req, res, user) => {
      const out = profileEnvelope(user.id, req.socialId);
      json(res, out.profile ? 200 : 404, out.profile ? out : { error: 'Profile not found.', code: 'profile-missing' });
    }),
    'PUT /api/social/me/avatar': guard(async (req, res, user) => {
      if (!store.get(user.id)) throw new SocialError(409, 'profile-required', 'Create your profile first.');
      if (avatars.take(user.id)) throw new SocialError(429, 'social-rate-limit', 'Try again shortly.');
      if (uploads >= 2) throw new SocialError(503, 'avatar-busy', 'An image is being uploaded. Try again shortly.');
      uploads++;
      try {
        const bytes = await processAvatar(await readAvatar(req));
        // Processing awaits: account deletion/sign-out could have happened meanwhile.
        if (readSession(req)?.id !== user.id) throw new SocialError(401, 'not-signed-in', 'Not signed in.');
        json(res, 200, { profile: store.setAvatar(user.id, bytes) });
      } finally { uploads--; }
    }),
    'DELETE /api/social/me/avatar': guard(async (req, res, user) => json(res, 200, { profile: store.setAvatar(user.id, null) })),
    'GET /api/social/profiles/{id}/avatar/{asset}': guard(async (req, res, user) => {
      const bytes = store.avatar(req.socialId, req.socialAsset, user.id);
      if (!bytes) return json(res, 404, { error: 'Photo not found.', code: 'avatar-missing' });
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    })
  };
}

export function socialRouteKey(method, pathname, req) {
  const interaction=/^\/api\/social\/posts\/([a-f0-9-]{36})\/(like|comments)(?:\/([a-f0-9-]{36}))?$/.exec(pathname);
  if(interaction){req.socialPost=interaction[1];req.socialComment=interaction[3];return method+' /api/social/posts/{post}/'+interaction[2]+(interaction[3]?'/{comment}':'');}
  const report = /^\/api\/admin\/social\/reports\/([a-f0-9-]{36})(\/photo)?$/.exec(pathname);
  if (report) { req.socialReport = report[1]; return method + ' /api/admin/social/reports/{report}' + (report[2] || ''); }
  const post = /^\/api\/social\/posts\/([a-f0-9-]{36})(\/photo)?$/.exec(pathname);
  if (post) { req.socialPost = post[1]; return method + ' /api/social/posts/{post}' + (post[2] || ''); }
  const upload = /^\/api\/social\/uploads\/([a-f0-9-]{36})$/.exec(pathname);
  if (upload) { req.socialAsset = upload[1]; return method + ' /api/social/uploads/{asset}'; }
  const posts = /^\/api\/social\/profiles\/([A-Za-z0-9_-]{1,64})\/posts$/.exec(pathname);
  if (posts) { req.socialId = posts[1]; return method + ' /api/social/profiles/{id}/posts'; }
  const graph = /^\/api\/social\/(follows|blocks)\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
  if (graph) { req.socialId = graph[2]; return method + ' /api/social/' + graph[1] + '/{id}'; }
  const list = /^\/api\/social\/profiles\/([A-Za-z0-9_-]{1,64})\/(followers|following)$/.exec(pathname);
  if (list) { req.socialId = list[1]; return method + ' /api/social/profiles/{id}/' + list[2]; }
  const match = /^\/api\/social\/profiles\/([A-Za-z0-9_-]{1,64})(?:\/avatar\/([a-f0-9-]{36}))?$/.exec(pathname);
  if (!match) return null;
  req.socialId = match[1]; req.socialAsset = match[2];
  return method + (match[2] ? ' /api/social/profiles/{id}/avatar/{asset}' : ' /api/social/profiles/{id}');
}
