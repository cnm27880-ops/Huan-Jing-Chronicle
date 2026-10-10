// ============================================================
// 修整日頁面（黑金版，見 DESIGN.md）
// 設計原則：全程用點的，不用打字；狀態列常駐在上方。
// 版面：上方 HUD → 兩個行動分頁 → 左邊一步步設定（行動、難度、次數與加值）＋大按鈕，右邊結果。
// 只改畫面：採集、製作、檢定都還是呼叫 engine.js 的同一批函式。
// ============================================================
import { h, fmt } from './dom.js';
import { statusBar } from './statusBar.js';
import { itemTile, amountPicker, toast } from './controls.js';
import { iconOf, TIERS } from './items.js';
import {
  GATHER_ACTIONS, CRAFT_ACTIONS, DIFFICULTIES, RECIPES,
  CRAFT_COST_AMOUNT, LIFE_SKILLS,
} from '../game/rules.js';
import {
  modifier, gather, craft, craftableTimes, keepsakeApplies, countOf,
} from '../game/engine.js';
import { SKILL_TABLE, MAX_SKILL_LEVEL, FOOL_SWAPS, FOOL_LEVELS, usesSkillTable, inCatalog, upgradePlan, maxAffordableLevel, upgradeSkillTo } from '../game/skillTable.js';
import { drawBooks, chooseDraw, hasPendingDraw, DRAW_TIERS, MAX_DRAW_AT_ONCE, DRAW_CHOICES } from '../game/skillDraw.js';
import { badgeStatus, craftBadge, renameBadge, BADGE_COUNT, BADGE_NAME_MAX } from '../game/badges.js';
import {
  allRecipes, allMaterials, USABLE_ITEMS, MEAT, MONSTER_MEAT, MEAT_PER_HARVEST, MEAT_FEED,
  specialMaxTimes, craftSpecial, useSpecialItem, gatherDaily, dailyDone, feedMeatball, harvestMeat,
} from '../game/special.js';
import { openSheet } from './sheet.js';
import { skillTile, skillInfoBlock, skillTag } from './skillTile.js';

