// 執行方式：在專案根目錄 npm test
// 遭遇戰（階段 C）：GM 建立、全員共享、怪物生命只由伺服器更新、先攻純隨機
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { makeDb } from './helpers.js';

const GM = { uid: '100', name: 'GM', avatar: null };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const P2 = { uid: '400', name: '玩家二', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,200,300,400', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '200' };

/** 小怪用的小數亂數固定 0.5；洗牌用的 int 可以自己指定（預設一律抽 1，也就是每次都換到最前面） */
function room(intPick = () => 1) {
  let clock = 1_000_000;
  const rng = () => 0.5;
  rng.int = (n) => intPick(n);
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng, uuid: (() => { let n = 0; return () => `id${++n}`; })() });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 250; return handle(...a); };
  core.join(GM); core.join(P1); core.join(P2);
  return core;
}
const send = (core, user, msg, opts) => core.handle(user, JSON.stringify(msg), opts);
const encOf = (res) => res.out.find((o) => o.msg.t === 'enc')?.msg.encounter;
const errorOf = (res) => res.out.find((o) => o.msg.t === 'error')?.msg;
const SPEC = { count: 2, atkPower: 12, defPower: 9, hp: 100 };

test('GM 新增小怪：廣播給所有人、寫進紀錄、新連線的 hello 也看得到', () => {
  const core = room();
  const res = send(core, GM, { t: 'encAdd', rid: 'r1', kind: 'mob', spec: SPEC });
  const enc = encOf(res);
  assert.deepEqual(enc.monsters.map((m) => m.id), ['小怪1', '小怪2']);
  assert.equal(res.out.find((o) => o.msg.t === 'enc').to, 'all');
  assert.ok(res.out.some((o) => o.msg.t === 'encOk' && o.msg.rid === 'r1'));
  assert.equal(res.out.find((o) => o.msg.t === 'event').msg.event.label, '遭遇：新增 小怪1、小怪2');
  assert.equal(core.hello(P1).encounter.monsters.length, 2);
});

test('只有 GM 可以新增、移除、清空、抽先攻、換人；玩家被拒絕', () => {
  const core = room();
  for (const m of [{ t: 'encAdd', kind: 'mob', spec: SPEC }, { t: 'encRemove', id: 'x' }, { t: 'encClear' }, { t: 'encInit' }, { t: 'encNext' }]) {
    assert.equal(errorOf(send(core, P1, m))?.code, 'forbidden', m.t);
  }
  assert.equal(core.encounter().monsters.length, 0);
});

test('新增敵人的輸入驗證：數量、強度、血量超出範圍或場上超過 40 隻都拒絕', () => {
  const core = room();
  for (const spec of [{ ...SPEC, count: 0 }, { ...SPEC, count: 21 }, { ...SPEC, hp: 0 }, { ...SPEC, atkPower: -1 }, { ...SPEC, defPower: 1.5 }, { ...SPEC, absDef: 'x' }]) {
    assert.equal(errorOf(send(core, GM, { t: 'encAdd', kind: 'mob', spec }))?.code, 'bad_enc');
  }
  assert.equal(errorOf(send(core, GM, { t: 'encAdd', kind: 'dragon', spec: SPEC }))?.code, 'bad_enc');
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 20 } });
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 20 } });
  assert.equal(errorOf(send(core, GM, { t: 'encAdd', kind: 'mob', spec: SPEC }))?.code, 'bad_enc');
  assert.equal(core.encounter().monsters.length, 40);
});

test('怪物生命只有伺服器會改：玩家回報傷害，累加、不會低於 0、怪物不在就略過', () => {
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'boss', spec: { ...SPEC, count: 1, hp: 50 } });
  let enc = encOf(send(core, P1, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 20 }] }));
  assert.equal(enc.monsters[0].hp, 30);
  enc = encOf(send(core, P2, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 25 }, { id: '不存在', dmg: 5 }] }));
  assert.equal(enc.monsters[0].hp, 5);
  enc = encOf(send(core, P1, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 999 }] }));
  assert.equal(enc.monsters[0].hp, 0);
  assert.equal(errorOf(send(core, P1, { t: 'encHit', hits: [{ id: '不存在', dmg: 5 }] }))?.code, 'bad_enc');
  for (const hits of [[{ id: 'BOSS1', dmg: -1 }], [{ id: 'BOSS1', dmg: 1.5 }], [], 'x']) {
    assert.equal(errorOf(send(core, P1, { t: 'encHit', hits }))?.code, 'bad_enc');
  }
});

test('先攻：在線玩家（不含 GM）加還活著的怪物一起洗牌；回合推進會跳過倒下的怪物', () => {
  const core = room((n) => n); // int(n) = n → 每個位置都和最後一個交換，結果固定
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 2 } });
  send(core, P1, { t: 'encHit', hits: [{ id: '小怪2', dmg: 100 }] }); // 小怪2 倒下，不參與先攻
  const res = send(core, GM, { t: 'encInit' }, { online: ['100', '300', '400'] });
  const enc = encOf(res);
  assert.equal(enc.round, 1);
  assert.equal(enc.order.length, 3); // 玩家一、玩家二、小怪1
  assert.ok(!enc.order.some((o) => o.uid === '100' || o.id === '小怪2'));
  assert.ok(res.out.find((o) => o.msg.t === 'event').msg.event.lines.length === 3);
  // 輪一圈：turn 0→1→2→0（回合 +1）
  assert.equal(encOf(send(core, GM, { t: 'encNext' })).turn, 1);
  assert.equal(encOf(send(core, GM, { t: 'encNext' })).turn, 2);
  const wrapped = encOf(send(core, GM, { t: 'encNext' }));
  assert.deepEqual([wrapped.turn, wrapped.round], [0, 2]);
  // 怪物倒下後輪到牠會被跳過
  const target = wrapped.order.findIndex((o) => o.kind === 'monster');
  send(core, P1, { t: 'encHit', hits: [{ id: '小怪1', dmg: 100 }] });
  let cur = core.encounter();
  while (cur.turn !== (target + cur.order.length - 1) % cur.order.length) cur = encOf(send(core, GM, { t: 'encNext' }));
  const after = encOf(send(core, GM, { t: 'encNext' }));
  assert.notEqual(after.turn, target);
});

test('還沒抽先攻就換人會被拒絕；移除怪物會一併從先攻順序拿掉；清空後回到空的遭遇', () => {
  const core = room();
  assert.equal(errorOf(send(core, GM, { t: 'encNext' }))?.code, 'bad_enc');
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 1 } });
  send(core, GM, { t: 'encInit' }, { online: ['300'] });
  assert.equal(core.encounter().order.length, 2);
  const enc = encOf(send(core, GM, { t: 'encRemove', id: '小怪1' }));
  assert.equal(enc.monsters.length, 0);
  assert.equal(enc.order.length, 1);
  const cleared = encOf(send(core, GM, { t: 'encClear' }));
  assert.deepEqual([cleared.monsters.length, cleared.order.length, cleared.round], [0, 0, 0]);
});
