// 執行方式：在專案根目錄 npm test
// 怪物立繪（GM 上傳、全員用網址讀）與隊友狀態（每人回報自己的生命與資源）
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import worker from '../src/index.js';
import { signToken } from '../src/crypto.js';
import { makeDb } from './helpers.js';

const GM = { uid: '100', name: 'GM', avatar: null };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,300', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '' };

function room() {
  let clock = 1_000_000;
  const rng = () => 0.5;
  rng.int = () => 1;
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng, uuid: (() => { let n = 0; return () => `id${++n}`; })() });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 250; return handle(...a); };
  core.join(GM); core.join(P1);
  return core;
}
const send = (core, user, msg) => core.handle(user, JSON.stringify(msg));
const find = (res, t) => res.out.find((o) => o.msg.t === t);
const errorOf = (res) => find(res, 'error')?.msg;
const b64 = (bin) => Buffer.from(bin, 'binary').toString('base64');
const WEBP = b64(`RIFF\x20\x00\x00\x00WEBPVP8 ${'x'.repeat(40)}`);
const PNG = b64(`\x89PNG\r\n\x1a\n${'x'.repeat(40)}`);

test('立繪：GM 上傳後全員收到清單、hello 也有；檔案讀得回原本的位元組', () => {
  const core = room();
  const res = send(core, GM, { t: 'imgPut', rid: 'r1', name: '魔王', mime: 'image/webp', data: WEBP });
  const id = find(res, 'imgOk').msg.id;
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(find(res, 'images').to, 'all');
  assert.deepEqual(find(res, 'images').msg.images.map((x) => x.name), ['魔王']);
  assert.equal(core.hello(P1).images.length, 1);
  const file = core.imageFile(id);
  assert.equal(file.mime, 'image/webp');
  assert.equal(Buffer.from(file.bytes).toString('base64'), WEBP);
  assert.equal(core.imageFile('0'.repeat(32)), null);
  assert.equal(core.imageFile('../x'), null);
});

test('立繪：只有 GM 能上傳；格式、檔頭、大小不對都拒絕（不收 SVG）', () => {
  const core = room();
  assert.equal(errorOf(send(core, P1, { t: 'imgPut', mime: 'image/webp', data: WEBP }))?.code, 'forbidden');
  for (const bad of [
    { mime: 'image/svg+xml', data: b64('<svg xmlns="http://www.w3.org/2000/svg"></svg>') },
    { mime: 'image/webp', data: PNG }, // 檔頭和宣稱的格式不一樣
    { mime: 'image/png', data: 'not base64!!' },
    { mime: 'image/png', data: 'A'.repeat(240_004) },
    { mime: 'image/png' },
  ]) assert.equal(errorOf(send(core, GM, { t: 'imgPut', ...bad }))?.code, 'bad_img', bad.mime);
  assert.equal(core.imagesView().length, 0);
  assert.ok(find(send(core, GM, { t: 'imgPut', mime: 'image/png', data: PNG }), 'imgOk'));
});

test('立繪：上傳時直接套到怪物、之後換掉或拿掉；刪除立繪時怪物身上的也拿掉', () => {
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'boss', spec: { count: 1, atkPower: 10, defPower: 10, hp: 300 } });
  const boss = core.encounter().monsters[0].id;
  const put = send(core, GM, { t: 'imgPut', mime: 'image/webp', data: WEBP, assign: boss });
  const id = find(put, 'imgOk').msg.id;
  assert.equal(find(put, 'enc').msg.encounter.monsters[0].img, id);
  assert.equal(errorOf(send(core, P1, { t: 'encImg', id: boss, img: null }))?.code, 'forbidden');
  assert.equal(errorOf(send(core, GM, { t: 'encImg', id: boss, img: 'f'.repeat(32) }))?.code, 'bad_img');
  send(core, GM, { t: 'encImg', id: boss, img: null });
  assert.equal(core.encounter().monsters[0].img, undefined);
  send(core, GM, { t: 'encImg', id: boss, img: id });
  const del = send(core, GM, { t: 'imgDel', id });
  assert.equal(find(del, 'enc').msg.encounter.monsters[0].img, undefined);
  assert.equal(core.imagesView().length, 0);
  // 新增敵人時指定立繪
  const id2 = find(send(core, GM, { t: 'imgPut', mime: 'image/png', data: PNG }), 'imgOk').msg.id;
  send(core, GM, { t: 'encAdd', kind: 'mob', img: id2, spec: { count: 2, atkPower: 5, defPower: 5, hp: 50 } });
  assert.deepEqual(core.encounter().monsters.filter((m) => m.kind === 'mob').map((m) => m.img), [id2, id2]);
});

