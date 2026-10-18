// 執行方式：在專案根目錄 npm test
// 不顯示於資源條：只有 GM 能設定、全員同步、hello 帶名單、隱藏不影響隊友狀態與角色資料
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
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

test('隱藏名單：舊房間沒有這筆＝空，hello 帶空陣列', () => {
  assert.deepEqual(room().hello(P1).hiddenVitals, []);
});

test('隱藏名單：GM 設定後全員收到、hello 帶名單；取消後移除', () => {
  const core = room();
  const res = send(core, GM, { t: 'hideVitals', rid: 'r1', uid: '300', hidden: true, name: '玩家一' });
  assert.ok(find(res, 'hideOk'));
  assert.equal(find(res, 'hiddenVitals').to, 'all');
  assert.deepEqual(find(res, 'hiddenVitals').msg.uids, ['300']);
  assert.deepEqual(core.hello(P1).hiddenVitals, ['300']);
  send(core, GM, { t: 'hideVitals', rid: 'r2', uid: '300', hidden: true }); // 重複設定不會重複加
  assert.deepEqual(core.hiddenVitals(), ['300']);
  const back = send(core, GM, { t: 'hideVitals', rid: 'r3', uid: '300', hidden: false });
  assert.deepEqual(find(back, 'hiddenVitals').msg.uids, []);
});

test('隱藏名單：非 GM 不能設定；格式錯誤被擋', () => {
  const core = room();
  assert.equal(find(send(core, P1, { t: 'hideVitals', rid: 'r', uid: '100', hidden: true }), 'error').msg.code, 'forbidden');
  assert.equal(find(send(core, GM, { t: 'hideVitals', rid: 'r', uid: '', hidden: true }), 'error').msg.code, 'bad_hide');
  assert.equal(find(send(core, GM, { t: 'hideVitals', rid: 'r', uid: '300', hidden: 'yes' }), 'error').msg.code, 'bad_hide');
  assert.deepEqual(core.hiddenVitals(), []);
});

test('隱藏名單：被隱藏的人照常回報狀態（伺服器的 vitals 不受影響）', () => {
  const core = room();
  send(core, GM, { t: 'hideVitals', rid: 'r', uid: '300', hidden: true });
  send(core, P1, { t: 'vitals', v: { name: '玩家一', hp: 5, maxHp: 10, seq: 1 } });
  assert.equal(core.hello(GM).vitals['300']?.hp, 5);
});
