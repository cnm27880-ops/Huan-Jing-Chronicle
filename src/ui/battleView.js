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
  drinkPotion, useSupport, isDowned, monsterAtk, monsterDef, BOSS_ATK_MODES, BOSS_DEF_MODES, healPlayer, damagePlayer,
} from '../game/combat.js';
import { maxHp } from '../game/stats.js';
import {
  SKILL_CATALOG, RULE_SKILLS, moveFromCatalog, passivesOf, skillLevel, globalCost, addCost,
} from '../game/skills.js';
import {
  OTHER_RESOURCES, resourceMax, resourceNow, setResource, restoreAllResources, actionCost, shortfall, costText, witchRest,
} from '../game/resources.js';
import { countOf } from '../game/engine.js';
import { iconOf } from './items.js';
import { publish, rollWith } from '../state/rollLog.js';

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
  return result.tracks
    .filter((t) => t.atkDice > 0)
    .map((t) => `${t.track} 軌　攻 ${fmt(t.atkDice)} 顆＝${fmt(t.atkRoll)}　防 ${fmt(t.defDice)} 顆＝${fmt(t.defRoll)}　傷害 ${fmt(t.damage)}`);
}

export function createBattleView({ root, getState, commit }) {
  const ui = {
    moveId: null,
    modes: {}, // 怪物 id → { atk, def }
    form: { kind: 'mob', count: 1, atk: 10, def: 10, hp: 100, atkMod: '', defMod: '', absDef: 0 },
    moveForm: { name: '', mode: 'normal', school: '', tracks: ['C'], extra: { A: 0, B: 0, C: 0 }, cost: {}, global: true },
    yuwai: false, newSkill: '', newSkillLv: 1,
    hpAdjust: 10,
    openBoxes: new Set(), // 展開中的「＋新增」區塊：重畫後保持展開
  };
  let feed = null;

  /** 可收合的「＋新增」區塊。記住展開狀態，按裡面的按鈕重畫後不會自己收起來 */
  function addBox(key, summary, ...children) {
    return h('details', {
      class: 'add-box', open: ui.openBoxes.has(key),
      ontoggle: (e) => { if (e.target.open) ui.openBoxes.add(key); else ui.openBoxes.delete(key); },
    }, h('summary', { text: summary }), ...children);
  }

  // ---------- 狀態、藥水 ----------
  function statusCard(state) {
    const max = maxHp(state);
    const downed = isDowned(state);
    const toxic = state.toxicity;
    return h('section', { class: 'card' },
      h('div', { class: 'battle-head' },
        h('h2', { class: 'section-title', text: state.name }),
        downed ? h('span', { class: 'badge', dataset: { tone: 'bad' }, text: '倒地' }) : null),
      hpBar(state.hp, max, downed),
      downed
        ? h('p', { class: 'notice notice--bad', text: '倒地了。倒地不會死亡，但劇情可能走向不太好的結局。喝回血藥水或請 GM 處理。' })
        : null,
      h('div', { class: 'row hp-adjust' },
        h('span', { class: 'field-label', text: '手動調整血量' }),
        h('input', {
          class: 'field', type: 'number', min: 1, value: ui.hpAdjust, 'aria-label': '調整數值',
          onchange: (e) => { ui.hpAdjust = num(e.target.value, 1) || 1; },
        }),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { damagePlayer(state, ui.hpAdjust); commit(); } }, '− 扣血'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { healPlayer(state, ui.hpAdjust); commit(); } }, '＋ 補血')),
      h('div', { class: 'chip-row chip-row--info' },
        h('span', { class: `info-chip${toxic >= TOXICITY_MAX ? ' is-bad' : ''}` },
          `毒性 ${toxic} / ${TOXICITY_MAX}`,
          h('button', { type: 'button', class: 'info-chip__btn', 'aria-label': '毒性 −1', onclick: () => { state.toxicity = Math.max(0, toxic - 1); commit(); } }, '−'),
          h('button', { type: 'button', class: 'info-chip__btn', 'aria-label': '毒性 +1', onclick: () => { state.toxicity = Math.min(TOXICITY_MAX, toxic + 1); commit(); } }, '＋')),
        state.shield?.hp > 0 ? h('span', { class: 'info-chip is-good', text: `🛡 護盾 ${fmt(state.shield.hp)}${state.shield.res ? `（抗性 +${state.shield.res}）` : ''}` }) : null,
        state.buffs.atk ? h('span', { class: 'info-chip is-good', text: `下次攻擊 真傷 +${state.buffs.atk} 骰` }) : null,
        state.buffs.def ? h('span', { class: 'info-chip is-good', text: `下次防禦 絕防 +${state.buffs.def} 骰` }) : null),
      toxic >= TOXICITY_MAX ? h('p', { class: 'notice notice--bad', text: `毒性已達 ${TOXICITY_MAX}，不能再喝藥水。戰鬥結束後毒性歸零。` }) : null,
      h('button', {
        type: 'button', class: 'btn btn--small',
        onclick: () => {
          if (!confirm('結束戰鬥？毒性歸零、藥水加成清除、敵人清空。')) return;
          const r = endBattle(state); ui.modes = {};
          publish({ who: state.name, kind: 'note', label: '戰鬥結束', lines: [`毒性 ${r.toxicity} → 0`] });
          commit();
        },
      }, '🏁 結束戰鬥'));
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

  // ---------- 資源 ----------
  function resourceCard(state) {
    const p = passivesOf(state);
    const row = (r) => {
      const now = resourceNow(state, r);
      const max = resourceMax(state, r);
      return h('div', { class: 'res-row' },
        h('span', { class: 'res-row__name', text: r }),
        h('div', { class: 'bar res-row__bar', role: 'img', 'aria-label': `${r} ${now} / ${max}` },
          h('div', { class: 'bar__fill', style: `width:${max > 0 ? Math.min(100, (now / max) * 100) : 0}%` }),
          h('span', { class: 'bar__text', text: `${fmt(now)} / ${fmt(max)}` })),
        h('input', {
          class: 'field res-row__input', type: 'number', min: 0, max, value: now, 'aria-label': `${r} 目前值`,
          onchange: (e) => { setResource(state, r, num(e.target.value)); commit(); },
        }));
    };
    return h('section', { class: 'card' },
      h('div', { class: 'battle-head' },
        h('h2', { class: 'section-title', text: '資源' }),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { restoreAllResources(state); commit(); } }, '觸摸存檔點（全部回滿）')),
      h('p', { class: 'hint', text: '招式會依試算表的「消耗資源」自動扣除；不夠就不能出招。生命見上方血條。觸摸存檔點可以全部回滿；其他回復方式請手動調整。' }),
      ...OTHER_RESOURCES.map(row),
      p.witch
        ? h('div', { class: 'notice' },
            h('p', { text: '魔女（負向被動）：每個主動動作額外花 30 魔力，魔力不夠就無法行動。' }),
            h('button', {
              type: 'button', class: 'btn btn--small', disabled: isDowned(state),
              onclick: () => {
                const r = witchRest(state);
                if (r.error) return toast(r.error);
                publish({ who: state.name, kind: 'note', label: '魔女：放棄主動動作', lines: [`回復 ${r.gained} 魔力（現在 ${r.now}）`] });
                commit();
              },
            }, '放棄這次主動動作，回復 30 魔力'))
        : null);
  }

  // ---------- 已學會技能（影響規則的） ----------
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
      addBox('skill', '＋ 登錄技能 / 從技能庫加入招式',
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

  function moveCard(state) {
    if (!state.moves.some((m) => m.id === ui.moveId)) ui.moveId = state.moves.find((m) => m.kind !== 'heal' && m.kind !== 'shield')?.id ?? state.moves[0]?.id ?? null;
    const f = ui.moveForm;
    const trackToggle = (t) => h('button', {
      type: 'button', class: 'toggle', 'aria-pressed': String(f.tracks.includes(t)),
      onclick: () => { f.tracks = f.tracks.includes(t) ? f.tracks.filter((x) => x !== t) : [...f.tracks, t].sort(); render(); },
    }, `${t} ${TRACK_ATK_STAT[t]}`);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '招式' }),
      h('p', { class: 'hint', text: '一般招式：攻擊骰 = 該軌道傷害 + 真實傷害 + 招式加成，敵人只用對應軌道的防禦來擋。點一個招式選為「出招」用的招式；輔助技能直接按檔位使用。消耗已含魔女的額外魔力。' }),
      state.moves.length
        ? h('ul', { class: 'move-list' }, state.moves.map((m) => {
            const d = moveDetail(state, m);
            const support = m.kind === 'heal' || m.kind === 'shield';
            return h('li', { class: 'move', 'aria-current': String(m.id === ui.moveId) },
              h('div', { class: 'move__main' },
                h('button', { type: 'button', class: 'move__pick', disabled: support, onclick: () => { ui.moveId = m.id; render(); } },
                  h('strong', { text: m.skill ? `${m.name} Lv${skillLevel(state, m.skill)}` : m.name }),
                  h('span', { class: 'move__dice', text: d.dice }),
                  h('small', { text: d.text }),
                  support ? null : h('small', { class: 'move__cost', text: `消耗：${costText(d.cost)}` })),
                support ? supportButtons(state, m) : null),
              h('button', {
                type: 'button', class: 'btn btn--ghost btn--small', 'aria-label': `刪除招式 ${m.name}`,
                onclick: () => { if (!confirm(`刪除招式「${m.name}」？`)) return; state.moves = state.moves.filter((x) => x.id !== m.id); commit(); },
              }, '刪除'));
          }))
        : h('p', { class: 'notice', text: '還沒有招式。下面新增一個。' }),
      addBox('move', '＋ 新增自訂招式',
        h('div', { class: 'row' },
          h('input', {
            class: 'field', type: 'text', placeholder: '招式名稱', value: f.name, maxlength: 20, 'aria-label': '招式名稱',
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
      if (multi) lines.push(`— ${h2.target.id}（傷害 ${fmt(h2.result.total)}）—`);
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
        h('div', {}, h('dt', { text: '防禦' }), h('dd', { text: (m.kind === 'boss' ? `${BOSS_DEF_MODES[modes.def]}：${formatAbc(monsterDef(m, modes.def))}` : formatAbc(m.def)) + (monsterAbs(m) ? `　絕防 ${monsterAbs(m)}` : '') }))),
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

  function render() {
    const state = getState();
    feed?.destroy();
    const feedBox = h('div', { class: 'battle-feed' });
    const scrollY = root.scrollTop;
    root.replaceChildren(
      h('div', { class: 'page-wrap battle-layout' },
        h('div', { class: 'battle-col' }, statusCard(state), resourceCard(state), potionCard(state), moveCard(state), skillCard(state), defenseCard(state)),
        h('div', { class: 'battle-col' }, encounterCard(state),
          h('section', { class: 'card' }, h('h2', { class: 'section-title', text: '戰鬥紀錄' }), feedBox))));
    feed = mountFeed(feedBox, { limit: 8, empty: '出招或喝藥水後，結果會出現在這裡，也會出現在骰盤。' });
    root.scrollTop = scrollY;
  }

  return { render };
}