test('隊友狀態：回報後廣播給所有人、hello 也有；不合法的欄位丟掉或拒絕', () => {
  const core = room();
  const res = send(core, P1, { t: 'vitals', v: { name: '福德', hp: 120, maxHp: 300, downed: false, tox: 2, shield: 0, res: { 靈氣: [10, 50], '<b>': [1, 2], 魔力: [1, 'x'] } } });
  const msg = find(res, 'vitals');
  assert.equal(msg.to, 'all');
  assert.deepEqual(msg.msg, { t: 'vitals', uid: '300', v: { name: '福德', hp: 120, maxHp: 300, downed: false, tox: 2, res: { 靈氣: [10, 50] } } });
  assert.equal(core.hello(GM).vitals['300'].hp, 120);
  assert.equal(errorOf(send(core, P1, { t: 'vitals', v: { hp: -1, maxHp: 10 } }))?.code, 'bad_vitals');
  assert.equal(errorOf(send(core, P1, { t: 'vitals', v: { hp: 1.5, maxHp: 10 } }))?.code, 'bad_vitals');
  send(core, P1, { t: 'vitals', v: { name: '福德', hp: 0, maxHp: 300, downed: true } });
  assert.equal(core.vitalsView()['300'].downed, true);
});

// ---------- 對外網址 /rooms/main/img/:id ----------
const SITE = 'https://huan-jing.yuci8660.uk';
const API = 'https://huan-jing-api.yuci8660.uk';
const workerEnv = {
  SITE_ORIGIN: SITE, DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', DISCORD_REDIRECT_URI: `${API}/auth/callback`,
  SESSION_SECRET: 'secret', DISCORD_ALLOWED_IDS: '100,300', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '',
};
const cookie = async (uid) => `hj_session=${await signToken({ uid, name: '玩家', avatar: null, iat: Date.now(), exp: Date.now() + 1e6 }, workerEnv.SESSION_SECRET)}`;

test('立繪網址：登入且在白名單內才轉給房間；其他情況擋下', async () => {
  const seen = [];
  const ROOM = { idFromName: (n) => n, get: () => ({ fetch: async (req) => { seen.push(req); return new Response('img'); } }) };
  const id = 'a'.repeat(32);
  const get = async (path, headers = {}, method = 'GET') => worker.fetch(new Request(API + path, { method, headers }), { ...workerEnv, ROOM });
  assert.equal((await get(`/rooms/main/img/${id}`)).status, 401);
  assert.equal((await get(`/rooms/main/img/${id}`, { Cookie: await cookie('999') })).status, 403);
  assert.equal((await get(`/rooms/other/img/${id}`, { Cookie: await cookie('300') })).status, 404);
  assert.equal((await get(`/rooms/main/img/${id}`, { Cookie: await cookie('300') }, 'POST')).status, 405);
  assert.equal((await get('/rooms/main/img/notanid', { Cookie: await cookie('300') })).status, 404);
  assert.equal(seen.length, 0);
  const ok = await get(`/rooms/main/img/${id}`, { Cookie: await cookie('300'), 'X-HJ-Uid': '100' });
  assert.equal(ok.status, 200);
  assert.equal(new URL(seen[0].url).pathname, `/img/${id}`);
  assert.equal(seen[0].headers.get('X-HJ-Uid'), '300'); // 瀏覽器自己帶的身分標頭不會被採信
});
