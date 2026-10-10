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
  identifiable, identify, equip, unequip, compareGear, findJunk, gearName, effectText, gearDiceText,
  identifiableGems, identifyGems, socketGem, socketTargets, gemDiceText, gemName,
} from '../game/equipment.js';
import { derivedStats } from '../game/stats.js';
import { RULE_SKILLS } from '../game/skills.js';
import { SKILL_TABLE, inCatalog, needsActivation, usesSkillTable } from '../game/skillTable.js';
import { publish, rollWith } from '../state/rollLog.js';
import { logActivity } from '../state/activityLog.js';
import { openReveal } from './reveal.js';
import { openGearSellSheet } from './marketView.js';
import { badgeCard } from './badgePanel.js';

const tierIndex = (g) => GEAR_TIERS.indexOf(g.tier);
const SLOT_ICON = { weapon: '⚔️', armor: '🛡️', accessory: '💍' };
const gearIcon = (g) => SLOT_ICON[g.slot] ?? '';  // 取了自訂名字後不能再靠名稱判斷圖示，改看欄位
const NAME_MAX = 20;
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
  const ui = { filter: 'all', batch: null, gemTarget: {}, newSkill: '', newSkillLv: 1, skillBoxOpen: false };

  const gearValue = (g) => g.effects.reduce((a, e) => a + e.value, 0);

  // ---------- 數值面板 ----------
  function statCell(p, stat, extra) {
    const x = p[stat];
    return h('div', { class: 'stat' },
      h('span', { class: 'stat__name', text: stat }),
      h('strong', { class: 'stat__value', text: fmt(x.total) }),
      extra ?? null);
  }

  function panelCard(state) {
    const p = derivedStats(state);
    const group = (title, list) => h('div', { class: 'stat-group' },
      h('p', { class: 'field-label', text: title }),
      h('div', { class: 'stat-grid' }, list.map((s) => statCell(p, s, s === '生命' ? h('small', { class: 'stat__detail', text: `目前 ${fmt(state.hp)}` }) : null))));
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '數值面板' }),
      group('攻擊', ATK_STATS),
      group('防禦', DEF_STATS),
      group('資源', RESOURCE_STATS),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small stat-food', onclick: () => openFoodSheet(state, 'session', commit) }, '🍽️ 跑團胃袋吃東西'));
  }

  // ---------- 啟動型技能（武裝這類要花算力啟動才會算進面板；其他已學技能在修整日「學習」看） ----------
  function activationCard(state) {
    const list = Object.entries(state.skills ?? {}).filter(([n]) => inCatalog(n) && needsActivation(n))
      .sort((a, b) => a[0].localeCompare(b[0], 'zh-TW'));
    if (!list.length) return null;
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '啟動型技能' }),
      h('p', { class: 'hint', text: '勾選才會把效果算進數值面板，並扣除算力。其他技能到「修整日 → 學習」查看。' }),
      h('ul', { class: 'activate-grid' }, list.map(([name, lv]) => h('li', { class: 'activate-cell' },
        h('strong', { text: `${name}　${lv} 級` }),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: state.skillOn?.[name] ? true : null, onchange: (e) => { state.skillOn = { ...state.skillOn, [name]: e.target.checked }; commit(); } }),
          h('span', { text: `啟動 −${SKILL_TABLE[name].activate.算力} 算力` }))))));
  }

  function skillCard(state) {
    if (usesSkillTable(state)) return activationCard(state);
    const entries = Object.entries(state.skills ?? {});
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '技能等級（會影響戰鬥規則的）' }),
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
            ui.newSkill = '';
            commit();
          },
        }, '加入'))));
  }

  // ---------- 裝備欄 ----------
  /** 取名欄：空白＝改回預設名稱（例如「傳說武器」）。身上的與背包的共用 */
  const nameField = (g) => h('input', {
    class: 'field gear-name', type: 'text', placeholder: `取個名字（預設：${gearName({ ...g, name: undefined })}）`, value: g.name ?? '',
    maxlength: NAME_MAX, 'aria-label': '裝備名稱',
    onchange: (e) => {
      const v = e.target.value.trim().slice(0, NAME_MAX);
      if (v) g.name = v; else delete g.name;
      commit();
    },
  });

  /** 裝備屬性：每條屬性一個小格（屬性名＋數值），特殊飾品沒有數值時顯示文字 */
  const effectChips = (g) => h('div', { class: 'fx-chips' },
    g.effects.length
      ? [
          g.special ? h('span', { class: 'fx-chip fx-chip--special', text: '特殊' }) : null,
          ...g.effects.map((e) => h('span', { class: 'fx-chip' }, h('span', { text: e.stat }), h('strong', { class: 'num', dataset: { final: e.value }, text: `+${fmt(e.value)}` }))),
        ]
      : h('span', { class: 'fx-chip fx-chip--special', text: effectText(g) }),
    g.gem ? gemChip(g.gem) : null);

  /** 鑲在裝備上的寶石（神話色、菱形） */
  const gemChip = (gem) => h('span', { class: 'fx-chip fx-chip--gem', title: '鑲嵌的寶石（目前無法取出）' },
    h('span', { class: 'rarity-tag__gem', 'aria-hidden': 'true' }),
    h('span', { text: gem.stat }), h('strong', { class: 'num', text: `+${fmt(gem.value)}` }));

  function slotCard(state, key) {
    const g = state.equipment[key];
    return h('div', { class: `gear-slot${g ? ' rarity' : ' is-empty'}`, dataset: { tier: g ? tierIndex(g) : 'none', rarity: g ? tierIndex(g) : 'none' } },
      h('span', { class: 'gear-slot__icon', 'aria-hidden': 'true', text: g ? gearIcon(g) : '＋' }),
      h('div', { class: 'gear-slot__head' },
        h('span', { class: 'gear-slot__label', text: EQUIP_SLOT_LABEL[key] }),
        g ? h('strong', { class: 'gear-slot__name rarity__name', text: gearName(g) }) : h('span', { class: 'gear-slot__name', text: '空著' }),
        g ? rarityTag(tierIndex(g)) : null),
      g ? h('button', { type: 'button', class: 'btn btn--ghost btn--small gear-slot__off', onclick: () => { unequip(state, key); commit(); } }, '卸下') : null,
      g ? nameField(g) : null,
      g ? effectChips(g) : h('p', { class: 'gear-slot__empty', text: '從下方「背包裝備」選一件裝上' }));
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
    logActivity(state, {
      cat: 'item', text: `鑑定 ${name} ×${made.length}，最高 ${effectText(best)}`,
      lines: made.slice(0, 8).map((g) => `${gearName(g)}：${effectText(g)}`),
    });
    commit();
    // 開獎動畫（只是畫面；數值上面已經擲好存好）
    // 超過 12 件時只翻數值最高的 12 件（保持鑑定順序，最好的一定在裡面）
    const top = new Set([...rows].sort((a, b) => gearValue(b.g) - gearValue(a.g)).slice(0, 12).map((r) => r.g.id));
    const picked = rows.filter((r) => top.has(r.g.id));
    const order = picked.map((r) => r.g.id);
    openReveal({
      title: `${name} ×${fmt(made.length)}`,
      cards: picked.map(({ g, cmp }) => ({
        tier: tierIndex(g), icon: gearIcon(g), name: gearName(g), body: effectChips(g), badge: BADGE[cmp],
        note: g.roll?.d4 === 4 && g.slot !== 'accessory' ? '1D4 擲出 4' : null,
      })),
      best: order.indexOf(best.id),
      summary: made.length > 12
        ? `只翻開數值最高的 12 件；共 ${fmt(made.length)} 件，其中 ${fmt(upgrades)} 件比身上好，全部在下方「背包裝備」。`
        : `共 ${fmt(made.length)} 件，其中 ${fmt(upgrades)} 件比身上好。`,
    });
  }

  function identifyCard(state) {
    const list = identifiable(state);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '鑑定' }),
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
      gemIdentifyList(state),
      batchCard(state));
  }

  // ---------- 寶石：鑑定（擲數值）、鑲嵌 ----------
  function gemIdentifyList(state) {
    const list = identifiableGems(state);
    if (!list.length) return null;
    return h('div', { class: 'identify-list identify-list--gems' },
      h('p', { class: 'field-label', text: '寶石（神級鍛造，鑑定時擲出數值）' }),
      list.map((x) =>
        h('div', { class: 'identify rarity', dataset: { tier: 4, rarity: 4 } },
          h('div', { class: 'identify__info' },
            h('strong', { class: 'rarity__name', text: `💎 ${x.name}` }),
            rarityTag(4),
            h('span', { class: 'identify__qty', text: `×${fmt(x.qty)}` }),
            h('small', { text: gemDiceText(x.stat) })),
          h('div', { class: 'identify__btns' },
            [1, 10].filter((n) => n < x.qty).map((n) =>
              h('button', { type: 'button', class: 'btn btn--small', onclick: () => runIdentifyGems(state, x.name, n) }, `鑑定 ${n}`)),
            h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => runIdentifyGems(state, x.name, x.qty) }, `全部 ${fmt(x.qty)}`)))));
  }

  async function runIdentifyGems(state, name, times) {
    let made;
    let draw;
    try { ({ r: made, draw } = await rollWith(state, (st, rng) => identifyGems(st, name, times, rng))); } catch (e) { return rollFailed(e); }
    if (!made.length) return toast('沒有可以鑑定的寶石。');
    const best = [...made].sort((a, b) => b.value - a.value)[0];
    publish({
      who: state.name, kind: 'identify', label: `鑑定 ${name} ×${made.length}`,
      big: made.length === 1 ? `${best.stat}+${best.value}` : `最高 ${best.stat}+${best.value}`,
      lines: [
        ...made.slice(0, 5).map((g) => `${gemName(g)}：${gemDiceText(g.stat)} → ${g.stat}+${g.value}`),
        made.length > 5 ? `…共 ${made.length} 顆` : null,
      ].filter(Boolean),
    }, { draw });
    logActivity(state, {
      cat: 'item', text: `鑑定 ${name} ×${made.length}，最高 ${best.stat}+${best.value}`,
      lines: made.slice(0, 8).map((g) => `${gemName(g)}：${g.stat}+${g.value}`),
    });
    commit();
    const top = new Set([...made].sort((a, b) => b.value - a.value).slice(0, 12).map((g) => g.id));
    const picked = made.filter((g) => top.has(g.id));
    openReveal({
      title: `${name} ×${fmt(made.length)}`,
      cards: picked.map((g) => ({
        tier: 4, icon: '💎', name: gemName(g),
        body: h('div', { class: 'fx-chips' }, h('span', { class: 'fx-chip' }, h('span', { text: g.stat }), h('strong', { class: 'num', dataset: { final: g.value }, text: `+${fmt(g.value)}` }))),
        note: gemDiceText(g.stat),
      })),
      best: picked.findIndex((g) => g.id === best.id),
      summary: made.length > 12 ? `只翻開數值最高的 12 顆；共 ${fmt(made.length)} 顆，都在下方「寶石」。` : `共 ${fmt(made.length)} 顆，到下方「寶石」鑲進傳說裝備。`,
    });
  }

  function gemCard(state) {
    const gems = [...(state.gems ?? [])].sort((a, b) => a.stat.localeCompare(b.stat) || b.value - a.value);
    if (!gems.length) return null;
    const targets = socketTargets(state);
    const wornIds = new Set(Object.values(state.equipment).filter(Boolean).map((g) => g.id));
    const label = (g) => `${wornIds.has(g.id) ? '【身上】' : ''}${gearName(g)}：${effectText(g)}`;
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: `寶石（${fmt(gems.length)} 顆未鑲嵌）` }),
      targets.length ? null : h('p', { class: 'notice', text: '沒有可以鑲的傳說裝備（全部都已經鑲了，或還沒有傳說裝備）。' }),
      h('ul', { class: 'gem-list' }, gems.map((gem) => {
        const sel = targets.some((g) => g.id === ui.gemTarget[gem.id]) ? ui.gemTarget[gem.id] : targets[0]?.id;
        return h('li', { class: 'gem-row rarity', dataset: { tier: 4, rarity: 4 } },
          h('div', { class: 'gem-row__main' },
            h('strong', { class: 'rarity__name', text: `💎 ${gemName(gem)}` }),
            rarityTag(4),
            h('span', { class: 'fx-chip' }, h('span', { text: gem.stat }), h('strong', { class: 'num', text: `+${fmt(gem.value)}` }))),
          targets.length
            ? h('div', { class: 'gem-row__socket' },
                h('select', {
                  class: 'field', 'aria-label': `把${gemName(gem)}鑲進哪一件`,
                  onchange: (e) => { ui.gemTarget[gem.id] = Number(e.target.value); },
                }, targets.map((g) => h('option', { value: String(g.id), selected: g.id === sel ? true : null, text: label(g) }))),
                h('button', {
                  type: 'button', class: 'btn btn--primary btn--small',
                  onclick: () => {
                    const target = targets.find((g) => g.id === (ui.gemTarget[gem.id] ?? sel));
                    if (!target || !confirm(`把${gemName(gem)}（${gem.stat} +${gem.value}）鑲進「${label(target)}」？\n鑲上後目前無法取出。`)) return;
                    const err = socketGem(state, gem.id, target.id);
                    if (err) return toast(err);
                    delete ui.gemTarget[gem.id];
                    logActivity(state, { cat: 'item', text: `鑲嵌 ${gemName(gem)}`, lines: [`${gem.stat} +${gem.value} → ${gearName(target)}`] });
                    toast(`已鑲進${gearName(target)}`);
                    commit();
                  },
                }, '鑲嵌'))
            : null);
      })));
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
  function ownedRow(state, g, junk) {
    const cmp = compareGear(state, g);
    const accFull = g.slot === 'accessory' && state.equipment.acc1 && state.equipment.acc2;
    const putOn = (key) => { const err = equip(state, g.id, key); if (err) return toast(err); commit(); };
    return h('li', { class: 'owned rarity', dataset: { tier: tierIndex(g), rarity: tierIndex(g) } },
      h('div', { class: 'owned__main' },
        h('strong', { class: 'owned__name rarity__name', text: `${gearIcon(g)} ${gearName(g)}` }),
        rarityTag(tierIndex(g)),
        h('span', { class: 'owned__effect', text: effectText(g) }),
        g.gem ? gemChip(g.gem) : null,
        h('span', { class: 'badge', dataset: { tone: BADGE[cmp][1] }, text: BADGE[cmp][0] }),
        junk.has(g.id) ? h('span', { class: 'badge', title: '同欄位同屬性已經有更高的（身上穿的算在內），可以賣掉', text: '用不到' }) : null),
      nameField(g),
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
        // 裝備不能丟棄，只能到交易大廳／黑市賣掉（使用者 2026-10-07）；鑲了寶石的不能賣
        h('button', {
          type: 'button', class: 'btn btn--ghost btn--small', disabled: Boolean(g.gem), title: g.gem ? '鑲了寶石的裝備不能賣' : '',
          onclick: () => openGearSellSheet(state, g, commit),
        }, '賣出')));
  }

  function ownedCard(state) {
    const junk = new Set(findJunk(state)); // 只用來標「用不到」，方便決定要賣哪些
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
          }, label)))),
      list.length ? h('ul', { class: 'owned-list' }, list.map((g) => ownedRow(state, g, junk))) : h('p', { class: 'empty', text: '這個分類沒有裝備。' }));
  }

  function render() {
    const state = getState();
    const scrollY = root.scrollTop;
    root.replaceChildren(
      h('div', { class: 'page-wrap gear-layout' },
        h('div', { class: 'gear-col' }, slotsCard(state), identifyCard(state), gemCard(state), ownedCard(state)), // 背包裝備放寶石下面，右欄技能表才不會太長
        h('div', { class: 'gear-col' }, panelCard(state), skillCard(state), badgeCard({ getState, commit }))));
    root.scrollTop = scrollY;
  }

  return { render };
}
