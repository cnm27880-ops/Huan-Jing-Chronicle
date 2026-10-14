// ============================================================
// GM 專用：模擬戰（階段 D）。選幾位玩家＋一組敵人，跑幾百到幾千場，看勝率、回合數、每回合傷害、剩餘生命。
// 全部在這個瀏覽器裡算（規則見 src/game/simulate.js），讀玩家角色但不會改動任何存檔。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet } from './sheet.js';
import { toast } from './controls.js';
import { listCharacters, fetchCharacter } from '../state/charSync.js';
import { normalizeCharacter } from '../state/store.js';
import { simulateBattle, summarize, seededRng, DEFAULT_MAX_ROUNDS } from '../game/simulate.js';
import { measureHits, rankPlayers, suggestMobHp, capsFor, blockedPlayers, splitBlank, FAIR } from '../game/fairness.js';
import { POTIONS } from '../game/rules.js';
import { assess, autoTune, penalty, scaleEncounter, shrinkEncounter, PLANS, TARGET } from '../game/tuning.js';
import { TEMPLATE, templateSpecs, makeEvaluator, analyzeSensitivity, topImpact } from '../game/sensitivity.js';
import { getEncounter, presetAction, templateAction } from '../state/rollLog.js';
import { askText, askConfirm } from './confirmPop.js';
import { describeSpecs, nextVersionName, compareVersions, snapshotOf } from '../game/templates.js';
import { formatAbc } from '../game/combat.js';
import { maxHp } from '../game/stats.js';
import { usageList, usagePlan } from '../game/moveUse.js';

const RUNS = 200; // 每次模擬的場數（固定）
const TUNE_RUNS = 40; // 自動調整時，每組候選數值只跑這麼多場（要試很多組，跑 200 場太慢）；每次都用同一批種子，結果才不會被運氣干擾
const SENS_RUNS = 100; // 範本調整影響分析：每一項（範本本身與每個微調）各跑幾場（同一批固定種子）
const BATCH = 25; // 每算幾場讓畫面喘口氣，進度才會動
const PLANS_KEY = 'huanjing:sim:movePlans'; // GM 在這個瀏覽器設定的每位玩家出招方式：{ 玩家編號: { mode: 'auto' | 'manual', names: [招式名稱…] } }
const readPlans = () => { try { return JSON.parse(localStorage.getItem(PLANS_KEY)) ?? {}; } catch { return {}; } };
const writePlans = (v) => { try { localStorage.setItem(PLANS_KEY, JSON.stringify(v)); } catch { /* 存不了就只在這次面板有效 */ } };
const pct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);

/** 條狀圖的一欄：高度 = 比例（0~1） */
const column = (label, value, max, tone, title) => h('div', { class: 'simchart__col', title },
  h('span', { class: 'simchart__bar', dataset: { tone }, style: `height:${max ? Math.max(value ? 3 : 0, (value / max) * 100) : 0}%` }),
  h('small', { class: 'simchart__label', text: label }));

