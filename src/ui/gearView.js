// ============================================================
// 裝備頁：數值面板、裝備欄（武器 1、防具 1、飾品 2）、鑑定（開獎）、背包裝備整理
// 設計原則：玩家會一次鍛造很多件再挑最好的，所以鑑定可以一次多件，並自動標出「比身上好」的
// ============================================================
import { h, fmt } from './dom.js';
import { toast, rollFailed, rarityTag } from './controls.js';
import { iconOf } from './items.js';
import { openFoodSheet } from './statusBar.js';
import {
  ATK_STATS, DEF_STATS, RESOURCE_STATS, EQUIP_SLOTS, EQUIP_SLOT_LABEL, GEAR_TIERS,
} from '../game/rules.js';
import {
  identifiable, identify, equip, unequip, discard, compareGear, findJunk, gearName, effectText, gearDiceText,
} from '../game/equipment.js';
import { derivedStats } from '../game/stats.js';
import { SKILL_CATALOG, RULE_SKILLS, moveFromCatalog } from '../game/skills.js';
import { publish, rollWith } from '../state/rollLog.js';

const tierIndex = (g) => GEAR_TIERS.indexOf(g.tier);
const SLOT_ORDER = { weapon: 0, armor: 1, accessory: 2 };
const BADGE = {
  empty: ['空欄位', 'good'],
  better: ['比身上好 ↑', 'good'],
  worse: ['比身上差', 'bad'],
  same: ['和身上一樣', 'bad'],
  different: ['不同屬性', 'neutral'],
};
const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);
const FILTERS = [['all', '全部'], ['weapon', '武器'], ['armor', '防具'], ['accessory', '飾品']];

