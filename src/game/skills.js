// ============================================================
// 技能庫：把試算表「技能表」中需要特殊程式處理的技能寫成資料（%數、護盾、吸血、負向被動…）。
// 純資料與小函式，不碰畫面。技能原文見試算表；括號內為數值出處。
// 目前只收「使用者指定」的技能；其他技能的被動加值（每級 +N 點）已包含在角色基礎數值裡。
// ============================================================
import { SKILL_TABLE } from '../data/skills.js';

/** 角色學會的技能等級：state.skills = { 魔女: 10, 暴徒: 1, ... } */
export const skillLevel = (state, name) => Number(state.skills?.[name]) || 0;

/** 會改變戰鬥規則的被動（來自已學會的技能） */
export function passivesOf(state) {
  return {
    // 攻擊無視敵人絕對防禦；新匯入的角色（statMode 'skills'）要「啟動」終焉武裝才有
    ignoreAbs: skillLevel(state, '終焉武裝') > 0 && (state.statMode !== 'skills' || Boolean(state.skillOn?.終焉武裝)),
    brute: skillLevel(state, '暴徒') > 0,           // 無法造成物理傷害，一半的物理加到能量與靈魂
    witch: skillLevel(state, '魔女') > 0,           // 負向被動：每個主動動作額外 30 魔力
  };
}

export const WITCH_EXTRA_COST = 30;

/** 鬥氣的基礎用法：攻擊時每花 1 點，額外增加 1 顆真實傷害攻擊骰（2026/10 平衡更新）；冠軍勇士（大師）改成每點 4 顆 */
export const douMult = (state) => (skillLevel(state, '冠軍勇士') > 0 ? 4 : 1);

/**
 * 攻擊響應：「造成○○傷害時，可以消耗 X 增加 N 顆傷害骰」。有學這個技能、招式符合條件就會自動套用（玩家可以在招式區把它關掉省資源）。
 * 以前試算表把「消耗」直接算進每個含 C 軌的招式（2 生命 + 3 算力），卻沒有加骰；現在改成真的看有沒有學這些技能。
 * track = 加在哪一軌；school = 限定招式系別（沒寫就不限）；free = 不花資源，一定生效。每次出招每個響應最多觸發 1 次（需驗證）。
 */
export const ATTACK_RESPONSES = {
  腦機協議: { track: 'C', cost: { 算力: 3 }, dice: 1 },
  殘缺筆記: { track: 'C', cost: { 生命: 2 }, dice: 1 },
  清心觀想圖: { track: 'C', cost: { 靈氣: 2 }, dice: 1 },
  血肉法則: { track: 'A', cost: { 生命: 2 }, dice: 1 },
  特戰數據包: { track: 'A', school: '科技', cost: { 算力: 1 }, dice: 1 },
  魔能潮汐: { track: 'B', school: '西幻', cost: { 魔力: 3 }, dice: 2 },
  真龍九變圖: { track: 'A', cost: {}, dice: 4, free: true },
};

/** 這個招式現在可以觸發、而且玩家學過的攻擊響應（不管付不付得起、有沒有被關掉） */
export function attackResponses(state, move) {
  if (!move || move.kind === 'heal' || move.kind === 'shield') return [];
  const tracks = move.mode === 'all' ? ['A', 'B', 'C'] : move.tracks ?? [];
  const brute = passivesOf(state).brute;
  return Object.entries(ATTACK_RESPONSES)
    .filter(([name, r]) => skillLevel(state, name) > 0 && tracks.includes(r.track) && !(r.track === 'A' && brute) && (!r.school || r.school === move.school))
    .map(([name, r]) => ({ name, ...r }));
}

/** 龍（傳說）：造成能量傷害時，每 1 級讓自己的能量傷害 +3，直到戰鬥結束（每次造成都疊加，需驗證）。回傳每次增加的點數 */
export const dragonGain = (state) => 3 * skillLevel(state, '龍');

/** 賽博駭客（大師）：受到靈魂傷害但沒破防，攻擊方扣「精神意志面板」顆 D4 的生命，一回合 1 次 */
export const hasCyberHacker = (state) => skillLevel(state, '賽博駭客') > 0;