/** deps 只給測試用（換掉讀玩家角色的來源）；平常不用傳 */
export function openSimPanel({ list = listCharacters, fetch = fetchCharacter, presets = () => presetAction({ t: 'presetList' }), templates = templateAction } = {}) {
  const ui = {
    source: 'custom', // 敵人來源：custom 自訂強度（每場重抽 A/B/C）｜stage 場上的敵人｜preset:名稱 敵人預組（固定）
    presetList: [],
    list: null, error: '', picked: new Set(), cache: new Map(), loading: false,
    specs: [], form: { kind: 'mob', count: 1, atkPower: TEMPLATE.mob.atkPower, defPower: TEMPLATE.mob.defPower, hp: TEMPLATE.mob.hp, absDef: 0, atkMod: '', defMod: '' },
    plans: readPlans(), // 每位玩家的出招方式（自動＝有實戰紀錄照紀錄、沒有就自動挑招；手動＝GM 指定順序）
    tpl: { list: null, error: '', busy: false, selected: [], compare: null, comparing: false }, // 範本版本（存在伺服器，GM 專用）；selected＝勾選要比較的版本編號（最多 2 個）
    sens: null, analyzing: false, sensProgress: 0, // 範本調整影響分析的結果與進度（敵人清單、玩家、血藥、攻擊分配有變就清掉）
    running: false, progress: 0, result: null, names: [],
    tuning: false, tuneProgress: 0, tuneResults: null, // tuneResults：[{ plan, specs, summary, penalty }]（保守版、激進版各一）；固定敵人時 specs 是調整後的 { monsters }
    tuneFrom: null,
    skipBlank: true, // 略過沒有攻擊力（角色資料還沒填）的玩家
    skipped: [], blocked: [], // 這次被略過的、以及打不出傷害的玩家（結果頁上方提醒）
    focus: 'spread', // 怪物怎麼挑目標：spread 平均分散（輪流打每個人）｜random 隨機
    supply: '回春湯', // 假設每位玩家都備足這種血藥（毒性 15 喝滿）；'' ＝ 只用玩家背包裡有的
    override: null, // 固定敵人套用自動調整後的模擬用版本（只在這個面板用，不會改場上或預組）
  };
  let sheet;

  /** 跑完後把結果捲到畫面上（結果在面板最下面，不捲的話要自己往下拉） */
  function scrollTo(selector) {
    requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function loadList() {
    try { ui.list = await list(); } catch (e) { ui.error = e.message; }
    try { ui.presetList = await presets(); } catch { ui.presetList = []; } // 不是 GM 或沒連線：只能用自訂強度
    try { ui.tpl.list = await templates({ t: 'tplList' }); } catch (e) { ui.tpl.list = []; ui.tpl.error = e.message || '讀不到範本版本（沒連上房間？）'; }
    sheet.refresh();
  }

  /** 固定敵人（場上的或預組）；自訂強度回傳 null */
  function fixedEnemies() {
    if (ui.override) return ui.override;
    if (ui.source === 'stage') return getEncounter()?.monsters?.length ? { monsters: getEncounter().monsters } : null;
    if (ui.source.startsWith('preset:')) return ui.presetList.find((p) => `preset:${p.name}` === ui.source) ?? null;
    return null;
  }

  /** 這位玩家模擬時的出招優先順序（招式名稱陣列；空＝自動挑招「續航最長」） */
  function planOf(uid, player) {
    const c = ui.plans[uid];
    if (c?.mode === 'manual') {
      const own = new Set(player.moves.filter((m) => m.kind !== 'heal' && m.kind !== 'shield').map((m) => m.name));
      return (c.names ?? []).filter((n) => own.has(n));
    }
    return usagePlan(player);
  }

  function setPlan(uid, patch) {
    ui.plans[uid] = { mode: 'auto', names: [], ...ui.plans[uid], ...patch };
    writePlans(ui.plans);
    ui.result = null; ui.tuneResults = null; ui.sens = null;
    sheet.refresh();
  }

  async function ensureLoaded(uid) {
    if (ui.cache.has(uid)) return ui.cache.get(uid);
    const { data } = await fetch(uid);
    if (!data) throw new Error('讀不到這位玩家的角色。');
    const c = normalizeCharacter(data);
    ui.cache.set(uid, c);
    return c;
  }

  /** 讀取勾選的玩家角色，回傳 { players, names } */
  async function loadPlayers() {
    const uids = [...ui.picked];
    const players = [];
    for (const uid of uids) players.push({ ...(await ensureLoaded(uid)), movePlan: planOf(uid, ui.cache.get(uid)) }); // movePlan 只放在模擬用的複本，不存檔
    const names = uids.map((uid, i) => players[i].name || ui.list?.find((c) => c.uid === uid)?.name || uid);
    return { players, names };
  }

  /**
   * 建立評估函式：跑 runs 場（固定種子）；full 時再多跑一組「第一名只出部分力」的情境，算隊伍勝率。
   * 回傳的結果帶 rank（強弱）、capWin、capBudget，評價與自動調整都靠這些判斷公平性。
   */
  function makeEvaluate(players, names, rank, fixed, runs) {
    const once = (input, caps, n, downed = []) => summarize(Array.from({ length: n }, (_, i) => (fixed
      ? simulateBattle(players, [], { encounter: input, rng: seededRng(i + 1), supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order, caps, downed })
      : simulateBattle(players, input.map((s) => ({ ...s })), { rng: seededRng(i + 1), supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order, caps, downed }))), names);
    return (input, full = true) => {
      const sum = once(input, [], runs);
      sum.rank = rank;
      sum.focus = ui.focus;
      if (full && players.length > 1) {
        sum.capWin = once(input, capsFor(players.length, rank.strongest), Math.max(20, Math.round(runs * 0.6))).win;
        sum.capBudget = FAIR.topBudget;
      }
      if (full && players.length > 1 && ui.focus === 'strongest') sum.outWin = once(input, [], Math.max(20, Math.round(runs * 0.6)), [rank.strongest]).win; // 第一名開場就倒，隊伍還贏不贏
      return sum;
    };
  }

  /**
   * 讀玩家、量一次出手的傷害、依設定略過「沒有攻擊力」的玩家（角色資料還沒填，會讓整隊看起來只有一個人在打）。
   * 回傳 { players, names, rank }；全部都沒有攻擊力就丟錯誤。
   */
  async function prepareTeam(source) {
    const all = await loadPlayers();
    const supply = ui.supply || null;
    const hits0 = measureHits(all.players, source, { supply });
    ui.blocked = blockedPlayers(hits0, all.names);
    let { players, names } = all;
    ui.skipped = [];
    if (ui.skipBlank) { ({ players, names } = splitBlank(players, names, hits0)); ui.skipped = all.names.filter((n) => !names.includes(n)); }
    if (!players.length) throw new Error('選的玩家都沒有攻擊力（角色資料還沒填），沒辦法模擬。');
    const rank = rankPlayers(players.length === all.players.length ? hits0 : measureHits(players, source, { supply }));
    return { players, names, rank };
  }

  async function run() {
    if (ui.running || ui.tuning) return;
    if (!ui.picked.size) return toast('至少選一位玩家。');
    const fixed = ui.source === 'custom' ? null : fixedEnemies();
    if (ui.source !== 'custom' && !fixed) return toast('場上沒有敵人，或找不到這個預組。');
    if (!fixed && !ui.specs.length) return toast('至少加一組敵人。');
    ui.running = true; ui.progress = 0; ui.result = null; ui.tuneResults = null; sheet.refresh();
    try {
      const source = fixed ?? ui.specs;
      const { players, names, rank } = await prepareTeam(source);
      ui.names = names;
      const results = [];
      for (let i = 0; i < RUNS; i++) {
        const opts = { supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order };
        results.push(fixed ? simulateBattle(players, [], { encounter: fixed, ...opts }) : simulateBattle(players, ui.specs.map((s) => ({ ...s })), opts));
        if ((i + 1) % BATCH === 0) {
          ui.progress = (i + 1) / RUNS;
          sheet.refresh();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      ui.result = summarize(results, ui.names);
      ui.result.rank = rank;
      ui.result.focus = ui.focus;
      ui.result.hits = rank.hits;
      if (players.length > 1) { // 第一名只出部分力的情境（場數少一點，只看勝率）
        const caps = capsFor(players.length, rank.strongest);
        const capRuns = Array.from({ length: Math.round(RUNS / 2) }, () => (fixed ? simulateBattle(players, [], { encounter: fixed, supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order, caps }) : simulateBattle(players, ui.specs.map((s) => ({ ...s })), { supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order, caps })));
        ui.result.capWin = summarize(capRuns, ui.names).win;
        ui.result.capBudget = FAIR.topBudget;
        if (ui.focus === 'strongest') { // 第一名開場就倒，隊伍還贏不贏
          const outRuns = Array.from({ length: Math.round(RUNS / 2) }, () => (fixed ? simulateBattle(players, [], { encounter: fixed, supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order, downed: [rank.strongest] }) : simulateBattle(players, ui.specs.map((s) => ({ ...s })), { supply: ui.supply || null, focus: ui.focus, focusOrder: rank.order, downed: [rank.strongest] })));
          ui.result.outWin = summarize(outRuns, ui.names).win;
        }
      }
    } catch (e) { toast(e.message || '模擬失敗。'); }
    ui.running = false; ui.progress = 1;
    sheet.refresh();
    if (ui.result) scrollTo('.simresult');
  }

  /**
   * 自動調整：血量與攻擊一起縮放，保守版、激進版各找一組，讓 GM 比較後挑一個套用。
   * 自訂強度：縮放敵人的血量與攻擊強度；場上的敵人／預組：縮放血量與 A/B/C 攻擊骰數（只影響模擬，不改場上與預組）。
   */
  async function tune() {
    if (ui.running || ui.tuning) return;
    if (!ui.picked.size) return toast('至少選一位玩家。');
    const fixed = ui.source === 'custom' ? null : fixedEnemies();
    if (ui.source !== 'custom' && !fixed) return toast('場上沒有敵人，或找不到這個預組。');
    if (!fixed && !ui.specs.length) return toast('至少加一組敵人。');
    ui.tuning = true; ui.tuneProgress = 0; ui.tuneResults = null; sheet.refresh();
    try {
      const { players, names, rank } = await prepareTeam(fixed ?? ui.specs);
      if (rank.hits.every((h) => h.perTarget < 1)) throw new Error('所有玩家對這組敵人都打不出傷害，調整數值沒有意義。請先確認角色資料與怪物防禦。');
      const evaluate = makeEvaluate(players, names, rank, fixed, TUNE_RUNS);
      const mob = suggestMobHp(rank.hits); // 小怪血量依最弱玩家一次出手的傷害設
      const plans = [PLANS.conservative, PLANS.aggressive];
      const out = [];
      for (const [i, plan] of plans.entries()) {
        const r = await autoTune({
          specs: fixed ?? ui.specs, evaluate, target: plan,
          ...(fixed ? { scale: scaleEncounter, shrink: shrinkEncounter } : {}), mobHp: mob?.mobHp ?? null,
          onProgress: (p) => { ui.tuneProgress = (i + p) / plans.length; sheet.refresh(); },
        });
        out.push({ plan, ...r, notes: [...(mob?.note ? [mob.note] : []), ...r.notes], mobHp: mob?.mobHp ?? null });
      }
      ui.tuneResults = out;
      ui.tuneFrom = fixed; // 調整前的固定敵人（畫面比對前後用）；自訂強度時是 null
    } catch (e) { toast(e.message || '自動調整失敗。'); }
    ui.tuning = false;
    sheet.refresh();
    if (ui.tuneResults) scrollTo('.simtune');
  }

  /**
   * 範本調整影響分析（自訂強度）：以目前的敵人清單（例如「載入範本」）為基準，逐項微調（加減隻數、攻擊／防禦／血量 ±10%／±20%），
   * 用同一批固定種子各跑一次，告訴 GM 每個調整會讓勝率、回合、資源消耗、剩餘生命變多少（規則見 src/game/sensitivity.js）。
   */
  async function analyze() {
    if (ui.running || ui.tuning || ui.analyzing) return;
    if (!ui.picked.size) return toast('至少選一位玩家。');
    if (!ui.specs.length) return toast('先加敵人，或按「載入範本」。');
    ui.analyzing = true; ui.sensProgress = 0; ui.sens = null; sheet.refresh();
    try {
      const { players, names, rank } = await prepareTeam(ui.specs);
      const specs = ui.specs.map((x) => ({ ...x }));
      const evaluate = makeEvaluator({ players, names, rank, supply: ui.supply || null, focus: ui.focus, runs: SENS_RUNS });
      const out = await analyzeSensitivity({ specs, evaluate, onProgress: (p) => { ui.sensProgress = p; sheet.refresh(); } });
      ui.sens = { ...out, specs };
    } catch (e) { toast(e.message || '分析失敗。'); }
    ui.analyzing = false;
    sheet.refresh();
    if (ui.sens) scrollTo('.simsens');
  }

  // ---------- 範本版本 ----------
  const when = (t) => new Date(t).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const specsOut = () => ui.specs.map((x) => ({ ...x })); // 存起來的敵人清單（伺服器只留已知欄位）

  /** 對伺服器發一個版本操作，成功就更新清單 */
  async function tplCall(msg) {
    try { ui.tpl.list = await templates(msg); ui.tpl.error = ''; ui.tpl.selected = ui.tpl.selected.filter((id) => ui.tpl.list.some((v) => v.id === id)); return true; } catch (e) { toast(e.message || '操作失敗。'); return false; }
  }

  /** 用目前選的玩家，建立評分用的模擬（固定種子）。回傳 { evaluate, names } */
  async function evaluatorFor(specs) {
    const { players, names, rank } = await prepareTeam(specs);
    return { names, evaluate: makeEvaluator({ players, names, rank, supply: ui.supply || null, focus: ui.focus, runs: SENS_RUNS }) };
  }

  /** 把目前的敵人清單存成新版本（old＝要覆蓋的舊版本）。有選玩家時順便記一份「當時成績」當歷史參考 */
  async function saveVersion(anchor, old = null) {
    if (ui.tpl.busy) return;
    if (!ui.specs.length) return toast('目前沒有敵人可以存。先「載入範本」或加敵人。');
    const name = await askText(anchor, { title: old ? `覆蓋「${old.name}」（可改名）` : '存成新版本', value: old?.name ?? nextVersionName(ui.tpl.list ?? []), maxLength: 40 });
    if (name === null) return;
    const note = await askText(anchor, { title: '備註（選填：這一版改了什麼）', value: old?.note ?? '', maxLength: 200 });
    if (note === null) return;
    ui.tpl.busy = true; sheet.refresh();
    let snap;
    if (ui.picked.size) {
      try { const { evaluate, names } = await evaluatorFor(ui.specs); snap = snapshotOf(evaluate(ui.specs, false), names); } catch { snap = undefined; } // 記不了成績不影響存版本
    }
    const ok = await tplCall({ t: 'tplSave', ...(old ? { id: old.id } : {}), name, note, specs: specsOut(), ...(snap ? { snap } : {}) });
    ui.tpl.busy = false;
    sheet.refresh();
    if (ok) toast(`已存成「${name.trim() || name}」。`);
  }

  async function renameVersion(anchor, v) {
    const name = await askText(anchor, { title: '改名', value: v.name, maxLength: 40 });
    if (name === null) return;
    const note = await askText(anchor, { title: '備註', value: v.note ?? '', maxLength: 200 });
    if (note === null) return;
    if (await tplCall({ t: 'tplSave', id: v.id, name, note, specs: v.specs })) sheet.refresh(); // 沒給 snap：伺服器保留原本的成績
  }

  async function deleteVersion(anchor, v) {
    if (!(await askConfirm(anchor, { title: `刪除「${v.name}」？`, lines: ['刪除後無法復原。'], okText: '刪除', danger: true }))) return;
    if (await tplCall({ t: 'tplDel', id: v.id })) sheet.refresh();
  }

  function loadVersion(v) {
    ui.specs = v.specs.map((x) => ({ ...x }));
    ui.sens = null; ui.tuneResults = null; ui.result = null;
    toast(`已載入「${v.name}」，可以繼續調整。`);
    sheet.refresh();
  }

  function toggleSelected(id) {
    const cur = ui.tpl.selected;
    ui.tpl.selected = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2); // 最多 2 個，再勾第三個就擠掉最早勾的
    ui.tpl.compare = null;
    sheet.refresh();
  }

  /** 比較勾選的兩個版本（較舊的在左）：用「現在選的玩家」把兩個版本同時重跑 */
  async function compareSelected() {
    if (ui.tpl.comparing || ui.running || ui.tuning || ui.analyzing) return;
    const vs = ui.tpl.selected.map((id) => ui.tpl.list?.find((v) => v.id === id)).filter(Boolean).sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    if (vs.length !== 2) return toast('請勾選兩個版本。');
    if (!ui.picked.size) return toast('先選玩家：比較是用現在的玩家重新模擬。');
    ui.tpl.comparing = true; ui.tpl.compare = null; sheet.refresh();
    try {
      const { evaluate, names } = await evaluatorFor(vs[0].specs);
      ui.tpl.compare = { ...compareVersions({ a: vs[0].specs, b: vs[1].specs, evaluate }), av: vs[0], bv: vs[1], names };
    } catch (e) { toast(e.message || '比較失敗。'); }
    ui.tpl.comparing = false;
    sheet.refresh();
    if (ui.tpl.compare) scrollTo('.simver__compare');
  }

  /** 把某個微調套用到敵人清單（之後可以再分析一次） */
  function applyVariation(row) {
    ui.specs = row.specs.filter((x) => x.count > 0).map((x) => ({ ...x }));
    ui.sens = null;
    sheet.refresh();
  }

  function applyTune(plan) {
    const t = ui.tuneResults?.find((x) => x.plan.key === plan.key);
    if (!t) return;
    if (ui.tuneFrom) ui.override = t.specs; // 固定敵人：之後的模擬都用調整後的版本
    else ui.specs = t.specs.filter((s) => s.count > 0).map((s) => ({ ...s }));
    ui.tuneResults = null;
    run(); // 套用後馬上用 200 場確認
  }

  // ---------- 畫面 ----------
  const field = (label, key, min = 0) => h('label', { class: 'extra' }, h('span', { text: label }),
    h('input', { class: 'field', type: 'number', min, value: ui.form[key], onchange: (e) => { ui.form[key] = num(e.target.value, min); } }));

  function playersCard() {
    if (ui.error) return h('p', { class: 'notice notice--bad', text: ui.error });
    if (!ui.list) return h('p', { class: 'hint', text: '讀取中…' });
    if (!ui.list.length) return h('p', { class: 'notice', text: '伺服器上還沒有任何玩家的角色。' });
    return h('ul', { class: 'import-list' }, ui.list.map((c) => h('li', { class: 'import-row' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ui.picked.has(c.uid) ? true : null, disabled: ui.running ? true : null, onchange: (e) => {
          if (e.target.checked) { ui.picked.add(c.uid); ensureLoaded(c.uid).then(() => sheet.refresh()).catch(() => {}); } else ui.picked.delete(c.uid);
          ui.sens = null;
        } }),
        h('span', { text: c.charName || c.name })),
      h('small', { class: 'hint', text: c.name }))));
  }

  /**
   * 「出招設定」：每位被選中的玩家一塊。顯示他在網站上的實戰招式紀錄（自動記錄），GM 可以選「自動」或「手動指定順序」。
   * 自動：有紀錄就照紀錄（次數多的優先）、沒有紀錄就由程式挑「續航最長」的招式；手動：照 GM 點選的順序，用第一個付得起的招式，都付不起就普攻。
   */
  function movePlansCard() {
    const picked = [...ui.picked].filter((uid) => ui.cache.has(uid));
    if (!picked.length) return null;
    return h('div', { class: 'simmoves' },
      h('p', { class: 'field-label', text: '出招設定（每位玩家模擬時用哪些招式）' }),
      picked.map((uid) => {
        const pl = ui.cache.get(uid);
        const c = ui.plans[uid] ?? { mode: 'auto', names: [] };
        const used = usageList(pl);
        const plan = planOf(uid, pl);
        const attacks = [...new Set(pl.moves.filter((m) => m.kind !== 'heal' && m.kind !== 'shield').map((m) => m.name))];
        return h('section', { class: 'simtune__plan' },
          h('h4', { class: 'field-label', text: pl.name || uid }),
          h('p', { class: 'hint', text: used.length ? `網站上的實戰紀錄：${used.slice(0, 6).map((x) => `${x.name} ${x.count} 次`).join('・')}` : '網站上還沒有實戰紀錄（沒在網站戰鬥過）。' }),
          h('div', { class: 'toggle-row' }, [['auto', '自動'], ['manual', '手動指定']].map(([mode, label]) => h('button', {
            type: 'button', class: 'toggle', 'aria-pressed': String((c.mode ?? 'auto') === mode), disabled: ui.running || ui.tuning || ui.analyzing ? true : null, onclick: () => setPlan(uid, { mode }),
          }, label))),
          c.mode === 'manual'
            ? h('div', { class: 'toggle-row' }, attacks.map((n) => {
                const k = (c.names ?? []).indexOf(n);
                return h('button', {
                  type: 'button', class: 'toggle', 'aria-pressed': String(k >= 0), title: '依點選的順序排優先；再點一次取消',
                  onclick: () => setPlan(uid, { names: k >= 0 ? c.names.filter((x) => x !== n) : [...(c.names ?? []), n] }),
                }, k >= 0 ? `${k + 1}. ${n}` : n);
              }))
            : null,
          h('p', { class: 'hint', text: plan.length ? `模擬會依序用：${plan.join(' → ')}（付不起就換下一個，都付不起用普攻）` : (c.mode === 'manual' ? '還沒選招式：先用自動挑招（續航最長）。' : '沒有紀錄：由程式自動挑「續航最長」的招式。') }));
      }));
  }

  /** 敵人來源：自訂強度（每場重抽）、場上的敵人、預組（後兩種 A/B/C 固定） */
  function sourceCard() {
    const options = [['custom', '自訂強度（每場重抽 A/B/C）'], ['stage', '場上的敵人（固定）'], ...ui.presetList.map((p) => [`preset:${p.name}`, `預組：${p.name}（固定）`])];
    const fixed = fixedEnemies();
    return h('div', {},
      h('label', { class: 'extra' }, h('span', { text: '敵人來源' }),
        h('select', { class: 'field', disabled: ui.running ? true : null, onchange: (e) => { ui.source = e.target.value; ui.override = null; ui.tuneResults = null; ui.sens = null; sheet.refresh(); } },
          options.map(([v, label]) => h('option', { value: v, selected: v === ui.source ? true : null, text: label })))),
      h('p', { class: 'hint', text: ui.source === 'custom'
        ? '每一場都重新抽怪物的 A/B/C，所以勝率代表「這種強度的敵人，平均來說打不打得贏」（會包含抽到很兇或很弱的情況）。'
        : '每一場都用同一組已經抽好的敵人，勝率代表「這一團打不打得贏」。' }),
      ui.source === 'custom'
        ? enemiesCard()
        : fixed
          ? h('div', {}, ui.override ? h('p', { class: 'notice', text: '目前用的是「自動調整後」的數值（只影響模擬，不會改場上或預組的敵人）。' }) : null, h('ul', { class: 'import-list' }, fixed.monsters.map((m) => h('li', { class: 'import-row' },
              h('span', { text: `${m.kind === 'boss' ? '👹' : m.rank === 'elite' ? '👺' : '👾'} ${m.id}　血 ${fmt(m.maxHp)}${m.abs ? `・絕防 ${fmt(m.abs)}` : ''}` }),
              h('small', { class: 'hint', text: m.kind === 'boss' ? `攻 ${m.atk.map(formatAbc).join('／')}` : `攻 ${formatAbc(m.atk)}・防 ${formatAbc(m.def)}` })))))
          : h('p', { class: 'notice', text: '場上沒有敵人。先在跑團頁新增，或改選預組／自訂強度。' }));
  }

  function enemiesCard() {
    const f = ui.form;
    return h('div', {},
      ui.specs.length
        ? h('ul', { class: 'import-list' }, ui.specs.map((s, i) => h('li', { class: 'import-row' },
            h('span', { text: `${{ boss: '👹 BOSS', elite: '👺 菁英' }[s.kind] ?? '👾 小怪'} ×${s.count}　攻 ${fmt(s.atkPower)}・防 ${fmt(s.defPower)}・血 ${fmt(s.hp)}${s.absDef ? `・絕防 ${fmt(s.absDef)}` : ''}${s.atkMod || s.defMod ? `（補正 ${s.atkMod || '—'} / ${s.defMod || '—'}）` : ''}` }),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.running ? true : null, onclick: () => { ui.specs.splice(i, 1); ui.sens = null; sheet.refresh(); } }, '移除'))))
        : h('p', { class: 'hint', text: '還沒有敵人。從下面加一組。' }),
      h('div', { class: 'toggle-row' }, [['mob', '小怪（普通）'], ['elite', '菁英（2 打）'], ['boss', 'BOSS（3 打）']].map(([id, label]) => h('button', {
        type: 'button', class: 'toggle', 'aria-pressed': String(f.kind === id), onclick: () => { f.kind = id; sheet.refresh(); },
      }, label))),
      h('div', { class: 'extra-row' }, field('數量', 'count', 1), field('攻擊強度', 'atkPower'), field('防禦強度', 'defPower'), field('血量', 'hp', 1), field('絕對防禦', 'absDef')),
      h('div', { class: 'extra-row' },
        h('label', { class: 'extra' }, h('span', { text: '攻擊補正（選填）' }), h('input', { class: 'field', type: 'text', placeholder: '5A 3C', value: f.atkMod, onchange: (e) => { f.atkMod = e.target.value; } })),
        h('label', { class: 'extra' }, h('span', { text: '防禦補正（選填）' }), h('input', { class: 'field', type: 'text', placeholder: '2B', value: f.defMod, onchange: (e) => { f.defMod = e.target.value; } }))),
      h('button', {
        type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.running ? true : null,
        onclick: () => { ui.specs = templateSpecs(); ui.sens = null; sheet.refresh(); },
      }, '載入範本（9 小怪＋BOSS）'),
      h('button', {
        type: 'button', class: 'btn btn--small', disabled: ui.running ? true : null,
        onclick: () => {
          if (f.count > 20) return toast('一組最多 20 隻。');
          ui.specs.push({ ...f });
          ui.sens = null;
          sheet.refresh();
        },
      }, '＋ 加入這組敵人'));
  }

  function stat(label, value, note) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat__name', text: label }), h('strong', { class: 'stat__value', text: value }), note ? h('small', { class: 'stat__detail', text: note }) : null);
  }

  const STATUS_LABEL = { ok: '達標', low: '偏低', high: '偏高' };
  /** 評價與策略：對照 GM 的目標（回合 4～8、勝率至少 75%、每場耗約一半資源）；自訂強度時可以一鍵自動調整 */
  function assessmentView(r) {
    const a = assess(r);
    return h('div', { class: 'simassess' },
      h('h3', { class: 'section-title', text: `評價（目標：${TARGET.roundsMin}～${TARGET.roundsMax} 回合、資源消耗 ${pct(TARGET.drain - TARGET.drainTol)}～${pct(TARGET.drain + TARGET.drainTol)} 算合理、第一名不用全力、最弱的也有貢獻）` }),
      h('ul', { class: 'import-list' }, a.items.map((i) => h('li', { class: 'import-row' },
        h('span', { text: `${i.label}：${i.value}（目標 ${i.target}）` }),
        h('span', { class: 'badge', dataset: { tone: i.status === 'ok' ? 'good' : 'bad' }, text: `${STATUS_LABEL[i.status]}・${i.text}` })))),
      h('h3', { class: 'section-title', text: '策略建議' }),
      h('ul', { class: 'simassess__advice' }, a.advice.map((t) => h('li', { text: t }))),
      ui.source === 'custom' ? null : h('button', { type: 'button', class: 'btn btn--small', disabled: ui.running || ui.tuning ? true : null, onclick: tune }, ui.tuning ? `調整中… ${Math.round(ui.tuneProgress * 100)}%` : '自動調整數值（保守／激進兩個方案）'),
      ui.source === 'custom' ? null : tuneView());
  }

  /** 「範本調整影響分析」區塊（只在自訂強度）：以目前的敵人清單為基準，逐項微調並比較結果 */
  function sensCard() {
    if (ui.source !== 'custom') return null;
    return h('div', { class: 'simsens' },
      h('h3', { class: 'section-title', text: '範本調整影響分析' }),
      h('p', { class: 'hint', text: `以上面的敵人清單（例如「載入範本」）為基準，一次只動一項：加減隻數、攻擊／防禦／血量 ±10%／±20%／±50%，各用同一批固定種子跑 ${SENS_RUNS} 場，告訴你每個調整會讓戰局變多少。玩家變強了，範本不動、重新分析一次就知道該往哪調。` }),
      h('button', { type: 'button', class: 'btn btn--primary btn--go', disabled: ui.running || ui.tuning || ui.analyzing ? true : null, onclick: analyze },
        ui.analyzing ? `分析中… ${Math.round(ui.sensProgress * 100)}%` : '分析範本調整的影響'),
      ui.sens ? sensView() : null);
  }

  /** 「範本版本」區塊（只在自訂強度）：存成新版本、載入、覆蓋、改名、刪除，勾兩個比較 */
  function versionsCard() {
    if (ui.source !== 'custom') return null;
    const t = ui.tpl;
    const busy = ui.running || ui.tuning || ui.analyzing || t.busy || t.comparing;
    return h('div', { class: 'simver' },
      h('h3', { class: 'section-title', text: '範本版本' }),
      h('p', { class: 'hint', text: '把調整好的敵人清單存成版本（範本 v1、v2…），之後可以載入繼續調整，或勾兩個版本比較。版本存在房間伺服器（只有 GM 看得到，每日備份）。' }),
      t.error ? h('p', { class: 'notice notice--bad', text: `${t.error}（沒連上房間時無法使用版本）` }) : null,
      h('button', { type: 'button', class: 'btn btn--small', disabled: busy ? true : null, onclick: (e) => saveVersion(e.currentTarget) }, t.busy ? '儲存中…' : '把目前的敵人清單存成新版本'),
      t.list === null ? h('p', { class: 'hint', text: '讀取中…' }) : !t.list.length ? h('p', { class: 'hint', text: '還沒有版本。先「載入範本」、調整，再存成 v1。' }) : h('ul', { class: 'import-list' }, t.list.map((v) => h('li', { class: 'import-row' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: t.selected.includes(v.id) ? true : null, disabled: busy ? true : null, onchange: () => toggleSelected(v.id) }),
          h('span', { text: v.name })),
        h('div', {},
          h('small', { class: 'hint', text: `${v.note ? `${v.note}・` : ''}${describeSpecs(v.specs)}・${when(v.created)}` }),
          v.snap ? h('small', { class: 'hint', text: `存檔當時（${when(v.snap.at)}${v.snap.players?.length ? `，${v.snap.players.join('、')}` : ''}，${v.snap.runs} 場）：勝率 ${pct(v.snap.win)}・回合 ${v.snap.rounds.toFixed(1)}・資源消耗 ${pct(v.snap.drain)}（歷史參考；玩家變強後不能直接拿來比）` }) : null),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: busy ? true : null, onclick: () => loadVersion(v) }, '載入'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: busy ? true : null, title: '用目前的敵人清單取代這個版本', onclick: (e) => saveVersion(e.currentTarget, v) }, '覆蓋'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: busy ? true : null, onclick: (e) => renameVersion(e.currentTarget, v) }, '改名'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: busy ? true : null, onclick: (e) => deleteVersion(e.currentTarget, v) }, '刪除')))),
      t.list?.length >= 2
        ? h('button', { type: 'button', class: 'btn btn--primary btn--small', disabled: busy || t.selected.length !== 2 ? true : null, onclick: compareSelected },
            t.comparing ? '比較中…' : t.selected.length === 2 ? '比較勾選的兩個版本' : '勾選兩個版本才能比較')
        : null,
      t.compare ? compareView() : null);
  }

  const fmtMetric = (type, v) => (v == null ? '—' : type === 'pct' ? pct(v) : type === 'int' ? fmt(Math.round(v)) : v.toFixed(1));
  const dMetric = (type, d) => (d == null ? '' : type === 'pct' ? dPct(d) : type === 'int' ? signed(d, (x) => fmt(Math.round(x))) : dNum(d));

  /** 版本比較結果：數值差異＋用現在的玩家重跑的結果差異 */
  function compareView() {
    const c = ui.tpl.compare;
    return h('div', { class: 'simver__compare simtune' },
      h('section', { class: 'simtune__plan' },
        h('h4', { class: 'field-label', text: `${c.av.name} → ${c.bv.name}` }),
        c.diff.length ? h('ul', { class: 'simassess__advice' }, c.diff.map((t) => h('li', { text: t }))) : h('p', { class: 'hint', text: '兩個版本的敵人數值完全相同。' }),
        h('p', { class: 'hint', text: `用現在的玩家（${c.names.join('、')}）把兩個版本同時重跑 ${c.runs} 場（同一批種子）；勝率的誤差約 ±${Math.round(c.se * 150)}%，差距小於這個多半是運氣。` }),
        h('ul', { class: 'import-list' }, c.rows.map((r) => h('li', { class: 'import-row' },
          h('span', { text: r.label }),
          h('strong', { class: 'num', text: `${fmtMetric(r.type, r.a)} → ${fmtMetric(r.type, r.b)}${r.d == null ? '' : `（${dMetric(r.type, r.d)}）`}` }),
          r.key === 'win' && r.d != null && Math.abs(r.d) <= 1.5 * c.se ? h('span', { class: 'badge', dataset: { tone: '' }, text: '差別不明顯' }) : null)))));
  }

  const signed = (v, fmtFn) => `${v > 0 ? '＋' : v < 0 ? '－' : '±'}${fmtFn(Math.abs(v))}`;
  const dPct = (v) => signed(v, (x) => (x > 0 && x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`)); // 不到 10% 的差顯示一位小數，免得 5.3% → 5.7% 變成「＋0%」
  const dNum = (v) => signed(v, (x) => x.toFixed(1));

  /** 分析結果：範本本身、影響力排行、再依敵人組列出每一項微調的變化 */
  function sensView() {
    const { base, rows, se, baseMeets } = ui.sens;
    const r1 = (sum) => (sum.avgRoundsWin ?? sum.avgRounds).toFixed(1);
    const line = (row) => {
      const b = row.summary;
      return `勝率 ${pct(base.win)} → ${pct(b.win)}（${dPct(row.d.win)}）・回合 ${r1(base)} → ${r1(b)}（${dNum(row.d.rounds)}）・資源消耗 ${pct(base.avgDrain)} → ${pct(b.avgDrain)}（${dPct(row.d.drain)}）・剩餘生命 ${pct(base.avgHpLeft)} → ${pct(b.avgHpLeft)}・藥水 ${base.avgPotions.toFixed(1)} → ${b.avgPotions.toFixed(1)} 瓶`;
    };
    const rowView = (row) => h('li', { class: 'import-row' },
      h('div', {},
        h('span', { text: row.label }),
        h('small', { class: 'hint', text: line(row) })),
      row.noticeable ? null : h('span', { class: 'badge', dataset: { tone: '' }, text: '差別不明顯' }),
      row.meets && !baseMeets ? h('span', { class: 'badge', dataset: { tone: 'good' }, text: '達標' }) : null,
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.running ? true : null, onclick: () => applyVariation(row) }, '套用'));
    const groups = [...new Set(rows.map((r) => r.group))];
    const top = topImpact(rows);
    return h('div', { class: 'simtune' },
      blockedNotice(),
      h('section', { class: 'simtune__plan' },
        h('h4', { class: 'field-label', text: '範本本身' }),
        h('p', { class: 'hint', text: `${ui.sens.specs.map((s) => `${{ boss: 'BOSS', elite: '菁英' }[s.kind] ?? '小怪'} ×${s.count}（攻 ${fmt(s.atkPower)}・防 ${fmt(s.defPower)}・血 ${fmt(s.hp)}）`).join('、')}` }),
        h('p', { class: 'hint', text: `勝率 ${pct(base.win)}・回合 ${r1(base)}・資源消耗 ${pct(base.avgDrain)}・剩餘生命 ${pct(base.avgHpLeft)}・藥水 ${base.avgPotions.toFixed(1)} 瓶・${baseMeets ? '已達標（回合、勝率、資源消耗都在目標內）' : `還沒達標（目標：回合 ${TARGET.roundsMin}～${TARGET.roundsMax}、勝率至少 ${pct(TARGET.winMin)}、資源消耗 ${pct(TARGET.drain - TARGET.drainTol)}～${pct(TARGET.drain + TARGET.drainTol)}）`}` }),
        h('p', { class: 'hint', text: `每項 ${ui.sens.runs} 場、同一批種子；勝率的誤差約 ±${Math.round(se * 150)}%，小於這個的差別大多是運氣，標「差別不明顯」。` })),
      !rows.some((r) => r.noticeable)
        ? h('p', { class: 'notice', text: '所有調整的差別都不明顯：這個範本對目前的玩家來說，勝率與回合幾乎不受這些調整影響（太簡單或太難都會這樣）。可以先用「載入範本」後手動把某一項改大改小很多，再分析一次。' })
        : null,
      top.length
        ? h('section', { class: 'simtune__plan' },
            h('h4', { class: 'field-label', text: '影響力排行（對勝率影響最大的調整）' }),
            h('ul', { class: 'import-list' }, top.map((r) => h('li', { class: 'import-row' }, h('span', { text: `${r.group}：${r.label}` }), h('strong', { class: 'num', text: `勝率 ${dPct(r.d.win)}` })))))
        : null,
      groups.map((g) => h('section', { class: 'simtune__plan' },
        h('h4', { class: 'field-label', text: `${{ boss: '👹', elite: '👺' }[rows.find((r) => r.group === g).kind] ?? '👾'} ${g}` }),
        h('ul', { class: 'import-list' }, rows.filter((r) => r.group === g).map(rowView)))));
  }

  /** 自動調整的結果：保守版與激進版各一張卡，列出調整前後的數值與預估成績，GM 按「套用」才會真的改 */
  function tuneView() {
    const list = ui.tuneResults;
    if (!list) return null;
    return h('div', { class: 'simtune' },
      blockedNotice(),
      h('p', { class: 'hint', text: '兩個方案都以目標為範圍（回合 4～8、勝率 75% 以上、第一名省力也要贏、最弱的也能打倒小怪）：小怪血量依最弱玩家一次出手的傷害設，BOSS 血量補足回合數，怪物攻擊盡量拉高讓血藥有存在感。保守版偏輕鬆、激進版偏緊繃；預估每組只跑了少數場次，套用後會用 200 場重新確認。' }),
      list.map((t) => {
        const a = assess(t.summary);
        const exact = penalty(t.summary, t.plan) === 0;
        return h('section', { class: 'simtune__plan' },
          h('h4', { class: 'field-label', text: `${t.plan.label}：${t.plan.note}` }),
          ui.tuneFrom
            ? h('ul', { class: 'import-list' }, ui.tuneFrom.monsters.map((o) => {
                const m = t.specs.monsters.find((x) => x.id === o.id);
                const atk = (x) => (Array.isArray(x.atk) ? x.atk.map(formatAbc).join('／') : formatAbc(x.atk));
                const icon = o.kind === 'boss' ? '👹' : o.rank === 'elite' ? '👺' : '👾';
                return h('li', { class: 'import-row' },
                  h('span', { text: m ? `${icon} ${o.id}　血量 ${fmt(o.maxHp)} → ${fmt(m.maxHp)}　攻擊 ${atk(o)} → ${atk(m)}` : `${icon} ${o.id}　拿掉（怪物太多）` }));
              }))
            : h('ul', { class: 'import-list' }, t.specs.map((s, i) => {
                const o = ui.specs[i];
                return h('li', { class: 'import-row' },
                  h('span', { text: `${{ boss: '👹 BOSS', elite: '👺 菁英' }[s.kind] ?? '👾 小怪'} ×${o.count === s.count ? s.count : `${o.count} → ${s.count}`}　血量 ${fmt(o.hp)} → ${fmt(s.hp)}　攻擊強度 ${fmt(o.atkPower)} → ${fmt(s.atkPower)}` }));
              })),
          t.notes?.length ? h('ul', { class: 'simassess__advice' }, t.notes.map((n) => h('li', { text: n }))) : null,
          h('p', { class: 'hint', text: `預估：${(t.summary.avgRoundsWin ?? t.summary.avgRounds).toFixed(1)} 回合、資源消耗 ${pct(t.summary.avgDrain)}、勝率 ${pct(t.summary.win)}（${exact ? '符合這個方案' : '找不到完全符合的，這是最接近的'}${a.ok ? '' : '；還有項目沒達標'}）` }),
          t.degenerate ? h('p', { class: 'notice notice--bad', text: '這個方案不合理，已隱藏「套用」。請先處理上面的原因。' }) : h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => applyTune(t.plan) }, `套用${t.plan.label}${ui.tuneFrom ? '（只用在模擬）' : ''}，並用 ${RUNS} 場重新模擬`));
      }));
  }

  /** 每位玩家的貢獻與消耗：看第一名是不是被逼著全力、最弱的有沒有參與 */
  function playersTable(r) {
    if (!r.perPlayer?.length) return null;
    const tag = (i) => (r.rank && r.perPlayer.length > 1 ? (i === r.rank.strongest ? '🥇 ' : i === r.rank.weakest ? '🌱 ' : '') : '');
    return h('div', {},
      h('p', { class: 'field-label', text: '每位玩家的表現（🥇 一次出手傷害最高、🌱 最低；單次出手＝對一隻怪）' }),
      h('ul', { class: 'import-list' }, r.perPlayer.map((p, i) => h('li', { class: 'import-row' },
        h('span', { text: `${tag(i)}${p.name}` }),
        h('small', { class: 'hint', text: `輸出占 ${pct(p.share)}・打倒 ${p.kills.toFixed(1)} 隻・出招 ${p.actions.toFixed(1)} 次・被打 ${p.hit.toFixed(1)} 下・受傷 ${pct(p.takenPct)} 生命・藥水 ${p.potions.toFixed(1)} 瓶・資源消耗 ${pct(p.drain)}・單次出手 ${r.hits ? fmt(Math.round(r.hits[i].perTarget)) : '—'}` })))));
  }

  /** 血藥假設：毒性 15 都拿來喝血，所以怪物可以兇一點 */
  function supplyCard() {
    const heal = Object.keys(POTIONS).filter((n) => POTIONS[n].heal);
    return h('label', { class: 'extra' }, h('span', { text: '血藥假設（每位玩家都備足、毒性 15 喝滿）' }),
      h('select', { class: 'field', disabled: ui.running ? true : null, onchange: (e) => { ui.supply = e.target.value; ui.result = null; ui.tuneResults = null; ui.sens = null; sheet.refresh(); } },
        [['', '只用玩家背包裡有的'], ...heal.map((n) => [n, `${n}（${POTIONS[n].heal.n}D${POTIONS[n].heal.sides}，毒性 +${POTIONS[n].toxicity}）`])].map(([v, label]) => h('option', { value: v, selected: v === ui.supply ? true : null, text: label }))));
  }

  /** 怪物攻擊分配：GM 跑團時輪流打不同的人，還是隨機（隨機會偶爾集中在同一個人身上） */
  function focusCard() {
    return h('label', { class: 'extra' }, h('span', { text: '怪物攻擊分配' }),
      h('select', { class: 'field', disabled: ui.running ? true : null, onchange: (e) => { ui.focus = e.target.value; ui.result = null; ui.tuneResults = null; ui.sens = null; sheet.refresh(); } },
        [['spread', '平均分散（輪流打每個人）'], ['strongest', '集火第一名（先打倒他，再打下一個）'], ['random', '隨機（可能集中在同一人）']].map(([v, label]) => h('option', { value: v, selected: v === ui.focus ? true : null, text: label }))));
  }

  /** 提醒：被略過的玩家、以及打不出傷害的玩家（原因：資料沒填，或攻擊骰比敵人防禦低） */
  function blockedNotice() {
    const stillBlocked = ui.blocked.filter((b) => !(ui.skipBlank && b.empty));
    if (!ui.skipped.length && !stillBlocked.length) return null;
    return h('div', { class: 'notice notice--bad' },
      ui.skipped.length ? h('p', { text: `已略過 ${ui.skipped.length} 位沒有攻擊力的玩家：${ui.skipped.join('、')}（角色資料可能還沒填；模擬只算有資料的玩家）。` }) : null,
      stillBlocked.map((b) => h('p', { text: `${b.name}：${b.why}。（強弱排名與「最弱」評價不把他算進去：他本來就不是輸出。）` })));
  }

  function skipCard() {
    return h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: ui.skipBlank ? true : null, disabled: ui.running || ui.tuning ? true : null, onchange: (e) => { ui.skipBlank = e.target.checked; ui.result = null; ui.tuneResults = null; ui.sens = null; sheet.refresh(); } }),
      h('span', { text: '略過沒有攻擊力的玩家（角色資料還沒填的，不然整隊看起來只有一個人在打）' }));
  }

  function resultView() {
    const r = ui.result;
    if (!r) return null;
    const maxRound = Math.max(1, ...r.roundHist.map((x) => x.win + x.lose + x.timeout));
    const maxHp10 = Math.max(1, ...r.hpHist);
    return h('div', { class: 'simresult' },
      h('h3', { class: 'section-title', text: `結果（${fmt(r.runs)} 場）` }),
      blockedNotice(),
      h('div', { class: 'stat-grid' },
        stat('勝率', pct(r.win), `敗 ${pct(r.lose)}・平手 ${pct(r.timeout)}`),
        stat('平均回合', r.avgRoundsWin.toFixed(1), `打贏的場次；全部 ${r.avgRounds.toFixed(1)}・上限 ${DEFAULT_MAX_ROUNDS}`),
        stat('每回合傷害', fmt(Math.round(r.avgDamagePerRound)), '全隊對怪物'),
        stat('剩餘生命', pct(r.avgHpLeft), '每場結束時全隊平均'),
        stat('資源消耗', pct(r.avgDrain), `合理範圍 ${pct(TARGET.drain - TARGET.drainTol)}～${pct(TARGET.drain + TARGET.drainTol)}（每人的資源與毒性）`),
        stat('用掉藥水', r.avgPotions.toFixed(1), '每場平均瓶數'),
        stat('怪物每下傷害', ['mob', 'elite', 'boss'].filter((k) => r.hitPct?.[k] != null).map((k) => `${{ mob: '小怪', elite: '菁英', boss: 'BOSS' }[k]} ${pct(r.hitPct[k])}`).join('・') || '—', '一下平均打掉玩家多少比例的生命上限')),
      h('p', { class: 'field-label', text: '各項消耗（全隊平均，毒性以上限 15 計）' }),
      h('div', { class: 'toggle-row' }, Object.entries(r.drainBy).map(([k, v]) => h('span', { class: 'badge', dataset: { tone: '' }, text: `${k} ${pct(v)}` }))),
      assessmentView(r),
      h('p', { class: 'field-label', text: '回合數分布（金＝勝、紅＝敗、灰＝平手）' }),
      h('div', { class: 'simchart' }, r.roundHist.map((x) => h('div', { class: 'simchart__col', title: `第 ${x.round} 回合結束：勝 ${x.win}・敗 ${x.lose}・平手 ${x.timeout}` },
        h('span', { class: 'simchart__stack', style: `height:${((x.win + x.lose + x.timeout) / maxRound) * 100}%` },
          x.timeout ? h('span', { class: 'simchart__bar', dataset: { tone: 'mute' }, style: `flex:${x.timeout}` }) : null,
          x.lose ? h('span', { class: 'simchart__bar', dataset: { tone: 'lose' }, style: `flex:${x.lose}` }) : null,
          x.win ? h('span', { class: 'simchart__bar', dataset: { tone: 'win' }, style: `flex:${x.win}` }) : null),
        h('small', { class: 'simchart__label', text: String(x.round) })))),
      h('p', { class: 'field-label', text: '勝利時，玩家剩下多少生命（全隊合計）' }),
      h('div', { class: 'simchart' }, r.hpHist.map((c, i) => column(`${i * 10}%`, c, maxHp10, 'win', `${i * 10}~${(i + 1) * 10}%：${c} 場`))),
      playersTable(r),
      h('p', { class: 'field-label', text: '各玩家至少倒地一次的機率' }),
      h('ul', { class: 'import-list' }, r.downRate.map((d) => h('li', { class: 'import-row' },
        h('span', { text: d.name }),
        h('span', { class: 'simbar' }, h('span', { class: 'simbar__fill', style: `width:${d.rate * 100}%` })),
        h('strong', { class: 'num', text: pct(d.rate) })))),
      h('details', { class: 'skill-row__text' }, h('summary', { text: '模擬的假設（需驗證）' }),
        h('p', { text: '每場開始：生命與資源補滿、毒性歸零。每回合玩家依序行動、再輪到怪物（沒有模擬先攻）。玩家用「續航最長」的招式（資源能放最多次的），不夠就換下一個，最後用普攻；魔女付不起就放棄行動回復魔力。怪物每一下打誰由「怪物攻擊分配」決定（平均分散＝打這場被打次數最少的人，隨機＝隨機挑一位還沒倒地的玩家），BOSS 的輕擊／重擊／絕殺由被打的玩家挑預期傷害最低的。玩家自動喝藥水（毒性滿了不能喝），隊友倒地會餵回復藥水（毒性算被救的人），喝藥水不佔行動；攻擊藥水只在「不喝打不死眼前這隻、喝了打得死」時才喝，防禦藥水在生命低於 60% 時才喝；血藥假設每位玩家都備足（上面選的那種）。評價另外跑一組「第一名只出六成力」的情境，看隊伍還贏不贏。選「自訂強度」時怪物的 A/B/C 分配每一場各自隨機；選場上的敵人或預組時每場都是同一組。玩家全員倒地才算敗。' })));
  }

  function body() {
    return h('div', { class: 'simpanel' },
      h('p', { class: 'hint', text: '在這個瀏覽器裡跑模擬，只讀取玩家的角色，不會改動任何存檔。' }),
      h('h3', { class: 'section-title', text: '1. 選玩家' }), playersCard(), movePlansCard(),
      h('h3', { class: 'section-title', text: '2. 敵人' }), sourceCard(),
      h('h3', { class: 'section-title', text: '3. 血藥與攻擊分配' }), supplyCard(), focusCard(), skipCard(),
      sensCard(), versionsCard(),
      h('button', { type: 'button', class: 'btn btn--primary btn--go', disabled: ui.running || ui.tuning ? true : null, onclick: run },
        ui.running ? `模擬中… ${Math.round(ui.progress * 100)}%` : `▶ 開始模擬（${RUNS} 場）`),
      resultView());
  }

  sheet = openSheet('模擬戰（GM）', body);
  loadList();
}
