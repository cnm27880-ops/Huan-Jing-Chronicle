// ============================================================
// 遭遇戰舞台（跑團頁中間）：先攻軸、BOSS 大立繪與多段血條、小怪矩陣、選目標、隊友血量、GM 工具。
// 規則在 combat.js；結果用 rollLog 的 publish／rollWith 發布。
// 已加入房間：敵人由 GM 建立、存在伺服器、全員共享；怪物生命只有伺服器會改（玩家回報傷害）。
// 沒加入房間（本機模式）：照舊由自己建立，存在角色存檔裡（單人試玩）。
// 選目標：點卡片選取（可多選，依點選順序），最多到目前招式的目標數；出招按鈕在左欄的招式上。
// ============================================================
import { askConfirm } from './confirmPop.js';
import { h, fmt } from './dom.js';
import { toast, rollFailed } from './controls.js';
import { TRACKS, TRACK_ATK_STAT, TRACK_DEF_STAT } from '../game/rules.js';
import {
  formatAbc, monsterAbs, addMobs, addBosses, removeMonster, newEncounter, playerAttack, monsterAttack,
  isDowned, monsterAtk, monsterDef, BOSS_ATK_MODES, BOSS_DEF_MODES, SPLIT_FOCUS,
} from '../game/combat.js';
import {
  ENEMY_RANKS, SKILL_NAMES, enemyLeft, useEnemySkill, spendEnemyAttack, spendEnemyB, pendingEnemyB, nextRound,
} from '../game/enemy.js';
import { maxHp } from '../game/stats.js';
import { costText, resourceNow } from '../game/resources.js';
import {
  publish, rollWith, getEncounter, encounterAction, getRoomStatus, imageUrl, uploadImage, deleteImage, presetAction,
} from '../state/rollLog.js';
import { trackLine, targetLine } from '../game/events.js';
import { battleSel as sel } from './battleSelect.js';

const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);
const pctOf = (cur, max) => (max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0);
const BOSS_LAYERS = 3; // BOSS 血條畫成幾段（只是視覺，見 GAME_RULES.md）
const MAX_UPLOAD_B64 = 240_000; // 和伺服器的 MAX_IMAGE_B64_CHARS 一樣

function hpBar(cur, max, downed) {
  return h('div', { class: `bar${downed ? ' is-downed' : ''}`, role: 'img', 'aria-label': `生命 ${cur} / ${max}` },
    h('div', { class: 'bar__fill', style: `width:${pctOf(cur, max)}%` }),
    h('span', { class: 'bar__text', text: `${fmt(cur)} / ${fmt(max)}` }));
}

// ---------- 血條與出招動畫的「記憶」：畫面會整個重畫，動畫狀態要放在外面，重畫時才接得上 ----------
const HP_SLIDE_MS = 450; // 血條滑到新數值的時間
const GHOST_DELAY_MS = 350; // 殘影（扣掉的那一段）等多久才開始縮
const GHOST_SLIDE_MS = 700;
const FX_MS = 650; // 出招／承受攻擊的動畫長度
const hpTrack = new Map(); // 怪物編號 → { from, to, t0 }（血量從 from 滑到 to，t0 是開始時間）
const fxTrack = new Map(); // 怪物編號 → { kind: 'hit'|'block'|'strike', t0 }
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 記下這隻怪物的血量變化，回傳目前的動畫狀態 { from, to, elapsed }；沒有變化 elapsed 就是很大的數字 */
function trackHp(m) {
  const now = Date.now();
  let e = hpTrack.get(m.id);
  if (!e) { e = { from: m.hp, to: m.hp, t0: 0 }; hpTrack.set(m.id, e); }
  else if (e.to !== m.hp) {
    const shown = e.from + (e.to - e.from) * clamp01((now - e.t0) / HP_SLIDE_MS);
    e = { from: shown, to: m.hp, t0: now };
    hpTrack.set(m.id, e);
  }
  return { from: e.from, to: e.to, elapsed: now - e.t0 };
}

/** 出招／承受攻擊的動畫：回傳 { kind, elapsed }，過期就是 null（用負的 animation-delay 接上重畫前已經播的部分） */
function fxOf(id) {
  const f = fxTrack.get(id);
  const elapsed = f ? Date.now() - f.t0 : Infinity;
  return elapsed < FX_MS ? { kind: f.kind, elapsed } : null;
}
const playFx = (id, kind) => fxTrack.set(id, { kind, t0: Date.now() });
/** 元素要加的屬性：data-fx 讓 CSS 播動畫，負的 animation-delay 讓重畫後從中途接著播 */
const fxAttrs = (id, data = {}) => {
  const f = fxOf(id);
  return { dataset: { ...data, ...(f ? { fx: f.kind } : {}) }, ...(f ? { style: `--fx-delay:-${Math.round(f.elapsed)}ms` } : {}) };
};