export function createGearView({ root, getState, commit }) {
  const ui = { filter: 'all', batch: null, newSkill: '', newSkillLv: 1, skillBoxOpen: false };

  const gearValue = (g) => g.effects.reduce((a, e) => a + e.value, 0);

  // ---------- 數值面板 ----------
  function statCell(p, stat, extra) {
    const x = p[stat];
    const detail = x.parts.length > 1 ? x.parts.map((q) => `${q.label} ${fmt(q.value)}`).join('　') : '';
    return h('div', { class: 'stat', title: detail },
      h('span', { class: 'stat__name', text: stat }),
      h('strong', { class: 'stat__value', text: fmt(x.total) }),
      extra ?? null,
      detail ? h('small', { class: 'stat__detail', text: detail }) : null);
  }

  function panelCard(state) {
    const p = derivedStats(state);
    const group = (title, list) => h('div', { class: 'stat-group' },
      h('p', { class: 'field-label', text: title }),
      h('div', { class: 'stat-grid' }, list.map((s) => statCell(p, s, s === '生命' ? h('small', { class: 'stat__detail', text: `目前 ${fmt(state.hp)}` }) : null))));
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '數值面板' }),
      h('p', { class: 'hint', text: '基礎 + 裝備 + 跑團胃袋的食物。滑過數字可看明細。' }),
      group('攻擊', ATK_STATS),
      group('防禦', DEF_STATS),
      group('資源', RESOURCE_STATS),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => openFoodSheet(state, 'session', commit) }, '🍽️ 跑團胃袋吃東西'));
  }

  // ---------- 技能等級（原本在戰鬥頁，功能不變） ----------
  function skillCard(state) {
    const entries = Object.entries(state.skills ?? {});
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '技能等級（會影響戰鬥規則的）' }),
      h('p', { class: 'hint', text: '暴徒、魔女、終焉武裝、域外魔祖、不可名狀是被動規則；納米醫療蜂、生生造化印、吞天噬血陣、萬物歸一的等級決定威力。其他技能的「每級加數值」已包含在基礎數值裡。' }),
      entries.length
        ? h('ul', { class: 'skill-list' }, entries.map(([name, lv]) => h('li', { class: 'skill-row' },
            h('strong', { text: name }),
            h('label', { class: 'extra' }, h('span', { text: '等級' }),
              h('input', { class: 'field', type: 'number', min: 1, max: 10, value: lv, onchange: (e) => { state.skills[name] = Math.max(1, Math.min(10, num(e.target.value, 1))); commit(); } })),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { delete state.skills[name]; commit(); } }, '移除'))))
        : h('p', { class: 'notice', text: '還沒有登錄技能。' }),
      h('details', {
        class: 'add-box', open: ui.skillBoxOpen,
        ontoggle: (e) => { ui.skillBoxOpen = e.target.open; },
      },
      h('summary', { text: '＋ 登錄技能 / 從技能庫加入招式' }),
      h('div', { class: 'row' },
        h('select', { class: 'field', 'aria-label': '技能', onchange: (e) => { ui.newSkill = e.target.value; } },
          h('option', { value: '', text: '選擇技能…' }),
          RULE_SKILLS.filter((n) => !(n in (state.skills ?? {}))).map((n) => h('option', { value: n, selected: ui.newSkill === n ? true : null, text: n }))),
        h('input', { class: 'field', type: 'number', min: 1, max: 10, value: ui.newSkillLv, 'aria-label': '等級', onchange: (e) => { ui.newSkillLv = Math.max(1, Math.min(10, num(e.target.value, 1))); } }),
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small',
          onclick: () => {
            const n = ui.newSkill;
            if (!n) return toast('先選一個技能。');
            state.skills = { ...state.skills, [n]: ui.newSkillLv };
            // 有招式的技能（技能庫）自動加進招式清單
            if (SKILL_CATALOG[n] && !state.moves.some((m) => m.skill === n)) state.moves.push(moveFromCatalog(n));
            ui.newSkill = '';
            commit();
          },
        }, '加入'))));
  }

  // ---------- 裝備欄 ----------
  function slotCard(state, key) {
    const g = state.equipment[key];
    return h('div', { class: `gear-slot${g ? ' rarity' : ' is-empty'}`, dataset: { tier: g ? tierIndex(g) : 'none', rarity: g ? tierIndex(g) : 'none' } },
      h('span', { class: 'gear-slot__label', text: EQUIP_SLOT_LABEL[key] }),
      g
        ? [
            h('strong', { class: 'gear-slot__name rarity__name', text: `${iconOf(gearName(g))} ${gearName(g)}` }),
            rarityTag(tierIndex(g)),
            h('span', { class: 'gear-slot__effect', text: effectText(g) }),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { unequip(state, key); commit(); } }, '卸下'),
          ]
        : h('span', { class: 'gear-slot__effect', text: '空著' }));
  }

  function slotsCard(state) {
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '裝備欄' }),
      h('div', { class: 'gear-slots' }, EQUIP_SLOTS.map((k) => slotCard(state, k))));
  }

  // ---------- 鑑定 ----------
  async function runIdentify(state, name, times) {
    let made;
    let draw;
    try { ({ r: made, draw } = await rollWith(state, (st, rng) => identify(st, name, times, rng))); } catch (e) { return rollFailed(e); }
    if (!made.length) return toast('沒有可以鑑定的裝備。');
    const rows = made.map((g) => ({ g, cmp: compareGear(state, g) }));
    ui.batch = { name, ids: made.map((g) => g.id) };
    const best = [...made].sort((a, b) => gearValue(b) - gearValue(a))[0];
    const upgrades = rows.filter((r) => r.cmp === 'better' || r.cmp === 'empty').length;
    publish({
      who: state.name, kind: 'identify', label: `鑑定 ${name} ×${made.length}`,
      big: made.length === 1 ? effectText(best) : `最高 ${effectText(best)}`,
      lines: [
        ...made.slice(0, 5).map((g) => `${gearName(g)}：${effectText(g)}${g.roll?.d4 === 4 && g.slot !== 'accessory' ? '（1D4 擲出 4）' : ''}`),
        made.length > 5 ? `…共 ${made.length} 件，其中 ${upgrades} 件比身上好` : null,
      ].filter(Boolean),
    }, { draw });
    commit();
  }

  function identifyCard(state) {
    const list = identifiable(state);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '鑑定' }),
      h('p', { class: 'hint', text: '鍛造得到的是通用裝備。鑑定時才會骰出數值，每件固定下來。可以一次鑑定很多件，結果會出現在骰盤紀錄，所有人都看得到。' }),
      list.length
        ? h('div', { class: 'identify-list' }, list.map((x) =>
            h('div', { class: 'identify rarity', dataset: { tier: GEAR_TIERS.indexOf(x.tier), rarity: GEAR_TIERS.indexOf(x.tier) } },
              h('div', { class: 'identify__info' },
                h('strong', { class: 'rarity__name', text: `${iconOf(x.name)} ${x.name}` }),
                rarityTag(GEAR_TIERS.indexOf(x.tier)),
                h('span', { class: 'identify__qty', text: `×${fmt(x.qty)}` }),
                h('small', { text: gearDiceText(x.tier, x.slot) })),
              h('div', { class: 'identify__btns' },
                [1, 10, 50].filter((n) => n < x.qty).map((n) =>
                  h('button', { type: 'button', class: 'btn btn--small', onclick: () => runIdentify(state, x.name, n) }, `鑑定 ${n}`)),
                h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => runIdentify(state, x.name, x.qty) }, `全部 ${fmt(x.qty)}`)))))
        : h('p', { class: 'notice', text: '背包裡沒有通用裝備。到修整日鍛造（鑄造）就會得到。' }),
      batchCard(state));
  }

  function batchCard(state) {
    if (!ui.batch) return null;
    const made = ui.batch.ids.map((id) => state.gear.find((g) => g.id === id)).filter(Boolean);
    const worn = ui.batch.ids.length - made.length;
    if (!made.length) return h('p', { class: 'hint', text: `上一批 ${ui.batch.ids.length} 件已經裝上或丟棄。` });
    const rows = made.map((g) => ({ g, cmp: compareGear(state, g) })).sort((a, b) => gearValue(b.g) - gearValue(a.g));
    const shown = rows.slice(0, 12);
    return h('div', { class: 'batch' },
      h('p', { class: 'field-label', text: `上一批 ${made.length} 件（${ui.batch.name}）${worn ? `，另有 ${worn} 件已處理` : ''}` }),
      h('ul', { class: 'batch__list' }, shown.map(({ g, cmp }) => h('li', { class: 'batch__row' },
        h('span', { text: effectText(g) }),
        h('span', { class: 'badge', dataset: { tone: BADGE[cmp][1] }, text: BADGE[cmp][0] })))),
      rows.length > shown.length ? h('p', { class: 'hint', text: `只列出最高的 ${shown.length} 件，其餘在下方「背包裝備」。` }) : null);
  }

  // ---------- 背包裝備 ----------
  function ownedRow(state, g) {
    const cmp = compareGear(state, g);
    const accFull = g.slot === 'accessory' && state.equipment.acc1 && state.equipment.acc2;
    const putOn = (key) => { const err = equip(state, g.id, key); if (err) return toast(err); commit(); };
    return h('li', { class: 'owned rarity', dataset: { tier: tierIndex(g), rarity: tierIndex(g) } },
      h('div', { class: 'owned__main' },
        h('strong', { class: 'owned__name rarity__name', text: `${iconOf(gearName(g))} ${gearName(g)}` }),
        rarityTag(tierIndex(g)),
        h('span', { class: 'owned__effect', text: effectText(g) }),
        h('span', { class: 'badge', dataset: { tone: BADGE[cmp][1] }, text: BADGE[cmp][0] })),
      g.special
        ? h('input', {
            class: 'field owned__note', type: 'text', placeholder: '記下特殊效果（例如：怪力）', value: g.note ?? '', maxlength: 60,
            onchange: (e) => { g.note = e.target.value.trim(); commit(); },
          })
        : null,
      h('div', { class: 'owned__btns' },
        g.slot === 'accessory'
          ? (accFull
              ? [h('button', { type: 'button', class: 'btn btn--small', onclick: () => putOn('acc1') }, '換飾品 1'),
                 h('button', { type: 'button', class: 'btn btn--small', onclick: () => putOn('acc2') }, '換飾品 2')]
              : h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => putOn(state.equipment.acc1 ? 'acc2' : 'acc1') }, '裝備'))
          : h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => putOn(g.slot) }, '裝備'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { discard(state, [g.id]); commit(); } }, '丟棄')));
  }

  function ownedCard(state) {
    const junk = findJunk(state);
    const list = state.gear
      .filter((g) => ui.filter === 'all' || g.slot === ui.filter)
      .sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || tierIndex(b) - tierIndex(a) || gearValue(b) - gearValue(a));
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: `背包裝備（${fmt(state.gear.length)} 件已鑑定）` }),
      h('div', { class: 'row owned-bar' },
        h('div', { class: 'tabs-seg', role: 'tablist' },
          FILTERS.map(([id, label]) => h('button', {
            type: 'button', role: 'tab', class: 'seg', 'aria-selected': String(ui.filter === id),
            onclick: () => { ui.filter = id; render(); },
          }, label))),
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--small', disabled: !junk.length,
          title: '同欄位同屬性只留最高的（武器、防具 1 件，飾品 2 件，身上穿的算在內）。特殊飾品不會動。',
          onclick: () => {
            if (!confirm(`丟棄 ${junk.length} 件用不到的裝備？\n（同欄位同屬性只留最高的；身上穿的與特殊飾品不會動）\n丟棄後無法復原。`)) return;
            const n = discard(state, junk);
            toast(`已丟棄 ${n} 件`);
            commit();
          },
        }, junk.length ? `整理：丟棄 ${fmt(junk.length)} 件用不到的` : '沒有可整理的')),
      list.length ? h('ul', { class: 'owned-list' }, list.map((g) => ownedRow(state, g))) : h('p', { class: 'empty', text: '這個分類沒有裝備。' }));
  }

  function render() {
    const state = getState();
    const scrollY = root.scrollTop;
    root.replaceChildren(
      h('div', { class: 'page-wrap gear-layout' },
        h('div', { class: 'gear-col' }, slotsCard(state), identifyCard(state)),
        h('div', { class: 'gear-col' }, panelCard(state), skillCard(state), ownedCard(state))));
    root.scrollTop = scrollY;
  }

  return { render };
}
