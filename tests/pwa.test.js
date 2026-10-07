// PWA：manifest 欄位、圖示尺寸、index.html 連結、Service Worker 只快取該快取的
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const manifest = JSON.parse(read('public/manifest.webmanifest'));

/** 讀 PNG 檔頭的寬高 */
const pngSize = (p) => { const b = read(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest：名稱、獨立視窗、相對路徑、192／512／maskable 圖示都存在且尺寸正確', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.name && manifest.short_name);
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), '圖示路徑要用相對路徑（專案規則 6）');
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(`public/${icon.src}`), [w, h]);
  }
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.deepEqual(pngSize('public/icons/apple-touch-icon.png'), [180, 180]);
});

test('index.html：有 manifest、apple-touch-icon 連結', () => {
  const html = read('index.html').toString();
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
});

/** 在假的 Service Worker 環境裡載入 sw.js，取出它註冊的事件處理函式 */
function loadSw() {
  const handlers = {};
  const self = { location: { origin: 'https://huan-jing.example' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL, caches: { open: () => new Promise(() => {}) } });
  return handlers;
}
const req = (url, method = 'GET') => ({ url, method });
const intercepts = (handlers, request) => {
  let responded = false;
  handlers.fetch({ request, respondWith: () => { responded = true; } });
  return responded;
};

test('Service Worker：只攔同網域的 /assets、/icons、/img 的 GET；網頁、API、設定集資料、POST 都不碰', () => {
  const sw = loadSw();
  const o = 'https://huan-jing.example';
  assert.equal(intercepts(sw, req(`${o}/assets/index-abc123.js`)), true);
  assert.equal(intercepts(sw, req(`${o}/icons/icon-192.png`)), true);
  assert.equal(intercepts(sw, req(`${o}/img/maps/world.webp`)), true);
  assert.equal(intercepts(sw, req(`${o}/`)), false); // HTML 永遠走網路
  assert.equal(intercepts(sw, req(`${o}/index.html`)), false);
  assert.equal(intercepts(sw, req(`${o}/lore-data/xx.json`)), false);
  assert.equal(intercepts(sw, req(`${o}/map-data/markers.json`)), false);
  assert.equal(intercepts(sw, req(`${o}/assets/x.js`, 'POST')), false);
  assert.equal(intercepts(sw, req('https://huan-jing-api.yuci8660.uk/api/me')), false); // 另一個網域（API）
  assert.equal(intercepts(sw, req('https://fonts.gstatic.com/assets/font.woff2')), false); // 外部網域的 /assets/ 也不碰
});
