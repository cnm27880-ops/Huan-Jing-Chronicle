// ============================================================
// 進入點：把資料層和各個 UI 模組接起來
// ============================================================
import { askConfirm } from './ui/confirmPop.js';
import './styles/theme.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/map.css';
import './styles/dossier.css';
import './styles/pages.css';
import './styles/redesign.css';
import './styles/dice.css';
import './styles/polish.css';
import './styles/blackgold.css';

import { getRegions, getMapLocations, getLocationDetail } from './api/lore.js';
import { createMapView } from './ui/mapView.js';
import { createDossier } from './ui/dossier.js';
import { createRestView } from './ui/restView.js';
import { createBagView } from './ui/bagView.js';
import { createGearView } from './ui/gearView.js';
import { createMarketView } from './ui/marketView.js';
import { createSessionView } from './ui/sessionView.js';
import { createLogsView } from './ui/logsView.js';
import { createVitalsReporter } from './state/vitals.js';
import { showCover } from './ui/cover.js';
import { createUserChip } from './ui/userChip.js';
import { getCurrentUser, consumeLoginResult } from './api/auth.js';
import { startRoom, stopRoom, getRoomStatus, subscribeRoom } from './state/rollLog.js';
import { mountWaitNotice } from './ui/waitNotice.js';
import { blankCharacter } from './game/importBot.js';
import { SAMPLE_CHARACTER } from './data/sample/fude.js';
import { setCustomSpecial } from './game/special.js';
import { setCustomSkills } from './game/skillTable.js';
import { loadCachedCustomSkills, saveCachedCustomSkills } from './state/customSkills.js';
import { loadCharacter, saveCharacter, resetCharacter, hasSavedCharacter, importCharacter, stashLocalCharacter, unstashLocalCharacter } from './state/store.js';
import { createCharSync } from './state/charSync.js';
import { createMailbox } from './state/mailbox.js';
import { toast } from './ui/controls.js';

const $ = (sel) => document.querySelector(sel);

