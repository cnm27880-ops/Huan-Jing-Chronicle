// ============================================================
// 原型階段的存檔：只存在這台裝置的瀏覽器（localStorage）
// 之後接上 Cloudflare 時，只要改這個檔案，其他程式不用動
// ============================================================
import { SAMPLE_CHARACTER } from '../data/sample/fude.js';

const KEY = 'huanjing:character:v1';
const clone = (o) => JSON.parse(JSON.stringify(o));

export function loadCharacter() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 讀不到就用示範資料 */
  }
  return clone(SAMPLE_CHARACTER);
}

export function saveCharacter(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 儲存失敗時不中斷遊戲 */
  }
}

export function resetCharacter() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  return clone(SAMPLE_CHARACTER);
}
