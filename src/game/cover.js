// ============================================================
// 替隊友擋攻擊（使用者 2026-10-10）：每位玩家每回合可以替另一位玩家擋 1 次敵人的攻擊。
// 擋的做法就是「自己按承受攻擊」（用自己的防禦結算）；這裡只負責記「這回合誰擋過了」，一回合 1 次。
// 記在 enc.cover = { round, by: [擋過的玩家 uid] }；回合數變了就自動視為新的一回合（和敵人技能次數一樣）。
// 純函式，伺服器與前端共用。「擋一次」＝擋一次攻擊（一次承受攻擊）是我的解讀，需驗證。
// ============================================================
export const COVER_PER_ROUND = 1;

const current = (enc) => {
  const round = enc.round ?? 0;
  return enc.cover && enc.cover.round === round ? enc.cover : { round, by: [] };
};

/** 這位玩家這回合還能替隊友擋幾次（不改動 enc） */
export const coverLeft = (enc, uid) => Math.max(0, COVER_PER_ROUND - current(enc).by.filter((u) => u === String(uid)).length);

/** 用掉一次：成功回傳 { ok: true }，這回合已經擋過回傳 { error } */
export function spendCover(enc, uid) {
  if (coverLeft(enc, uid) < 1) return { error: `你這回合已經替隊友擋過了（每回合 ${COVER_PER_ROUND} 次），等 GM 進到下一回合。` };
  const c = current(enc);
  c.by.push(String(uid));
  enc.cover = c;
  return { ok: true };
}