async function init() {
  const [regions, locations] = await Promise.all([getRegions(), getMapLocations()]);
  const regionsById = Object.fromEntries(regions.map((r) => [r.id, r]));

  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const dossierPanel = $('#dossier');

  const map = createMapView({
    viewport: $('#map-viewport'),
    stage: $('#map-stage'),
    hotspotLayer: $('#map-hotspots'),
    onSelect: (id) => openLocation(id, { fly: false }),
  });

  const dossier = createDossier({
    panel: dossierPanel,
    onClose: () => map.setActive(null),
  });

  /** 點地圖標記：直接打開右側的設定集面板 */
  let openToken = 0;
  async function openLocation(id, { fly = false } = {}) {
    const loc = locationsById[id];
    if (!loc) return;
    const token = ++openToken; // 連點兩個地點時，只顯示最後點的那個（避免慢的請求蓋掉新的）
    map.setActive(id);
    if (fly) map.focusOn(loc.x, loc.y);
    const detail = await getLocationDetail(id);
    if (!detail || token !== openToken) return;
    dossier.open(detail, regionsById[detail.region]);
  }


  map.renderHotspots(locations, regionsById);

  const mapImg = $('#map-image');
  if (mapImg.complete) map.reset(false);
  else mapImg.addEventListener('load', () => map.reset(false), { once: true });

  // ---------- 角色資料與分頁 ----------
  setCustomSkills(loadCachedCustomSkills()); // 先放進上次的 GM 專屬技能，再載入角色（載入時會依數值上限修正生命與資源）
  let character = loadCharacter();
  const getState = () => character;
  let views;
  let sync = null;
  let vitals = null;
  const commit = () => {
    saveCharacter(character);
    sync?.markDirty(); // 已連上房間時，稍後同步到伺服器
    vitals?.changed(); // 生命、資源有變就回報給房間（隊友看得到）
    views[currentView]?.render();
  };
  views = {
    rest: createRestView({ root: $('#view-rest'), getState, commit }),
    bag: createBagView({
      root: $('#view-bag'),
      getState,
      commit,
      onReset: () => {
        character = resetCharacter();
        commit();
      },
    }),
    gear: createGearView({ root: $('#view-gear'), getState, commit }),
    session: createSessionView({ root: $('#view-session'), getState, commit }),
    market: createMarketView({ root: $('#view-market'), getState, commit }),
    logs: createLogsView({ root: $('#view-logs') }),
  };
  sync = createCharSync({
    getState,
    hasLocalSave: hasSavedCharacter,
    stashLocal: stashLocalCharacter,
    unstashLocal: unstashLocalCharacter,
    onAccountSwitch: () => { // 換帳號：畫面改讀這個帳號的本機存檔（沒有就是示範角色，之後等 GM 匯入）
      character = loadCharacter();
      views[currentView]?.render();
      vitals?.changed();
    },
    notify: toast,
    confirmFn: (text, o) => askConfirm(null, { title: o?.title ?? '請選擇', lines: [text], okText: o?.okText, cancelText: o?.cancelText }),
    adopt: (data) => { // 伺服器的存檔套用到畫面（不經過 commit，免得又上傳一次）
      character = importCharacter(data);
      views[currentView]?.render();
      vitals?.changed();
    },
  });
  vitals = createVitalsReporter({ getState, skip: () => sync.isWaiting() }); // 等 GM 匯入期間不回報示範角色

  createMailbox({ getState, commit }); // 別人送的東西、餵的藥：領取後直接放進自己的角色

  // GM 不用示範角色：連上房間後，如果 GM 的角色看起來還是示範角色（名字相同、或還在等匯入），**先問**要不要換成空白角色（名字用 Discord 名稱）。
  // 注意：示範角色就是照某位玩家的角色做的，名字會一樣——所以只用名字判斷不夠準，一定要讓人確認（2026/10/10 出過事：玩家自己的角色被誤換掉）。
  // 暫代 GM（測試用）不處理。舊的存檔備份在 localStorage 的 huanjing:character:demo-backup（已經有備份就不覆蓋）；每台裝置只問一次。
  const GM_BLANK_KEY = 'huanjing:gm-blank:v2';
  const BACKUP_KEY = 'huanjing:character:demo-backup';
  let gmChecking = false;
  let restoring = false; // 正在問「要不要還原備份」時，先不問「要不要換成空白角色」，免得連跳兩個對話框
  async function gmBlankCheck() {
    const status = getRoomStatus();
    if (gmChecking || restoring || status.phase !== 'online' || !status.me?.isGm || status.gm?.override === status.me.uid) return;
    try { if (localStorage.getItem(GM_BLANK_KEY)) return; } catch { return; } // 讀不到就不問（寧可不換）
    gmChecking = true;
    try {
      await sync.idle(); // 等連線後的比對做完，免得被它蓋掉
      if (!getRoomStatus().me?.isGm) return;
      if (sync.isWaiting() || character.name === SAMPLE_CHARACTER.name) {
        const ok = await askConfirm(null, { title: `GM 帳號目前用的角色「${character.name}」看起來是示範角色`, lines: ['要換成空白角色嗎？（名字會用你的 Discord 名稱）', '換成空白角色：舊角色備份在這台裝置，之後可以還原。', '維持現在的角色：之後不會再問。'], okText: '換成空白角色', cancelText: '維持現在的角色' });
        if (ok) {
          try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, localStorage.getItem('huanjing:character:v1') ?? ''); } catch { /* 備份失敗也照做 */ }
          character = importCharacter({ ...blankCharacter(status.me.name || 'GM'), statMode: 'skills' });
          await sync.forceUpload();
          vitals.changed();
          views[currentView]?.render();
          toast(`已換成空白角色「${character.name}」（舊角色備份在這台裝置，重新整理後會問你要不要還原）。`);
        }
      }
      try { localStorage.setItem(GM_BLANK_KEY, getRoomStatus().me?.uid ?? '1'); } catch { /* 忽略 */ }
    } finally { gmChecking = false; }
  }

  // 還原被換掉的角色：這台裝置有備份（gmBlankCheck 換角色前存的）時，連上房間後問一次要不要還原
  let restoreAsked = false;
  async function offerRestore() {
    if (restoreAsked || getRoomStatus().phase !== 'online') return;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null'); } catch { data = null; }
    if (!data?.name) return;
    restoreAsked = true;
    restoring = true;
    try {
      await sync.idle();
      const ok = await askConfirm(null, { title: `這台裝置有一份被換掉的角色備份：「${data.name}」`, lines: [`金幣 ${Number(data.gold ?? 0).toLocaleString('zh-TW')}`, '還原：目前的角色會被取代，並同步到伺服器。', '先不要：下次開啟網站還會再問。'], okText: '還原這個角色', cancelText: '先不要' });
      if (!ok) return;
      character = importCharacter(data);
      try { localStorage.removeItem(BACKUP_KEY); localStorage.setItem(GM_BLANK_KEY, getRoomStatus().me?.uid ?? '1'); } catch { /* 忽略 */ }
      await sync.forceUpload();
      vitals.changed();
      views[currentView]?.render();
      toast(`已還原角色「${character.name}」。`);
    } finally { restoring = false; }
  }
  subscribeRoom(() => { offerRestore().then(gmBlankCheck); });
  offerRestore().then(gmBlankCheck);

  let currentView = 'map';
  function showView() {
    const raw = (location.hash || '#map').slice(1);
    const id = raw === 'battle' ? 'session' : raw; // 戰鬥頁已改成跑團頁裡的戰鬥面板（舊連結導到跑團頁）
    const previous = currentView;
    currentView = ['map', 'rest', 'bag', 'gear', 'session', 'market', 'logs'].includes(id) ? id : 'map';
    if (previous !== currentView) views[previous]?.leave?.(); // 離開的頁面可以停掉背景更新（跑團頁的紀錄）
    document.querySelectorAll('[data-view]').forEach((el) => {
      el.hidden = el.dataset.view !== currentView;
    });
    document.querySelectorAll('[data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === currentView) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    moreBtn.toggleAttribute('data-active', ['gear', 'market', 'logs'].includes(currentView)); // 裝備、交易、日誌收在「更多」裡，手機版讓「更多」亮起
    if (currentView === 'map') map.reset(false);
    else views[currentView].render();
    applyWait();
  }
  // 登入後伺服器沒有角色、這台裝置也只有示範角色：非地圖頁改顯示「等 GM 匯入」（GM 自己不擋，要用 GM 工具）
  const waitView = $('#view-wait');
  mountWaitNotice(waitView, {
    onCreate: (name) => { // 新玩家自己建立空白角色：存本機、解除等待、上傳伺服器
      character = importCharacter({ ...blankCharacter(name), statMode: 'skills' });
      sync.release();
      vitals.changed();
      toast(`已建立角色「${name}」。`);
      showView();
    },
  });
  function applyWait() {
    const status = getRoomStatus();
    const wait = currentView !== 'map' && currentView !== 'logs' && Boolean(sync?.isWaiting()) && status.phase === 'online' && !status.me?.isGm;
    waitView.hidden = !wait;
    const el = document.querySelector(`[data-view="${currentView}"]`);
    if (el && wait) el.hidden = true;
    if (el && !wait) el.hidden = false;
  }
  sync.onWaitingChange(() => showView());
  let lastSpecial;
  let lastSkills = getRoomStatus().skills;
  subscribeRoom(() => {
    applyWait();
    const status = getRoomStatus();
    if (status.phase === 'online' && status.skills !== lastSkills) { // GM 新增／修改了專屬技能：換成最新的、快取起來並重畫目前頁面（離線時沿用快取）
      lastSkills = status.skills;
      setCustomSkills(status.skills);
      saveCachedCustomSkills(status.skills);
      if (currentView !== 'map') views[currentView]?.render();
    }
    const special = status.phase === 'online' ? status.special : null;
    if (special !== lastSpecial) { // GM 新增／修改了特殊配方或材料（或離開房間）：換成最新的資料並重畫修整日
      lastSpecial = special;
      setCustomSpecial(special);
      if (currentView === 'rest') views.rest.render();
    }
  });
  // 手機底部導覽列的「更多」選單
  const moreBtn = $('#more-toggle');
  const moreMenu = $('#more-menu');
  const setMore = (open) => { moreMenu.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); };
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setMore(moreMenu.hidden); });
  moreMenu.addEventListener('click', (e) => {
    const target = e.target.closest('[data-more-click]');
    setMore(false);
    if (target) $(`#${target.dataset.moreClick}`).click();
  });
  document.addEventListener('click', (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) setMore(false); });

  window.addEventListener('hashchange', () => { setMore(false); showView(); });
  showView();
  // 登入：封面先出現，不等網路；查到已登入才更新畫面。任何失敗都維持單機試玩。
  const chip = createUserChip(() => stopRoom());
  const cover = showCover({ notice: consumeLoginResult(), onUserChange: () => { chip.set(null); stopRoom(); } });
  getCurrentUser().then((user) => {
    if (!user) return;
    cover.setUser(user);
    chip.set(user);
    startRoom(); // 已登入：自動加入固定團房間（不在白名單或連不上就維持本機模式，並顯示原因）
  });
}

init();

// PWA：只在正式版註冊 Service Worker（開發時不註冊，避免快取讓畫面不更新）。失敗就當沒有，網站照常運作
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
