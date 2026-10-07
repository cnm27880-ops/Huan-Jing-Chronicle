// Discord ID 名單工具（登入白名單與房間成員共用同一份 DISCORD_ALLOWED_IDS）
export function parseIdList(raw) {
  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const parseAllowlist = parseIdList;

/** 登入白名單：空 = 不限制（階段 1-A 的行為，不變） */
export function isAllowed(env, userId) {
  const list = parseIdList(env.DISCORD_ALLOWED_IDS);
  return list.length === 0 || list.includes(String(userId));
}

/** 房間成員：安全預設，名單為空 = 一律拒絕 */
export function roomAccessState(env, userId) {
  const list = parseIdList(env.DISCORD_ALLOWED_IDS);
  if (list.length === 0) return 'whitelist_empty';
  return list.includes(String(userId)) ? 'ok' : 'not_allowed';
}
