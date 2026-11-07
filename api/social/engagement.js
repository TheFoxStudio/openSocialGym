import { SocialError } from './errors.js';
const fail = (status, code, message) => { throw new SocialError(status, code, message); };
const UUID = /^[a-f0-9-]{36}$/;
export function engagementSummary(db, viewer, post) {
  const allowed = `NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=user_id) OR (b.blocker_id=user_id AND b.blocked_id=?))`;
  return {
    likes: db.prepare(`SELECT count(*) n FROM post_likes WHERE post_id=? AND ${allowed}`).get(post,viewer,viewer).n,
    liked: !!db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(post,viewer),
    comments: db.prepare(`SELECT count(*) n FROM post_comments WHERE post_id=? AND text<>'' AND ${allowed}`).get(post,viewer,viewer).n
  };
}
export function createEngagement({ db, posts, policy, active, cursors }) {
  const actor = viewer => { if (!active(viewer) || !db.prepare('SELECT 1 FROM profiles WHERE account_id=?').get(viewer)) fail(409,'profile-required','Create your social profile first.'); };
  const project = r => ({ id:r.id,postId:r.post_id,text:r.text,createdAt:r.created_at,
    author: db.prepare('SELECT account_id id,handle,display_name displayName,avatar_id avatarId FROM profiles WHERE account_id=?').get(r.user_id) });
  return {
    likePost(viewer,id,liked) {
      actor(viewer); posts.getPost(viewer,id);
      if (liked) db.prepare('INSERT OR IGNORE INTO post_likes VALUES(?,?,?)').run(id,viewer,Date.now());
      else db.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').run(id,viewer);
      return { viewerId:viewer,engagement:engagementSummary(db,viewer,id) };
    },
    comments(viewer,id,{cursor,limit=20}={}) {
      posts.getPost(viewer,id);
      if (!Number.isInteger(limit)||limit<1||limit>50) fail(400,'limit-invalid','Invalid page size.');
      const context=JSON.stringify(['comments',viewer,id]),at=cursor?cursors.decode(cursor,context):{time:0,id:''};
      if (!Number.isSafeInteger(at.time)||typeof at.id!=='string') fail(400,'cursor-invalid','Invalid cursor.');
      const rows=db.prepare("SELECT * FROM post_comments WHERE post_id=? AND text<>'' AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 201").all(id,at.time,at.time,at.id);
      const comments=[];let last,scanned=0;
      for (const r of rows.slice(0,200)) {last=r;scanned++;if(active(r.user_id)&&policy.canView(viewer,r.user_id)) comments.push(project(r));if(comments.length===limit)break;}
      return {viewerId:viewer,comments,engagement:engagementSummary(db,viewer,id),nextCursor:scanned<rows.length?cursors.encode({context,time:last.created_at,id:last.id}):null};
    },
    putComment(viewer,id,commentId,body) {
      actor(viewer);posts.getPost(viewer,id);
      if (!UUID.test(commentId)||typeof body?.text!=='string'||!body.text.trim()||body.text.length>1000||/[\x00-\x08\x0b-\x1f\x7f]/.test(body.text)) fail(400,'comment-invalid','Use 1–1000 characters.');
      const prior=db.prepare('SELECT * FROM post_comments WHERE id=?').get(commentId),text=body.text.trim();
      if(prior) { if(prior.post_id!==id||prior.user_id!==viewer)fail(409,'comment-conflict','Comment request changed.');if(!prior.text)fail(410,'comment-deleted','This comment was removed.');if(prior.text!==text)fail(409,'comment-conflict','Comment request changed.'); }
      else db.prepare('INSERT INTO post_comments VALUES(?,?,?,?,?)').run(commentId,id,viewer,text,Date.now());
      return {viewerId:viewer,comment:project(db.prepare('SELECT * FROM post_comments WHERE id=?').get(commentId)),engagement:engagementSummary(db,viewer,id)};
    },
    deleteComment(viewer,id,commentId) {
      const post=posts.getPost(viewer,id),r=db.prepare('SELECT * FROM post_comments WHERE id=? AND post_id=?').get(commentId,id);
      if(r&&r.user_id!==viewer&&post.authorId!==viewer)fail(404,'comment-missing','Comment not found.');
      db.prepare("UPDATE post_comments SET text='' WHERE id=? AND post_id=?").run(commentId,id);
      return {viewerId:viewer,engagement:engagementSummary(db,viewer,id)};
    }
  };
}
