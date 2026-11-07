// Every social read, including direct avatar URLs, uses the same two-way block rule.
export function createSocialPolicy({ db, active }) {
  const blocked = (viewer, target) => !!db.prepare(`SELECT 1 FROM blocks
    WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1`)
    .get(viewer, target, target, viewer);
  return {
    blocked,
    canView: (viewer, target) => active(viewer) && active(target) && (viewer === target || !blocked(viewer, target))
  };
}