/**
 * 目錄：主動技能。kind = 'attack' | 'heal' | 'shield'
 * tiers：可選擇的花費檔位（heal/shield）；pct = 目標「最大生命」的百分比
 * extraAt(level)：每級加成骰數（attack）
 */
export const SKILL_CATALOG = {
  納米醫療蜂: {
    school: '科技', kind: 'heal',
    tiers: [{ cost: { 算力: 8 }, pct: 10 }, { cost: { 算力: 16 }, pct: 20 }, { cost: { 算力: 24 }, pct: 30 }],
    // 響應：5、9 級時額外回復 1、2 個目標（以門檻等級的「總數」解讀，需驗證）
    targetsAt: (lv) => 2 + (lv >= 9 ? 2 : lv >= 5 ? 1 : 0),
  },
  生生造化印: {
    school: '修仙', kind: 'shield',
    tiers: [{ cost: { 靈氣: 10 }, pct: 10 }, { cost: { 靈氣: 20 }, pct: 15 }, { cost: { 靈氣: 30 }, pct: 25 }],
    // 響應：1、4、7、10 級提升目標 2、6、10、14 點抗性免疫，不可疊加，持續到護盾被打破
    resAt: (lv) => (lv >= 10 ? 14 : lv >= 7 ? 10 : lv >= 4 ? 6 : lv >= 1 ? 2 : 0),
  },
  吞天噬血陣: {
    school: '修仙', kind: 'attack', tracks: ['C'], targets: 3, cost: { 靈氣: 30 },
    extraAt: (lv) => ({ C: 2 * lv }), // 響應：每 1 級 +2 個靈魂傷害骰
    drain: { ratio: 0.5, capPct: 30 }, // 回復「目標扣除生命」的一半，總回復上限 = 玩家最大生命的 30%
  },
  // 暴徒的主動招式：造成能量與靈魂傷害。響應「每級 +2 個物理骰」因不能造成物理，轉成 B、C 各 +1（每級）——使用者確認。
  // 消耗：試算表沒有列，目前不花資源，需驗證
  暴徒: { school: '神秘', kind: 'attack', tracks: ['B', 'C'], targets: 1, cost: {}, extraAt: (lv) => ({ B: lv, C: lv }) },
  萬物歸一: {
    school: '神秘', kind: 'attack', mode: 'all', tracks: ['A', 'B', 'C'], cost: {},
    extraAt: () => ({}),
    bonusCurrentPct: 5, // 破防時額外扣目標「現有生命」5%
  },
};

// ---------- 從技能表的效果文字自動產生攻擊招式（目錄沒手寫的主動技能；解析方式需驗證） ----------
const TRACK_OF = { 物理: 'A', 能量: 'B', 靈魂: 'C' };
const RESOURCES = '生命|靈氣|魔力|能量|鬥氣|算力';

