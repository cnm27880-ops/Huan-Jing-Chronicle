// ============================================================
// 戰鬥的個人部分（跑團頁左欄常駐，原本的戰鬥面板拆開來）：生命與資源、防禦三軌、狀態、招式、藥水。
// 遭遇戰（怪物、選目標）在 encounterCard.js；版面組合在 sessionView.js。
// 規則照機器人的 A/B/C 三軌道（見 GAME_RULES.md「戰鬥」）。結果會發布到擲骰紀錄，所有人看得到。
// ============================================================
import { h, fmt } from './dom.js';
import { toast, rollFailed } from './controls.js';
import { TRACKS, POTIONS, TOXICITY_MAX } from '../game/rules.js';
import {
  attackDice, pooledAttack, endBattle, monsterAbs, ATTACK_MODES, defenseDice, formatAbc, addMobs, addBosses, removeMonster, newEncounter, playerAttack, monsterAttack,
  drinkPotion, useSupport, isDowned, monsterAtk, monsterDef, BOSS_ATK_MODES, BOSS_DEF_MODES,
} from '../game/combat.js';
import { maxHp } from '../game/stats.js';
import {
  SKILL_CATALOG, bindableSkills, passivesOf, skillLevel, moveFromCatalog, WITCH_EXTRA_COST, douMult,
} from '../game/skills.js';
import {
  OTHER_RESOURCES, resourceMax, resourceNow, setResource, restoreAllResources, actionCost, shortfall, costText, witchRest,
  convertResource, CONVERT_TARGETS,
} from '../game/resources.js';
import { countOf } from '../game/engine.js';
import { iconOf } from './items.js';
import { holdRepeat } from './holdRepeat.js';
import { publish, rollWith } from '../state/rollLog.js';
import { trackLine, targetLine } from '../game/events.js';
import { openValueSheet } from './valueSheet.js';
import { battleSel as sel } from './battleSelect.js';
import { teammates } from './giftSheet.js';
import { sendMail } from '../state/rollLog.js';
import { takeItems, refundItems } from '../game/mail.js';

// 戰鬥紀錄只放戰鬥相關事件；黑市、鑑定、鑲嵌、一般檢定與自訂骰只出現在跑團頁
const BATTLE_KINDS = new Set(['attack', 'defend', 'potion', 'skill', 'divider']);
const BATTLE_NOTE = /^(調整|戰鬥結束|魔女|遭遇)/;
export const isBattleEvent = (ev) => BATTLE_KINDS.has(ev.kind) || (ev.kind === 'note' && BATTLE_NOTE.test(ev.label ?? ''));

const potionText = (p) => [
  p.heal ? `回復 ${p.heal.n}D${p.heal.sides} 生命` : null,
  ...Object.entries(p.restore ?? {}).map(([res, pct]) => `回復 ${pct}% ${res}`),
  p.atk ? `下次攻擊 真傷 +${p.atk} 骰` : null,
  p.def ? `下次防禦 絕防 +${p.def} 骰` : null,
  `毒性 +${p.toxicity}`,
].filter(Boolean).join('，');

/**
 * rerender()：資料或選擇有變時重畫整個跑團頁；onFire()：按下招式的「出招」（打中間選好的目標）；
 * fireInfo()：出招按鈕要顯示的目標文字與能不能按 { text, ready }。
 */
