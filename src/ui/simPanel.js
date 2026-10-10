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
import { measureHits, rankPlayers, suggestMobHp, capsFor, FAIR } from '../game/fairness.js';
import { POTIONS } from '../game/rules.js';
import { assess, autoTune, penalty, scaleEncounter, shrinkEncounter, PLANS, TARGET } from '../game/tuning.js';
import { getEncounter, presetAction } from '../state/rollLog.js';
import { formatAbc } from '../game/combat.js';
import { maxHp } from '../game/stats.js';

const RUNS = 200; // 每次模擬的場數（固定）
const TUNE_RUNS = 40; // 自動調整時，每組候選數值只跑這麼多場（要試很多組，跑 200 場太慢）；每次都用同一批種子，結果才不會被運氣干擾
const BATCH = 25; // 每算幾場讓畫面喘口氣，進度才會動
const pct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);

/** 條狀圖的一欄：高度 = 比例（0~1） */
const column = (label, value, max, tone, title) => h('div', { class: 'simchart__col', title },
  h('span', { class: 'simchart__bar', dataset: { tone }, style: `height:${max ? Math.max(value ? 3 : 0, (value / max) * 100) : 0}%` }),
  h('small', { class: 'simchart__label', text: label }));

/** deps 只給測試用（換掉讀玩家角色的來源）；平常不用傳 */
export function openSimPanel({ list = listCharacters, fetch = fetchCharacter, presets = () => presetAction({ t: 'presetList' }) } = {}) {
  const ui = {
    source: 'custom', // 敵人來源：custom 自訂強度（每場重抽 A/B/C）｜stage 場上的敵人｜preset:名稱 敵人預組（固定）
    presetList: [],
    list: null, error: '', picked: new Set(), cache: new Map(), loading: false,
    specs: [], form: { kind: 'mob', count: 1, atkPower: 100, defPower: 100, hp: 1000, absDef: 0, atkMod: '', defMod: '' },
    running: false, progress: 0, result: null, names: [],
    tuning: false, tuneProgress: 0, tuneResults: null, // tuneResults：[{ plan, specs, summary, penalty }]（保守版、激進版各一）；固定敵人時 specs 是調整後的 { monsters }
    tuneFrom: null,
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
    sheet.refresh();
  }

  /** 固定敵人（場上的或預組）；自訂強度回傳 null */
  function fixedEnemies() {
    if (ui.override) return ui.override;
    if (ui.source === 'stage') return getEncounter()?.monsters?.length ? { monsters: getEncounter().monsters } : null;
    if (ui.source.startsWith('preset:')) return ui.presetList.find((p) => `preset:${p.name}` === ui.source) ?? null;
    return null;
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
    for (const uid of uids) players.push(await ensureLoaded(uid));
    const names = uids.map((uid, i) => players[i].name || ui.list?.find((c) => c.uid === uid)?.name || uid);
    return { players, names };
  }

  /**
   * 建立評估函式：跑 runs 場（固定種子）；full 時再多跑一組「第一名只出部分力」的情境，算隊伍勝率。
   * 回傳的結果帶 rank（強弱）、capWin、capBudget，評價與自動調整都靠這些判斷公平性。
   */
  function makeEvaluate(players, names, rank, fixed, runs) {
    const once = (input, caps, n) => summarize(Array.from({ length: n }, (_, i) => (fixed
      ? simulateBattle(players, [], { encounter: input, rng: seededRng(i + 1), supply: ui.supply || null, caps })
      : simulateBattle(players, input.map((s) => ({ ...s })), { rng: seededRng(i + 1), supply: ui.supply || null, caps }))), names);
    return (input, full = true) => {
      const sum = once(input, [], runs);
      sum.rank = rank;
      if (full && players.length > 1) {
        sum.capWin = once(input, capsFor(players.length, rank.strongest), Math.max(20, Math.round(runs * 0.6))).win;
        sum.capBudget = FAIR.topBudget;
      }
      return sum;
    };
  }

  async function run() {
    if (ui.running || ui.tuning) return;
    if (!ui.picked.size) return toast('至少選一位玩家。');
    const fixed = ui.source === 'custom' ? null : fixedEnemies();
    if (ui.source !== 'custom' && !fixed) return toast('場上沒有敵人，或找不到這個預組。');
    if (!fixed && !ui.specs.length) return toast('至少加一組敵人。');
    ui.running = true; ui.progress = 0; ui.result = null; ui.tuneResults = null; sheet.refresh();
    try {
      const { players, names } = await loadPlayers();
      ui.names = names;
      const source = fixed ?? ui.specs;
      const rank = rankPlayers(measureHits(players, source, { supply: ui.supply || null }));
      const results = [];
      for (let i = 0; i < RUNS; i++) {
        const opts = { supply: ui.supply || null };
        results.push(fixed ? simulateBattle(players, [], { encounter: fixed, ...opts }) : simulateBattle(players, ui.specs.map((s) => ({ ...s })), opts));
        if ((i + 1) % BATCH === 0) {
          ui.progress = (i + 1) / RUNS;
          sheet.refresh();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      ui.result = summarize(results, ui.names);
      ui.result.rank = rank;
      ui.result.hits = rank.hits;
      if (players.length > 1) { // 第一名只出部分力的情境（場數少一點，只看勝率）
        const caps = capsFor(players.length, rank.strongest);
        const capRuns = Array.from({ length: Math.round(RUNS / 2) }, () => (fixed ? simulateBattle(players, [], { encounter: fixed, supply: ui.supply || null, caps }) : simulateBattle(players, ui.specs.map((s) => ({ ...s })), { supply: ui.supply || null, caps })));
        ui.result.capWin = summarize(capRuns, ui.names).win;
        ui.result.capBudget = FAIR.topBudget;
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
      const { players, names } = await loadPlayers();
      const rank = rankPlayers(measureHits(players, fixed ?? ui.specs, { supply: ui.supply || null }));
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
        h('input', { type: 'checkbox', checked: ui.picked.has(c.uid) ? true : null, disabled: ui.running ? true : null, onchange: (e) => { if (e.target.checked) ui.picked.add(c.uid); else ui.picked.delete(c.uid); } }),
        h('span', { text: c.charName || c.name })),
      h('small', { class: 'hint', text: c.name }))));
  }

  /** 敵人來源：自訂強度（每場重抽）、場上的敵人、預組（後兩種 A/B/C 固定） */
  function sourceCard() {
    const options = [['custom', '自訂強度（每場重抽 A/B/C）'], ['stage', '場上的敵人（固定）'], ...ui.presetList.map((p) => [`preset:${p.name}`, `預組：${p.name}（固定）`])];
    const fixed = fixedEnemies();
    return h('div', {},
      h('label', { class: 'extra' }, h('span', { text: '敵人來源' }),
        h('select', { class: 'field', disabled: ui.running ? true : null, onchange: (e) => { ui.source = e.target.value; ui.override = null; ui.tuneResults = null; sheet.refresh(); } },
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
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.running ? true : null, onclick: () => { ui.specs.splice(i, 1); sheet.refresh(); } }, '移除'))))
        : h('p', { class: 'hint', text: '還沒有敵人。從下面加一組。' }),
      h('div', { class: 'toggle-row' }, [['mob', '小怪（普通）'], ['elite', '菁英（2 打）'], ['boss', 'BOSS（3 打）']].map(([id, label]) => h('button', {
        type: 'button', class: 'toggle', 'aria-pressed': String(f.kind === id), onclick: () => { f.kind = id; sheet.refresh(); },
      }, label))),
      h('div', { class: 'extra-row' }, field('數量', 'count', 1), field('攻擊強度', 'atkPower'), field('防禦強度', 'defPower'), field('血量', 'hp', 1), field('絕對防禦', 'absDef')),
      h('div', { class: 'extra-row' },
        h('label', { class: 'extra' }, h('span', { text: '攻擊補正（選填）' }), h('input', { class: 'field', type: 'text', placeholder: '5A 3C', value: f.atkMod, onchange: (e) => { f.atkMod = e.target.value; } })),
        h('label', { class: 'extra' }, h('span', { text: '防禦補正（選填）' }), h('input', { class: 'field', type: 'text', placeholder: '2B', value: f.defMod, onchange: (e) => { f.defMod = e.target.value; } }))),
      h('button', {
        type: 'button', class: 'btn btn--small', disabled: ui.running ? true : null,
        onclick: () => {
          if (f.count > 20) return toast('一組最多 20 隻。');
          ui.specs.push({ ...f });
          sheet.refresh();
        },
      }, '＋ 加入這組敵人'));
  }

  function stat(label, value, note) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat__name', text: label }), h('strong', { class: 'stat__value', text: value }), note ? h('small', { class: 'stat__detail', text: note }) : null);
  }

  const STATUS_LABEL = { ok: '達標', low: '偏低', high: '偏高' };
  /** 評價與策略：對照 GM 的目標（回合 2～3、每場耗約一半資源）；自訂強度時可以一鍵自動調整 */
  function assessmentView(r) {
    const a = assess(r);
    return h('div', { class: 'simassess' },
      h('h3', { class: 'section-title', text: `評價（目標：${TARGET.roundsMin}～${TARGET.roundsMax} 回合、資源消耗 ${pct(TARGET.drain - TARGET.drainTol)}～${pct(TARGET.drain + TARGET.drainTol)} 算合理、第一名不用全力、最弱的也有貢獻）` }),
      h('ul', { class: 'import-list' }, a.items.map((i) => h('li', { class: 'import-row' },
        h('span', { text: `${i.label}：${i.value}（目標 ${i.target}）` }),
        h('span', { class: 'badge', dataset: { tone: i.status === 'ok' ? 'good' : 'bad' }, text: `${STATUS_LABEL[i.status]}・${i.text}` })))),
      h('h3', { class: 'section-title', text: '策略建議' }),
      h('ul', { class: 'simassess__advice' }, a.advice.map((t) => h('li', { text: t }))),
      h('button', { type: 'button', class: 'btn btn--small', disabled: ui.running || ui.tuning ? true : null, onclick: tune }, ui.tuning ? `調整中… ${Math.round(ui.tuneProgress * 100)}%` : '🎯 自動調整數值（保守／激進兩個方案）'),
      tuneView());
  }

  /** 自動調整的結果：保守版與激進版各一張卡，列出調整前後的數值與預估成績，GM 按「套用」才會真的改 */
  function tuneView() {
    const list = ui.tuneResults;
    if (!list) return null;
    return h('div', { class: 'simtune' },
      h('p', { class: 'hint', text: '兩個方案都以目標為範圍（2～3 回合、第一名省力也要贏、最弱的也能打倒小怪）：小怪血量依最弱玩家一次出手的傷害設，BOSS 血量補足回合數，怪物攻擊盡量拉高讓血藥有存在感。保守版偏輕鬆、激進版偏緊繃；預估每組只跑了少數場次，套用後會用 200 場重新確認。' }),
      list.map((t) => {
        const a = assess(t.summary);
        const exact = penalty(t.summary, t.plan) === 0;
        return h('section', { class: 'simtune__plan' },
          h('h4', { class: 'field-label', text: `${t.plan.key === 'aggressive' ? '🔥' : '🛡️'} ${t.plan.label}：${t.plan.note}` }),
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
          h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => applyTune(t.plan) }, `套用${t.plan.label}${ui.tuneFrom ? '（只用在模擬）' : ''}，並用 ${RUNS} 場重新模擬`));
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
        h('small', { class: 'hint', text: `輸出占 ${pct(p.share)}・打倒 ${p.kills.toFixed(1)} 隻・出招 ${p.actions.toFixed(1)} 次・承受 ${fmt(Math.round(p.taken))}・藥水 ${p.potions.toFixed(1)} 瓶・資源消耗 ${pct(p.drain)}・單次出手 ${r.hits ? fmt(Math.round(r.hits[i].perTarget)) : '—'}` })))));
  }

  /** 血藥假設：毒性 15 都拿來喝血，所以怪物可以兇一點 */
  function supplyCard() {
    const heal = Object.keys(POTIONS).filter((n) => POTIONS[n].heal);
    return h('label', { class: 'extra' }, h('span', { text: '血藥假設（每位玩家都備足、毒性 15 喝滿）' }),
      h('select', { class: 'field', disabled: ui.running ? true : null, onchange: (e) => { ui.supply = e.target.value; ui.result = null; ui.tuneResults = null; sheet.refresh(); } },
        [['', '只用玩家背包裡有的'], ...heal.map((n) => [n, `${n}（${POTIONS[n].heal.n}D${POTIONS[n].heal.sides}，毒性 +${POTIONS[n].toxicity}）`])].map(([v, label]) => h('option', { value: v, selected: v === ui.supply ? true : null, text: label }))));
  }

  function resultView() {
    const r = ui.result;
    if (!r) return null;
    const maxRound = Math.max(1, ...r.roundHist.map((x) => x.win + x.lose + x.timeout));
    const maxHp10 = Math.max(1, ...r.hpHist);
    return h('div', { class: 'simresult' },
      h('h3', { class: 'section-title', text: `結果（${fmt(r.runs)} 場）` }),
      h('div', { class: 'stat-grid' },
        stat('勝率', pct(r.win), `敗 ${pct(r.lose)}・平手 ${pct(r.timeout)}`),
        stat('平均回合', r.avgRoundsWin.toFixed(1), `打贏的場次；全部 ${r.avgRounds.toFixed(1)}・上限 ${DEFAULT_MAX_ROUNDS}`),
        stat('每回合傷害', fmt(Math.round(r.avgDamagePerRound)), '全隊對怪物'),
        stat('剩餘生命', pct(r.avgHpLeft), '每場結束時全隊平均'),
        stat('資源消耗', pct(r.avgDrain), `合理範圍 ${pct(TARGET.drain - TARGET.drainTol)}～${pct(TARGET.drain + TARGET.drainTol)}（每人的資源與毒性）`),
        stat('用掉藥水', r.avgPotions.toFixed(1), '每場平均瓶數')),
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
        h('p', { text: '每場開始：生命與資源補滿、毒性歸零。每回合玩家依序行動、再輪到怪物（沒有模擬先攻）。玩家用「續航最長」的招式（資源能放最多次的），不夠就換下一個，最後用普攻；魔女付不起就放棄行動回復魔力。怪物每回合隨機打一位還沒倒地的玩家，BOSS 的輕擊／重擊／絕殺由被打的玩家挑預期傷害最低的。玩家自動喝藥水（毒性滿了不能喝），隊友倒地會餵回復藥水（毒性算被救的人），喝藥水不佔行動；攻擊藥水只在「不喝打不死眼前這隻、喝了打得死」時才喝，防禦藥水在生命低於 60% 時才喝；血藥假設每位玩家都備足（上面選的那種）。評價另外跑一組「第一名只出六成力」的情境，看隊伍還贏不贏。選「自訂強度」時怪物的 A/B/C 分配每一場各自隨機；選場上的敵人或預組時每場都是同一組。玩家全員倒地才算敗。' })));
  }

  function body() {
    return h('div', { class: 'simpanel' },
      h('p', { class: 'hint', text: '在這個瀏覽器裡跑模擬，只讀取玩家的角色，不會改動任何存檔。' }),
      h('h3', { class: 'section-title', text: '1. 選玩家' }), playersCard(),
      h('h3', { class: 'section-title', text: '2. 敵人' }), sourceCard(),
      h('h3', { class: 'section-title', text: '3. 血藥' }), supplyCard(),
      h('button', { type: 'button', class: 'btn btn--primary btn--go', disabled: ui.running || ui.tuning ? true : null, onclick: run },
        ui.running ? `模擬中… ${Math.round(ui.progress * 100)}%` : `▶ 開始模擬（${RUNS} 場）`),
      resultView());
  }

  sheet = openSheet('模擬戰（GM）', body);
  loadList();
}
