// ============================================================
// GM 專用：模擬戰（階段 D）。選幾位玩家＋一組敵人，跑幾百到幾千場，看勝率、回合數、每回合傷害、剩餘生命。
// 全部在這個瀏覽器裡算（規則見 src/game/simulate.js），讀玩家角色但不會改動任何存檔。
// ============================================================
import { h, fmt } from './dom.js';
import { openSheet } from './sheet.js';
import { toast } from './controls.js';
import { listCharacters, fetchCharacter } from '../state/charSync.js';
import { normalizeCharacter } from '../state/store.js';
import { simulateBattle, summarize, DEFAULT_MAX_ROUNDS } from '../game/simulate.js';
import { maxHp } from '../game/stats.js';

const RUN_CHOICES = [200, 1000, 3000];
const BATCH = 25; // 每算幾場讓畫面喘口氣，進度才會動
const pct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const num = (v, min = 0) => Math.max(min, Math.floor(Number(v)) || 0);

/** 條狀圖的一欄：高度 = 比例（0~1） */
const column = (label, value, max, tone, title) => h('div', { class: 'simchart__col', title },
  h('span', { class: 'simchart__bar', dataset: { tone }, style: `height:${max ? Math.max(value ? 3 : 0, (value / max) * 100) : 0}%` }),
  h('small', { class: 'simchart__label', text: label }));

