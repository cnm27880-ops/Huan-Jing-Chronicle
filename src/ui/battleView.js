// ============================================================
// 戰鬥頁：血量與倒地、藥水、招式、遭遇戰（小怪與 BOSS）
// 規則照機器人的 A/B/C 三軌道（見 GAME_RULES.md「戰鬥」）。結果會發布到骰盤紀錄，所有人看得到。
// 目前遭遇戰由自己建立（等於單人試玩）；之後交給 GM 控制、全員共享。
// ============================================================
import { h, fmt } from './dom.js';
import { toast, rollFailed } from './controls.js';
import { mountFeed } from './rollFeed.js';
import { TRACKS, TRACK_ATK_STAT, POTIONS, TOXICITY_MAX } from '../game/rules.js';
import {
  attackDice, pooledAttack, endBattle, monsterAbs, ATTACK_MODES, defenseDice, formatAbc, addMobs, addBosses, removeMonster, newEncounter, playerAttack, monsterAttack,
  drinkPotion, useSupport, isDowned, monsterAtk, monsterDef, BOSS_ATK_MODES, BOSS_DEF_MODES,
} from '../game/combat.js';
import { maxHp } from '../game/stats.js';
import {
  SKILL_CATALOG, passivesOf, skillLevel, globalCost, addCost, WITCH_EXTRA_COST,
} from '../game/skills.js';
import {
  OTHER_RESOURCES, resourceMax, resourceNow, setResource, restoreAllResources, actionCost, shortfall, costText, witchRest,
} from '../game/resources.js';
import { countOf } from '../game/engine.js';
import { iconOf } from './items.js';
import { publish, rollWith } from '../state/rollLog.js';
import { trackLine, targetLine } from '../game/events.js';
import { openValueSheet } from './valueSheet.js';

// 戰鬥紀錄只放戰鬥相關事件；黑市、鑑定、鑲嵌、一般檢定與自訂骰只出現在骰盤
const BATTLE_KINDS = new Set(['attack', 'defend', 'potion', 'skill', 'divider']);
const BATTLE_NOTE = /^(調整|戰鬥結束|魔女|遭遇)/;
const isBattleEvent = (ev) => BATTLE_KINDS.has(ev.kind) || (ev.kind === 'note' && BATTLE_NOTE.test(ev.label ?? ''));

const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);
const potionText = (p) => [
  p.heal ? `回復 ${p.heal.n}D${p.heal.sides} 生命` : null,
  p.atk ? `下次攻擊 真傷 +${p.atk} 骰` : null,
  p.def ? `下次防禦 絕防 +${p.def} 骰` : null,
  `毒性 +${p.toxicity}`,
].filter(Boolean).join('，');

function hpBar(cur, max, downed) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return h('div', { class: `bar${downed ? ' is-downed' : ''}`, role: 'img', 'aria-label': `生命 ${cur} / ${max}` },
    h('div', { class: 'bar__fill', style: `width:${pct}%` }),
    h('span', { class: 'bar__text', text: `${fmt(cur)} / ${fmt(max)}` }));
}

function trackLines(result) {
  return result.tracks.filter((t) => t.atkDice > 0).map(trackLine);
}