/** 技能表裡「主動：造成○○傷害」的技能 → 目錄格式（kind 'attack'）；輔助、增益、解析不出軌道的回傳 null */
export function generatedAttack(name) {
  const t = SKILL_TABLE[name];
  const first = (t?.text ?? '').split('\n').find((l) => l.startsWith('主動：'))?.slice(3);
  if (!first || /聚集|凝聚|獲得治療|增加\d+點[^，。]*傷害骰/.test(first)) return null;
  const hit = first.match(/造成[^，。]*/);
  if (!hit) return null;
  const tracks = Object.keys(TRACK_OF).filter((w) => hit[0].includes(w)).map((w) => TRACK_OF[w]);
  if (!tracks.length) return null;
  const paid = first.match(new RegExp(`花費(\\d+)點(${RESOURCES})`));
  const targets = Number(first.match(/對(\d+)個目標/)?.[1]) || 1;
  // 響應（只看「響應：」開頭的行）：「1、5、9級時…增加1、2、3個物理傷害骰」→ 到該級的累積骰數（與手寫目錄相同的解讀）；
  // 「每1級增加2個…傷害骰」→ 每級加。看得懂才算，複雜的效果（上限、花費條件）不自動加，需驗證
  const lines = t.text.split('\n').filter((l) => l.startsWith('響應：'));
  const tracksIn = (str) => Object.keys(TRACK_OF).filter((w) => str.includes(w) || (w === '靈魂' && str.includes('物靈魂'))).map((w) => TRACK_OF[w]);
  const byLevels = lines.flatMap((l) => [...l.matchAll(/(\d+(?:、\d+)*)\s*級時[^。]*?增加\s*(\d+(?:、\d+)*)個([^。，]*傷害骰)/g)])
    .map((r) => ({ levels: r[1].split('、').map(Number), amounts: r[2].split('、').map(Number), tracks: tracksIn(r[3]) }));
  const perLevel = lines.flatMap((l) => [...l.matchAll(/每(\d+)級增加(\d+)個([^。，]*傷害骰)/g)])
    .map((r) => ({ every: Number(r[1]), n: Number(r[2]), tracks: tracksIn(r[3]) }));
  const extraAt = (lv) => {
    const out = {};
    const add = (tr, n) => { for (const k of tr) out[k] = (out[k] ?? 0) + n; };
    for (const r of byLevels) {
      const idx = r.levels.filter((x) => x <= lv).length - 1;
      if (idx >= 0) add(r.tracks, r.amounts[Math.min(idx, r.amounts.length - 1)] ?? 0);
    }
    for (const r of perLevel) add(r.tracks, Math.floor(lv / r.every) * r.n);
    return out;
  };
  return { school: t.school, kind: 'attack', tracks, targets, cost: paid ? { [paid[2]]: Number(paid[1]) } : {}, extraAt };
}

/** 手寫目錄優先，沒有的再從技能表產生 */
export const catalogOf = (name) => SKILL_CATALOG[name] ?? generatedAttack(name) ?? null;

/** 已學會、可以綁定成招式的主動技能名稱 */
export const bindableSkills = (state) =>
  Object.keys(state.skills ?? {}).filter((n) => skillLevel(state, n) > 0 && catalogOf(n));

/** 被動「響應」：條件成立時追加效果 */
export const PASSIVE_RIDERS = {
  域外魔祖: { school: '修仙', cost: { 靈氣: 30 }, currentPct: 10 }, // 可花 30 靈氣，直接扣目標現有生命 10%
  不可名狀: { school: '神秘', ratio: 0.5, capBasePct: 0, capPerLevelPct: 5 }, // 回復目標損失生命的一半，上限 = 最大生命 × 5% × 等級（1 級 = 5%，使用者確認）
};

export function addCost(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** 用目錄技能建立一個招式（等級由 state.skills 決定，不寫死在招式裡） */
/** 普攻：每人固定有一個不花資源的招式（資源用光還能出手）：A/B/C 三軌都用面板攻擊，沒有招式加成 */
export const basicMove = () => ({ id: 'basic', name: '普攻', tracks: ['A', 'B', 'C'], extra: { A: 0, B: 0, C: 0 }, cost: {} });

export function moveFromCatalog(name) {
  const c = catalogOf(name);
  if (!c) return null;
  return {
    id: `s_${name}`, name, skill: name, kind: c.kind, school: c.school,
    tracks: c.tracks ?? [], mode: c.mode ?? 'normal', targets: c.targets ?? 1,
    cost: { ...(c.cost ?? {}) }, extra: { A: 0, B: 0, C: 0 },
  };
}

/** 招式實際的加成骰數：手動 extra + 目錄的每級加成 */
export function moveExtra(state, move) {
  const c = move.skill ? catalogOf(move.skill) : null;
  const lv = move.skill ? skillLevel(state, move.skill) : 0;
  const byLevel = c?.extraAt ? c.extraAt(lv) : {};
  return { A: 0, B: 0, C: 0, ...(move.extra ?? {}), ...Object.fromEntries(Object.entries(byLevel).map(([k, v]) => [k, (move.extra?.[k] ?? 0) + v])) };
}

/** 可在「已學會技能」登錄等級的技能（會被程式規則用到的） */
export const RULE_SKILLS = [...new Set(['暴徒', '魔女', '終焉武裝', '域外魔祖', '不可名狀', '冠軍勇士', ...Object.keys(SKILL_CATALOG)])];
