// ============================================================
// 世界地圖檢視（操作比照 Google 地圖）：
//   手機：單指拖曳、雙指捏合縮放＋同時移動、點兩下放大；電腦：拖曳、滾輪／觸控板縮放、點兩下放大
//   最小可以縮到看見整張地圖，最大放大到原圖解析度附近
// ============================================================

const MAP_W = 1280;
const MAP_H = 714;
const MAX_SCALE = 2.2; // 原圖寬 1884 像素（= 1.47 倍），再大一點還看得清楚，更大只會糊
const DRAG_THRESHOLD = 6; // 移動超過幾像素就算拖曳，不算點擊
const DOUBLE_TAP_MS = 300;

export function createMapView({ viewport, stage, hotspotLayer, onSelect }) {
  // fit：剛進地圖的倍率（手機塞滿高度、電腦塞滿畫面）；min：最小倍率（看得見整張地圖）
  const state = { scale: 1, x: 0, y: 0, fit: 1, min: 1 };
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
    state.min = contain; // 可以一直縮到整張地圖都看得到
  }

  const maxScale = () => Math.max(MAX_SCALE, state.fit * 2);
  const clampScale = (s) => Math.min(maxScale(), Math.max(state.min, s));

  function zoomAt(newScale, cx, cy, animate = false) {
    const s = clampScale(newScale);
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
    state.scale = clampScale(Math.max(state.scale, state.fit * 2));
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

  // ---------- 拖曳、雙指縮放、點兩下放大 ----------
  // 注意：不使用 setPointerCapture，否則熱點按鈕會收不到 click
  const localPoint = (x, y) => { const r = viewport.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };

  /** 依目前手指重新設定起點：手指數改變（例如雙指放開一指）時不會跳動 */
  function restartGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      panStart = { px: pts[0].x, py: pts[0].y, x: state.x, y: state.y };
      pinchStart = null;
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: state.scale, mid, x: state.x, y: state.y };
      panStart = null;
    } else {
      panStart = null;
      pinchStart = null;
    }
  }

  let lastTap = { t: 0, x: 0, y: 0 };
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) dragged = false;
    restartGesture();
  });

  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2 && pinchStart) {
      // 捏合：倍率跟著兩指距離，地圖上「起始兩指中心」那一點跟著目前兩指中心走（縮放＋移動一起）
      const [a, b] = [...pointers.values()];
      const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = clampScale(pinchStart.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.dist));
      state.x = mid.x - ((pinchStart.mid.x - pinchStart.x) * s) / pinchStart.scale;
      state.y = mid.y - ((pinchStart.mid.y - pinchStart.y) * s) / pinchStart.scale;
      state.scale = s;
      dragged = true;
      viewport.classList.add('is-dragging');
      apply();
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
    restartGesture();
    if (pointers.size === 0) viewport.classList.remove('is-dragging');
    // 點兩下（沒有拖曳、不是點在地名上）：以該點為中心放大；已經很大就縮回剛進來的大小
    if (e.type === 'pointerup' && pointers.size === 0 && !dragged && !e.target.closest?.('.hotspot')) {
      const now = performance.now();
      if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        const p = localPoint(e.clientX, e.clientY);
        if (state.scale >= maxScale() * 0.95) reset(true);
        else zoomAt(state.scale * 2, p.x, p.y, true);
        lastTap = { t: 0, x: 0, y: 0 };
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
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
  };
}
