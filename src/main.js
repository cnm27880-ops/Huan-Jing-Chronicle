// ============================================================
// 進入點：把資料層和各個 UI 模組接起來
// ============================================================
import './styles/tokens.css';
import './styles/layout.css';
import './styles/map.css';
import './styles/dossier.css';
import './styles/pages.css';

import { getRegions, getMapLocations, getLocationDetail } from './api/lore.js';
import { createMapView } from './ui/mapView.js';
import { createDossier } from './ui/dossier.js';
import { createIndexList } from './ui/indexList.js';
import { createRestView } from './ui/restView.js';
import { createBagView } from './ui/bagView.js';
import { loadCharacter, saveCharacter, resetCharacter } from './state/store.js';

const $ = (sel) => document.querySelector(sel);

async function init() {
  const [regions, locations] = await Promise.all([getRegions(), getMapLocations()]);
  const regionsById = Object.fromEntries(regions.map((r) => [r.id, r]));
  const indexPanel = $('#index-panel');
  const indexToggle = $('#index-toggle');

  const map = createMapView({
    viewport: $('#map-viewport'),
    stage: $('#map-stage'),
    hotspotLayer: $('#map-hotspots'),
    onSelect: (id) => openLocation(id, { fly: false }),
  });

  const dossier = createDossier({
    panel: $('#dossier'),
    onClose: () => map.setActive(null),
  });

  const index = createIndexList({
    container: $('#index-list'),
    onSelect: (id) => {
      setIndexOpen(false);
      openLocation(id, { fly: true });
    },
    onRegionHover: (rid) => map.highlightRegion(rid),
  });

  async function openLocation(id, { fly }) {
    const detail = await getLocationDetail(id);
    if (!detail) return;
    map.setActive(id);
    if (fly) map.focusOn(detail.x, detail.y);
    dossier.open(detail, regionsById[detail.region]);
  }

  function setIndexOpen(open) {
    indexPanel.dataset.open = String(open);
    indexToggle.setAttribute('aria-expanded', String(open));
  }

  indexToggle.addEventListener('click', () => {
    setIndexOpen(indexPanel.dataset.open !== 'true');
  });

  $('#zoom-in').addEventListener('click', () => map.zoomIn());
  $('#zoom-out').addEventListener('click', () => map.zoomOut());
  $('#zoom-reset').addEventListener('click', () => map.reset());

  map.renderHotspots(locations, regionsById);
  index.render(regions, locations);

  const mapImg = $('#map-image');
  if (mapImg.complete) map.reset(false);
  else mapImg.addEventListener('load', () => map.reset(false), { once: true });

  // ---------- 角色資料與分頁 ----------
  let character = loadCharacter();
  const getState = () => character;
  let views;
  const commit = () => {
    saveCharacter(character);
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
  };

  let currentView = 'map';
  function showView() {
    const id = (location.hash || '#map').slice(1);
    currentView = ['map', 'rest', 'bag'].includes(id) ? id : 'map';
    document.querySelectorAll('[data-view]').forEach((el) => {
      el.hidden = el.dataset.view !== currentView;
    });
    document.querySelectorAll('[data-view-link]').forEach((a) => {
      if (a.dataset.viewLink === currentView) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    indexToggle.hidden = currentView !== 'map';
    if (currentView === 'map') map.reset(false);
    else views[currentView].render();
  }
  window.addEventListener('hashchange', showView);
  showView();
}

init();
