// ============================================================
// 世界觀資料存取層
// 現在：讀本機假資料（src/data/）
// 之後：改成 fetch('/api/lore/...') 向 Cloudflare Worker 要資料
//
// 重要：「未揭露」的內容必須在這一層就被拿掉，不能只在畫面上藏起來。
// 之後換成 Worker 時，這段過濾邏輯會搬到伺服器端，玩家按 F12 也看不到。
// 介面（函式名稱與回傳格式）請保持不變，UI 端就不用改。
// ============================================================
import { REGIONS } from '../data/regions.js';
import { LOCATIONS } from '../data/locations.js';

const PUBLIC_FIELDS = ['id', 'name', 'region', 'x', 'y', 'w', 'h'];

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

/** 取得所有區域 */
export async function getRegions() {
  return REGIONS;
}

/**
 * 取得地圖上所有地點的「公開摘要」
 * 回傳只含位置與名稱，以及 locked（是否尚未揭露）
 * 地名本來就印在地圖上，所以名稱可以公開；內容不行。
 */
export async function getMapLocations() {
  return LOCATIONS
    .filter((l) => l.status !== 'draft') // 草稿完全不出現
    .map((l) => ({ ...pick(l, PUBLIC_FIELDS), locked: l.status !== 'revealed' }));
}

/**
 * 取得單一地點的詳細內容
 * 未揭露的地點只回傳公開摘要，不含任何劇情文字與圖片。
 */
export async function getLocationDetail(id) {
  const l = LOCATIONS.find((x) => x.id === id);
  if (!l || l.status === 'draft') return null;
  if (l.status !== 'revealed') {
    return { ...pick(l, PUBLIC_FIELDS), locked: true };
  }
  return { ...l, locked: false };
}
