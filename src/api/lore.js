// ============================================================
// 世界觀資料存取層
// 現在：位置讀 public/map-data/markers.json，內容讀本機假資料（src/data/）
// 之後：改成 fetch('/api/lore/...') 向 Cloudflare Worker 要資料
//
// 重要：「未揭露」的內容必須在這一層就被拿掉，不能只在畫面上藏起來。
// 之後換成 Worker 時，這段過濾邏輯會搬到伺服器端，玩家按 F12 也看不到。
// 介面（函式名稱與回傳格式）請保持不變，UI 端就不用改。
// ============================================================
import { REGIONS } from '../data/regions.js';
import { LOCATIONS } from '../data/locations.js';

const MARKERS_URL = './map-data/markers.json'; // 相對路徑，GitHub Pages 子路徑才不會壞
const PUBLIC_FIELDS = ['id', 'name', 'region', 'x', 'y', 'w', 'h', 'type'];

let markersPromise = null;

function loadMarkers() {
  markersPromise ??= fetch(MARKERS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`markers.json 讀取失敗（${res.status}）`);
      return res.json();
    })
    .then((data) => data.markers ?? []);
  return markersPromise;
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

/** 位置資料（markers.json）加上揭露狀態（locations.js）；草稿完全不出現 */
async function loadPublicMarkers() {
  const markers = await loadMarkers();
  const statusById = new Map(LOCATIONS.map((l) => [l.id, l.status]));
  return markers
    .filter((m) => statusById.has(m.id) && statusById.get(m.id) !== 'draft')
    .map((m) => ({ marker: m, revealed: statusById.get(m.id) === 'revealed' }));
}

/** 取得所有區域 */
export async function getRegions() {
  return REGIONS;
}

/**
 * 取得地圖上所有地點的「公開摘要」
 * 回傳位置、名稱、類型，以及 locked（是否尚未揭露）。
 * 已揭露的才附上 summary 與 loreId；未揭露的一律不帶。
 * 地名本來就印在地圖上，所以名稱可以公開；內容不行。
 */
export async function getMapLocations() {
  const items = await loadPublicMarkers();
  return items.map(({ marker, revealed }) => ({
    ...pick(marker, PUBLIC_FIELDS),
    locked: !revealed,
    ...(revealed ? { summary: marker.summary ?? '', loreId: marker.loreId ?? null } : {}),
  }));
}

/**
 * 取得單一地點的詳細內容
 * 未揭露的地點只回傳公開摘要，不含任何劇情文字與圖片。
 */
export async function getLocationDetail(id) {
  const items = await loadPublicMarkers();
  const found = items.find((i) => i.marker.id === id);
  if (!found) return null;
  const pub = pick(found.marker, PUBLIC_FIELDS);
  if (!found.revealed) return { ...pub, locked: true };
  const content = LOCATIONS.find((x) => x.id === id);
  return { ...content, ...pub, locked: false };
}
