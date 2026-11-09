// 執行方式：在專案根目錄 npm test
// H6：登出與撤銷讓舊 session 立即失效（session 版本號，存在房間的 Durable Object；這裡用 RoomCore＋node:sqlite 模擬）
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { signToken } from '../src/crypto.js';
import { RoomCore } from '../src/room-core.js';

const SITE = 'https://huan-jing.yuci8660.uk';
const API = 'https://huan-jing-api.yuci8660.uk';
const baseEnv = {
  SITE_ORIGIN: SITE, DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', DISCORD_REDIRECT_URI: `${API}/auth/callback`,
  SESSION_SECRET: 'secret', DISCORD_ALLOWED_IDS: '100,300,400', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '',
};

/** 假的房間命名空間：版本號放在真的 RoomCore（和正式環境同一份邏輯） */
function makeRoom() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { exec: (q, ...p) => sqlite.prepare(q).all(...p), tx: (fn) => fn() };
  const core = new RoomCore({ db, env: baseEnv });
  core.migrate();
  const ns = {
    idFromName: (n) => n,
    get: () => ({
      fetch: async (req) => {
        const m = /^\/sv\/(\d+)(\/bump)?$/.exec(new URL(req.url).pathname);
        if (!m) return new Response('x');
        return Response.json({ v: m[2] ? core.bumpSession(m[1]) : core.sessionVersion(m[1]) });
      },
    }),
  };
  return { core, env: { ...baseEnv, ROOM: ns } };
}
const tokenFor = async (uid, extra = {}) => signToken({ uid, name: 'x', avatar: null, iat: Date.now(), exp: Date.now() + 1e7, ...extra }, baseEnv.SESSION_SECRET);
const call = (env, path, { token, method = 'GET', body } = {}) => worker.fetch(new Request(API + path, {
  method, headers: { Origin: SITE, ...(token ? { Cookie: `hj_session=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
}), env);
const meUser = async (env, token) => (await (await call(env, '/auth/me', { token })).json()).user;

test('登出後，舊 token（包含被偷走的複本）立即失效；別人不受影響', async () => {
  const { env } = makeRoom();
  const mine = await tokenFor('300');
  const stolen = mine; // 同一個 token 的複本
  const other = await tokenFor('400');
  assert.equal((await meUser(env, mine)).id, '300');
  const out = await call(env, '/auth/logout', { token: mine, method: 'POST' });
  assert.equal(out.status, 200);
  assert.equal(await meUser(env, stolen), null);
  assert.equal((await meUser(env, other)).id, '400');
  assert.equal((await (await call(env, '/rooms/main/access', { token: stolen })).json()).state, 'unauthenticated');
});

test('上線前簽發的舊 token（沒有 sv 欄位）仍然有效；撤銷後失效', async () => {
  const { env, core } = makeRoom();
  const legacy = await tokenFor('300');
  assert.equal((await meUser(env, legacy)).id, '300');
  core.bumpSession('300');
  assert.equal(await meUser(env, legacy), null);
  // 版本號對得上的新 token 可用
  const fresh = await tokenFor('300', { sv: 1 });
  assert.equal((await meUser(env, fresh)).id, '300');
});

test('續期換發的新 token 保留版本號', async () => {
  const { env, core } = makeRoom();
  core.bumpSession('300'); // 版本 1
  const near = await tokenFor('300', { sv: 1, exp: Date.now() + 2 * 24 * 3600 * 1000 });
  const res = await call(env, '/auth/me', { token: near });
  const setCookie = res.headers.getSetCookie()[0];
  assert.ok(setCookie, '剩 2 天要換發');
  const renewed = setCookie.split(';')[0].slice('hj_session='.length);
  assert.equal((await meUser(env, renewed)).id, '300'); // 換發後版本號仍是 1，還能用
});

test('撤銷：GM 可以撤銷別人的 session；一般玩家不行；格式錯誤擋下', async () => {
  const { env } = makeRoom();
  const victim = await tokenFor('300');
  const gm = await tokenFor('100');
  const player = await tokenFor('400');
  assert.equal((await call(env, '/auth/revoke', { token: player, method: 'POST', body: { uid: '300' } })).status, 403);
  assert.equal((await meUser(env, victim)).id, '300');
  assert.equal((await call(env, '/auth/revoke', { token: gm, method: 'POST', body: { uid: 'abc' } })).status, 400);
  assert.equal((await call(env, '/auth/revoke', { token: gm, method: 'POST', body: { uid: '300' } })).status, 200);
  assert.equal(await meUser(env, victim), null);
  assert.equal((await meUser(env, gm)).id, '100'); // GM 自己不受影響
  assert.equal((await call(env, '/auth/revoke', { method: 'POST', body: { uid: '300' } })).status, 401); // 沒登入
});

test('查不到版本號時寧可擋人（不放行可能已撤銷的 token）', async () => {
  const broken = { ...baseEnv, ROOM: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('x', { status: 500 }) }) } };
  assert.equal(await meUser(broken, await tokenFor('300')), null);
});

test('白名單短期止血仍有效：移出名單後立即失效', async () => {
  const { env } = makeRoom();
  const t = await tokenFor('300');
  assert.equal((await meUser(env, t)).id, '300');
  assert.equal(await meUser({ ...env, DISCORD_ALLOWED_IDS: '100' }, t), null);
});

test('RoomCore：版本號預設 0，每次撤銷 +1，各人分開', () => {
  const { core } = makeRoom();
  assert.equal(core.sessionVersion('300'), 0);
  assert.equal(core.bumpSession('300'), 1);
  assert.equal(core.bumpSession('300'), 2);
  assert.equal(core.sessionVersion('400'), 0);
});
