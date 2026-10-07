// ============================================================
// 遭遇戰卡片（跑團頁用）：怪物、新增敵人、用選定的招式攻擊、承受怪物攻擊。
// 規則在 combat.js；結果用 rollLog 的 publish／rollWith 發布。
// 目前遭遇戰由自己建立（等於單人試玩）；之後交給 GM 建立、全員共享（階段 C）。
// ============================================================
import { h, fmt } from './dom.js';
import { toast, rollFailed } from './controls.js';
import { TRACKS } from '../game/rules.js';
import {
  formatAbc, monsterAbs, addMobs, addBosses, removeMonster, newEncounter, playerAttack, monsterAttack,
  isDowned, monsterAtk, monsterDef, BOSS_ATK_MODES, BOSS_DEF_MODES,
} from '../game/combat.js';
import { maxHp } from '../game/stats.js';
import { costText } from '../game/resources.js';
import { publish, rollWith } from '../state/rollLog.js';
import { trackLine, targetLine } from '../game/events.js';
import { battleSel as sel } from './battleSelect.js';

const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);

function hpBar(cur, max, downed) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return h('div', { class: `bar${downed ? ' is-downed' : ''}`, role: 'img', 'aria-label': `生命 ${cur} / ${max}` },
    h('div', { class: 'bar__fill', style: `width:${pct}%` }),
    h('span', { class: 'bar__text', text: `${fmt(cur)} / ${fmt(max)}` }));
}

const trackLines = (result) => result.tracks.filter((t) => t.atkDice > 0).map(trackLine);