/** 把元素的寬度從 fromFrac 滑到 toFrac；已經過了 elapsed 毫秒就從中途接著滑 */
function slideWidth(el, fromFrac, toFrac, elapsed, delay, dur) {
  const t = clamp01((elapsed - delay) / dur);
  if (fromFrac === toFrac || t >= 1) { el.style.width = `${toFrac * 100}%`; return; }
  el.style.transition = 'none';
  el.style.width = `${(fromFrac + (toFrac - fromFrac) * t) * 100}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = `width ${Math.round((1 - t) * dur)}ms ease-out ${Math.max(0, Math.round(delay - elapsed))}ms`;
    el.style.width = `${toFrac * 100}%`;
  }));
}

/**
 * BOSS 的多段血條：三條各自獨立，第 3 條（最上面）先被打掉。
 * 血量變少時：血條滑下去、後面留一段淡色殘影慢慢縮、浮出傷害數字；打掉一整條時閃一下。
 */
function layeredBar(m, downed) {
  const { from, to, elapsed } = trackHp(m);
  const max = m.maxHp;
  const per = max / BOSS_LAYERS;
  const layersOf = (v) => (v <= 0 ? 0 : Math.min(BOSS_LAYERS, Math.ceil(v / per - 1e-9)));
  const left = layersOf(to);
  const frac = (v, layer) => clamp01((v - (layer - 1) * per) / per);
  const lost = from - to;
  const animating = elapsed < GHOST_DELAY_MS + GHOST_SLIDE_MS && from !== to;
  const bars = Array.from({ length: BOSS_LAYERS }, (_, i) => BOSS_LAYERS - i).map((layer) => {
    const fill = h('div', { class: 'lbar__fill' });
    const ghost = h('div', { class: 'lbar__ghost' });
    slideWidth(fill, frac(from, layer), frac(to, layer), elapsed, 0, HP_SLIDE_MS);
    slideWidth(ghost, frac(from, layer), frac(to, layer), elapsed, GHOST_DELAY_MS, GHOST_SLIDE_MS);
    if (!animating || lost < 0) ghost.style.width = `${frac(to, layer) * 100}%`; // 回血或沒在動：殘影跟著血條，不留尾巴
    const part = frac(to, layer);
    return h('div', { class: 'lbar__track', dataset: { layer: String(layer), state: part >= 1 ? 'full' : part > 0 ? 'part' : 'empty' } }, ghost, fill);
  });
  const broke = animating && lost > 0 && layersOf(from) > left;
  return h('div', { class: 'lbar', dataset: { layer: String(left), broke: broke ? '1' : '0' }, role: 'img', 'aria-label': `生命 ${to} / ${max}，剩 ${left} 條` },
    h('div', { class: 'lbar__bars', style: broke ? `animation-delay:-${Math.round(elapsed)}ms` : null }, bars),
    h('div', { class: 'lbar__info' },
      downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒下' }) : null,
      h('span', { class: 'lbar__text num', text: `${fmt(to)} / ${fmt(max)}` }),
      h('span', { class: 'lbar__count num', text: `×${left}` })),
    animating && lost > 0
      ? h('span', { class: 'lbar__pop num', style: `animation-delay:-${Math.round(elapsed)}ms`, text: `−${fmt(Math.round(lost))}` })
      : null);
}

const trackLines = (result) => result.tracks.filter((t) => t.atkDice > 0).map(trackLine);
const glyph = (m) => (m.kind === 'boss' ? '👹' : m.rank === 'elite' ? '👺' : '👾');

/** 圖片檔 → 縮小後的 WebP（瀏覽器不支援就 PNG／JPEG）base64；太大就再縮 */
async function shrinkImage(file, longest) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    for (const size of [longest, Math.round(longest * 0.75), Math.round(longest * 0.5)]) {
      for (const quality of [0.85, 0.7, 0.55]) {
        const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/webp', quality));
        if (!blob) continue;
        const data = await new Promise((ok, fail) => {
          const r = new FileReader();
          r.onload = () => ok(String(r.result).split(',')[1] ?? '');
          r.onerror = () => fail(r.error);
          r.readAsDataURL(blob);
        });
        if (data.length <= MAX_UPLOAD_B64) return { mime: blob.type, data };
      }
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}

export function createEncounterCard({ getState, commit, rerender }) {
  const ui = {
    swapFrom: null, // 先攻換位置：已選的第一個位置
    form: { kind: 'mob', count: 1, atk: 10, def: 10, hp: 100, atkMod: '', defMod: '', absDef: 0, img: '', atkType: '', atkFocus: '', defType: '', defFocus: '' },
    openBoxes: new Set(), // 展開中的「＋新增」區塊：重畫後保持展開
    uploading: false,
    armed: null, // 承受攻擊的二次確認：第一次點只「待命」，3 秒內再點同一個才真的承受
    presets: null, // GM 的敵人預組清單（第一次打開 GM 工具時向伺服器要）
    presetName: '',
  };
  let armTimer = null;
  /** 承受攻擊要點兩次：第一次點亮「再點一次確認」，3 秒內再點同一個才執行，點別的或逾時就取消 */
  function confirmHit(key, run) {
    clearTimeout(armTimer);
    if (ui.armed === key) { ui.armed = null; run(); return; }
    ui.armed = key;
    armTimer = setTimeout(() => { ui.armed = null; rerender(); }, 3000);
    rerender();
  }

  function addBox(key, summary, ...children) {
    return h('details', {
      class: 'add-box', open: ui.openBoxes.has(key),
      ontoggle: (e) => { if (e.target.open) ui.openBoxes.add(key); else ui.openBoxes.delete(key); },
    }, h('summary', { text: summary }), ...children);
  }

  const online = () => getEncounter() !== null;
  const isGm = () => Boolean(getRoomStatus().me?.isGm);
  /** 目前畫面用的遭遇戰：房間裡是伺服器的，本機是角色自己的 */
  const currentEnc = (state) => getEncounter() ?? state.encounter;
  /** 伺服器動作：失敗（不是 GM、輸入不合法、斷線）時顯示原因 */
  async function act(msg) {
    try { await encounterAction(msg); } catch (e) { toast(e.message || '操作失敗。'); }
  }

  /**
   * 房間模式的出招／承受攻擊：規則函式吃的是 state.encounter，所以先把伺服器的遭遇戰複製一份放進去，
   * 做完立刻換回原本的（本機的 state.encounter 不會被房間的怪物弄髒）。
   */
  async function withRoomEncounter(state, fn) {
    const room = getEncounter();
    if (!room) return fn();
    const saved = state.encounter;
    state.encounter = structuredClone(room);
    try { return await fn(); } finally { state.encounter = saved; }
  }

  // ---------- 招式與選目標 ----------
  const isAttackMove = (m) => m.kind !== 'heal' && m.kind !== 'shield';
  /** 出招用的招式：沒選或選的招式不見了，就挑第一個攻擊招式 */
  function ensureMove(state) {
    if (!state.moves.some((m) => m.id === sel.moveId)) sel.moveId = state.moves.find(isAttackMove)?.id ?? state.moves[0]?.id ?? null;
  }
  const currentMove = (state) => state.moves.find((m) => m.id === sel.moveId);
  /** 目前招式能打幾個目標（招式／技能規定，沒寫就是 1） */
  const capOf = (state) => Math.max(1, currentMove(state)?.targets ?? 1);

  /** 清掉不存在或已倒下的目標，並裁到目前招式的上限（換成目標比較少的招式時） */
  function pruneTargets(state) {
    const enc = currentEnc(state);
    sel.targets = sel.targets.filter((id) => { const m = enc.monsters.find((x) => x.id === id); return m && !isDowned(m); }).slice(0, capOf(state));
    if (sel.focusBoss && !enc.monsters.some((m) => m.id === sel.focusBoss)) sel.focusBoss = null;
  }

  function toggleTarget(state, m) {
    if (isDowned(m)) return;
    const cap = capOf(state);
    if (sel.targets.includes(m.id)) sel.targets = sel.targets.filter((id) => id !== m.id);
    else if (cap === 1) sel.targets = [m.id];
    else if (sel.targets.length >= cap) return toast(`「${currentMove(state)?.name ?? '這招'}」最多選 ${cap} 個目標。`);
    else sel.targets = [...sel.targets, m.id];
    return rerender();
  }

  /** 確保這隻被選為目標（已選就不動；招式只能打 1 個就換成它；滿了就提示） */
  function pickTarget(state, m) {
    if (!isDowned(m) && !sel.targets.includes(m.id)) return toggleTarget(state, m);
    return rerender();
  }

  function selectAllAlive(state) {
    const alive = currentEnc(state).monsters.filter((m) => !isDowned(m));
    const cap = capOf(state);
    sel.targets = alive.slice(0, cap).map((m) => m.id);
    if (alive.length > cap) toast(`「${currentMove(state)?.name ?? '這招'}」最多 ${cap} 個目標，已選前 ${cap} 個。`);
    rerender();
  }

  /** 左欄「出招」按鈕要顯示的目標 */
  function fireInfo() {
    const state = getState();
    pruneTargets(state);
    if (sel.targets.length) return { text: sel.targets.join('、'), ready: true };
    return { text: currentEnc(state).monsters.some((m) => !isDowned(m)) ? '先在中間選目標' : '場上沒有敵人', ready: false };
  }

  const defModeOf = (id) => sel.modes[id]?.def ?? 0;

  async function doAttack() {
    const state = getState();
    pruneTargets(state);
    if (!sel.targets.length) return toast('先在中間點選目標。');
    const targetIds = [...sel.targets];
    const modes = Object.fromEntries(targetIds.map((id) => [id, defModeOf(id)]));
    const hpBefore = state.hp;
    // 敵人 B 技能（防禦強化）蓄力過的，這一下絕對防禦多一些；鬥氣加骰：這次花幾點
    const encNow = currentEnc(state);
    const extraAbs = Object.fromEntries(targetIds.map((id) => [id, pendingEnemyB(encNow, encNow.monsters.find((x) => x.id === id) ?? { hp: 0 })]).filter(([, n]) => n > 0));
    const dou = Math.min(sel.dou, resourceNow(state, '鬥氣'));
    let r;
    let draw;
    let befores;
    let bosses;
    try {
      ({ r, draw, befores, bosses } = await withRoomEncounter(state, async () => {
        const before = new Map(state.encounter.monsters.map((x) => [x.id, x.hp]));
        const boss = new Set(state.encounter.monsters.filter((x) => x.kind === 'boss').map((x) => x.id));
        const res = await rollWith(state, (st, rng) => playerAttack(st, st.encounter, sel.moveId, targetIds[0], modes[targetIds[0]], rng, { yuwai: sel.yuwai, targetIds, modes, dou, extraAbs, respOff: [...sel.respOff] }));
        return { ...res, befores: before, bosses: boss };
      }));
    } catch (e) { return rollFailed(e); }
    if (r.error) return toast(r.error);
    sel.dou = 0;
    if (!online()) Object.keys(extraAbs).forEach((id) => spendEnemyB(state.encounter, id)); // 本機模式：蓄力用掉了（房間模式由伺服器扣）
    r.hits.forEach((x) => playFx(x.target.id, x.result.total > 0 ? 'hit' : 'block')); // 打中＝晃動閃光；沒破防＝護盾擋下
    const multi = r.hits.length > 1;
    const lines = [];
    r.hits.forEach((h2) => {
      if (multi) lines.push(targetLine(h2.target.id, h2.result.total));
      lines.push(...trackLines(h2.result));
      if (h2.ignoreAbs) lines.push('終焉武裝：無視絕對防禦'); else if (h2.abs) lines.push(`敵人絕對防禦 ${h2.abs}${h2.extraAbs ? `（含 B 技能 +${h2.extraAbs}）` : ''}`);
      lines.push(`${h2.target.id} 生命 ${fmt(befores.get(h2.target.id))} → ${fmt(h2.target.hp)} / ${fmt(h2.target.maxHp)}${h2.target.hp <= 0 ? '　倒下了！' : ''}`);
    });
    lines.push(...r.notes);
    if (r.potion) lines.push(`藥水加成：真實傷害 +${r.potion} 骰`);
    if (r.dou) lines.push(`鬥氣 −${r.dou}：真實傷害 +${r.douDice} 骰（用到的每一軌）`);
    lines.push(`花費：${costText(r.cost)}`);
    if (state.hp !== hpBefore) lines.push(`${state.name} 生命 ${fmt(hpBefore)} → ${fmt(state.hp)} / ${fmt(maxHp(state))}`);
    publish({
      who: state.name, kind: 'attack',
      label: `${r.move.name} → ${r.hits.map((x) => (bosses.has(x.target.id) ? `${x.target.id}（${BOSS_DEF_MODES[modes[x.target.id]]}）` : x.target.id)).join('、')}`,
      big: r.hits.reduce((a, x) => a + x.result.total + (x.bonus ?? 0) + (x.yuwai ?? 0), 0),
      tone: r.hits.some((x) => x.result.total > 0) ? 'ok' : 'fail',
      lines,
    }, { draw });
    if (online()) { // 怪物生命由伺服器改：回報這次打掉多少
      const hits = r.hits.map((x) => ({ id: x.target.id, dmg: Math.max(0, befores.get(x.target.id) - x.target.hp), ...(extraAbs[x.target.id] ? { usedB: true } : {}) })).filter((x) => x.dmg > 0 || x.usedB);
      if (hits.length) await act({ t: 'encHit', hits });
    }
    commit();
  }

  /** 賽博駭客的紀錄行：靈魂傷害沒破防 → 攻擊方扣精神意志顆 D4 */
  const reflectLine = (rf, id) => {
    if (!rf) return null;
    if (rf.skipped) return '賽博駭客：靈魂傷害未破防，但這回合已經觸發過（一回合只能 1 次）';
    return `賽博駭客：靈魂傷害未破防，${id} 立刻扣 ${rf.dice}D4 = ${fmt(rf.rolled)} 生命（實際 −${fmt(rf.lost)}）`;
  };

  async function doDefend(state, m) {
    const modes = sel.modes[m.id] ?? { atk: 0, def: 0 };
    const before = state.hp;
    // 敵人這回合還能打幾次（普通 1、菁英 2、BOSS 3）；A 技能蓄力過就多加骰。房間模式由伺服器扣次數
    let extraAtk = 0;
    try {
      if (online()) extraAtk = (await encounterAction({ t: 'encUse', id: m.id, use: 'atk' })).extraAtk ?? 0;
      else {
        const spent = spendEnemyAttack(state.encounter, m.id);
        if (spent.error) return toast(spent.error);
        extraAtk = spent.extraAtk;
      }
    } catch (e) { return toast(e.message || '操作失敗。'); }
    let r;
    let draw;
    try {
      ({ r, draw } = await withRoomEncounter(state, () => rollWith(state, (st, rng) => monsterAttack(st, st.encounter, m.id, modes.atk, rng, { extraAtk }))));
    } catch (e) { return rollFailed(e); }
    if (r.error) return toast(r.error);
    playFx(m.id, 'strike'); // 怪物撲過來
    publish({
      who: state.name, kind: 'defend', label: `${m.id} 攻擊${m.kind === 'boss' ? `（${BOSS_ATK_MODES[modes.atk]}）` : ''}`,
      big: r.result.total, tone: r.result.total > 0 ? 'fail' : 'ok',
      lines: [
        r.extraAtk ? `敵人 A 技能：這招每一軌各 +${r.extraAtk} 顆攻擊骰` : null,
        ...trackLines(r.result),
        r.potion ? `藥水加成：絕對防禦 +${r.potion} 骰（三軌）` : null,
        r.absorbed?.toShield ? `護盾吸收 ${fmt(r.absorbed.toShield)}` : null,
        `${state.name} 生命 ${fmt(before)} → ${fmt(state.hp)} / ${fmt(maxHp(state))}`,
        r.newlyDowned ? `${state.name} 倒地！` : null,
        reflectLine(r.reflect, m.id),
      ].filter(Boolean),
    }, { draw });
    if (r.reflect && !r.reflect.skipped) {
      toast(`賽博駭客觸發：${m.id} 立刻扣 ${fmt(r.reflect.lost)} 生命（${r.reflect.dice}D4 = ${fmt(r.reflect.rolled)}）。`);
      if (online() && r.reflect.lost > 0) await act({ t: 'encHit', hits: [{ id: m.id, dmg: r.reflect.lost }] }); // 怪物生命由伺服器改：回報這次反擊扣多少
    } else if (r.reflect?.skipped) toast('賽博駭客：這回合已經觸發過了（一回合只能 1 次）。');
    commit();
  }

  // ---------- 立繪 ----------
  /** 立繪圖片；沒有立繪（或讀不到）就顯示圖示 */
  function portrait(m, cls) {
    const empty = () => h('span', { class: `${cls} portrait--empty`, 'aria-hidden': 'true', text: glyph(m) });
    if (!online() || !m.img) return empty();
    const img = h('img', { class: cls, src: imageUrl(m.img), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(empty()), { once: true });
    return img;
  }

  /** GM：選檔案 → 縮小 → 上傳；assign = 怪物編號時直接套上去 */
  function pickAndUpload(assign = null, longest = 768) {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      ui.uploading = true; rerender();
      try {
        const shrunk = await shrinkImage(file, longest);
        if (!shrunk) return toast('圖片太大，縮小後還是超過上限，請換一張。');
        await uploadImage({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), ...shrunk, ...(assign ? { assign } : {}) });
        toast(assign ? `已上傳並套用到 ${assign}。` : '已上傳到立繪庫。');
      } catch (e) {
        toast(e?.message ? `上傳失敗：${e.message}` : '這個檔案讀不出來，請換一張圖片。');
      } finally { ui.uploading = false; rerender(); }
    }, { once: true });
    input.click();
  }

  function imageSelect(value, onChange, label) {
    const images = getRoomStatus().images ?? [];
    return h('select', { class: 'field', 'aria-label': label, onchange: (e) => onChange(e.target.value) },
      h('option', { value: '', text: '無立繪' }),
      images.map((im) => h('option', { value: im.id, selected: im.id === value ? true : null, text: im.name })));
  }

  // ---------- 先攻軸 ----------
  /** 先攻位置：抽完後玩家可以點自己的位置，再點想換的位置（GM 按「開打」後鎖定）；GM 隨時可以換 */
  function initiativeBar(enc) {
    if (!enc.order?.length) return null;
    const me = getRoomStatus().me;
    const gm = isGm();
    const icon = (o) => (o.kind === 'player' ? '🧑' : enc.monsters.find((m) => m.id === o.id)?.kind === 'boss' ? '👹' : '👾');
    const name = (o) => (o.kind === 'player' ? o.name : o.id);
    const canSwap = !enc.locked || gm;
    const mine = (o) => o.kind === 'player' && o.uid === me?.uid;
    const pick = (i) => {
      if (ui.swapFrom == null) {
        if (!gm && !mine(enc.order[i])) return toast('先點自己的位置，再點想換過去的位置。');
        ui.swapFrom = i;
        return rerender();
      }
      const from = ui.swapFrom;
      ui.swapFrom = null;
      if (from === i) return rerender();
      return act({ t: 'encSwap', a: from, b: i });
    };
    return h('div', { class: 'init' },
      h('p', { class: 'init__label', text: enc.locked ? `第 ${enc.round} 回合・輪到 ${name(enc.order[enc.turn])}` : '先攻位置（隨機）：玩家可以點選交換，GM 按「開打」後鎖定' }),
      h('ol', { class: 'init__list' }, enc.order.map((o, i) => {
        const down = o.kind === 'monster' && isDowned(enc.monsters.find((m) => m.id === o.id) ?? { hp: 1 });
        return h('li', { class: 'init__item' },
          h('button', {
            type: 'button', class: 'init__btn', dataset: { kind: o.kind, down: down ? '1' : '0', mine: mine(o) ? '1' : '0' },
            'aria-current': enc.locked && i === enc.turn ? 'step' : null, 'aria-pressed': String(ui.swapFrom === i),
            disabled: !online() || !canSwap, onclick: () => pick(i),
          },
          h('span', { class: 'init__no num', text: String(i + 1) }),
          h('span', { class: 'init__icon', 'aria-hidden': 'true', text: icon(o) }),
          h('span', { class: 'init__name', text: name(o) })));
      })));
  }

  function gmBar(enc) {
    if (!online()) { // 本機模式：沒有先攻順序，自己按「新回合」讓敵人的技能次數恢復
      return enc.monsters.length
        ? h('div', { class: 'row stage__gm' },
            h('span', { class: 'hint', text: `第 ${enc.round ?? 0} 回合` }),
            h('button', { type: 'button', class: 'btn btn--small', onclick: () => { nextRound(getState().encounter); rerender(); commit(); } }, '▶ 新回合（敵人技能次數恢復）'))
        : null;
    }
    if (!isGm()) return null;
    return h('div', { class: 'row stage__gm' },
      h('span', { class: 'hint', text: `第 ${enc.round ?? 0} 回合` }),
      h('button', { type: 'button', class: 'btn btn--small', title: '回合數 +1，敵人的技能次數與蓄力恢復（有先攻順序時，繞完一圈會自動進下一回合）', onclick: () => act({ t: 'encRound' }) }, '▶ 新回合'),
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { ui.swapFrom = null; act({ t: 'encInit' }); } }, '🎲 抽先攻'),
      h('button', { type: 'button', class: 'btn btn--small', disabled: !enc.order?.length || enc.locked, onclick: () => act({ t: 'encStart' }) }, '⚔️ 開打（鎖定）'),
      h('button', { type: 'button', class: 'btn btn--small', disabled: !enc.locked, onclick: () => act({ t: 'encNext' }) }, '下一位 ▶'));
  }

  // ---------- 敵人技能列與回合（2026/10 平衡更新，規則見 game/enemy.js） ----------
  const SKILL_TIPS = {
    A: '攻擊強化：用了之後，他的下一次攻擊每一軌各 +20 顆攻擊骰（一回合 1 次）',
    B: '防禦強化：用了之後，他下一次被打時絕對防禦多 20 顆（BOSS 30 顆）；普通 1 次、菁英與 BOSS 一回合 2 次',
    C: '喝血：只能在他自己的回合用，回復 ND16 生命（普通 10、菁英 20、BOSS 30 顆）；整場戰鬥只能 1 次（換回合不會恢復）',
  };
  /** 敵人用技能（GM；本機模式是自己）。房間模式由伺服器處理並寫紀錄 */
  function useSkill(state, m, skill) {
    if (online()) return act({ t: 'encUse', id: m.id, use: skill });
    const r = useEnemySkill(state.encounter, m.id, skill);
    if (r.error) return toast(r.error);
    publish({
      who: state.name, kind: 'note',
      label: skill === 'C' ? `遭遇：${m.id} 喝血（${r.dice}）` : `遭遇：${m.id} 使用 ${skill} 技能（${SKILL_NAMES[skill]}）`,
      lines: skill === 'C' ? [`${r.dice} = ${r.rolled}，回復 ${r.healed} 生命`] : [skill === 'A' ? `下一次攻擊，每一軌各 +${r.dice} 顆攻擊骰` : `下一次被打，絕對防禦 +${r.dice} 顆`],
    });
    return commit();
  }

  /** 一隻敵人的技能列：等級與每回合攻擊次數、A／B／C 剩餘次數與蓄力；只有 GM（本機是自己）按得動 */
  function skillBar(state, enc, m) {
    if (isDowned(m)) return null;
    const left = enemyLeft(enc, m);
    const info = ENEMY_RANKS[left.rank];
    const canUse = !online() || isGm();
    const charged = { A: left.chargeA, B: left.chargeB };
    return h('div', { class: 'eskills', dataset: { rank: left.rank } },
      h('span', { class: 'badge eskills__rank', title: `每回合攻擊 ${info.attacks} 次`, text: `${info.label}・${info.attacks} 打` }),
      h('span', { class: 'eskill eskill--atk num', title: '這回合還能打幾次', text: `攻 ${left.atk}/${info.attacks}` }),
      ['A', 'B', 'C'].map((k) => h('button', {
        type: 'button', class: 'eskill num', title: SKILL_TIPS[k], dataset: { skill: k, ready: charged[k] ? '1' : '0' },
        disabled: !canUse || left[k] < 1, 'aria-label': `${m.id} 使用 ${k} 技能：${SKILL_NAMES[k]}，剩 ${left[k]} 次`,
        onclick: () => useSkill(state, m, k),
      }, `${k}${k === 'C' ? '🩸' : k === 'A' ? '⚔' : '🛡'} ${left[k]}/${info[k].uses}${k === 'C' ? '・每場' : ''}${charged[k] ? ' ✓' : ''}`)));
  }

  /** 戰鬥結果（GM；本機是自己）：只記錄到紀錄裡，獎勵由 GM 另外發 */
  const RESULTS = [
    ['full', '完全勝利', 'ok', ['敵人被徹底擊敗。', '獲得全部獎勵（技能感悟、經驗、金幣、高級材料或 BOSS 特殊裝備）與配方；完美結局另有特殊紅利。']],
    ['repel', '擊退勝利', 'ok', ['敵人的血被打到固定值或達成特殊條件，退走或放棄戰鬥。', '獲得一半的獎勵與配方（沒有特殊紅利）。']],
    ['defeat', '戰敗', 'fail', ['玩家被打空血條或投降。', '什麼也不會得到，之後可能會有戰敗 CG。']],
  ];
  function resultBox(state) {
    if (online() && !isGm()) return null;
    return h('div', { class: 'row stage__result' },
      h('span', { class: 'field-label', text: '戰鬥結果' }),
      RESULTS.map(([id, label, tone, lines]) => h('button', {
        type: 'button', class: 'btn btn--small btn--ghost', dataset: { result: id },
        onclick: async (e) => {
          if (!(await askConfirm(e.currentTarget, { title: `記錄這場戰鬥的結果：${label}？`, lines, okText: '記錄' }))) return;
          publish({ who: state.name, kind: 'note', label: `戰鬥結束：${label}`, tone, lines });
        },
      }, label)));
  }

  // ---------- BOSS ----------
  const orderBadge = (id) => {
    const i = sel.targets.indexOf(id);
    return i >= 0 ? h('span', { class: 'pick-no num', 'aria-hidden': 'true', text: String(i + 1) }) : null;
  };

  /** A／B／C 三格數值 */
  const abcCells = (abc) => h('span', { class: 'abc' },
    TRACKS.map((t) => h('span', { class: 'abc__cell', dataset: { track: t } }, h('b', { text: t }), h('span', { class: 'num', text: fmt(abc[t]) }))));

  function bossHero(state, bosses) {
    const m = bosses.find((b) => b.id === sel.focusBoss) ?? bosses.find((b) => !isDowned(b)) ?? bosses[0];
    const downed = isDowned(m);
    const modes = sel.modes[m.id] ?? (sel.modes[m.id] = { atk: 0, def: 0 });
    const picked = sel.targets.includes(m.id);
    return h('section', { class: `boss${downed ? ' is-downed' : ''}`, 'aria-label': `BOSS ${m.id}`, dataset: { picked: picked ? '1' : '0' } },
      bosses.length > 1
        ? h('div', { class: 'boss__tabs', role: 'tablist', 'aria-label': '切換 BOSS' }, bosses.map((b) => h('button', {
            type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(b.id === m.id), dataset: { down: isDowned(b) ? '1' : '0' },
            onclick: () => { sel.focusBoss = b.id; rerender(); },
          }, b.id, sel.targets.includes(b.id) ? ` ・${sel.targets.indexOf(b.id) + 1}` : '')))
        : null,
      layeredBar(m, downed),
      h('button', {
        type: 'button', class: 'boss__art', 'aria-pressed': String(picked), disabled: downed, ...fxAttrs(m.id),
        'aria-label': `${picked ? '取消選取' : '選取'} ${m.id} 為目標`, onclick: () => toggleTarget(state, m),
      }, portrait(m, 'boss__img'), orderBadge(m.id)),
      h('div', { class: 'boss__stats' },
        h('div', { class: 'boss__group' },
          h('p', { class: 'boss__k' },
            h('span', { text: '🛡️ 防禦' }),
            h('small', { text: '點一種＝選它當目標，打它時用這一組' }),
            monsterAbs(m) ? h('span', { class: 'boss__abs num', text: `絕防 ${fmt(monsterAbs(m))}` }) : null),
          h('div', { class: 'boss__modes', role: 'radiogroup', 'aria-label': `${m.id} 的防禦模式` }, BOSS_DEF_MODES.map((name, i) => h('button', {
            type: 'button', class: 'boss-mode', role: 'radio', 'aria-checked': String(modes.def === i), dataset: { kind: 'def' },
            onclick: () => { modes.def = i; pickTarget(state, m); }, // 選防禦＝也把它選為目標（之前只換模式，出招會說還沒選目標）
          }, h('span', { class: 'boss-mode__name', text: name }), abcCells(monsterDef(m, i)))))),
        h('div', { class: 'boss__group' },
          h('p', { class: 'boss__k' },
            h('span', { text: '⚔️ 攻擊' }),
            h('small', { text: '點兩下＝你承受這一招' })),
          h('div', { class: 'boss__modes', 'aria-label': `${m.id} 的攻擊` }, BOSS_ATK_MODES.map((name, i) => {
            const armed = ui.armed === `${m.id}:${i}`;
            return h('button', {
              type: 'button', class: 'boss-mode', dataset: { kind: 'atk', armed: armed ? '1' : '0' }, disabled: downed,
              'aria-label': armed ? `再點一次確認承受 ${m.id} 的${name}` : `承受 ${m.id} 的${name}（要點兩下）`,
              onclick: () => confirmHit(`${m.id}:${i}`, () => { modes.atk = i; doDefend(state, m); }),
            }, h('span', { class: 'boss-mode__name', text: armed ? '再點一次確認' : name }), abcCells(monsterAtk(m, i)));
          }))),
        skillBar(state, currentEnc(state), m)));
  }

  // ---------- 小怪矩陣 ----------
  function mobCard(state, m) {
    const downed = isDowned(m);
    const picked = sel.targets.includes(m.id);
    const abs = monsterAbs(m);
    return h('li', { class: `mob${downed ? ' is-downed' : ''}`, ...fxAttrs(m.id, { picked: picked ? '1' : '0' }) },
      h('div', { class: 'mob__card' }, // 盾牌按鈕要貼在這張卡上，不能貼在整個 li（下面還有技能標籤，按鈕會跑到卡片外面）
      h('button', {
        type: 'button', class: 'mob__pick', 'aria-pressed': String(picked), disabled: downed,
        'aria-label': `${m.id}，生命 ${m.hp} / ${m.maxHp}${downed ? '，已倒下' : ''}，點一下${picked ? '取消選取' : '選為目標'}`,
        onclick: () => toggleTarget(state, m),
      },
      portrait(m, 'mob__img'),
      h('span', { class: 'mob__name', text: m.id }),
      h('span', { class: 'mob__hp', 'aria-hidden': 'true' }, h('span', { class: 'mob__fill', style: `width:${pctOf(m.hp, m.maxHp)}%` })),
      h('span', { class: 'mob__pct num', text: `${Math.ceil(pctOf(m.hp, m.maxHp))}%` }),
      h('span', { class: 'mob__def num', text: `${TRACKS.map((t) => `${t}${fmt(m.def[t])}`).join(' ')}${abs ? `・絕${fmt(abs)}` : ''}` }),
      orderBadge(m.id)),
      h('button', {
        type: 'button', class: 'mob__hit', disabled: downed, dataset: { armed: ui.armed === m.id ? '1' : '0' },
        title: ui.armed === m.id ? '再點一次確認' : `承受 ${m.id} 的攻擊（${formatAbc(m.atk)}），要點兩下`,
        'aria-label': ui.armed === m.id ? `再點一次確認承受 ${m.id} 的攻擊` : `承受 ${m.id} 的攻擊（要點兩下）`,
        onclick: () => confirmHit(m.id, () => doDefend(state, m)),
      }, ui.armed === m.id ? '✔' : '🛡️')),
      skillBar(state, currentEnc(state), m));
  }

  function targetBar(state, enc) {
    if (!enc.monsters.length) return null;
    const move = currentMove(state);
    const cap = capOf(state);
    return h('div', { class: 'stage__targetbar' },
      h('span', { class: 'stage__targetinfo' },
        move ? `${move.name}・可選 ${cap} 個` : '先在左邊選招式',
        h('strong', { class: 'num', text: `　已選 ${sel.targets.length}` })),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: !enc.monsters.some((m) => !isDowned(m)), onclick: () => selectAllAlive(state) }, '全選存活'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: !sel.targets.length, onclick: () => { sel.targets = []; rerender(); } }, '清除選取'));
  }

  // ---------- GM：新增敵人、立繪、管理 ----------
  function numField(label, key, min = 0) {
    return h('label', { class: 'extra' },
      h('span', { text: label }),
      h('input', { class: 'field', type: 'number', min, value: ui.form[key], onchange: (e) => { ui.form[key] = num(e.target.value, min); } }));
  }

  /** 強度分配：類型（隨機／單軌集中／雙軌／平均）＋集中在哪一軌或哪兩軌（選了類型才出現） */
  const SPLIT_LABELS = [['', '隨機'], ['extreme', '單軌集中'], ['dual', '雙軌'], ['balanced', '平均']];
  function splitPicker(side) {
    const f = ui.form;
    const names = side === 'atk' ? TRACK_ATK_STAT : TRACK_DEF_STAT;
    const type = f[`${side}Type`];
    const focusLabel = (k) => k.split('').map((t) => `${t}（${names[t].slice(0, 2)}）`).join('＋');
    return h('div', { class: 'split-pick' },
      h('label', { class: 'extra' }, h('span', { text: side === 'atk' ? '攻擊分配' : '防禦分配' }),
        h('select', {
          class: 'field', 'aria-label': side === 'atk' ? '攻擊強度的分配方式' : '防禦強度的分配方式',
          onchange: (e) => { f[`${side}Type`] = e.target.value; f[`${side}Focus`] = ''; rerender(); },
        }, SPLIT_LABELS.map(([v, label]) => h('option', { value: v, selected: v === type ? true : null, text: label })))),
      SPLIT_FOCUS[type]
        ? h('label', { class: 'extra' }, h('span', { text: type === 'extreme' ? '集中在' : '集中在這兩軌' }),
            h('select', { class: 'field', 'aria-label': '集中在哪', onchange: (e) => { f[`${side}Focus`] = e.target.value; } },
              h('option', { value: '', text: '隨機' }),
              SPLIT_FOCUS[type].map((k) => h('option', { value: k, selected: k === f[`${side}Focus`] ? true : null, text: focusLabel(k) }))))
        : null);
  }

  function enemyForm(state) {
    const f = ui.form;
    return h('section', { class: 'gm-tools__sec' },
      h('h3', { class: 'tray__title', text: '新增敵人' }),
      h('div', { class: 'toggle-row' },
        [['mob', '小怪（普通）'], ['elite', '菁英（2 打）'], ['boss', 'BOSS（3 打）']].map(([id, label]) => h('button', {
          type: 'button', class: 'toggle', 'aria-pressed': String(f.kind === id), onclick: () => { f.kind = id; rerender(); },
        }, label))),
      h('div', { class: 'extra-row' }, numField('數量', 'count', 1), numField('攻擊強度', 'atk'), numField('防禦強度', 'def'), numField('血量', 'hp', 1), numField('絕對防禦（選填）', 'absDef')),
      h('p', { class: 'hint', text: '強度分配：隨機＝照機器人三種隨機抽；單軌集中＝一軌 50～70%；雙軌＝兩軌高、一軌 0～25%；平均＝三軌各 1/3。可以再選集中在哪（BOSS 的三組都套用同一種，比例各自隨機）。區域補正選填，例如 5A 3C，會加在每隻身上。' }),
      h('div', { class: 'extra-row split-row' }, splitPicker('atk'), splitPicker('def')),
      h('div', { class: 'extra-row' },
        h('label', { class: 'extra' }, h('span', { text: '攻擊補正（選填）' }),
          h('input', { class: 'field', type: 'text', placeholder: '5A 3C', value: f.atkMod, onchange: (e) => { f.atkMod = e.target.value; } })),
        h('label', { class: 'extra' }, h('span', { text: '防禦補正（選填）' }),
          h('input', { class: 'field', type: 'text', placeholder: '2B', value: f.defMod, onchange: (e) => { f.defMod = e.target.value; } })),
        online() && isGm()
          ? h('label', { class: 'extra' }, h('span', { text: '立繪（選填）' }), imageSelect(f.img, (v) => { f.img = v; }, '新敵人的立繪'))
          : null),
      h('button', {
        type: 'button', class: 'btn btn--primary btn--small',
        onclick: () => {
          if (f.count > 20) return toast('一次最多 20 隻。');
          const spec = { count: f.count, atkPower: f.atk, defPower: f.def, hp: f.hp, atkMod: f.atkMod, defMod: f.defMod, absDef: f.absDef };
          for (const side of ['atk', 'def']) { // 指定的分配方式（沒選＝隨機，不送）
            if (f[`${side}Type`]) spec[`${side}Type`] = f[`${side}Type`];
            if (f[`${side}Type`] && f[`${side}Focus`]) spec[`${side}Focus`] = f[`${side}Focus`];
          }
          if (online()) return act({ t: 'encAdd', kind: f.kind, spec, ...(f.img ? { img: f.img } : {}) });
          const added = f.kind === 'boss' ? addBosses(state.encounter, spec) : addMobs(state.encounter, { ...spec, ...(f.kind === 'elite' ? { rank: 'elite' } : {}) });
          publish({ who: state.name, kind: 'note', label: `遭遇：新增 ${added.map((m) => m.id).join('、')}`, lines: [] });
          return commit();
        },
      }, '加入遭遇戰'));
  }

  function removeEnemy(state, m) {
    delete sel.modes[m.id];
    sel.targets = sel.targets.filter((id) => id !== m.id);
    if (online()) act({ t: 'encRemove', id: m.id }); else { removeMonster(state.encounter, m.id); commit(); }
  }

  /** 敵人管理：換立繪（GM）、移除 */
  function manageBox(state, enc) {
    if (!enc.monsters.length) return null;
    const gmOnline = online() && isGm();
    return h('section', { class: 'gm-tools__sec' },
      h('h3', { class: 'tray__title', text: `場上的敵人（${enc.monsters.length}）` }),
      h('ul', { class: 'manage' }, enc.monsters.map((m) => h('li', { class: 'manage__row' },
        h('span', { class: 'manage__name', text: `${glyph(m)} ${m.id}` }),
        gmOnline ? imageSelect(m.img ?? '', (v) => act({ t: 'encImg', id: m.id, img: v || null }), `${m.id} 的立繪`) : null,
        gmOnline ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.uploading, onclick: () => pickAndUpload(m.id, m.kind === 'boss' ? 768 : 256) }, '上傳立繪') : null,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => removeEnemy(state, m) }, '移除')))));
  }

  // ---------- 敵人預組（GM 備團）：把場上抽好的整團存起來，跑團時一鍵換上；模擬戰也能選 ----------
  async function presetDo(msg, done) {
    try { ui.presets = await presetAction(msg); if (done) toast(done); } catch (e) { toast(e.message || '操作失敗。'); }
    rerender();
  }
  const presetSummary = (p) => {
    const boss = p.monsters.filter((m) => m.kind === 'boss').length;
    const mob = p.monsters.length - boss;
    return [boss ? `👹×${boss}` : '', mob ? `👾×${mob}` : ''].filter(Boolean).join(' ');
  };

  function presetBox(enc) {
    if (!online() || !isGm()) return null;
    if (ui.presets === null) { ui.presets = []; presetDo({ t: 'presetList' }); }
    const save = async (anchor) => {
      const name = ui.presetName.trim();
      if (!name) return toast('先幫這團取個名字。');
      if (ui.presets.some((p) => p.name === name) && !(await askConfirm(anchor, { title: `已經有「${name}」`, lines: ['要用場上的敵人覆蓋嗎？'], okText: '覆蓋', danger: true }))) return undefined;
      ui.presetName = '';
      return presetDo({ t: 'presetSave', name }, `已存成預組「${name}」。`);
    };
    return h('section', { class: 'gm-tools__sec' },
      h('h3', { class: 'tray__title', text: `敵人預組（${ui.presets.length}）` }),
      h('p', { class: 'hint', text: '把場上抽好的整團敵人（A/B/C 不會再變）存起來：跑團時一鍵換上，模擬戰也能選它當固定敵人。只有 GM 看得到。' }),
      h('div', { class: 'row preset-save' },
        h('input', {
          class: 'field', type: 'text', maxlength: 40, placeholder: '預組名稱，例如：第三章魔王戰', value: ui.presetName, 'aria-label': '預組名稱',
          oninput: (e) => { ui.presetName = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') save(e.currentTarget); },
        }),
        h('button', { type: 'button', class: 'btn btn--small', disabled: !enc.monsters.length, onclick: (e) => save(e.currentTarget) }, '把場上的敵人存成預組')),
      ui.presets.length
        ? h('ul', { class: 'manage' }, ui.presets.map((p) => h('li', { class: 'manage__row' },
            h('span', { class: 'manage__name', text: p.name }),
            h('small', { class: 'hint', text: presetSummary(p) }),
            h('button', {
              type: 'button', class: 'btn btn--primary btn--small',
              onclick: async (e) => {
                if (getEncounter()?.monsters.length && !(await askConfirm(e.currentTarget, { title: `用「${p.name}」取代場上目前的敵人？`, lines: ['先攻會清空。'], okText: '換上場' }))) return;
                sel.targets = []; sel.modes = {};
                presetDo({ t: 'presetLoad', name: p.name }, `已換上「${p.name}」。`);
              },
            }, '換上場'),
            h('button', {
              type: 'button', class: 'btn btn--ghost btn--small',
              onclick: async (e) => { if (await askConfirm(e.currentTarget, { title: `刪除預組「${p.name}」？`, okText: '刪除', danger: true })) presetDo({ t: 'presetDel', name: p.name }); },
            }, '刪除'))))
        : null);
  }

  /** 立繪庫（GM）：上傳、刪除 */
  function libraryBox() {
    if (!online() || !isGm()) return null;
    const images = getRoomStatus().images ?? [];
    return h('section', { class: 'gm-tools__sec' },
      h('h3', { class: 'tray__title', text: `立繪庫（${images.length}）` }),
      h('p', { class: 'hint', text: '上傳後會自動縮小。指定給怪物後，所有玩家會即時看到。刪除立繪時，用到它的怪物會改回圖示。' }),
      h('button', { type: 'button', class: 'btn btn--small', disabled: ui.uploading, onclick: () => pickAndUpload(null) }, ui.uploading ? '上傳中…' : '＋ 上傳新立繪'),
      images.length
        ? h('ul', { class: 'library' }, images.map((im) => h('li', { class: 'library__item' },
            h('img', { class: 'library__img', src: imageUrl(im.id), alt: '', loading: 'lazy' }),
            h('span', { class: 'library__name', text: im.name }),
            h('button', {
              type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': `刪除立繪 ${im.name}`,
              onclick: async (e) => {
                if (!(await askConfirm(e.currentTarget, { title: `刪除立繪「${im.name}」？`, okText: '刪除', danger: true }))) return;
                try { await deleteImage(im.id); } catch (e) { toast(e.message || '刪除失敗。'); }
              },
            }, '刪除'))))
        : null);
  }

  // ---------- 組合 ----------
  function stage() {
    const state = getState();
    ensureMove(state);
    pruneTargets(state);
    const enc = currentEnc(state);
    const canEdit = !online() || isGm();
    const bosses = enc.monsters.filter((m) => m.kind === 'boss');
    const mobs = enc.monsters.filter((m) => m.kind !== 'boss');
    const yuwaiOn = state.skills?.域外魔祖 && currentMove(state)?.school === '修仙';
    return h('div', { class: 'stage' },
      h('div', { class: 'stage__head' },
        h('h2', { class: 'section-title', text: '遭遇戰' }),
        canEdit && enc.monsters.length
          ? h('button', {
              type: 'button', class: 'btn btn--ghost btn--small',
              onclick: async (e) => {
                if (!(await askConfirm(e.currentTarget, { title: '清空所有敵人？', okText: '清空', danger: true }))) return;
                sel.modes = {}; sel.targets = [];
                if (online()) act({ t: 'encClear' }); else { state.encounter = newEncounter(); commit(); }
              },
            }, '清空')
          : null),
      initiativeBar(enc),
      gmBar(enc),
      enc.monsters.length ? resultBox(state) : null,
      bosses.length ? bossHero(state, bosses) : null,
      mobs.length ? h('ul', { class: 'mobs', 'aria-label': '敵方隨從' }, mobs.map((m) => mobCard(state, m))) : null,
      enc.monsters.length
        ? null
        : h('p', { class: 'notice stage__empty', text: online() ? '場上沒有敵人，等 GM 建立。' : '還沒有敵人。從下面新增。' }),
      targetBar(state, enc),
      yuwaiOn
        ? h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: sel.yuwai ? true : null, onchange: (e) => { sel.yuwai = e.target.checked; } }),
            h('span', { text: '域外魔祖：這次攻擊花 30 靈氣，追加扣目標現有生命 10%' }))
        : null,
      canEdit
        ? addBox('gm', online() ? '⚙️ 敵人與立繪（GM）' : '⚙️ 新增與管理敵人', h('div', { class: 'gm-tools' }, enemyForm(state), manageBox(state, enc), presetBox(enc), libraryBox()))
        : null);
  }

  /** 手機頂部的目標條：選中的目標（沒選就顯示 BOSS）的血量 */
  function targetStrip() {
    const state = getState();
    pruneTargets(state);
    const enc = currentEnc(state);
    const list = sel.targets.length
      ? sel.targets.map((id) => enc.monsters.find((m) => m.id === id)).filter(Boolean)
      : enc.monsters.filter((m) => m.kind === 'boss' && !isDowned(m)).slice(0, 1);
    if (!list.length) return null;
    return h('ul', { class: 'tstrip', 'aria-label': '目標血量' }, list.map((m) => h('li', { class: 'tstrip__item' },
      h('span', { class: 'tstrip__name', text: `${sel.targets.includes(m.id) ? `${sel.targets.indexOf(m.id) + 1}. ` : ''}${glyph(m)} ${m.id}` }),
      hpBar(m.hp, m.maxHp, isDowned(m)))));
  }

  return { render: stage, attack: doAttack, fireInfo, targetStrip };
}
