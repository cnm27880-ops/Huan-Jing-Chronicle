// ============================================================
// 戰鬥提醒與隊友資源條的判斷（純函式）。
// 起因（使用者 2026-10-10）：第一名比較會玩、不想讓團隊輸，消耗很多資源；第二、三名忘記用資源，結果全倒地；
// 第一名覺得反正會倒，下次乾脆都不用。所以：
//   1. 隊友的資源用量隨時看得到（資源條，`usageOf`）。
//   2. 「出事了」才跳出必須按掉的提醒（隊友倒地、血量危急、全隊吃緊），內容是你手上實際能做的事（餵藥、還沒用的資源），
//      不是每回合都吵——常常跳的提醒會被養成反射關掉。GM 端不顯示。
// 隊友狀態來自 vitals（src/state/vitals.js 回報、房間廣播）：{ name, hp, maxHp, downed, res: { 資源: [現有, 上限] }, tox, shield }。
// ============================================================
import { POTIONS, TOXICITY_MAX } from './rules.js';
import { countOf } from './engine.js';
import { OTHER_RESOURCES, resourceNow, resourceMax } from './resources.js';

export const NUDGE = {
  danger: 0.3, // 生命低於這個比例＝危急
  trouble: 0.4, // 生命低於這個比例（或倒地）＝有麻煩，算進「全隊吃緊」
  recover: 0.6, // 回到這個比例以上才算脫離（之後再掉才會再提醒）
  idleUsage: 0.2, // 資源動用不到這個比例＝還很滿
  cooldownMs: 15000, // 同一個人同一種提醒，至少隔這麼久
  minPressure: 2, // 全隊吃緊至少要有幾個人有麻煩
};

const ratio = (v) => (v.maxHp > 0 ? v.hp / v.maxHp : 0);

/** 一位玩家資源「已動用」的比例（0~1）：每種資源用掉多少、加上毒性（占上限 15）的平均。沒有任何資源回傳 0 */
export function usageOf(v) {
  const list = Object.values(v?.res ?? {}).filter(([, max]) => max > 0).map(([now, max]) => Math.min(1, Math.max(0, 1 - now / max)));
  if (typeof v?.tox === 'number') list.push(Math.min(1, v.tox / TOXICITY_MAX));
  return list.length ? list.reduce((a, x) => a + x, 0) / list.length : 0;
}

/** 資源條要畫的每一條：{ key, label, now, max, left }，left = 還剩多少（0~1）；毒性畫成「藥水空間」（還能喝多少），所以每條都是「還剩多少」 */
export function barsOf(v) {
  const bars = Object.entries(v?.res ?? {}).filter(([, [, max]]) => max > 0)
    .map(([key, [now, max]]) => ({ key, label: key.slice(0, 1), now, max, left: Math.min(1, Math.max(0, now / max)), text: `${key} ${now} / ${max}` }));
  if (typeof v?.tox === 'number') {
    const room = Math.max(0, TOXICITY_MAX - v.tox);
    bars.push({ key: '毒性', label: '毒', now: room, max: TOXICITY_MAX, left: room / TOXICITY_MAX, text: `毒性 ${v.tox} / ${TOXICITY_MAX}（還能喝 ${room} 點的藥水）` });
  }
  return bars;
}

/** 隊伍一句話摘要（折疊時顯示）：{ count, downed, low（血量低於有麻煩線、沒倒地）, minPct, idle（資源還很滿的名字）, level: 'ok'|'warn'|'bad' } */
export function partyDigest(mates, { inBattle = false } = {}) {
  const list = mates.filter(Boolean);
  const downed = list.filter((v) => v.downed).length;
  const low = list.filter((v) => !v.downed && ratio(v) < NUDGE.trouble).length;
  const minPct = list.length ? Math.round(Math.min(...list.map((v) => (v.downed ? 0 : ratio(v)))) * 100) : 100;
  const idle = inBattle ? list.filter((v) => !v.downed && usageOf(v) < NUDGE.idleUsage).map((v) => v.name) : [];
  return { count: list.length, downed, low, minPct, idle, level: downed ? 'bad' : low ? 'warn' : 'ok' };
}

