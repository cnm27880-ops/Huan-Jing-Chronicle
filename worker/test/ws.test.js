// 執行方式：在專案根目錄 npm test
// 房間的對外入口：/rooms/main/access 與 /rooms/main/ws（登入、白名單、Origin、標頭防偽造）
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { signToken } from '../src/crypto.js';

const SITE = 'https://huan-jing.yuci8660.uk';
const API = 'https://huan-jing-api.yuci8660.uk';
const baseEnv = {
  SITE_ORIGIN: SITE, DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', DISCORD_REDIRECT_URI: `${API}/auth/callback`,
  SESSION_SECRET: 'secret', DISCORD_ALLOWED_IDS: '100,300', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '',
};

/** 假的 Durable Object：記下收到的請求，回 101 的樣子（Node 沒有 WebSocketPair，用 200 代替） */
function fakeRoom() {
  const seen = { names: [], requests: [] };
  return {
    seen,
    ns: {
      idFromName: (n) => { seen.names.push(n); return n; },
      get: () => ({ fetch: async (req) => { seen.requests.push(req); return new Response('upgraded', { status: 200 }); } }),
    },
  };
}
const cookie = async (uid = '300', { exp = Date.now() + 1e6, name = '玩家' } = {}) =>
  `hj_session=${await signToken({ uid, name, avatar: null, iat: Date.now(), exp }, baseEnv.SESSION_SECRET)}`;
const ws = (path, { headers = {}, env = baseEnv, method = 'GET' } = {}) =>
  worker.fetch(new Request(API + path, { method, headers: { Upgrade: 'websocket', Origin: SITE, ...headers } }), env);

test('/rooms/main/access：未登入、不在白名單、白名單為空、通過，各有明確原因', async () => {
  const get = async (headers, env = baseEnv) => (await worker.fetch(new Request(`${API}/rooms/main/access`, { headers: { Origin: SITE, ...headers } }), env)).json();
  assert.deepEqual(await get({}), { state: 'unauthenticated' });
  assert.equal((await get({ Cookie: await cookie('999') })).state, 'not_allowed');
  assert.equal((await get({ Cookie: await cookie('300') }, { ...baseEnv, DISCORD_ALLOWED_IDS: '' })).state, 'whitelist_empty');
  const ok = await get({ Cookie: await cookie('300', { name: '福德' }) });
  assert.equal(ok.state, 'ok');
  assert.equal(ok.user.name, '福德');
  const res = await worker.fetch(new Request(`${API}/rooms/main/access`, { headers: { Origin: SITE } }), baseEnv);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE); // 前端要能讀到（帶 credentials 的 CORS）
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.equal((await worker.fetch(new Request(`${API}/rooms/other/access`), baseEnv)).status, 404);
  assert.equal((await worker.fetch(new Request(`${API}/rooms/main/access`, { method: 'POST' }), baseEnv)).status, 405);
});

test('WebSocket：登入且在白名單內才會轉給房間，並帶上伺服器驗證過的身分', async () => {
  const room = fakeRoom();
  const res = await ws('/rooms/main/ws', { headers: { Cookie: await cookie('300', { name: '福德 Fude' }) }, env: { ...baseEnv, ROOM: room.ns } });
  assert.equal(res.status, 200);
  assert.deepEqual(room.seen.names, ['main']);
  const h = room.seen.requests[0].headers;
  assert.equal(h.get('X-HJ-Uid'), '300');
  assert.equal(decodeURIComponent(h.get('X-HJ-Name')), '福德 Fude');
  assert.equal(h.get('X-HJ-Room'), 'main');
  assert.ok(Number(h.get('X-HJ-Exp')) > Date.now());
});

test('WebSocket：瀏覽器自己帶的 x-hj-* 標頭不會被採信（防冒充）', async () => {
  const room = fakeRoom();
  await ws('/rooms/main/ws', {
    headers: { Cookie: await cookie('300'), 'X-HJ-Uid': '100', 'x-hj-exp': '99999999999999', 'X-HJ-Evil': '1' },
    env: { ...baseEnv, ROOM: room.ns },
  });
  const h = room.seen.requests[0].headers;
  assert.equal(h.get('X-HJ-Uid'), '300');
  assert.notEqual(h.get('X-HJ-Exp'), '99999999999999');
  assert.equal(h.get('X-HJ-Evil'), null);
});

test('WebSocket：錯誤 Origin、沒有 Origin、未登入、不在白名單、白名單為空、過期 session 都連不上', async () => {
  const room = fakeRoom();
  const env = { ...baseEnv, ROOM: room.ns };
  const good = { Cookie: await cookie('300') };
  for (const origin of ['https://evil.example', 'https://st.yuci8660.uk', 'http://huan-jing.yuci8660.uk', 'null']) {
    const res = await ws('/rooms/main/ws', { headers: { ...good, Origin: origin }, env });
    assert.equal(res.status, 403, origin);
    assert.equal((await res.json()).error, 'bad_origin');
  }
  const noOrigin = await worker.fetch(new Request(`${API}/rooms/main/ws`, { headers: { Upgrade: 'websocket', ...good } }), env);
  assert.equal(noOrigin.status, 403);

  assert.equal((await ws('/rooms/main/ws', { env })).status, 401);
  assert.equal((await ws('/rooms/main/ws', { headers: { Cookie: 'hj_session=garbage' }, env })).status, 401);
  assert.equal((await ws('/rooms/main/ws', { headers: { Cookie: await cookie('300', { exp: Date.now() - 1 }) }, env })).status, 401);
  const notAllowed = await ws('/rooms/main/ws', { headers: { Cookie: await cookie('999') }, env });
  assert.equal(notAllowed.status, 403);
  assert.equal((await notAllowed.json()).error, 'not_allowed');
  const empty = await ws('/rooms/main/ws', { headers: good, env: { ...env, DISCORD_ALLOWED_IDS: '' } });
  assert.equal(empty.status, 403);
  assert.equal((await empty.json()).error, 'whitelist_empty');
  assert.equal(room.seen.requests.length, 0); // 一個都沒有走到 Durable Object
});

test('WebSocket：不是升級請求、未知房間、錯誤方法', async () => {
  const room = fakeRoom();
  const env = { ...baseEnv, ROOM: room.ns };
  const good = { Cookie: await cookie('300') };
  const plain = await worker.fetch(new Request(`${API}/rooms/main/ws`, { headers: { Origin: SITE, ...good } }), env);
  assert.equal(plain.status, 426);
  assert.equal((await ws('/rooms/other/ws', { headers: good, env })).status, 404);
  assert.equal((await ws('/rooms/main/ws', { headers: good, env, method: 'POST' })).status, 405);
  assert.equal(room.seen.requests.length, 0);
});

test('缺少 Secrets 或 ROOM 綁定：回 500，不洩漏內容', async () => {
  const good = { Cookie: await cookie('300') };
  const noSecret = await ws('/rooms/main/ws', { headers: good, env: { ...baseEnv, SESSION_SECRET: undefined, ROOM: fakeRoom().ns } });
  assert.equal(noSecret.status, 500);
  const noRoom = await ws('/rooms/main/ws', { headers: good });
  assert.equal(noRoom.status, 500);
  assert.equal((await noRoom.json()).error, 'server_misconfigured');
});
