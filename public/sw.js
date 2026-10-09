// ============================================================
// Service Worker（PWA 第 2 層：只加快載入，不做離線）
// 只快取「同網域、檔名帶雜湊、內容不會變」的靜態檔：/assets/*（程式與樣式）、/icons/*、/img/*。
// 其他一律不碰、直接走網路：網頁本身（HTML）、設定集與地圖資料、登入／存檔／房間的 API
// （API 在另一個網域 huan-jing-api.*，這裡本來就攔不到）、WebSocket。
// 所以不會出現「登出了畫面還是舊的」或存檔版本衝突；網頁永遠拿最新的，沒網路就和沒裝一樣打不開。
// 改版後要讓舊快取失效：把 CACHE 的版本號 +1。
// ============================================================
const CACHE = 'huanjing-static-v3';
const PREFIXES = ['/assets/', '/icons/', '/img/'];

/** 要不要由 Service Worker 快取這個請求 */
function cacheable(request, origin) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === origin && PREFIXES.some((p) => url.pathname.startsWith(p));
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!cacheable(request, self.location.origin)) return; // 不呼叫 respondWith ＝ 照一般方式走網路
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok && res.type === 'basic') cache.put(request, res.clone());
      return res;
    }),
  );
});