const inTrouble = (v) => v.downed || ratio(v) < NUDGE.trouble;

/**
 * 比對前後兩份隊友狀態（uid → vitals），回傳新發生的事件：
 *   { kind: 'downed', uid, name }  隊友倒地
 *   { kind: 'danger', uid, name }  隊友生命掉到危急線以下（沒倒地）
 *   { kind: 'pressure', uids }     有麻煩的人數剛好湊到全隊一半以上（至少 minPressure 個）
 * 第一次看到的人（prev 沒有）不算事件，避免剛連線或剛開網頁就誤報。me：自己的 uid（自己倒地時不提醒，也不當成事件對象）。
 */
export function detectEvents(prev, next, { me } = {}) {
  if (!prev || !next) return [];
  if (next[me]?.downed) return [];
  const events = [];
  for (const [uid, v] of Object.entries(next)) {
    const p = prev[uid];
    if (!p || uid === me) continue;
    if (!p.downed && v.downed) events.push({ kind: 'downed', uid, name: v.name });
    else if (!v.downed && ratio(v) < NUDGE.danger && ratio(p) >= NUDGE.danger && !p.downed) events.push({ kind: 'danger', uid, name: v.name });
  }
  const all = Object.keys(next).filter((u) => prev[u]);
  const need = Math.max(NUDGE.minPressure, Math.ceil(all.length / 2));
  const was = all.filter((u) => inTrouble(prev[u])).length;
  const now = all.filter((u) => inTrouble(next[u]));
  if (now.length >= need && was < need) events.push({ kind: 'pressure', uids: now.map((u) => u) });
  return events;
}

/** 防連發：同一個人同一種提醒要隔 cooldownMs，而且要先脫離（生命回到 recover 以上）才會再提醒。allow(事件, 狀態, 現在時間) → 是否放行 */
export function createNudgeGate() {
  const last = new Map();
  return {
    allow(ev, vitals, now) {
      const key = `${ev.kind}:${ev.uid ?? 'team'}`;
      const t = last.get(key);
      if (t != null && now - t < NUDGE.cooldownMs) return false;
      last.set(key, now);
      return true;
    },
    /** 隊友回到安全線以上：清掉他的紀錄，下次再出事會再提醒 */
    recovered(vitals) {
      for (const [uid, v] of Object.entries(vitals)) if (!v.downed && ratio(v) >= NUDGE.recover) { last.delete(`downed:${uid}`); last.delete(`danger:${uid}`); }
    },
  };
}

/** 對方現在喝得下這瓶嗎（毒性不能超過 15） */
export const canFeed = (v, potion) => (v?.tox ?? 0) + (POTIONS[potion]?.toxicity ?? 99) <= TOXICITY_MAX;

/**
 * 自己現在手上能做的事（給提醒視窗列出來）：
 *   heals：有的回復藥水（大瓶的在前）{ name, qty, avg }
 *   fresh：還很滿的資源（剩下超過一半）{ key, now, max }——該放招式、加鬥氣了
 *   buffs：有的攻擊／防禦藥水 { name, qty, kind }
 */
export function myOptions(state) {
  const avg = (p) => p.heal.n * (p.heal.sides + 1) / 2;
  const heals = Object.keys(POTIONS).filter((n) => POTIONS[n].heal && countOf(state, n) > 0)
    .map((name) => ({ name, qty: countOf(state, name), avg: avg(POTIONS[name]) })).sort((a, b) => b.avg - a.avg);
  const fresh = OTHER_RESOURCES.map((key) => ({ key, now: resourceNow(state, key), max: resourceMax(state, key) }))
    .filter((r) => r.max > 0 && r.now / r.max > 0.5);
  const buffs = Object.keys(POTIONS).filter((n) => (POTIONS[n].atk || POTIONS[n].def) && countOf(state, n) > 0)
    .map((name) => ({ name, qty: countOf(state, name), kind: POTIONS[name].atk ? 'atk' : 'def' }));
  return { heals, fresh, buffs };
}