export function createBattleView({ root, getState, commit }) {
  const ui = {
    moveId: null,
    modes: {}, // 怪物 id → { atk, def }
    form: { kind: 'mob', count: 1, atk: 10, def: 10, hp: 100, atkMod: '', defMod: '', absDef: 0 },
    moveForm: { name: '', mode: 'normal', school: '', tracks: ['C'], extra: { A: 0, B: 0, C: 0 }, cost: {}, global: true },
    yuwai: false,
    pane: 'action', // 手機版目前的分頁：action（行動）／log（紀錄）／state（狀態）
    openMoves: new Set(), // 展開完整內容的招式 id
    openBoxes: new Set(), // 展開中的「＋新增」區塊：重畫後保持展開
  };
  let feed = null;
  let hudWatcher = null;

  /** 可收合的「＋新增」區塊。記住展開狀態，按裡面的按鈕重畫後不會自己收起來 */
  function addBox(key, summary, ...children) {
    return h('details', {
      class: 'add-box', open: ui.openBoxes.has(key),
      ontoggle: (e) => { if (e.target.open) ui.openBoxes.add(key); else ui.openBoxes.delete(key); },
    }, h('summary', { text: summary }), ...children);
  }

  // ---------- 頂部固定列：生命與資源（點了才調整） ----------
  const HUD_KEYS = (state) => ['生命', ...OTHER_RESOURCES, ...(typeof state.toxicity === 'number' ? ['毒性'] : [])];

  function readout(state, key) {
    if (key === '生命') return { now: state.hp, max: maxHp(state) };
    if (key === '毒性') return { now: state.toxicity, max: TOXICITY_MAX };
    return { now: resourceNow(state, key), max: resourceMax(state, key) };
  }

  function writeValue(state, key, v) {
    if (key === '毒性') state.toxicity = Math.max(0, Math.min(TOXICITY_MAX, Math.floor(v)));
    else setResource(state, key, v); // 生命與資源：上限夾限在 setResource 裡
  }

  function openAdjust(key, trigger) {
    const { now, max } = readout(getState(), key);
    openValueSheet({
      title: `調整${key}`, now, max, trigger,
      focusAfter: () => root.querySelector(`[data-hud="${key}"]`),
      onConfirm: (v) => {
        const state = getState();
        const before = readout(state, key).now;
        writeValue(state, key, v);
        const after = readout(state, key).now;
        if (after === before) return;
        publish({ who: state.name, kind: 'note', label: `調整${key}`, lines: [`${state.name} 把${key}從 ${fmt(before)} 改成 ${fmt(after)}`] });
        commit();
      },
    });
  }

  function meter(state, key) {
    const { now, max } = readout(state, key);
    const pct = max > 0 ? Math.max(0, Math.min(100, (now / max) * 100)) : 0;
    const kind = key === '生命' ? 'hp' : key === '毒性' ? 'tox' : 'res';
    const bad = (key === '生命' && isDowned(state)) || (key === '毒性' && now >= max);
    return h('button', {
      type: 'button', class: `hud-meter hud-meter--${kind}${bad ? ' is-bad' : ''}`, dataset: { hud: key },
      'aria-haspopup': 'dialog', 'aria-label': `${key} ${now} / ${max}，點一下調整`,
      onclick: (e) => openAdjust(key, e.currentTarget),
    },
    h('span', { class: 'hud-meter__name', text: key }),
    h('span', { class: 'hud-meter__val num', text: `${fmt(now)} / ${fmt(max)}` }),
    h('span', { class: 'hud-meter__bar', 'aria-hidden': 'true' }, h('span', { class: 'hud-meter__fill', style: `width:${pct}%` })));
  }

  function hud(state) {
    const keys = HUD_KEYS(state);
    return h('header', { class: 'bt-hud' },
      h('div', { class: 'bt-hud__top' },
        h('h2', { class: 'bt-hud__name', text: state.name }),
        isDowned(state) ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒地' }) : null),
      meter(state, keys[0]),
      h('div', { class: 'bt-hud__res' }, keys.slice(1).map((k) => meter(state, k))));
  }

  // ---------- 狀態分頁：護盾、藥水加成、結束戰鬥 ----------
  function statusCard(state) {
    const downed = isDowned(state);
    const chips = [
      state.shield?.hp > 0 ? h('span', { class: 'info-chip is-good', text: `🛡 護盾 ${fmt(state.shield.hp)}${state.shield.res ? `（抗性 +${state.shield.res}）` : ''}` }) : null,
      state.buffs.atk ? h('span', { class: 'info-chip is-good', text: `下次攻擊 真傷 +${state.buffs.atk} 骰` }) : null,
      state.buffs.def ? h('span', { class: 'info-chip is-good', text: `下次防禦 絕防 +${state.buffs.def} 骰` }) : null,
    ].filter(Boolean);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '狀態' }),
      h('p', { class: 'hint', text: '點上方的生命或資源條可以調整數值。招式會依「消耗資源」自動扣除，不夠就不能出招。' }),
      downed
        ? h('p', { class: 'notice notice--bad', text: '倒地了。倒地不會死亡，但劇情可能走向不太好的結局。喝回血藥水或請 GM 處理。' })
        : null,
      chips.length ? h('div', { class: 'chip-row chip-row--info' }, chips) : null,
      state.toxicity >= TOXICITY_MAX ? h('p', { class: 'notice notice--bad', text: `毒性已達 ${TOXICITY_MAX}，不能再喝藥水。戰鬥結束後毒性歸零。` }) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { restoreAllResources(state); commit(); } }, '觸摸存檔點（全部回滿）'),
        h('button', {
          type: 'button', class: 'btn btn--small',
          onclick: () => {
            if (!confirm('結束戰鬥？毒性歸零、藥水加成清除、敵人清空。')) return;
            const r = endBattle(state); ui.modes = {};
            publish({ who: state.name, kind: 'note', label: '戰鬥結束', lines: [`毒性 ${r.toxicity} → 0`] });
            commit();
          },
        }, '🏁 結束戰鬥')));
  }

  function potionCard(state) {
    const have = Object.keys(POTIONS).filter((n) => countOf(state, n) > 0);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '藥水' }),
      have.length
        ? h('div', { class: 'potion-grid' }, have.map((n) => h('button', {
            type: 'button', class: 'potion', title: potionText(POTIONS[n]), disabled: state.toxicity + POTIONS[n].toxicity > TOXICITY_MAX, 'aria-disabled': String(state.toxicity + POTIONS[n].toxicity > TOXICITY_MAX),
            onclick: async () => {
              const pd = POTIONS[n];
              if (pd.heal && !pd.atk && !pd.def && state.hp >= maxHp(state) && !confirm('血量已經是滿的，喝了回血會浪費。還是要喝嗎？')) return;
              let r;
              let draw;
              try { ({ r, draw } = await rollWith(state, (st, rng) => drinkPotion(st, n, rng))); } catch (e) { return rollFailed(e); }
              if (r.error) return toast(r.error);
              publish({
                who: state.name, kind: 'potion', label: `喝下${n}`,
                big: r.rolled != null ? `+${r.healed}` : r.atk ? `攻 +${r.atk}` : `防 +${r.def}`,
                tone: r.atLimit ? 'warn' : undefined,
                lines: [
                  r.rolled != null ? `${r.dice} = ${r.rolled}，生命 ${state.hp} / ${maxHp(state)}` : null,
                  r.atk ? '下次攻擊：真實傷害骰增加' : null,
                  r.def ? '下次防禦：絕對防禦骰增加（三軌都加）' : null,
                  `毒性 ${r.toxicity} / ${TOXICITY_MAX}${r.atLimit ? '　⚠ 已達上限，不能再喝' : ''}`,
                ].filter(Boolean),
              }, { draw });
              commit();
            },
          },
          h('span', { class: 'potion__icon', 'aria-hidden': 'true', text: iconOf(n) }),
          h('span', { class: 'potion__name', text: n }),
          h('span', { class: 'potion__qty', text: `×${fmt(countOf(state, n))}` }),
          h('small', { class: 'potion__fx', text: potionText(POTIONS[n]) }))))
        : h('p', { class: 'notice', text: '背包裡沒有藥水。到修整日調劑就會得到。' }));
  }

  // ---------- 招式 ----------
  function moveDetail(state, m) {
    const pooled = m.mode === 'all' || m.mode === 'abs';
    const support = m.kind === 'heal' || m.kind === 'shield';
    const cost = actionCost(state, m);
    const bits = [];
    if (m.school) bits.push(m.school);
    if (support) {
      const c = SKILL_CATALOG[m.skill];
      bits.push(m.kind === 'heal' ? `回復目標最大生命的 %（${c.tiers.map((t) => `${t.cost.算力}算力→${t.pct}%`).join('／')}）` : `護盾 = 最大生命的 %（${c.tiers.map((t) => `${t.cost.靈氣}靈氣→${t.pct}%`).join('／')}）`);
      return { dice: '輔助', text: bits.join('・'), cost };
    }
    const a = pooled ? pooledAttack(state, m) : attackDice(state, m);
    const dice = pooled ? `${fmt(a.dice)} 骰` : formatAbc(a.dice);
    const text = pooled
      ? `【${ATTACK_MODES[m.mode]}】 ${a.parts.map((p) => `${p.label} ${fmt(p.value)}`).join(' + ')}`
      : m.tracks.map((t) => a.parts[t].map((p) => `${p.label} ${fmt(p.value)}`).join(' + ')).join('　／　');
    if ((m.targets ?? 1) > 1) bits.push(`${m.targets} 個目標`);
    return { dice, text: [...bits, text].join('・'), cost };
  }

  function supportButtons(state, m) {
    const c = SKILL_CATALOG[m.skill];
    return h('div', { class: 'row support-btns' }, c.tiers.map((t, i) => {
      const cost = actionCost(state, m, t.cost);
      const lack = shortfall(state, cost);
      return h('button', {
        type: 'button', class: 'btn btn--small', disabled: isDowned(state) || Boolean(lack), title: lack ?? '',
        onclick: () => {
          const before = state.hp;
          const r = useSupport(state, m.id, i);
          if (r.error) return toast(r.error);
          publish({
            who: state.name, kind: 'skill', label: `${m.name}（${t.pct}%）`,
            big: r.kind === 'heal' ? `+${r.healed}` : `盾 ${r.amount}`,
            tone: 'ok',
            lines: [
              r.kind === 'heal'
                ? `目標最大生命 ${t.pct}% = ${r.amount}，生命 ${before} → ${state.hp} / ${maxHp(state)}（可回復 ${r.targets} 個目標；目前單人試玩只算自己）`
                : `護盾 = 最大生命 ${t.pct}% = ${r.amount}${r.res ? `，抗性免疫 +${r.res}（護盾破了才消失）` : ''}`,
              `花費：${costText(r.cost)}`,
            ],
          });
          commit();
        },
      }, `${t.pct}%（${costText(actionCost(state, m, t.cost))}）`);
    }));
  }

  const trackTag = (t) => h('span', { class: 'trk', dataset: { track: t }, text: t });

  function moveRow(state, m) {
    const support = m.kind === 'heal' || m.kind === 'shield';
    const d = moveDetail(state, m);
    // 付不起：一般招式看整個花費；輔助技能看最便宜的檔位
    const lack = shortfall(state, support ? actionCost(state, m, SKILL_CATALOG[m.skill].tiers[0].cost) : d.cost);
    const open = ui.openMoves.has(m.id);
    const tracks = support ? [] : (m.mode === 'all' ? TRACKS : m.tracks ?? []);
    return h('li', { class: `move${lack ? ' is-short' : ''}`, 'aria-current': String(!support && m.id === ui.moveId), dataset: { open: String(open) } },
      h('div', { class: 'move__main' },
        h('button', {
          type: 'button', class: 'move__pick', disabled: !support && Boolean(lack), 'aria-expanded': String(open),
          onclick: () => {
            if (!support) ui.moveId = m.id;
            if (open) ui.openMoves.delete(m.id); else ui.openMoves.add(m.id);
            render();
          },
        },
        h('span', { class: 'move__tags' }, support ? h('span', { class: 'trk', dataset: { track: 'S' }, text: '輔助' }) : tracks.map(trackTag)),
        h('span', { class: 'move__dice', text: d.dice }),
        h('strong', { class: 'move__name', text: m.skill ? `${m.name} Lv${skillLevel(state, m.skill)}` : m.name }),
        support ? null : h('small', { class: 'move__cost', text: `消耗：${costText(d.cost)}` }),
        open ? h('small', { class: 'move__detail', text: d.text }) : null,
        lack ? h('small', { class: 'move__lack', text: `缺少：${lack}` }) : null),
        support ? supportButtons(state, m) : null),
      h('button', {
        type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': `刪除招式 ${m.name}`,
        onclick: () => { if (!confirm(`刪除招式「${m.name}」？`)) return; state.moves = state.moves.filter((x) => x.id !== m.id); ui.openMoves.delete(m.id); commit(); },
      }, '刪除'));
  }

  function moveCard(state) {
    if (!state.moves.some((m) => m.id === ui.moveId)) ui.moveId = state.moves.find((m) => m.kind !== 'heal' && m.kind !== 'shield')?.id ?? state.moves[0]?.id ?? null;
    const f = ui.moveForm;
    const trackToggle = (t) => h('button', {
      type: 'button', class: 'toggle', 'aria-pressed': String(f.tracks.includes(t)),
      onclick: () => { f.tracks = f.tracks.includes(t) ? f.tracks.filter((x) => x !== t) : [...f.tracks, t].sort(); render(); },
    }, `${t} ${TRACK_ATK_STAT[t]}`);
    // 魔女：魔力不夠付額外的 30 魔力時，在最上方給一顆醒目的「放棄行動」按鈕
    const witchStuck = passivesOf(state).witch && resourceNow(state, '魔力') < WITCH_EXTRA_COST;
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '招式' }),
      witchStuck
        ? h('button', {
            type: 'button', class: 'btn btn--primary witch-rest', disabled: isDowned(state),
            onclick: () => {
              const r = witchRest(state);
              if (r.error) return toast(r.error);
              publish({ who: state.name, kind: 'note', label: '魔女：放棄主動動作', lines: [`回復 ${r.gained} 魔力（現在 ${r.now}）`] });
              commit();
            },
          }, `放棄行動・回復 ${WITCH_EXTRA_COST} 魔力`)
        : null,
      h('p', { class: 'hint', text: '點招式展開內容並選為「出招」用的招式；輔助技能直接按檔位使用。消耗已含魔女的額外魔力，付不起的招式會變灰。' }),
      state.moves.length
        ? h('ul', { class: 'move-list' }, state.moves.map((m) => moveRow(state, m)))
        : h('p', { class: 'notice', text: '還沒有招式。下面新增一個。' }),
      addBox('move', '＋ 新增自訂招式',
        h('div', { class: 'row' },
          h('input', {
            class: 'field', type: 'text', placeholder: '招式名稱', value: f.name, maxlength: 200, 'aria-label': '招式名稱',
            oninput: (e) => { f.name = e.target.value; },
          }),
          h('select', { class: 'field', 'aria-label': '招式系別', onchange: (e) => { f.school = e.target.value; } },
            ['', '西幻', '修仙', '科技', '神秘'].map((n) => h('option', { value: n, selected: f.school === n ? true : null, text: n || '系別（選填）' })))),
        h('p', { class: 'field-label', text: '攻擊方式' }),
        h('div', { class: 'toggle-row' }, Object.entries(ATTACK_MODES).map(([id, label]) => h('button', {
          type: 'button', class: 'toggle', 'aria-pressed': String((f.mode ?? 'normal') === id), onclick: () => { f.mode = id; render(); },
        }, label))),
        h('p', { class: 'field-label', text: f.mode === 'all' ? '傷害軌道（萬物歸一固定用全部，這裡不影響）' : '傷害軌道' }),
        h('div', { class: 'toggle-row' }, TRACKS.map(trackToggle)),
        f.tracks.length
          ? h('div', { class: 'extra-row' }, f.tracks.map((t) => h('label', { class: 'extra' },
              h('span', { text: `${t} 招式加成` }),
              h('input', {
                class: 'field', type: 'number', min: 0, value: f.extra[t], onchange: (e) => { f.extra[t] = num(e.target.value); },
              }))))
          : null,
        h('p', { class: 'field-label', text: '消耗資源（試算表「消耗資源」欄）' }),
        h('div', { class: 'extra-row' }, ['生命', ...OTHER_RESOURCES].map((r) => h('label', { class: 'extra' },
          h('span', { text: r }),
          h('input', { class: 'field', type: 'number', min: 0, value: f.cost[r] ?? 0, onchange: (e) => { f.cost[r] = num(e.target.value); } })))),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: f.global ? true : null, onchange: (e) => { f.global = e.target.checked; } }),
          h('span', { text: '另外加上全域響應耗用（含 C 軌的招式 +2 生命 +3 算力；試算表各招式的消耗欄已含這一份，所以照抄試算表時請取消勾選）' })),
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small',
          onclick: () => {
            const name = f.name.trim();
            if (!name) return toast('請輸入招式名稱。');
            if (!f.tracks.length) return toast('至少選一條傷害軌道。');
            const tracks = f.mode === 'all' ? ['A', 'B', 'C'] : [...f.tracks];
            const cost = addCost(Object.fromEntries(Object.entries(f.cost).filter(([, v]) => v > 0)), f.global ? globalCost(tracks) : {});
            state.moves.push({ id: `m${Date.now().toString(36)}`, name, school: f.school, tracks, mode: f.mode ?? 'normal', extra: { A: 0, B: 0, C: 0, ...f.extra }, cost });
            ui.moveForm = { name: '', mode: 'normal', school: '', tracks: ['C'], extra: { A: 0, B: 0, C: 0 }, cost: {}, global: true };
            commit();
          },
        }, '新增')));
  }

  // ---------- 遭遇戰 ----------
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
          type: 'button', class: 'toggle', 'aria-pressed': String(f.kind === id), onclick: () => { f.kind = id; render(); },
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
    const modes = ui.modes[m.id] ?? { atk: 0, def: 0 };
    const move = state.moves.find((x) => x.id === ui.moveId);
    const hpBefore = state.hp;
    const befores = new Map(state.encounter.monsters.map((x) => [x.id, x.hp]));
    let r;
    let draw;
    try {
      ({ r, draw } = await rollWith(state, (st, rng) => playerAttack(st, st.encounter, ui.moveId, m.id, modes.def, rng, { yuwai: ui.yuwai })));
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
    const modes = ui.modes[m.id] ?? { atk: 0, def: 0 };
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
    const modes = ui.modes[m.id] ?? (ui.modes[m.id] = { atk: 0, def: 0 });
    const noMove = !state.moves.some((x) => x.id === ui.moveId);
    return h('li', { class: `monster${downed ? ' is-downed' : ''}`, dataset: { kind: m.kind } },
      h('div', { class: 'monster__head' },
        h('strong', { text: `${m.kind === 'boss' ? '👹' : '👾'} ${m.id}` }),
        downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒下' }) : null,
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { removeMonster(state.encounter, m.id); delete ui.modes[m.id]; commit(); } }, '移除')),
      hpBar(m.hp, m.maxHp, downed),
      h('dl', { class: 'monster__stats' },
        h('div', {}, h('dt', { text: '攻擊' }), h('dd', { text: m.kind === 'boss' ? `${BOSS_ATK_MODES[modes.atk]}：${formatAbc(monsterAtk(m, modes.atk))}` : formatAbc(m.atk) })),
        h('div', {}, h('dt', { text: m.kind === 'boss' ? `防禦（${BOSS_DEF_MODES[modes.def]}）` : '防禦' }),
          h('dd', { class: 'abc' },
            TRACKS.map((t) => h('span', { class: 'abc__cell', dataset: { track: t } }, h('b', { text: t }), h('span', { class: 'num', text: fmt(monsterDef(m, modes.def)[t]) }))),
            monsterAbs(m) ? h('span', { class: 'abc__abs', text: `絕防 ${fmt(monsterAbs(m))}` }) : null))),
      m.kind === 'boss'
        ? h('div', { class: 'row modes' },
            modeSelect('它的攻擊', BOSS_ATK_MODES, modes.atk, (v) => { modes.atk = v; render(); }),
            modeSelect('它的防禦', BOSS_DEF_MODES, modes.def, (v) => { modes.def = v; render(); }))
        : null,
      h('div', { class: 'row monster__btns' },
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small', disabled: downed || noMove || isDowned(state),
          onclick: () => doAttack(state, m),
        }, noMove ? '先選招式' : `⚔️ 用「${state.moves.find((x) => x.id === ui.moveId).name}」攻擊${(state.moves.find((x) => x.id === ui.moveId).targets ?? 1) > 1 ? `（連同後面最多共 ${state.moves.find((x) => x.id === ui.moveId).targets} 個）` : ''}`),
        h('button', { type: 'button', class: 'btn btn--small', disabled: downed, onclick: () => doDefend(state, m) }, '🛡️ 承受它的攻擊')));
  }

  function encounterCard(state) {
    const enc = state.encounter;
    return h('section', { class: 'card' },
      h('div', { class: 'battle-head' },
        h('h2', { class: 'section-title', text: '遭遇戰' }),
        enc.monsters.length
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { if (confirm('清空所有敵人？')) { state.encounter = newEncounter(); ui.modes = {}; commit(); } } }, '清空')
          : null),
      state.skills?.域外魔祖 && state.moves.find((x) => x.id === ui.moveId)?.school === '修仙'
        ? h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: ui.yuwai ? true : null, onchange: (e) => { ui.yuwai = e.target.checked; } }),
            h('span', { text: '域外魔祖：這次攻擊花 30 靈氣，追加扣目標現有生命 10%' }))
        : null,
      enc.monsters.length
        ? h('ul', { class: 'monster-list' }, enc.monsters.map((m) => monsterCard(state, m)))
        : h('p', { class: 'notice', text: '還沒有敵人。從下面新增，或之後由 GM 建立。' }),
      enemyForm(state));
  }

  function defenseCard(state) {
    const d = defenseDice(state);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '你的防禦骰' }),
      h('p', { class: 'hint', text: '承受攻擊時，玩家不管怎樣都用 A+B+C 三軌防禦來擋（敵人攻擊是三種混合），絕對防禦會加進這三軌。' }),
      h('div', { class: 'stat-grid' }, TRACKS.map((t) => h('div', { class: 'stat' },
        h('span', { class: 'stat__name', text: `${t} 軌` }),
        h('strong', { class: 'stat__value', text: fmt(d.dice[t]) }),
        h('small', { class: 'stat__detail', text: d.parts[t].map((p) => `${p.label} ${fmt(p.value)}`).join(' + ') })))));
  }

  const PANES = [['action', '行動'], ['log', '紀錄'], ['state', '狀態']];

  function render() {
    const state = getState();
    feed?.destroy();
    hudWatcher?.disconnect();
    const feedBox = h('div', { class: 'battle-feed' });
    const scrollY = root.scrollTop;
    const pane = (id, ...cards) => h('div', { class: 'bt-pane', id: `bt-pane-${id}`, role: 'tabpanel', 'aria-labelledby': `bt-tab-${id}`, dataset: { id } }, ...cards);
    const layout = h('div', { class: 'bt-layout', dataset: { pane: ui.pane } },
      pane('state', statusCard(state), defenseCard(state)),
      pane('action', encounterCard(state), moveCard(state), potionCard(state)),
      pane('log', h('section', { class: 'card' }, h('h2', { class: 'section-title', text: '戰鬥紀錄' }), feedBox)));
    // 手機：頂部膠囊分頁（電腦版隱藏，三個區塊並排）。只切換顯示，不重畫
    const select = (id) => {
      ui.pane = id;
      layout.dataset.pane = id;
      tabs.querySelectorAll('.bt-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
    };
    const tabs = h('div', { class: 'bt-tabs', role: 'tablist', 'aria-label': '戰鬥分頁' }, PANES.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', class: 'bt-tab', id: `bt-tab-${id}`, 'aria-controls': `bt-pane-${id}`, 'aria-selected': String(ui.pane === id), dataset: { id },
      onclick: () => select(id),
      onkeydown: (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const i = PANES.findIndex(([x]) => x === id) + step;
        if (!step || i < 0 || i >= PANES.length) return;
        select(PANES[i][0]);
        tabs.querySelector(`#bt-tab-${PANES[i][0]}`).focus();
      },
    }, label)));
    const hudEl = hud(state);
    root.replaceChildren(h('div', { class: 'bt-root' }, hudEl, tabs, layout));
    feed = mountFeed(feedBox, { limit: 8, filter: isBattleEvent, empty: '出招或喝藥水後，結果會出現在這裡，也會出現在骰盤。' });
    // 電腦版右欄紀錄要貼在固定列下面：把固定列的高度記成 CSS 變數
    if (typeof ResizeObserver !== 'undefined') {
      hudWatcher = new ResizeObserver(() => root.style.setProperty('--bt-hud-h', `${hudEl.offsetHeight}px`));
      hudWatcher.observe(hudEl);
    }
    root.scrollTop = scrollY;
  }

  return { render };
}
