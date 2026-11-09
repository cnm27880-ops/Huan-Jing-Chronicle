// wrangler 的進入點：Worker 本體 + Durable Object 類別。
// 另外拆出 index.js（只有路由、不 import cloudflare:workers），測試才能在 Node 裡直接載入。
import worker from './index.js';
import { runBackupWithRetry } from './backup.js';

export default {
  fetch: worker.fetch,
  // 定時觸發（wrangler.jsonc 的 triggers.crons）：每日備份到 R2
  async scheduled(event, env, ctx) {
    // 失敗會記 log、重試一次、仍失敗就通知（見 backup.js 的 runBackupWithRetry）
    ctx.waitUntil(runBackupWithRetry(env).then((done) => { if (done) console.log('backup ok', JSON.stringify(done)); }));
  },
};
export { Room } from './room.js';
