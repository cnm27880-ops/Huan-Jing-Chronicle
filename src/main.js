// ============================================================
// 進入點：把資料層和各個 UI 模組接起來
// ============================================================
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
import { showCover } from './ui/cover.js';
import { createUserChip } from './ui/userChip.js';
import { getCurrentUser, consumeLoginResult } from './api/auth.js';
import { startRoom, stopRoom } from './state/rollLog.js';
import { loadCharacter, saveCharacter, resetCharacter, hasSavedCharacter, importCharacter } from './state/store.js';
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
  let character = loadCharacter();
  const getState = () => character;
  let views;
  let sync = null;
  const commit = () => {
    saveCharacter(character);
    sync?.markDirty(); // 已連上房間時，稍後同步到伺服器
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
  };
  sync = createCharSync({
    getState,
    hasLocalSave: hasSavedCharacter,
    notify: toast,
    adopt: (data) => { // 伺服器的存檔套用到畫面（不經過 commit，免得又上傳一次）
      character = importCharacter(data);
      views[currentView]?.render();
    },
  });

  createMailbox({ getState, commit }); // 別人送的東西、餵的藥：領取後直接放進自己的角色

  let currentView = 'map';
  function showView() {
    const raw = (location.hash || '#map').slice(1);
    const id = raw === 'battle' ? 'session' : raw; // 戰鬥頁已改成跑團頁裡的戰鬥面板（舊連結導到跑團頁）
    const previous = currentView;
    currentView = ['map', 'rest', 'bag', 'gear', 'session', 'market'].includes(id) ? id : 'map';
    if (previous !== currentView) views[previous]?.leave?.(); // 離開的頁面可以停掉背景更新（跑團頁的紀錄）
    document.querySelectorAll('[data-view]').forEach((el) => {
      el.hidden = el.dataset.view !== currentView;
    });
    document.querySelectorAll('[data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === currentView) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    moreBtn.toggleAttribute('data-active', currentView === 'gear' || currentView === 'market'); // 裝備、交易收在「更多」裡，手機版讓「更多」亮起
    if (currentView === 'map') map.reset(false);
    else views[currentView].render();
  }
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
