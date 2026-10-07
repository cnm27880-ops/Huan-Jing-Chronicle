// wrangler 的進入點：Worker 本體 + Durable Object 類別。
// 另外拆出 index.js（只有路由、不 import cloudflare:workers），測試才能在 Node 裡直接載入。
export { default } from './index.js';
export { Room } from './room.js';
