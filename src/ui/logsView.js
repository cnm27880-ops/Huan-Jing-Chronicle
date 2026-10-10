// ============================================================
// 日誌頁：所有玩家的修整、學習、物品日誌（誰在什麼時候做了什麼）。
// 已加入房間：資料在伺服器（每人最近 500 筆），所有玩家都看得到，有人新增會即時出現。
// 沒加入房間（單機試玩）：只看得到這個瀏覽器自己的紀錄。內容一律用 textContent（防 XSS）。
// ============================================================
import { h } from './dom.js';
import { getRoomStatus, subscribeRoom, listActivity, subscribeActivity } from '../state/rollLog.js';
import { localActivities } from '../state/activityLog.js';
import { ACTIVITY_CATS } from '../game/activity.js';

const pad = (n) => String(n).padStart(2, '0');
function timeText(t) {
  const d = new Date(t);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm}`;
}

export function createLogsView({ root }) {
  const ui = { uid: '', cat: '', entries: [], more: false, next: null, loading: false, error: '', loaded: false, active: false, wasOnline: false };
  let token = 0; // 切換篩選時，只收最新那次查詢的結果
  let unsubAct = null;
  let unsubRoom = null;
  const online = () => getRoomStatus().phase === 'online';

  async function load(reset) {
    const my = ++token;
    if (reset) { ui.entries = []; ui.more = false; ui.next = null; }
    ui.loading = true; ui.error = '';
    render();
    try {
      if (online()) {
        const res = await listActivity({ ...(ui.uid ? { uid: ui.uid } : {}), ...(ui.cat ? { cat: ui.cat } : {}), ...(!reset && ui.next != null ? { before: ui.next } : {}) });
        if (my !== token) return;
        ui.entries = reset ? res.entries : [...ui.entries, ...res.entries];
        ui.more = Boolean(res.more);
        ui.next = res.next ?? res.entries.at(-1)?.seq ?? null;
      } else {
        ui.entries = localActivities().filter((e) => !ui.cat || e.cat === ui.cat);
        ui.more = false;
      }
    } catch (e) {
      if (my !== token) return;
      ui.error = e?.message ?? '讀取日誌失敗。';
    }
    ui.loading = false;
    render();
  }

  /** 有人新增一筆：符合目前篩選就放到最前面 */
  function onLive(entry) {
    if (!ui.active || !entry?.id || ui.entries.some((e) => e.id === entry.id)) return;
    if ((ui.uid && entry.uid !== ui.uid) || (ui.cat && entry.cat !== ui.cat)) return;
    ui.entries = [entry, ...ui.entries];
    render();
  }

  function playerOptions() {
    const r = getRoomStatus();
    return (r.members ?? []).map((m) => ({ uid: m.uid, name: r.vitals?.[m.uid]?.name || m.name }));
  }

  function entryRow(e) {
    const showPlayer = e.name && e.name !== e.who;
    return h('li', { class: 'log-entry', dataset: { cat: e.cat } },
      h('div', { class: 'log-entry__head' },
        h('span', { class: 'log-entry__time num', text: timeText(e.t) }),
        h('strong', { class: 'log-entry__who', text: e.who || e.name || '玩家' }),
        showPlayer ? h('small', { class: 'log-entry__player', text: e.name }) : null,
        h('span', { class: 'badge log-entry__cat', dataset: { cat: e.cat }, text: ACTIVITY_CATS[e.cat] ?? e.cat })),
      h('p', { class: 'log-entry__text', text: e.text }),
      e.lines?.length
        ? h('details', { class: 'log-entry__more' },
            h('summary', { text: `細節（${e.lines.length}）` }),
            h('ul', {}, e.lines.map((l) => h('li', { text: l }))))
        : null);
  }

  function filters() {
    const players = playerOptions();
    return h('div', { class: 'log-filters' },
      online()
        ? h('select', { class: 'field', 'aria-label': '看哪位玩家', onchange: (e) => { ui.uid = e.target.value; load(true); } },
            h('option', { value: '', text: '全部玩家' }),
            players.map((p) => h('option', { value: p.uid, selected: ui.uid === p.uid ? true : null, text: p.name })))
        : null,
      h('div', { class: 'toggle-row', role: 'group', 'aria-label': '日誌類別' },
        [['', '全部'], ...Object.entries(ACTIVITY_CATS)].map(([id, label]) => h('button', {
          type: 'button', class: 'toggle', 'aria-pressed': String(ui.cat === id), onclick: () => { ui.cat = id; load(true); },
        }, label))),
      h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: ui.loading ? true : null, onclick: () => load(true) }, '重新整理'));
  }

  function render() {
    if (!ui.active) return;
    root.replaceChildren(h('section', { class: 'card logs' },
      h('h2', { class: 'section-title', text: '玩家日誌' }),
      h('p', { class: 'hint', text: online()
        ? '所有玩家的修整、學習、物品紀錄（每人保留最近 500 筆）。有人做了新的事會即時出現在最上面。'
        : '目前沒有加入房間，只看得到這個瀏覽器自己的紀錄。登入並加入房間後，就能看到所有玩家的日誌。' }),
      filters(),
      ui.error ? h('p', { class: 'notice notice--bad', text: ui.error }) : null,
      ui.entries.length
        ? h('ul', { class: 'log-list' }, ui.entries.map(entryRow))
        : h('p', { class: 'notice', text: ui.loading ? '讀取中…' : '還沒有日誌。' }),
      ui.more ? h('button', { type: 'button', class: 'btn btn--ghost', disabled: ui.loading ? true : null, onclick: () => load(false) }, ui.loading ? '讀取中…' : '載入更多') : null));
  }

  return {
    /** 進入頁面（main.js 每次切到日誌頁、或角色資料更新時會呼叫）：第一次進來才查詢，之後靠即時推送與「重新整理」 */
    render() {
      ui.active = true;
      if (!unsubAct) unsubAct = subscribeActivity(onLive);
      if (!unsubRoom) {
        ui.wasOnline = online();
        unsubRoom = subscribeRoom(() => { // 剛連上（或斷線）：換成伺服器（或本機）的資料
          if (!ui.active || online() === ui.wasOnline) return;
          ui.wasOnline = online();
          ui.uid = '';
          load(true);
        });
      }
      if (!ui.loaded) { ui.loaded = true; load(true); } else render();
    },
    leave() {
      ui.active = false; ui.loaded = false; // 下次進來重新查，才會是最新的
      unsubAct?.(); unsubAct = null;
      unsubRoom?.(); unsubRoom = null;
    },
  };
}
