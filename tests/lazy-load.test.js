// 動態載入的共用工具（src/ui/lazyLoad.js）：失敗時的說明、要不要自動重新整理、載入結果的檢查
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkErrorText, shouldAutoReload, loadModule, RELOAD_COOLDOWN_MS } from '../src/ui/lazyLoad.js';

test('載入失敗的說明：離線和一般失敗要分開講', () => {
  assert.match(chunkErrorText(false), /離線/);
  assert.doesNotMatch(chunkErrorText(true), /離線/);
  assert.match(chunkErrorText(true), /重新整理/);
});

test('自動重新整理：要有網路，而且 30 秒內沒有自動重新整理過（避免離線時變成空白頁、或卡成無限重新整理）', () => {
  const now = 1_000_000;
  assert.equal(shouldAutoReload({ now, last: 0, online: true }), true);
  assert.equal(shouldAutoReload({ now, last: now - 1000, online: true }), false); // 剛重新整理過還是載不到：真的有問題，別再試
  assert.equal(shouldAutoReload({ now, last: now - RELOAD_COOLDOWN_MS - 1, online: true }), true);
  assert.equal(shouldAutoReload({ now, last: 0, online: false }), false); // 離線時重新整理會變成瀏覽器的錯誤頁
});

test('loadModule：成功回傳模組；失敗或得到 undefined（vite:preloadError 被攔下時）都丟錯誤', async () => {
  const mod = { open() {} };
  assert.equal(await loadModule(async () => mod), mod);
  await assert.rejects(loadModule(async () => undefined), /chunk-load-failed/);
  await assert.rejects(loadModule(async () => { throw new TypeError('Failed to fetch dynamically imported module'); }), /Failed to fetch/);
});