export function createBattleView({ getState, commit, rerender, onFire = () => {}, fireInfo = () => ({ text: '', ready: false }) }) {
  const ui = {
    moveForm: { name: '', skill: '' }, // 自訂招式 = 名稱 + 綁定的主動技能
    feedTo: '', // 餵藥給誰（uid）
    supportTargets: new Set(['self']), // 補血／護盾技能的目標：'self' 或隊友 uid
    openMoves: new Set(), // 展開檔位按鈕的輔助技能 id
    openBoxes: new Set(), // 展開中的「＋新增」區塊：重畫後保持展開
    convert: { from: '靈氣', to: '生命', n: 1 }, // 資源轉換的表單
  };

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
      focusAfter: () => [...document.querySelectorAll(`[data-hud="${key}"]`)].find((el) => el.offsetParent !== null),
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

  /** 狀態標籤：倒地、護盾、藥水加成、毒性滿 */
  function statusTags(state) {
    return [
      isDowned(state) ? h('span', { class: 'info-chip is-bad', text: '倒地' }) : null,
      state.shield?.hp > 0 ? h('span', { class: 'info-chip is-good', text: `🛡 護盾 ${fmt(state.shield.hp)}${state.shield.res ? `（抗性 +${state.shield.res}）` : ''}` }) : null,
      state.buffs.atk ? h('span', { class: 'info-chip is-good', text: `下次攻擊 真傷 +${state.buffs.atk} 骰` }) : null,
      state.buffs.def ? h('span', { class: 'info-chip is-good', text: `下次防禦 絕防 +${state.buffs.def} 骰` }) : null,
      state.toxicity >= TOXICITY_MAX ? h('span', { class: 'info-chip is-bad', text: '毒性已滿' }) : null,
    ].filter(Boolean);
  }

  /** 個人 HUD：名字、生命與資源條、防禦三軌速覽、狀態標籤 */
  function hud(state) {
    const keys = HUD_KEYS(state);
    const d = defenseDice(state).dice;
    const tags = statusTags(state);
    return h('header', { class: 'bt-hud' },
      h('div', { class: 'bt-hud__top' },
        h('h2', { class: 'bt-hud__name', text: state.name }),
        h('span', { class: 'bt-hud__def', 'aria-label': `防禦骰 A ${d.A}、B ${d.B}、C ${d.C}` },
          TRACKS.map((t) => h('span', { class: 'bt-hud__trk', dataset: { track: t } }, h('b', { text: `${t}防` }), h('span', { class: 'num', text: fmt(d[t]) }))))),
      meter(state, keys[0]),
      h('div', { class: 'bt-hud__res' }, keys.slice(1).map((k) => meter(state, k))),
      tags.length ? h('div', { class: 'chip-row chip-row--info bt-hud__tags' }, tags) : null);
  }

  /** 手機頂部的膠囊 HUD：只放生命與資源的數字，點了展開完整 HUD */
  function miniHud(state, { open, onToggle }) {
    const pct = (now, max) => (max > 0 ? Math.max(0, Math.min(100, (now / max) * 100)) : 0);
    const hp = readout(state, '生命');
    return h('button', {
      type: 'button', class: `mini-hud${isDowned(state) ? ' is-bad' : ''}`, 'aria-expanded': String(open), onclick: onToggle,
      'aria-label': `${state.name} 生命 ${hp.now} / ${hp.max}，點一下${open ? '收起' : '展開'}完整狀態`,
    },
    h('span', { class: 'mini-hud__name', text: state.name }),
    h('span', { class: 'mini-hud__hp' },
      h('span', { class: 'mini-hud__bar', 'aria-hidden': 'true' }, h('span', { class: 'mini-hud__fill', style: `width:${pct(hp.now, hp.max)}%` })),
      h('span', { class: 'num', text: `${fmt(hp.now)}/${fmt(hp.max)}` })),
    h('span', { class: 'mini-hud__res' }, HUD_KEYS(state).slice(1).map((k) => {
      const r = readout(state, k);
      return r.max > 0 ? h('span', { class: 'mini-hud__chip', dataset: { hud: k } }, h('b', { text: k.slice(0, 1) }), h('span', { class: 'num', text: fmt(r.now) })) : null;
    })),
    h('span', { class: 'mini-hud__caret', 'aria-hidden': 'true', text: open ? '▴' : '▾' }));
  }

  // ---------- 狀態分頁：護盾、藥水加成、結束戰鬥 ----------
  function statusCard(state) {
    const downed = isDowned(state);
    return h('section', { class: 'card' },
      h('h2', { class: 'section-title', text: '狀態' }),
      h('p', { class: 'hint', text: '點生命或資源條可以調整數值。招式會依「消耗資源」自動扣除，不夠就不能出招。' }),
      downed
        ? h('p', { class: 'notice notice--bad', text: '倒地了。倒地不會死亡，但劇情可能走向不太好的結局。喝回血藥水或請 GM 處理。' })
        : null,
      state.toxicity >= TOXICITY_MAX ? h('p', { class: 'notice notice--bad', text: `毒性已達 ${TOXICITY_MAX}，不能再喝藥水。戰鬥結束後毒性歸零。` }) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: () => { restoreAllResources(state); commit(); } }, '觸摸存檔點（全部回滿）'),
        h('button', {
          type: 'button', class: 'btn btn--small',
          onclick: () => {
            if (!confirm('結束戰鬥？毒性歸零、藥水加成清除、敵人清空。')) return;
            const r = endBattle(state); sel.modes = {};
            publish({ who: state.name, kind: 'note', label: '戰鬥結束', lines: [`毒性 ${r.toxicity} → 0`] });
            commit();
          },
        }, '🏁 結束戰鬥')));
  }

  /** 餵回復藥水給隊友（倒地的也可以，等於拉起來）：藥水先從自己的背包扣，寄失敗會還回來；毒性算被救的人 */
  async function feedPotion(state, name) {
    if (!ui.feedTo) return toast('先選要餵誰。');
    if (!takeItems(state, { [name]: 1 })) return toast(`背包裡沒有${name}。`);
    commit();
    try {
      const res = await sendMail({ to: ui.feedTo, kind: 'potion', potion: name });
      toast(`已餵出${name}（回復 ${res.heal}），紀錄會顯示在戰鬥紀錄裡。`);
    } catch (e) {
      refundItems(state, { [name]: 1 });
      commit();
      toast(`沒有餵出去：${e.message}`);
    }
  }

  function feedBox(state) {
    const mates = teammates();
    const heals = Object.keys(POTIONS).filter((n) => POTIONS[n].heal && countOf(state, n) > 0);
    if (!mates.length || !heals.length) return null;
    return h('div', { class: 'feedbox' },
      h('p', { class: 'field-label', text: '餵給隊友（對方不用同意；倒地的也能拉起來，毒性算對方的）' }),
      h('div', { class: 'row' },
        h('select', { class: 'field', 'aria-label': '餵給誰', onchange: (e) => { ui.feedTo = e.target.value; rerender(); } },
          h('option', { value: '', text: '選擇隊友…' }),
          mates.map((m) => h('option', { value: m.uid, selected: ui.feedTo === m.uid ? true : null, text: `${m.name}${m.online ? '' : '（離線）'}` }))),
        heals.map((n) => h('button', {
          type: 'button', class: 'btn btn--small', disabled: ui.feedTo ? null : true, onclick: () => feedPotion(state, n),
        }, `餵 ${n}（×${fmt(countOf(state, n))}）`))));
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
                big: r.rolled != null ? `+${r.healed}` : r.restored ? Object.entries(r.restored).map(([k, v]) => `${k} +${v}`).join('　') : r.atk ? `攻 +${r.atk}` : `防 +${r.def}`,
                tone: r.atLimit ? 'warn' : undefined,
                lines: [
                  r.rolled != null ? `${r.dice} = ${r.rolled}，生命 ${state.hp} / ${maxHp(state)}` : null,
                  r.restored ? `回復 ${Object.entries(r.restored).map(([k, v]) => `${k} +${v}`).join('、')}` : null,
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
        : h('p', { class: 'notice', text: '背包裡沒有藥水。到修整日調劑就會得到。' }),
      feedBox(state));
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

  /** 補血／護盾的目標選擇：自己＋房間裡的隊友（補血技能可選的目標數照技能等級，護盾只能選 1 個） */
  function supportTargetPicker(state, m) {
    const c = SKILL_CATALOG[m.skill];
    const cap = c.kind === 'heal' ? c.targetsAt(skillLevel(state, m.skill)) : 1;
    const picked = ui.supportTargets;
    const mates = teammates();
    for (const x of [...picked]) if (x !== 'self' && !mates.some((mm) => mm.uid === x)) picked.delete(x); // 隊友不見了就拿掉
    if (!picked.size) picked.add('self');
    const toggle = (id) => {
      if (picked.has(id)) { if (picked.size > 1) picked.delete(id); } // 至少留一個目標
      else if (cap === 1) { picked.clear(); picked.add(id); }
      else if (picked.size >= cap) return toast(`「${m.name}」這個等級最多 ${cap} 個目標。`);
      else picked.add(id);
      return rerender();
    };
    const chip = (id, label) => h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(picked.has(id)), onclick: () => toggle(id) }, label);
    return h('div', { class: 'support-targets' },
      h('p', { class: 'field-label', text: `目標（最多 ${cap} 個，已選 ${picked.size}）` }),
      h('div', { class: 'toggle-row' },
        chip('self', '自己'),
        mates.map((mm) => chip(mm.uid, `${mm.name}${mm.online ? '' : '（離線）'}`))),
      mates.length ? null : h('p', { class: 'hint', text: '沒有加入房間，或房間裡沒有其他玩家，所以只能對自己使用。' }));
  }

  /** 施放補血／護盾：隊友的效果用信箱送出（對方上線時自動套用、不用同意），自己的立刻生效；花費只付一次 */
  async function castSupport(state, m, tier, t) {
    const c = SKILL_CATALOG[m.skill];
    const lv = skillLevel(state, m.skill);
    if (isDowned(state)) return toast('你已經倒地，無法行動。');
    const lack = shortfall(state, actionCost(state, m, t.cost));
    if (lack) return toast(`資源不足：${lack}`);
    const mates = teammates();
    const sendTo = [...ui.supportTargets].filter((x) => x !== 'self');
    const self = ui.supportTargets.has('self');
    const sent = [];
    let failed = '';
    for (const uid of sendTo) {
      try { await sendMail({ to: uid, kind: 'support', skill: m.skill, support: c.kind, pct: t.pct, res: c.kind === 'shield' ? c.resAt(lv) : 0 }); sent.push(uid); } catch (e) { failed = e.message; }
    }
    if (!self && !sent.length) return toast(`沒有施放出去：${failed || '送不出去'}`);
    if (failed) toast(`有人沒送到：${failed}`);
    const before = state.hp;
    const r = useSupport(state, m.id, tier, { self });
    if (r.error) return toast(r.error);
    if (self) { // 隊友那邊的紀錄由伺服器寫；自己的這筆由這裡發布
      publish({
        who: state.name, kind: 'skill', label: `${m.name}（${t.pct}%）`,
        big: r.kind === 'heal' ? `+${r.healed}` : `盾 ${r.amount}`,
        tone: 'ok',
        lines: [
          r.kind === 'heal'
            ? `自己：最大生命 ${t.pct}% = ${r.amount}，生命 ${before} → ${state.hp} / ${maxHp(state)}`
            : `自己：護盾 = 最大生命 ${t.pct}% = ${r.amount}${r.res ? `，抗性免疫 +${r.res}（護盾破了才消失）` : ''}`,
          sent.length ? `同時施放給：${sent.map((u) => mates.find((mm) => mm.uid === u)?.name ?? u).join('、')}` : null,
          `花費：${costText(r.cost)}`,
        ].filter(Boolean),
      });
    } else toast(`已對 ${sent.length} 位隊友施放${m.name}（花費 ${costText(r.cost)}）。`);
    commit();
  }

  function supportButtons(state, m) {
    const c = SKILL_CATALOG[m.skill];
    return h('div', { class: 'support-box' },
      supportTargetPicker(state, m),
      h('div', { class: 'row support-btns' }, c.tiers.map((t, i) => {
        const cost = actionCost(state, m, t.cost);
        const lack = shortfall(state, cost);
        return h('button', {
          type: 'button', class: 'btn btn--small', disabled: isDowned(state) || Boolean(lack), title: lack ?? '',
          onclick: () => castSupport(state, m, i, t),
        }, `${t.pct}%（${costText(cost)}）`);
      })));
  }

  const trackTag = (t) => h('span', { class: 'trk', dataset: { track: t }, text: t });

  /**
   * 招式條：點一下選為「目前招式」（中間選目標的上限跟著它），選中的會展開內容與「出招」按鈕。
   * 輔助技能（回血、護盾）點一下展開檔位按鈕，直接使用。
   */
  function moveRow(state, m) {
    const support = m.kind === 'heal' || m.kind === 'shield';
    const d = moveDetail(state, m);
    // 付不起：一般招式看整個花費；輔助技能看最便宜的檔位
    const lack = shortfall(state, support ? actionCost(state, m, SKILL_CATALOG[m.skill].tiers[0].cost) : d.cost);
    const armed = !support && m.id === sel.moveId;
    const open = support ? ui.openMoves.has(m.id) : armed;
    const tracks = support ? [] : (m.mode === 'all' ? TRACKS : m.tracks ?? []);
    const max = Math.max(1, m.targets ?? 1);
    const fire = armed ? fireInfo() : null;
    return h('li', { class: `move${lack ? ' is-short' : ''}`, 'aria-current': String(armed), dataset: { open: String(open) } },
      h('div', { class: 'move__main' },
        h('button', {
          type: 'button', class: 'move__pick', 'aria-expanded': String(open),
          onclick: () => {
            if (support) { if (open) ui.openMoves.delete(m.id); else ui.openMoves.add(m.id); } else sel.moveId = m.id;
            rerender();
          },
        },
        h('span', { class: 'move__tags' }, support ? h('span', { class: 'trk', dataset: { track: 'S' }, text: '輔助' }) : tracks.map(trackTag)),
        h('span', { class: 'move__dice', text: d.dice }),
        h('strong', { class: 'move__name', text: m.skill ? `${m.name} Lv${skillLevel(state, m.skill)}` : m.name }),
        !support && max > 1 ? h('span', { class: 'move__targets', text: `${max} 目標` }) : null,
        support ? null : h('small', { class: 'move__cost', text: `消耗：${costText(d.cost)}` }),
        open ? h('small', { class: 'move__detail', text: d.text }) : null,
        lack ? h('small', { class: 'move__lack', text: `缺少：${lack}` }) : null),
        support && open ? supportButtons(state, m) : null,
        armed
          ? h('button', {
              type: 'button', class: 'btn btn--primary move__fire', disabled: Boolean(lack) || !fire.ready || isDowned(state), onclick: () => onFire(),
            }, fire.ready ? `⚔️ 出招 → ${fire.text}` : `⚔️ 出招（${fire.text || '先在中間選目標'}）`)
          : null),
      h('button', {
        type: 'button', class: 'move__del', 'aria-label': `刪除招式 ${m.name}`, title: '刪除招式',
        onclick: () => { if (!confirm(`刪除招式「${m.name}」？`)) return; state.moves = state.moves.filter((x) => x.id !== m.id); ui.openMoves.delete(m.id); commit(); },
      }, '✕'));
  }

  /** 鬥氣加骰：這次出招花幾點鬥氣，每點 +1 顆真實傷害骰（冠軍勇士每點 4 顆）；出招後歸零 */
  function douRow(state) {
    if (resourceMax(state, '鬥氣') <= 0) return null;
    const have = resourceNow(state, '鬥氣');
    sel.dou = Math.max(0, Math.min(sel.dou, have));
    const mult = douMult(state);
    const hintText = () => (sel.dou ? `下次出招：花 ${sel.dou} 鬥氣，真實傷害 +${fmt(sel.dou * mult)} 骰` : `每點鬥氣 +${mult} 顆真實傷害骰${mult > 1 ? '（冠軍勇士）' : ''}，只對下一次出招有效`);
    const num = h('strong', { class: 'num dou__n', text: String(sel.dou) });
    const hint = h('small', { class: 'hint', text: hintText() });
    const minus = h('button', { type: 'button', class: 'btn btn--small btn--ghost dou__btn', 'aria-label': '少 1 點（按住連減）', disabled: sel.dou <= 0 }, '−');
    const plus = h('button', { type: 'button', class: 'btn btn--small btn--ghost dou__btn', 'aria-label': '多 1 點（按住連加）', disabled: sel.dou >= have }, '＋');
    let moved = false;
    // 連按途中只改這一列的字，不重畫整個面板（按鈕被換掉就收不到「放開」）；放開才重畫一次
    const step = (d) => () => {
      const n = Math.max(0, Math.min(have, sel.dou + d));
      if (n === sel.dou) return false;
      sel.dou = n; moved = true;
      num.textContent = String(n); hint.textContent = hintText();
      minus.disabled = n <= 0; plus.disabled = n >= have;
      return true;
    };
    const end = () => { if (moved) { moved = false; rerender(); } };
    holdRepeat(minus, step(-1), { onEnd: end });
    holdRepeat(plus, step(1), { onEnd: end });
    return h('div', { class: 'dou' },
      h('span', { class: 'field-label', text: `🔥 鬥氣加骰（現有 ${fmt(have)}，按住＋／－可連加連減）` }),
      h('div', { class: 'row' },
        minus, num, plus,
        h('button', { type: 'button', class: 'btn btn--small btn--ghost', disabled: have < 1, onclick: () => { sel.dou = have; rerender(); } }, '全部'),
        h('button', { type: 'button', class: 'btn btn--small btn--ghost', disabled: sel.dou <= 0, onclick: () => { sel.dou = 0; rerender(); } }, '歸零'),
        hint));
  }

  /** 資源轉換：靈氣 1 比 1 換生命；能量 1 比 1 換任意資源 */
  function convertBox(state) {
    const f = ui.convert;
    const targets = CONVERT_TARGETS[f.from];
    if (!targets.includes(f.to)) f.to = targets[0];
    return addBox('convert', '🔄 資源轉換（靈氣→生命、能量→任意資源）',
      h('p', { class: 'hint', text: '靈氣可以 1 比 1 換成生命；能量可以 1 比 1 換成任意資源；魔力、算力沒有基礎用法。換到的量不會超過上限。' }),
      h('div', { class: 'row' },
        h('select', { class: 'field', 'aria-label': '用哪種資源換', onchange: (e) => { f.from = e.target.value; rerender(); } },
          Object.keys(CONVERT_TARGETS).map((r) => h('option', { value: r, selected: f.from === r ? true : null, text: `${r}（${fmt(resourceNow(state, r))}）` }))),
        h('span', { text: '→' }),
        h('select', { class: 'field', 'aria-label': '換成什麼', onchange: (e) => { f.to = e.target.value; } },
          targets.map((r) => h('option', { value: r, selected: f.to === r ? true : null, text: `${r}（${fmt(resourceNow(state, r))}）` }))),
        h('input', { class: 'field', type: 'number', min: 1, value: f.n, 'aria-label': '換多少', onchange: (e) => { f.n = Math.max(1, Math.floor(Number(e.target.value)) || 1); } }),
        h('button', {
          type: 'button', class: 'btn btn--small',
          onclick: () => {
            const r = convertResource(state, f.from, f.to, f.n);
            if (r.error) return toast(r.error);
            publish({ who: state.name, kind: 'note', label: '調整：資源轉換', lines: [`${r.from} −${r.spent} → ${r.to} +${r.gained}`] });
            commit();
          },
        }, '轉換')));
  }

  /**
   * 手機的「目標」抽屜底部固定的出招列：選招式（下拉）＋出招，免得在招式頁與目標頁之間來回切。
   * 電腦版用 CSS 隱藏（左欄就有出招按鈕）。沒有可出的攻擊招式就不顯示。
   */
  function fireBar(state) {
    const attacks = state.moves.filter((m) => m.kind !== 'heal' && m.kind !== 'shield');
    if (!attacks.length) return null;
    if (!attacks.some((m) => m.id === sel.moveId)) sel.moveId = attacks[0].id;
    const cur = attacks.find((m) => m.id === sel.moveId);
    const lack = shortfall(state, moveDetail(state, cur).cost);
    const fire = fireInfo();
    return h('div', { class: 'firebar' },
      h('select', {
        class: 'field firebar__move', 'aria-label': '選招式',
        onchange: (e) => { sel.moveId = e.target.value; rerender(); },
      }, attacks.map((m) => h('option', { value: m.id, selected: m.id === sel.moveId ? true : null, text: `${m.name}（${moveDetail(state, m).dice}）` }))),
      h('button', {
        type: 'button', class: 'btn btn--primary firebar__fire', disabled: Boolean(lack) || !fire.ready || isDowned(state), onclick: () => onFire(),
      }, fire.ready ? `⚔️ 出招 → ${fire.text}` : `⚔️ 出招（${fire.text || '先選目標'}）`));
  }

  function moveCard(state) {
    if (!state.moves.some((m) => m.id === sel.moveId)) sel.moveId = state.moves.find((m) => m.kind !== 'heal' && m.kind !== 'shield')?.id ?? state.moves[0]?.id ?? null;
    const f = ui.moveForm;
    const learned = bindableSkills(state);
    const skillSummary = (n) => {
      const m = moveFromCatalog(n);
      if (m.kind === 'heal' || m.kind === 'shield') return `輔助技能（${m.kind === 'heal' ? '回復' : '護盾'}），照技能的檔位使用。`;
      return `傷害軌道 ${(m.mode === 'all' ? TRACKS : m.tracks).join('、')}；${m.targets} 目標；消耗：${costText(m.cost)}`;
    };
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
      h('p', { class: 'hint', text: '點招式選為目前招式（能選幾個目標照招式規定），再按「出招」打中間選好的目標；輔助技能點開後按檔位使用。消耗已含魔女的額外魔力，付不起的會變灰。' }),
      douRow(state),
      state.moves.length
        ? h('ul', { class: 'move-list' }, state.moves.map((m) => moveRow(state, m)))
        : h('p', { class: 'notice', text: '還沒有自訂招式。下面綁定一個主動技能新增。' }),
      convertBox(state),
      addBox('move', '＋ 新增自訂招式',
        h('p', { class: 'hint', text: '招式要綁定一個已學會的主動技能；傷害軌道、目標數、消耗（含全域響應耗用）、每級加成都照技能，只要取個自己的招式名稱。' }),
        learned.length
          ? h('div', {},
              h('input', {
                class: 'field', type: 'text', placeholder: '招式名稱（留空＝用技能名稱）', value: f.name, maxlength: 200, 'aria-label': '招式名稱',
                oninput: (e) => { f.name = e.target.value; },
              }),
              h('select', { class: 'field', 'aria-label': '綁定的主動技能', onchange: (e) => { f.skill = e.target.value; rerender(); } },
                h('option', { value: '', text: '綁定主動技能…' }),
                learned.map((n) => h('option', { value: n, selected: f.skill === n ? true : null, text: `${n} Lv${skillLevel(state, n)}` }))),
              f.skill ? h('p', { class: 'hint', text: skillSummary(f.skill) }) : null,
              h('button', {
                type: 'button', class: 'btn btn--primary btn--small',
                onclick: () => {
                  if (!f.skill) return toast('請先綁定一個主動技能。');
                  const base = moveFromCatalog(f.skill);
                  state.moves.push({ ...base, id: `m${Date.now().toString(36)}`, name: f.name.trim() || f.skill });
                  ui.moveForm = { name: '', skill: '' };
                  commit();
                },
              }, '新增'))
          : h('p', { class: 'notice', text: '還沒有學會可綁定的主動技能（到修整日學習，或請 GM 匯入角色卡）。' })));
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

  return { hud, miniHud, moveCard, fireBar, potionCard, statusCard, defenseCard };
}