/** deps 只給測試用（換掉讀玩家角色的來源）；平常不用傳 */
export function openSimPanel({ list = listCharacters, fetch = fetchCharacter } = {}) {
  const ui = {
    list: null, error: '', picked: new Set(), cache: new Map(), loading: false,
    specs: [], form: { kind: 'mob', count: 1, atkPower: 100, defPower: 100, hp: 1000, absDef: 0, atkMod: '', defMod: '' },
    runs: 1000, running: false, progress: 0, result: null, names: [],
  };
  let sheet;

  async function loadList() {
    try { ui.list = await list(); } catch (e) { ui.error = e.message; }
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

  async function run() {
    if (ui.running) return;
    if (!ui.picked.size) return toast('至少選一位玩家。');
    if (!ui.specs.length) return toast('至少加一組敵人。');
    ui.running = true; ui.progress = 0; ui.result = null; sheet.refresh();
    try {
      const uids = [...ui.picked];
      const players = [];
      for (const uid of uids) players.push(await ensureLoaded(uid));
      ui.names = uids.map((uid, i) => players[i].name || ui.list?.find((c) => c.uid === uid)?.name || uid);
      const results = [];
      for (let i = 0; i < ui.runs; i++) {
        results.push(simulateBattle(players, ui.specs.map((s) => ({ ...s }))));
        if ((i + 1) % BATCH === 0) {
          ui.progress = (i + 1) / ui.runs;
          sheet.refresh();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      ui.result = summarize(results, ui.names);
    } catch (e) { toast(e.message || '模擬失敗。'); }
    ui.running = false; ui.progress = 1;
    sheet.refresh();
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

  function enemiesCard() {
    const f = ui.form;
    return h('div', {},
      ui.specs.length
        ? h('ul', { class: 'import-list' }, ui.specs.map((s, i) => h('li', { class: 'import-row' },
            h('span', { text: `${s.kind === 'boss' ? '👹 BOSS' : '👾 小怪'} ×${s.count}　攻 ${fmt(s.atkPower)}・防 ${fmt(s.defPower)}・血 ${fmt(s.hp)}${s.absDef ? `・絕防 ${fmt(s.absDef)}` : ''}${s.atkMod || s.defMod ? `（補正 ${s.atkMod || '—'} / ${s.defMod || '—'}）` : ''}` }),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.running ? true : null, onclick: () => { ui.specs.splice(i, 1); sheet.refresh(); } }, '移除'))))
        : h('p', { class: 'hint', text: '還沒有敵人。從下面加一組。' }),
      h('div', { class: 'toggle-row' }, [['mob', '小怪'], ['boss', 'BOSS']].map(([id, label]) => h('button', {
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

  function resultView() {
    const r = ui.result;
    if (!r) return null;
    const maxRound = Math.max(1, ...r.roundHist.map((x) => x.win + x.lose + x.timeout));
    const maxHp10 = Math.max(1, ...r.hpHist);
    return h('div', { class: 'simresult' },
      h('h3', { class: 'section-title', text: `結果（${fmt(r.runs)} 場）` }),
      h('div', { class: 'stat-grid' },
        stat('勝率', pct(r.win), `敗 ${pct(r.lose)}・平手 ${pct(r.timeout)}`),
        stat('平均回合', r.avgRounds.toFixed(1), `上限 ${DEFAULT_MAX_ROUNDS} 回合`),
        stat('每回合傷害', fmt(Math.round(r.avgDamagePerRound)), '全隊對怪物'),
        stat('剩餘生命', pct(r.avgHpLeft), '每場結束時全隊平均'),
        stat('用掉藥水', r.avgPotions.toFixed(1), '每場平均瓶數')),
      h('p', { class: 'field-label', text: '回合數分布（金＝勝、紅＝敗、灰＝平手）' }),
      h('div', { class: 'simchart' }, r.roundHist.map((x) => h('div', { class: 'simchart__col', title: `第 ${x.round} 回合結束：勝 ${x.win}・敗 ${x.lose}・平手 ${x.timeout}` },
        h('span', { class: 'simchart__stack', style: `height:${((x.win + x.lose + x.timeout) / maxRound) * 100}%` },
          x.timeout ? h('span', { class: 'simchart__bar', dataset: { tone: 'mute' }, style: `flex:${x.timeout}` }) : null,
          x.lose ? h('span', { class: 'simchart__bar', dataset: { tone: 'lose' }, style: `flex:${x.lose}` }) : null,
          x.win ? h('span', { class: 'simchart__bar', dataset: { tone: 'win' }, style: `flex:${x.win}` }) : null),
        h('small', { class: 'simchart__label', text: String(x.round) })))),
      h('p', { class: 'field-label', text: '勝利時，玩家剩下多少生命（全隊合計）' }),
      h('div', { class: 'simchart' }, r.hpHist.map((c, i) => column(`${i * 10}%`, c, maxHp10, 'win', `${i * 10}~${(i + 1) * 10}%：${c} 場`))),
      h('p', { class: 'field-label', text: '各玩家至少倒地一次的機率' }),
      h('ul', { class: 'import-list' }, r.downRate.map((d) => h('li', { class: 'import-row' },
        h('span', { text: d.name }),
        h('span', { class: 'simbar' }, h('span', { class: 'simbar__fill', style: `width:${d.rate * 100}%` })),
        h('strong', { class: 'num', text: pct(d.rate) })))),
      h('details', { class: 'skill-row__text' }, h('summary', { text: '模擬的假設（需驗證）' }),
        h('p', { text: '每場開始：生命與資源補滿、毒性歸零。每回合玩家依序行動、再輪到怪物（沒有模擬先攻）。玩家用「續航最長」的招式（資源能放最多次的），不夠就換下一個，最後用普攻；魔女付不起就放棄行動回復魔力。怪物每回合隨機打一位還沒倒地的玩家，BOSS 的輕擊／重擊／絕殺由被打的玩家挑預期傷害最低的。玩家自動喝藥水（毒性滿了不能喝），隊友倒地會餵回復藥水（毒性算被救的人），喝藥水不佔行動；攻擊／防禦加成藥水只要身上沒有加成就會喝（所以輕鬆的戰鬥也會用掉藥水）。怪物的 A/B/C 分配每一場各自隨機。玩家全員倒地才算敗。' })));
  }

  function body() {
    return h('div', { class: 'simpanel' },
      h('p', { class: 'hint', text: '在這個瀏覽器裡跑模擬，只讀取玩家的角色，不會改動任何存檔。' }),
      h('h3', { class: 'section-title', text: '1. 選玩家' }), playersCard(),
      h('h3', { class: 'section-title', text: '2. 敵人' }), enemiesCard(),
      h('h3', { class: 'section-title', text: '3. 場數' }),
      h('div', { class: 'toggle-row' }, RUN_CHOICES.map((n) => h('button', {
        type: 'button', class: 'toggle', 'aria-pressed': String(ui.runs === n), disabled: ui.running ? true : null, onclick: () => { ui.runs = n; sheet.refresh(); },
      }, `${fmt(n)} 場`))),
      h('button', { type: 'button', class: 'btn btn--primary btn--go', disabled: ui.running ? true : null, onclick: run },
        ui.running ? `模擬中… ${Math.round(ui.progress * 100)}%` : '▶ 開始模擬'),
      resultView());
  }

  sheet = openSheet('模擬戰（GM）', body);
  loadList();
}