const ICONS = { 採藥: '🌿', 狩獵: '🏹', 挖礦: '⛏️', 釣魚: '🎣', 調劑: '⚗️', 烹飪: '🍳', 鑄造: '🔨', 書寫: '✍️' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createRestView({ root, getState, commit }) {
  const ui = {
    tab: 'gather',
    gatherAction: '採藥',
    craftAction: '烹飪',
    craftDiff: '普通',
    specialRecipe: '祕製桃花酒',
    matSkill: {}, // 每種特殊材料選的檢定技能
    times: 1,
    keepsakes: new Set(),
    results: [], // 最新的在最前面
    fresh: false, // 剛產生新結果：要播動畫並捲到結果
  };

  const partsText = (list) => list.map((p) => `${p.label} +${p.value}`).join('　');
  const pushResult = (r) => { ui.results.unshift(r); ui.results.length = Math.min(ui.results.length, 20); ui.fresh = true; commit(); };

  /** 抽取的技能還沒選完就不能做其他事（RULES_OVERVIEW 5.1）：擋下並打開選擇面板 */
  function blockedByDraw() {
    if (!hasPendingDraw(getState())) return false;
    toast('先把抽取的技能選完。');
    openDrawSheet();
    return true;
  }

  // ---------- 共用 ----------
  const section = (title, ...children) => h('section', { class: 'card rest-step' }, h('h2', { class: 'section-title', text: title }), ...children);

  /** 加值：大數字＋每一項來源 */
  function modLine(mod) {
    return h('div', { class: 'mod-line' },
      h('span', { class: 'mod-line__label', text: '加值' }),
      h('strong', { class: 'mod-line__value num', text: `+${mod.total}` }),
      h('span', { class: 'mod-line__parts' }, mod.parts.map((p) => h('span', { class: 'mod-chip' }, `${p.label} `, h('b', { class: 'num', text: `+${p.value}` })))));
  }

  function keepsakeToggles(state, action) {
    const usable = Object.entries(state.keepsakes).filter(([n, d]) => keepsakeApplies(d, action) && countOf(state, n) > 0);
    [...ui.keepsakes].forEach((n) => { if (!usable.some(([u]) => u === n)) ui.keepsakes.delete(n); });
    if (!usable.length) return null;
    return h('div', { class: 'rest-field' },
      h('p', { class: 'field-label', text: '使用紀念品（每次檢定各消耗 1 個）' }),
      h('div', { class: 'keepsake-row' },
        usable.map(([n, d]) =>
          h('button', {
            type: 'button', class: 'keepsake', 'aria-pressed': String(ui.keepsakes.has(n)), title: d.desc,
            onclick: () => { ui.keepsakes.has(n) ? ui.keepsakes.delete(n) : ui.keepsakes.add(n); render(); },
          },
          h('span', { class: 'keepsake__icon', 'aria-hidden': 'true', text: iconOf(n) }),
          h('span', { class: 'keepsake__text' }, h('strong', { text: n }), h('small', { text: `+${d.bonus}　剩 ${fmt(countOf(state, n))}` })),
          h('span', { class: 'keepsake__check', 'aria-hidden': 'true', text: ui.keepsakes.has(n) ? '✓' : '' })))));
  }

  /** 行動卡：圖示、名稱、技能等級、目前加值 */
  function actionCards(state, list, current, onPick) {
    return h('div', { class: 'action-cards', role: 'radiogroup' },
      list.map((a) => h('button', {
        type: 'button', class: 'action-card', role: 'radio', 'aria-checked': String(a === current),
        onclick: () => onPick(a),
      },
      h('span', { class: 'action-card__icon', 'aria-hidden': 'true', text: ICONS[a] }),
      h('span', { class: 'action-card__name', text: a }),
      h('span', { class: 'action-card__sub', text: `技能 ${state.lifeSkills[a] ?? 0}` }),
      h('span', { class: 'action-card__mod num', text: `+${modifier(state, a, 'rest').total}` }))));
  }

  /** 次數＋紀念品＋加值，最後是大按鈕 */
  function runBlock(state, a, { label, hint, max, quick, onRun }) {
    const mod = modifier(state, a, 'rest', [...ui.keepsakes]);
    return [
      section('次數與加值',
        h('div', { class: 'rest-field' },
          h('p', { class: 'field-label', text: hint }),
          amountPicker({ value: ui.times, max, quick, onChange: (n) => { ui.times = n; render(); } })),
        keepsakeToggles(state, a),
        modLine(mod)),
      h('div', { class: 'rest-go' },
        h('button', { type: 'button', class: 'btn btn--primary btn--go', onclick: onRun }, label)),
    ];
  }

  // ---------- 採集 ----------
  function gatherPanel(state) {
    const a = ui.gatherAction;
    const max = state.time;
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    return [
      section('選擇採集', actionCards(state, GATHER_ACTIONS, a, (x) => { ui.gatherAction = x; render(); })),
      ...(max <= 0
        ? [h('p', { class: 'notice notice--bad', text: '今天的時間用完了。點上方的「新的一天」恢復 10 點。' })]
        : runBlock(state, a, {
            label: `${ICONS[a]} ${a} ${ui.times} 次`, hint: `每次 1 點時間，今天還剩 ${max} 點`, max, quick: [1, 3, 5],
            onRun: () => blockedByDraw() || pushResult({ kind: 'gather', action: a, ...gather(state, a, ui.times, [...ui.keepsakes]) }),
          })),
    ];
  }

  // ---------- 製作 ----------
  function craftPanel(state) {
    const a = ui.craftAction;
    const d = ui.craftDiff;
    const recipe = RECIPES[a][d];
    const max = craftableTimes(state, a, d);
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    return [
      section('選擇製作', actionCards(state, CRAFT_ACTIONS, a, (x) => { ui.craftAction = x; render(); })),
      section('難度與配方',
        h('div', { class: 'diff-grid', role: 'radiogroup' },
          DIFFICULTIES.map((x, i) => {
            const r = RECIPES[a][x];
            const n = craftableTimes(state, a, x);
            return h('button', {
              type: 'button', class: `diff${n ? '' : ' is-none'}`, role: 'radio', 'aria-checked': String(x === d), dataset: { tier: i },
              onclick: () => { ui.craftDiff = x; render(); },
            },
            h('span', { class: 'diff__head' }, h('strong', { text: x }), h('span', { class: 'diff__dc num', text: `DC ${r.dc}` })),
            h('span', { class: 'diff__cost' }, h('span', { 'aria-hidden': 'true', text: iconOf(r.cost) }), ` ${r.cost} ×${CRAFT_COST_AMOUNT}`),
            h('span', { class: 'diff__can', text: n ? `可做 ${fmt(n)} 次` : `只有 ${fmt(countOf(state, r.cost))} 個` }));
          })),
        h('div', { class: 'reward-line' },
          h('p', { class: 'field-label', text: `成功時從這些抽 ${recipe.count} 個` }),
          h('div', { class: 'reward-line__tiles' }, recipe.rewards.map((r) => itemTile(r, null, { size: 'sm' }))))),
      ...(max <= 0
        ? [h('p', { class: 'notice notice--bad', text: `${recipe.cost}不足 ${CRAFT_COST_AMOUNT} 個，先去採集吧。` })]
        : runBlock(state, a, {
            label: `${ICONS[a]} ${a}（${d}）${ui.times} 次`, hint: '製作不消耗時間', max, quick: [1, 5, 10],
            onRun: () => blockedByDraw() || pushResult({ kind: 'craft', action: a, diff: d, ...craft(state, a, d, ui.times, [...ui.keepsakes]) }),
          })),
    ];
  }

  // ---------- 結果 ----------
  const lootTiles = (loot) =>
    h('div', { class: 'loot' }, Object.entries(loot).sort((x, y) => y[1] - x[1]).map(([n, q]) => itemTile(n, q, { size: 'sm' })));

  /** 結果卡：和擲骰紀錄同一種樣式（左側色條、右上膠囊徽章、六角骰面） */
  function resultCard(r, latest) {
    if (r.kind === 'note') return h('li', { class: 'rres rres--note', text: r.text });
    const gatherKind = r.kind === 'gather';
    if (!r.rolls.length) return h('li', { class: 'rres rres--note', text: gatherKind ? '時間不足，沒有採集。' : '原料不足，沒有製作。' });
    const best = gatherKind ? Math.max(...r.rolls.map((x) => TIERS.indexOf(x.tier))) : -1;
    const ok = gatherKind ? 0 : r.rolls.filter((x) => x.success).length;
    const used = r.rolls.flatMap((x) => x.used);
    const tone = gatherKind ? 'tier' : ok > 0 ? 'ok' : 'fail';
    return h('li', { class: 'rres', dataset: { tone, tier: gatherKind ? best : 'none' } },
      h('div', { class: 'rres__head' },
        h('strong', { class: 'rres__title', text: gatherKind ? `${ICONS[r.action]} ${r.action} ×${r.rolls.length}` : `${ICONS[r.action]} ${r.action}（${r.diff}）×${r.rolls.length}` }),
        h('span', { class: 'rres__badge', dataset: { tone } , text: gatherKind ? `經驗 +${fmt(r.exp)}` : `成功 ${ok} / ${r.rolls.length}` })),
      gatherKind && best >= 3 ? h('p', { class: 'rres__flash', text: `擲出${TIERS[best]}！` }) : null,
      h('div', { class: 'dice-faces' },
        r.rolls.map((x) => h('span', {
          class: 'die',
          dataset: { tier: gatherKind ? TIERS.indexOf(x.tier) : x.success ? 'ok' : 'fail', final: x.total, roll: latest ? '1' : '0' },
          title: `1D20（${x.roll}）+ ${x.mod} = ${x.total}${gatherKind ? `　${x.tier}` : x.success ? '　成功' : '　失敗'}`,
          text: x.total,
        }))),
      h('p', { class: 'dice-legend', text: gatherKind ? '每一骰的總分；顏色是評級（綠 簡單、藍 普通、紫 困難、金 史詩、白 神級）' : '每一骰的總分；藍色成功、紅色失敗' }),
      Object.keys(r.loot).length ? lootTiles(r.loot) : h('p', { class: 'hint', text: '全部失敗，原料全毀。' }),
      used.length ? h('p', { class: 'hint', text: `用掉紀念品 ${used.length} 個` }) : null);
  }

  /** 唯一的動畫：最新結果的數字先亂跳再定格 */
  function rollNumbers() {
    const els = root.querySelectorAll('[data-roll="1"]');
    if (!els.length || reduceMotion()) return;
    const start = performance.now();
    const tick = (t) => {
      const done = t - start > 450;
      els.forEach((el) => { el.textContent = done ? el.dataset.final : String(Math.floor(Math.random() * 40) + 1); });
      if (!done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- 學習（花經驗學新技能、升級；不花時間） ----------
  const TIER_RANK = { 初階: 0, 進階: 1, 大師: 2, 傳說: 3, 神級: 4 };
  const byTier = (a, b) => (TIER_RANK[SKILL_TABLE[a]?.tier] ?? 9) - (TIER_RANK[SKILL_TABLE[b]?.tier] ?? 9) || a.localeCompare(b, 'zh-TW');

  /** 一個技能的學習／升級面板：選目標等級 → 看要付什麼 → 確認 */
  function openLearnSheet(name) {
    const pick = { target: null };
    let sheet;

    const costRow = (label, need, have) => h('li', { class: 'learn-cost__row', dataset: { ok: have >= need ? '1' : '0' } },
      h('span', { text: label }),
      h('span', { class: 'num', text: `${fmt(need)}（有 ${fmt(have)}）` }),
      h('b', { 'aria-hidden': 'true', text: have >= need ? '✓' : `缺 ${fmt(need - have)}` }));

    function doUpgrade(plan) {
      if (blockedByDraw()) return;
      const state = getState();
      const bookText = Object.entries(plan.books).map(([n, q]) => `${n} ×${q}`).join('、');
      if (!confirm(`${name}：${plan.from ? `${plan.from} 級` : '學習'} → ${plan.to} 級\n將消耗 ${fmt(plan.exp)} 經驗、${bookText}。\n確定嗎？`)) return;
      const r = upgradeSkillTo(state, name, plan.to);
      if (!r.ok) return toast(r.error);
      const swapText = r.swaps.map((x) => `${x.level} 級對調「${x.a}」與「${x.b}」`).join('；');
      toast(`${name} ${r.from ? `${r.from} 級升到` : '學會，升到'} ${r.level} 級${swapText ? `。${swapText}` : ''}`);
      pick.target = null;
      commit();
      sheet.refresh();
    }

    function body() {
      const state = getState();
      const lv = Number(state.skills?.[name]) || 0;
      const info = skillInfoBlock(name);
      if (lv >= MAX_SKILL_LEVEL) return h('div', { class: 'learn' }, info, h('p', { class: 'notice', text: `${name} 已經滿級。` }));
      const best = maxAffordableLevel(state, name);
      if (!pick.target || pick.target <= lv || pick.target > MAX_SKILL_LEVEL) pick.target = Math.max(best, lv + 1);
      const plan = upgradePlan(state, name, pick.target);
      const set = (n) => { pick.target = n; sheet.refresh(); };
      const swapAt = FOOL_SWAPS[name] ? FOOL_LEVELS.filter((x) => x > lv && x <= pick.target) : [];
      return h('div', { class: 'learn' },
        info,
        h('p', { class: 'field-label', text: `目前 ${lv ? `${lv} 級` : '未學會'}　要升到幾級？` }),
        h('div', { class: 'chip-row learn__levels', role: 'radiogroup', 'aria-label': '目標等級' },
          Array.from({ length: MAX_SKILL_LEVEL - lv }, (_, i) => lv + 1 + i).map((n) =>
            h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(n === pick.target), onclick: () => set(n) }, `${n} 級`))),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn--small', onclick: () => set(lv + 1) }, lv ? '升一級' : '只學會'),
          best > lv ? h('button', { type: 'button', class: 'btn btn--small', onclick: () => set(best) }, `材料夠的最高：${best} 級`) : null,
          h('button', { type: 'button', class: 'btn btn--small', onclick: () => set(MAX_SKILL_LEVEL) }, '學滿 10 級')),
        h('p', { class: 'field-label', text: `${lv ? `${lv} → ${plan.to} 級` : `學會並升到 ${plan.to} 級`}要消耗` }),
        h('ul', { class: 'learn-cost' },
          plan.gate && plan.gate.need > 0 ? costRow('累計花費經驗（門檻）', plan.gate.need, plan.gate.have) : null,
          costRow('經驗', plan.exp, plan.haveExp),
          Object.entries(plan.books).map(([n, q]) => costRow(`${iconOf(n)} ${n}`, q, getState().inventory[n] ?? 0))),
        swapAt.length ? h('p', { class: 'hint', text: `會在 ${swapAt.join('、')} 級自動對調「${FOOL_SWAPS[name][0]}」與「${FOOL_SWAPS[name][1]}」。` }) : null,
        h('button', {
          type: 'button', class: 'btn btn--primary btn--go', disabled: plan.ok ? null : true, onclick: () => doUpgrade(plan),
        }, plan.ok ? `${lv ? '升級' : '學習'}到 ${plan.to} 級` : '材料不夠'));
    }

    sheet = openSheet(name, body, { tall: true });
  }

  /** 抽取結果：每組 3 個技能選 1（選了就不能反悔，所以先確認） */
  function openDrawSheet() {
    let sheet;
    function body() {
      const pending = getState().pendingDraws ?? [];
      if (!pending.length) return h('p', { class: 'notice', text: '都選完了。到背包可以看到新的技能書。' });
      return h('div', { class: 'learn' },
        pending.map((d, i) => h('section', { class: 'draw-set' },
          h('h3', { class: 'field-label', text: `${d.tier}技能書　第 ${i + 1} / ${pending.length} 組` }),
          h('div', { class: 'draw-options' }, d.options.map((n) => h('div', { class: 'draw-option' },
            h('strong', { text: n }),
            h('small', { class: 'skill-tile__tag', text: skillTag(n) }),
            h('p', { class: 'skill-info__text', text: SKILL_TABLE[n].text }),
            h('button', {
              type: 'button', class: 'btn btn--primary btn--small',
              onclick: () => {
                if (!confirm(`選「${n}」？選了就不能改。`)) return;
                const r = chooseDraw(getState(), i, n);
                if (!r.ok) return toast(r.error);
                toast(`得到 ${n} 技能書 ×1`);
                commit();
                sheet.refresh();
              },
            }, '選這個')))))));
    }
    sheet = openSheet(`選擇技能（${DRAW_CHOICES} 選 1）`, body, { tall: true });
  }

  function doDraw(tier, times) {
    const r = drawBooks(getState(), tier, times);
    if (!r.ok) return toast(r.error);
    commit();
    openDrawSheet();
  }

  function drawSection(state) {
    const pending = state.pendingDraws ?? [];
    return section('抽取技能書',
      pending.length
        ? h('button', { type: 'button', class: 'btn btn--primary btn--go', onclick: openDrawSheet }, `選擇技能（還有 ${pending.length} 組沒選）`)
        : h('div', { class: 'draw-cards' }, DRAW_TIERS.map((tier) => {
            const book = `${tier}技能書`;
            const n = countOf(state, book);
            return h('div', { class: 'draw-card' },
              h('strong', { text: `${iconOf(book)} ${book}` }),
              h('span', { class: 'num', text: `有 ${fmt(n)}` }),
              n ? h('div', { class: 'row' },
                h('button', { type: 'button', class: 'btn btn--small', onclick: () => doDraw(tier, 1) }, '抽 1 本'),
                n > 1 ? h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => doDraw(tier, Math.min(n, MAX_DRAW_AT_ONCE)) }, `抽 ${Math.min(n, MAX_DRAW_AT_ONCE)} 本`) : null) : null);
          })));
  }

  function badgeSection(state) {
    return section('生活徽章',
      h('ul', { class: 'badge-list' }, LIFE_SKILLS.map((skill) => h('li', { class: 'badge-row' },
        h('strong', { text: `${ICONS[skill]} ${skill}　技能 ${state.lifeSkills[skill] ?? 0}` }),
        h('div', { class: 'badge-row__btns' }, badgeStatus(state, skill).map((b) => {
          const label = b.kind === '神級' ? '神級徽章' : `${BADGE_COUNT}次徽章（${fmt(Math.min(b.progress.have, BADGE_COUNT))}/${BADGE_COUNT}）`;
          if (b.made) {
            return h('div', { class: 'badge-made' },
              h('span', { class: 'badge-made__name', text: `✓ ${b.item}` }),
              h('button', {
                type: 'button', class: 'btn btn--ghost btn--small',
                onclick: () => {
                  const name = prompt(`幫「${b.item}」取新名字（最多 ${BADGE_NAME_MAX} 字）`, b.item);
                  if (name === null) return;
                  const r = renameBadge(getState(), skill, b.kind, name);
                  if (!r.ok) return toast(r.error);
                  toast(`改名為 ${r.item}`);
                  commit();
                },
              }, '改名'));
          }
          if (!b.reached) return h('button', { type: 'button', class: 'btn btn--small', disabled: true }, `${label} 未達成`);
          return h('button', {
            type: 'button', class: 'btn btn--primary btn--small',
            onclick: () => {
              const name = prompt(`製作徽章：${skill}技能等級 +1，每種只能做一次。\n名稱可以自己取（最多 ${BADGE_NAME_MAX} 字，之後也能改）：`, b.item);
              if (name === null) return;
              const r = craftBadge(getState(), skill, b.kind, name);
              if (!r.ok) return toast(r.error);
              toast(`做出 ${r.item}，${skill}技能升到 ${r.level}`);
              commit();
            },
          }, `製作${label}`);
        }))))));
  }

  function learnTile(state, name) {
    const lv = Number(state.skills?.[name]) || 0;
    const note = lv >= MAX_SKILL_LEVEL ? '已滿級' : maxAffordableLevel(state, name) > lv ? '可以升級' : '材料不足';
    return skillTile(name, { level: lv, note, onOpen: () => openLearnSheet(name) });
  }

  function learnPanel(state) {
    if (!usesSkillTable(state)) {
      return section('學習技能', h('p', { class: 'notice', text: '這是舊式存檔，還不能在這裡升級技能。請請 GM 用「匯入角色卡」更新。' }));
    }
    const learned = Object.keys(state.skills ?? {}).filter(inCatalog).sort(byTier);
    const unlearned = Object.keys(SKILL_TABLE).filter((n) => !(n in (state.skills ?? {}))).sort(byTier);
    return [drawSection(state), badgeSection(state), section('學習技能',
      h('p', { class: 'hint', text: `目前經驗 ${fmt(state.exp)}` }),
      h('h3', { class: 'field-label', text: `已學會（${fmt(learned.length)}）` }),
      learned.length ? h('div', { class: 'skill-tiles' }, learned.map((n) => learnTile(state, n))) : h('p', { class: 'notice', text: '還沒有學會技能。' }),
      h('details', { class: 'add-box', open: ui.learnOpen, ontoggle: (e) => { ui.learnOpen = e.target.open; } },
        h('summary', { text: `＋ 學新技能（${fmt(unlearned.length)}）` }),
        h('div', { class: 'skill-tiles' }, unlearned.map((n) => learnTile(state, n)))))];
  }

  // ---------- 特殊（特殊配方、特殊材料、餵肉球） ----------
  function materialsSection(state) {
    return section('特殊材料',
      h('div', { class: 'special-list' }, Object.entries(allMaterials()).map(([name, m]) => {
        const skill = m.skills.includes(ui.matSkill[name]) ? ui.matSkill[name] : m.skills[0];
        const done = dailyDone(state, name);
        return h('div', { class: 'special-card' },
          h('div', { class: 'special-card__head' },
            h('strong', { text: `${iconOf(name)} ${name}` }),
            h('span', { class: 'num', text: `有 ${fmt(countOf(state, name))}` })),
          m.hint ? h('small', { class: 'hint', text: m.hint }) : null,
          done
            ? h('p', { class: 'notice', text: '今天已經取過了，下個修整日再來。' })
            : h('div', { class: 'row' },
                h('select', { class: 'field', 'aria-label': `${name}用的技能`, onchange: (e) => { ui.matSkill[name] = e.target.value; render(); } },
                  m.skills.map((s) => h('option', { value: s, selected: s === skill ? true : null, text: `${s}（+${modifier(state, s, 'rest').total}）` }))),
                h('button', {
                  type: 'button', class: 'btn btn--primary btn--small',
                  onclick: () => {
                    if (blockedByDraw()) return;
                    const r = gatherDaily(state, name, skill);
                    if (!r.ok) return toast(r.error);
                    pushResult({ kind: 'note', text: `${iconOf(name)} ${name}：1D20（${r.roll}）+ ${r.mod} = ${r.total}，獲得 ${r.total} 個` });
                  },
                }, '擲骰取得')));
      })));
  }

  function meatballSection(state) {
    const foods = Object.keys(MEAT_FEED).filter((n) => countOf(state, n) > 0);
    const meat = countOf(state, MEAT);
    const harvestMax = Math.floor(meat / MEAT_PER_HARVEST);
    const doFeed = (item, n) => {
      const r = feedMeatball(getState(), item, n);
      if (!r.ok) return toast(r.error);
      pushResult({ kind: 'note', text: `餵肉球 ${item} ×${n}，獲得 ${MEAT} ×${fmt(r.meat)}` });
    };
    return section('餵肉球',
      h('div', { class: 'special-card' },
        h('div', { class: 'special-card__head' },
          h('strong', { text: `${MEAT}　有 ${fmt(meat)}` }),
          h('span', { class: 'num', text: `${MONSTER_MEAT}　有 ${fmt(countOf(state, MONSTER_MEAT))}` })),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn--primary btn--small', disabled: harvestMax ? null : true,
            onclick: () => { const r = harvestMeat(getState(), 1); if (!r.ok) return toast(r.error); pushResult({ kind: 'note', text: `收割：${MEAT} ×${MEAT_PER_HARVEST} → ${MONSTER_MEAT} ×1` }); } }, '收割 1 次'),
          harvestMax > 1 ? h('button', { type: 'button', class: 'btn btn--small',
            onclick: () => { const r = harvestMeat(getState(), harvestMax); if (!r.ok) return toast(r.error); pushResult({ kind: 'note', text: `收割 ${harvestMax} 次：${MEAT} ×${MEAT_PER_HARVEST * harvestMax} → ${MONSTER_MEAT} ×${harvestMax}` }); } }, `全部收割（${harvestMax} 次）`) : null)),
      foods.length
        ? h('div', { class: 'feed-list' }, foods.map((n) => {
            const have = countOf(state, n);
            const input = h('input', {
              class: 'field feed-row__qty', type: 'number', inputmode: 'numeric', min: 1, max: have, placeholder: '數量', 'aria-label': `${n}要餵幾個`,
            });
            const go = () => {
              const q = Math.floor(Number(input.value));
              if (!(q >= 1)) return toast('先輸入要餵的數量。');
              doFeed(n, Math.min(q, have));
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
            return h('div', { class: 'feed-row' },
              h('span', { class: 'feed-row__name', text: `${iconOf(n)} ${n}` }),
              h('span', { class: 'feed-row__have num', text: `有 ${fmt(have)}　×${MEAT_FEED[n]}` }),
              input,
              h('button', { type: 'button', class: 'btn btn--small', onclick: go }, '餵'));
          }))
        : h('p', { class: 'notice', text: '背包裡沒有可以餵的材料。' }));
  }

  function specialRecipeSection(state) {
    const recipes = allRecipes();
    const name = recipes[ui.specialRecipe] ? ui.specialRecipe : Object.keys(recipes)[0];
    const r = recipes[name];
    const max = specialMaxTimes(state, name);
    ui.times = Math.max(1, Math.min(ui.times, Math.max(max, 1)));
    const usable = Object.keys(USABLE_ITEMS).filter((n) => countOf(state, n) > 0);
    return [
      section('特殊配方',
        h('div', { class: 'diff-grid', role: 'radiogroup' }, Object.entries(recipes).map(([n, x]) => h('button', {
          type: 'button', class: `diff${specialMaxTimes(state, n) ? '' : ' is-none'}`, role: 'radio', 'aria-checked': String(n === name),
          onclick: () => { ui.specialRecipe = n; ui.times = 1; render(); },
        },
        h('span', { class: 'diff__head' }, h('strong', { text: n }), h('span', { class: 'diff__dc num', text: `DC ${x.dc}` })),
        h('span', { class: 'diff__cost', text: `${x.type}・${x.skill}` }),
        h('span', { class: 'diff__can', text: specialMaxTimes(state, n) ? `可做 ${fmt(specialMaxTimes(state, n))} 次` : '材料不足' })))),
        h('div', { class: 'reward-line' },
          h('p', { class: 'field-label', text: `${name}　${r.type}（${r.skill} DC ${r.dc}）` }),
          r.effect ? h('p', { class: 'hint', text: `效果：${r.effect}` }) : null,
          h('ul', { class: 'learn-cost' }, Object.entries(r.materials).map(([item, n]) => h('li', { class: 'learn-cost__row', dataset: { ok: countOf(state, item) >= n ? '1' : '0' } },
            h('span', { text: `${iconOf(item)} ${item}` }),
            h('span', { class: 'num', text: `${n}（有 ${fmt(countOf(state, item))}）` }),
            h('b', { 'aria-hidden': 'true', text: countOf(state, item) >= n ? '✓' : `缺 ${fmt(n - countOf(state, item))}` })))))),
      ...(max <= 0
        ? [h('p', { class: 'notice notice--bad', text: `${name}的材料不足，先去取材料或採集。` })]
        : runBlock(state, r.skill, {
            label: `${ICONS[r.skill]} ${name} ${ui.times} 次`, hint: '每次檢定扣一份材料，不消耗時間；失敗材料全毀', max, quick: [1, 3, 5],
            onRun: () => blockedByDraw() || pushResult({ kind: 'craft', action: r.skill, diff: name, ...craftSpecial(state, name, ui.times, [...ui.keepsakes]) }),
          })),
      usable.length ? section('使用特殊物品', usable.map((n) => h('div', { class: 'special-card' },
        h('div', { class: 'special-card__head' }, h('strong', { text: `${iconOf(n)} ${n}　有 ${fmt(countOf(state, n))}` }),
          h('span', { class: 'hint', text: `使用 → ${Object.entries(USABLE_ITEMS[n].gives).map(([k, q]) => `${k} ×${q}`).join('、')}` })),
        h('button', {
          type: 'button', class: 'btn btn--primary btn--small',
          onclick: () => { const x = useSpecialItem(getState(), n); if (!x.ok) return toast(x.error); pushResult({ kind: 'note', text: `使用 ${n}：${Object.entries(x.gives).map(([k, q]) => `${k} ×${q}`).join('、')}` }); },
        }, '使用 1 個')))) : null,
    ];
  }

  const specialPanel = (state) => [materialsSection(state), meatballSection(state), ...specialRecipeSection(state)];

  // ---------- 組合 ----------
  const TABS = [
    ['gather', '採集', '🌿', '花時間'],
    ['craft', '製作', '🔨', '不花時間'],
    ['learn', '學習', '📖', '花經驗'],
    ['special', '特殊', '🧪', '配方與材料'],
  ];

  function render() {
    const state = getState();
    const panel = ui.tab === 'gather' ? gatherPanel(state) : ui.tab === 'learn' ? learnPanel(state) : ui.tab === 'special' ? specialPanel(state) : craftPanel(state);
    const scrollY = root.scrollTop;
    const fresh = ui.fresh;
    ui.fresh = false;
    root.replaceChildren(
      h('div', { class: 'rest-root' },
        statusBar(state, commit, 'rest'),
        h('div', { class: 'rest-tabs', role: 'tablist', 'aria-label': '修整日行動' },
          TABS.map(([id, label, icon, sub]) => h('button', {
            type: 'button', role: 'tab', class: 'rest-tab', 'aria-selected': String(ui.tab === id),
            onclick: () => { ui.tab = id; ui.times = 1; render(); },
          },
          h('span', { class: 'rest-tab__icon', 'aria-hidden': 'true', text: icon }),
          h('span', { class: 'rest-tab__name', text: label }),
          h('small', { class: 'rest-tab__sub', text: sub })))),
        h('div', { class: 'rest-grid' },
          h('div', { class: 'rest-main' }, panel),
          h('section', { class: 'card rest-results', 'aria-live': 'polite' },
            h('div', { class: 'battle-head' },
              h('h2', { class: 'section-title', text: '結果' }),
              ui.results.length ? h('span', { class: 'hint', text: `最近 ${Math.min(ui.results.length, 20)} 筆` }) : null),
            ui.results.length
              ? h('ol', { class: 'rres-list' }, ui.results.slice(0, 20).map((r, i) => resultCard(r, i === 0 && fresh)))
              : h('p', { class: 'empty', text: '選好行動後按下按鈕，戰利品會出現在這裡。' }))))
    );
    root.scrollTop = scrollY;
    if (fresh) {
      const first = root.querySelector('.rres');
      if (first) first.dataset.fresh = '1'; // 只有新結果播進場動畫，其他重畫不閃
      rollNumbers();
      // 手機上結果在下方，按下後自動捲過去
      if (matchMedia('(max-width: 759px)').matches) {
        first?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      }
    }
  }

  return { render };
}
