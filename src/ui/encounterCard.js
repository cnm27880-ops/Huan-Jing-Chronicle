// ============================================================
// 遭遇戰舞台（跑團頁中間）：先攻軸、BOSS 大立繪與多段血條、小怪矩陣、選目標、隊友血量、GM 工具。
// 規則在 combat.js；結果用 rollLog 的 publish／rollWith 發布。
// 已加入房間：敵人由 GM 建立、存在伺服器、全員共享；怪物生命只有伺服器會改（玩家回報傷害）。
// 沒加入房間（本機模式）：照舊由自己建立，存在角色存檔裡（單人試玩）。
// 選目標：點卡片選取（可多選，依點選順序），最多到目前招式的目標數；出招按鈕在左欄的招式上。
// ============================================================
import { h, fmt } from './dom.js';
import { toast, rollFailed } from './controls.js';
import { TRACKS, TRACK_ATK_STAT, TRACK_DEF_STAT } from '../game/rules.js';
import {
  formatAbc, monsterAbs, addMobs, addBosses, removeMonster, newEncounter, playerAttack, monsterAttack,
  isDowned, monsterAtk, monsterDef, BOSS_ATK_MODES, BOSS_DEF_MODES, SPLIT_FOCUS,
} from '../game/combat.js';
import { maxHp } from '../game/stats.js';
import { costText } from '../game/resources.js';
import {
  publish, rollWith, getEncounter, encounterAction, getRoomStatus, imageUrl, uploadImage, deleteImage,
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

/** BOSS 的多段血條：例如 300 血畫成 3 條 100，打完一條換下一條顏色 */
function layeredBar(cur, max) {
  const per = max / BOSS_LAYERS;
  const left = cur <= 0 ? 0 : Math.min(BOSS_LAYERS, Math.ceil(cur / per - 1e-9));
  const inLayer = cur <= 0 ? 0 : cur - (left - 1) * per;
  return h('div', { class: 'lbar', dataset: { layer: String(left) }, role: 'img', 'aria-label': `生命 ${cur} / ${max}，剩 ${left} 條` },
    h('div', { class: 'lbar__track' },
      h('div', { class: 'lbar__fill', style: `width:${pctOf(inLayer, per)}%` }),
      h('span', { class: 'lbar__text num', text: `${fmt(cur)} / ${fmt(max)}` })),
    h('span', { class: 'lbar__count num', text: `×${left}` }));
}

const trackLines = (result) => result.tracks.filter((t) => t.atkDice > 0).map(trackLine);
const glyph = (m) => (m.kind === 'boss' ? '👹' : '👾');

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
    let r;
    let draw;
    let befores;
    let bosses;
    try {
      ({ r, draw, befores, bosses } = await withRoomEncounter(state, async () => {
        const before = new Map(state.encounter.monsters.map((x) => [x.id, x.hp]));
        const boss = new Set(state.encounter.monsters.filter((x) => x.kind === 'boss').map((x) => x.id));
        const res = await rollWith(state, (st, rng) => playerAttack(st, st.encounter, sel.moveId, targetIds[0], modes[targetIds[0]], rng, { yuwai: sel.yuwai, targetIds, modes }));
        return { ...res, befores: before, bosses: boss };
      }));
    } catch (e) { return rollFailed(e); }
    if (r.error) return toast(r.error);
    const multi = r.hits.length > 1;
    const lines = [];
    r.hits.forEach((h2) => {
      if (multi) lines.push(targetLine(h2.target.id, h2.result.total));
      lines.push(...trackLines(h2.result));
      if (h2.ignoreAbs) lines.push('終焉武裝：無視絕對防禦'); else if (h2.abs) lines.push(`敵人絕對防禦 ${h2.abs}`);
      lines.push(`${h2.target.id} 生命 ${fmt(befores.get(h2.target.id))} → ${fmt(h2.target.hp)} / ${fmt(h2.target.maxHp)}${h2.target.hp <= 0 ? '　倒下了！' : ''}`);
    });
    lines.push(...r.notes);
    if (r.potion) lines.push(`藥水加成：真實傷害 +${r.potion} 骰`);
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
      const hits = r.hits.map((x) => ({ id: x.target.id, dmg: Math.max(0, befores.get(x.target.id) - x.target.hp) })).filter((x) => x.dmg > 0);
      if (hits.length) await act({ t: 'encHit', hits });
    }
    commit();
  }

  async function doDefend(state, m) {
    const modes = sel.modes[m.id] ?? { atk: 0, def: 0 };
    const before = state.hp;
    let r;
    let draw;
    try {
      ({ r, draw } = await withRoomEncounter(state, () => rollWith(state, (st, rng) => monsterAttack(st, st.encounter, m.id, modes.atk, rng))));
    } catch (e) { return rollFailed(e); }
    if (r.error) return toast(r.error);
    publish({
      who: state.name, kind: 'defend', label: `${m.id} 攻擊${m.kind === 'boss' ? `（${BOSS_ATK_MODES[modes.atk]}）` : ''}`,
      big: r.result.total, tone: r.result.total > 0 ? 'fail' : 'ok',
      lines: [
        ...trackLines(r.result),
        r.potion ? `藥水加成：絕對防禦 +${r.potion} 骰（三軌）` : null,
        r.absorbed?.toShield ? `護盾吸收 ${fmt(r.absorbed.toShield)}` : null,
        `${state.name} 生命 ${fmt(before)} → ${fmt(state.hp)} / ${fmt(maxHp(state))}`,
        r.newlyDowned ? `${state.name} 倒地！（不會死亡）` : null,
      ].filter(Boolean),
    }, { draw });
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
    if (!online() || !isGm()) return null;
    return h('div', { class: 'row stage__gm' },
      h('button', { type: 'button', class: 'btn btn--small', onclick: () => { ui.swapFrom = null; act({ t: 'encInit' }); } }, '🎲 抽先攻'),
      h('button', { type: 'button', class: 'btn btn--small', disabled: !enc.order?.length || enc.locked, onclick: () => act({ t: 'encStart' }) }, '⚔️ 開打（鎖定）'),
      h('button', { type: 'button', class: 'btn btn--small', disabled: !enc.locked, onclick: () => act({ t: 'encNext' }) }, '下一位 ▶'));
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
      h('div', { class: 'boss__head' },
        h('strong', { class: 'boss__name', text: `👹 ${m.id}` }),
        downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒下' } ) : null),
      layeredBar(m.hp, m.maxHp),
      h('button', {
        type: 'button', class: 'boss__art', 'aria-pressed': String(picked), disabled: downed,
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
          })))));
  }

  // ---------- 小怪矩陣 ----------
  function mobCard(state, m) {
    const downed = isDowned(m);
    const picked = sel.targets.includes(m.id);
    const abs = monsterAbs(m);
    return h('li', { class: `mob${downed ? ' is-downed' : ''}`, dataset: { picked: picked ? '1' : '0' } },
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
      }, ui.armed === m.id ? '✔' : '🛡️'));
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

  // ---------- 我方隊伍 ----------
  function partyRow() {
    const r = getRoomStatus();
    if (r.phase !== 'online') return null;
    const gm = new Set(r.gm?.uids ?? []);
    const onlineIds = new Set(r.members.filter((m) => m.online).map((m) => m.uid));
    const mates = Object.entries(r.vitals ?? {}).filter(([uid]) => uid !== r.me?.uid && !gm.has(uid));
    return h('section', { class: 'party', 'aria-label': '我方隊伍' },
      h('h3', { class: 'tray__title', text: '我方隊伍' }),
      mates.length
        ? h('ul', { class: 'party__list' }, mates.map(([uid, v]) => h('li', { class: `mate${v.downed ? ' is-downed' : ''}`, dataset: { online: onlineIds.has(uid) ? '1' : '0' } },
            h('span', { class: 'mate__name', text: v.name }),
            v.downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒地' }) : null,
            h('span', { class: 'mate__bar', role: 'img', 'aria-label': `生命 ${v.hp} / ${v.maxHp}` }, h('span', { class: 'mate__fill', style: `width:${pctOf(v.hp, v.maxHp)}%` })),
            h('span', { class: 'mate__hp num', text: `${fmt(v.hp)} / ${fmt(v.maxHp)}${v.shield ? `　🛡${fmt(v.shield)}` : ''}` }),
            h('span', { class: 'mate__res' }, Object.entries(v.res ?? {}).map(([k, [now, max]]) => h('span', { title: `${k} ${now} / ${max}`, text: `${k} ${fmt(now)}` })),
              v.tox != null ? h('span', { text: `毒 ${v.tox}` }) : null))))
        : h('p', { class: 'hint', text: '隊友上線並操作過角色後，這裡會顯示他們的血量。' }));
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
        [['mob', '小怪'], ['boss', 'BOSS']].map(([id, label]) => h('button', {
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
          const added = (f.kind === 'boss' ? addBosses : addMobs)(state.encounter, spec);
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
              onclick: async () => {
                if (!confirm(`刪除立繪「${im.name}」？`)) return;
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
              onclick: () => {
                if (!confirm('清空所有敵人？')) return;
                sel.modes = {}; sel.targets = [];
                if (online()) act({ t: 'encClear' }); else { state.encounter = newEncounter(); commit(); }
              },
            }, '清空')
          : null),
      initiativeBar(enc),
      gmBar(enc),
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
      partyRow(),
      canEdit
        ? addBox('gm', online() ? '⚙️ 敵人與立繪（GM）' : '⚙️ 新增與管理敵人', h('div', { class: 'gm-tools' }, enemyForm(state), manageBox(state, enc), libraryBox()))
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
