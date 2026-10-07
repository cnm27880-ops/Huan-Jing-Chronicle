// ============================================================
// 世界地圖檢視：拖曳平移、滾輪／雙指縮放、可點擊的地點熱點
// ============================================================

const MAP_W = 1280;
const MAP_H = 714;
const MAX_ZOOM = 2; // 相對於「剛好塞滿畫面」的倍數（原圖僅 1884 像素，再放大只會變糊）
const DRAG_THRESHOLD = 6; // 移動超過幾像素就算拖曳，不算點擊

export function createMapView({ viewport, stage, hotspotLayer, onSelect }) {
  const state = { scale: 1, x: 0, y: 0, fit: 1 };
  const pointers = new Map();
  let dragged = false;
  let pinchStart = null;
  let panStart = null;

  stage.style.width = `${MAP_W}px`;
  stage.style.height = `${MAP_H}px`;

  // ---------- 座標與邊界 ----------
  function clamp() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const w = MAP_W * state.scale;
    const h = MAP_H * state.scale;
    state.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, state.x));
    state.y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, state.y));
  }

  function apply(animate = false) {
    clamp();
    stage.classList.toggle('is-animating', animate);
    stage.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    viewport.dataset.zoomed = state.scale > state.fit * 1.05 ? 'true' : 'false';
  }

  function computeFit() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    // 手機直立時改用「塞滿高度」，不然地圖會變成一條細線
    const contain = Math.min(vw / MAP_W, vh / MAP_H);
    const cover = Math.max(vw / MAP_W, vh / MAP_H);
    state.fit = vw < 640 ? Math.min(cover, contain * 2.6) : contain;
  }

  function zoomAt(newScale, cx, cy, animate = false) {
    const s = Math.min(state.fit * MAX_ZOOM, Math.max(state.fit, newScale));
    // 讓游標（或雙指中心）下的那個點保持不動
    state.x = cx - ((cx - state.x) * s) / state.scale;
    state.y = cy - ((cy - state.y) * s) / state.scale;
    state.scale = s;
    apply(animate);
  }

  function reset(animate = true) {
    computeFit();
    state.scale = state.fit;
    state.x = (viewport.clientWidth - MAP_W * state.scale) / 2;
    state.y = (viewport.clientHeight - MAP_H * state.scale) / 2;
    apply(animate);
  }

  /** 把地圖移到某個地點（百分比座標）並適度放大 */
  function focusOn(xPct, yPct) {
    const target = Math.max(state.scale, state.fit * 2);
    state.scale = Math.min(target, state.fit * MAX_ZOOM);
    // 情報面板會蓋住一部分地圖：桌機在右側、手機在下方，所以把地點移到沒被蓋住的區域中央
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const isSheet = vw < 640;
    const cx = isSheet ? vw / 2 : (vw - Math.min(460, vw)) / 2;
    const cy = isSheet ? vh * 0.12 : vh / 2;
    state.x = cx - (xPct / 100) * MAP_W * state.scale;
    state.y = cy - (yPct / 100) * MAP_H * state.scale;
    apply(true);
  }

  // ---------- 滑鼠滾輪 ----------
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(state.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false }
  );

  // ---------- 拖曳與雙指縮放 ----------
  // 注意：不使用 setPointerCapture，否則熱點按鈕會收不到 click
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    if (pointers.size === 1) {
      panStart = { px: e.clientX, py: e.clientY, x: state.x, y: state.y };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: state.scale };
      panStart = null;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const rect = viewport.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      dragged = true;
      zoomAt(
        pinchStart.scale * (dist / pinchStart.dist),
        (a.x + b.x) / 2 - rect.left,
        (a.y + b.y) / 2 - rect.top
      );
    } else if (pointers.size === 1 && panStart) {
      const dx = e.clientX - panStart.px;
      const dy = e.clientY - panStart.py;
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragged = true;
      viewport.classList.add('is-dragging');
      state.x = panStart.x + dx;
      state.y = panStart.y + dy;
      apply();
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) {
      panStart = null;
      viewport.classList.remove('is-dragging');
    }
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // 拖曳結束時吃掉那一次 click，避免誤開地點
  viewport.addEventListener(
    'click',
    (e) => {
      if (dragged) {
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
      }
    },
    true
  );

  // 只有寬度改變（轉向、拉視窗）才重新置中。手機捲動時網址列伸縮只改高度，不能把玩家放大的地圖重設；
  // 地圖頁沒顯示時寬度是 0，也不處理（切回地圖時 main.js 會重設）
  let lastWidth = viewport.clientWidth;
  window.addEventListener('resize', () => {
    const w = viewport.clientWidth;
    if (!w || w === lastWidth) return;
    lastWidth = w;
    reset(false);
  });

  // ---------- 熱點 ----------
  function renderHotspots(locations, regionsById) {
    hotspotLayer.replaceChildren(
      ...locations.map((l) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hotspot';
        btn.dataset.id = l.id;
        btn.dataset.region = l.region;
        btn.dataset.locked = String(l.locked);
        btn.style.left = `${l.x - l.w / 2}%`;
        btn.style.top = `${l.y - l.h / 2}%`;
        btn.style.width = `${l.w}%`;
        btn.style.height = `${l.h}%`;
        const regionName = regionsById[l.region]?.name ?? '';
        btn.setAttribute(
          'aria-label',
          `${l.name}（${regionName}）${l.locked ? '，情報尚未公開' : ''}`
        );
        btn.addEventListener('click', () => onSelect(l.id));
        return btn;
      })
    );
  }

  function setActive(id) {
    hotspotLayer.querySelectorAll('.hotspot').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.id === id);
    });
  }

  return {
    reset,
    focusOn,
    renderHotspots,
    setActive,
    zoomIn: () => zoomAt(state.scale * 1.4, viewport.clientWidth / 2, viewport.clientHeight / 2, true),
    zoomOut: () => zoomAt(state.scale / 1.4, viewport.clientWidth / 2, viewport.clientHeight / 2, true),
  };
}