export function createEncounterCard({ getState, commit, rerender }) {
  const ui = {
    form: { kind: 'mob', count: 1, atk: 10, def: 10, hp: 100, atkMod: '', defMod: '', absDef: 0 },
    openBoxes: new Set(), // 展開中的「＋新增」區塊：重畫後保持展開
  };

  function addBox(key, summary, ...children) {
    return h('details', {
      class: 'add-box', open: ui.openBoxes.has(key),
      ontoggle: (e) => { if (e.target.open) ui.openBoxes.add(key); else ui.openBoxes.delete(key); },
    }, h('summary', { text: summary }), ...children);
  }

  /** 出招用的招式：沒選或選的招式不見了，就挑第一個攻擊招式 */
  function ensureMove(state) {
    if (!state.moves.some((m) => m.id === sel.moveId)) sel.moveId = state.moves.find((m) => m.kind !== 'heal' && m.kind !== 'shield')?.id ?? state.moves[0]?.id ?? null;
  }

  function movePicker(state) {
    const attackMoves = state.moves.filter((m) => m.kind !== 'heal' && m.kind !== 'shield');
    if (!attackMoves.length) return h('p', { class: 'notice', text: '還沒有攻擊招式。到「戰鬥」頁新增招式。' });
    return h('label', { class: 'mode' },
      h('span', { text: '出招用的招式' }),
      h('select', { class: 'field', 'aria-label': '出招用的招式', onchange: (e) => { sel.moveId = e.target.value; rerender(); } },
        attackMoves.map((m) => h('option', { value: m.id, selected: m.id === sel.moveId ? true : null, text: m.name }))));
  }

  function numField(label, key, min = 0) {
    return h('label', { class: 'extra' },
      h('span', { text: label }),
      h('input', { class: 'field', type: 'number', min, value: ui.form[key], onchange: (e) => { ui.form[key] = num(e.target.value, min); } }));
  }

  function enemyForm(state) {
    const f = ui.form;
    return addBox('enemy', '＋ 新增敵人',
      h('div', { class: 'toggle-row' },
        [['mob', '小怪'], ['boss', 'BOSS']].map(([id, label]) => h('button', {
          type: 'button', class: 'toggle', 'aria-pressed': String(f.kind === id), onclick: () => { f.kind = id; rerender(); },
        }, label))),
      h('div', { class: 'extra-row' }, numField('數量', 'count', 1), numField('攻擊強度', 'atk'), numField('防禦強度', 'def'), numField('血量', 'hp', 1), numField('絕對防禦（選填）', 'absDef')),
      h('p', { class: 'hint', text: '強度會隨機分配到 A/B/C 三軌（照機器人）。區域補正選填，例如 5A 3C，會加在每隻身上。' }),
      h('div', { class: 'extra-row' },
        h('label', { class: 'extra' }, h('span', { text: '攻擊補正（選填）' }),
          h('input', { class: 'field', type: 'text', placeholder: '5A 3C', value: f.atkMod, onchange: (e) => { f.atkMod = e.target.value; } })),
        h('label', { class: 'extra' }, h('span', { text: '防禦補正（選填）' }),
          h('input', { class: 'field', type: 'text', placeholder: '2B', value: f.defMod, onchange: (e) => { f.defMod = e.target.value; } }))),
      h('button', {
        type: 'button', class: 'btn btn--primary btn--small',
        onclick: () => {
          if (f.count > 20) return toast('一次最多 20 隻。');
          const spec = { count: f.count, atkPower: f.atk, defPower: f.def, hp: f.hp, atkMod: f.atkMod, defMod: f.defMod, absDef: f.absDef };
          const added = (f.kind === 'boss' ? addBosses : addMobs)(state.encounter, spec);
          publish({ who: state.name, kind: 'note', label: `遭遇：新增 ${added.map((m) => m.id).join('、')}`, lines: [] });
          commit();
        },
      }, '加入遭遇戰'));
  }

  function modeSelect(label, names, value, onChange) {
    return h('label', { class: 'mode' },
      h('span', { text: label }),
      h('select', { class: 'field', onchange: (e) => onChange(Number(e.target.value)) },
        names.map((n, i) => h('option', { value: String(i), selected: i === value ? true : null, text: n }))));
  }

  async function doAttack(state, m) {
    const modes = sel.modes[m.id] ?? { atk: 0, def: 0 };
    const move = state.moves.find((x) => x.id === sel.moveId);
    const hpBefore = state.hp;
    const befores = new Map(state.encounter.monsters.map((x) => [x.id, x.hp]));
    let r;
    let draw;
    try {
      ({ r, draw } = await rollWith(state, (st, rng) => playerAttack(st, st.encounter, sel.moveId, m.id, modes.def, rng, { yuwai: sel.yuwai })));
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
      label: `${r.move.name} → ${r.hits.map((x) => x.target.id).join('、')}${m.kind === 'boss' ? `（${BOSS_DEF_MODES[modes.def]}）` : ''}`,
      big: r.hits.reduce((a, x) => a + x.result.total + (x.bonus ?? 0) + (x.yuwai ?? 0), 0),
      tone: r.hits.some((x) => x.result.total > 0) ? 'ok' : 'fail',
      lines,
    }, { draw });
    commit();
  }

  async function doDefend(state, m) {
    const modes = sel.modes[m.id] ?? { atk: 0, def: 0 };
    const before = state.hp;
    let r;
    let draw;
    try {
      ({ r, draw } = await rollWith(state, (st, rng) => monsterAttack(st, st.encounter, m.id, modes.atk, rng)));
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

  function monsterCard(state, m) {
    const downed = isDowned(m);
    const modes = sel.modes[m.id] ?? (sel.modes[m.id] = { atk: 0, def: 0 });
    const noMove = !state.moves.some((x) => x.id === sel.moveId);
    return h('li', { class: `monster${downed ? ' is-downed' : ''}`, dataset: { kind: m.kind } },
      h('div', { class: 'monster__head' },
        h('strong', { text: `${m.kind === 'boss' ? '👹' : '👾'} ${m.id}` }),
        downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒下' }) : null,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { removeMonster(state.encounter, m.id); delete sel.modes[m.id]; commit(); } }, '移除')),
      hpBar(m.hp, m.maxHp, downed),
      h('dl', { class: 'monster__stats' },
        h('div', {}, h('dt', { text: '攻擊' }), h('dd', { text: m.kind === 'boss' ? `${BOSS_ATK_MODES[modes.atk]}：${formatAbc(monsterAtk(m, modes.atk))}` : formatAbc(m.atk) })),
        h('div', {}, h('dt', { text: m.kind === 'boss' ? `防禦（${BOSS_DEF_MODES[modes.def]}）` : '防禦' }),
          h('dd', { class: 'abc' },
            TRACKS.map((t) => h('span', { class: 'abc__cell', dataset: { track: t } }, h('b', { text: t }), h('span', { class: 'num', text: fmt(monsterDef(m, modes.def)[t]) }))),
            monsterAbs(m) ? h('span', { class: 'abc__abs', text: `絕防 ${fmt(monsterAbs(m))}` }) : null))),
      m.kind === 'boss'
        ? h('div', { class: 'row modes' },
            modeSelect('它的攻擊', BOSS_ATK_MODES, modes.atk, (v) => { modes.atk = v; rerender(); }),
            modeSelect('它的防禦', BOSS_DEF_MODES, modes.def, (v) => { modes.def = v; rerender(); }))
        : null,
      h('div', { class: 'row monster__btns' },
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small', disabled: downed || noMove || isDowned(state),
          onclick: () => doAttack(state, m),
        }, noMove ? '先選招式' : `⚔️ 用「${state.moves.find((x) => x.id === sel.moveId).name}」攻擊${(state.moves.find((x) => x.id === sel.moveId).targets ?? 1) > 1 ? `（連同後面最多共 ${state.moves.find((x) => x.id === sel.moveId).targets} 個）` : ''}`),
        h('button', { type: 'button', class: 'btn btn--small', disabled: downed, onclick: () => doDefend(state, m) }, '🛡️ 承受它的攻擊')));
  }

  function encounterCard() {
    const state = getState();
    ensureMove(state);
    const enc = state.encounter;
    return h('section', { class: 'card' },
      h('div', { class: 'battle-head' },
        h('h2', { class: 'section-title', text: '遭遇戰' }),
        enc.monsters.length
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (confirm('清空所有敵人？')) { state.encounter = newEncounter(); sel.modes = {}; commit(); } } }, '清空')
          : null),
      state.skills?.域外魔祖 && state.moves.find((x) => x.id === sel.moveId)?.school === '修仙'
        ? h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: sel.yuwai ? true : null, onchange: (e) => { sel.yuwai = e.target.checked; } }),
            h('span', { text: '域外魔祖：這次攻擊花 30 靈氣，追加扣目標現有生命 10%' }))
        : null,
      movePicker(state),
      enc.monsters.length
        ? h('ul', { class: 'monster-list' }, enc.monsters.map((m) => monsterCard(state, m)))
        : h('p', { class: 'notice', text: '還沒有敵人。從下面新增，或之後由 GM 建立。' }),
      enemyForm(state));
  }

  return { render: encounterCard };
}
