// 執行方式：在專案根目錄 npm test
// 模擬戰的範本版本（GM 專用）：存、改、刪、讀；格式把關；不廣播、不放進 hello
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { cleanSpecs, cleanSnap } from '../src/templates.js';
import { MAX_TEMPLATES } from '../src/config.js';
import { makeDb } from './helpers.js';

const GM = { uid: '100', name: 'GM', avatar: null };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,200,300', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '200' };

function room() {
  let clock = 1_000_000;
  const rng = () => 0.5;
  rng.int = () => 0;
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng, uuid: (() => { let n = 0; return () => `tpl${++n}`; })() });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 1000; return handle(...a); };
  core.join(GM); core.join(P1);
  return core;
}
const send = (core, user, msg) => core.handle(user, JSON.stringify(msg));
const listOf = (res) => res.out.find((o) => o.msg.t === 'templates')?.msg.list;
const errorOf = (res) => res.out.find((o) => o.msg.t === 'error')?.msg;
const SPECS = [
  { kind: 'mob', count: 9, atkPower: 360, defPower: 270, hp: 600 },
  { kind: 'boss', count: 1, atkPower: 600, defPower: 800, hp: 2000 },
];

test('範本版本：只有 GM 能用，玩家一律被拒絕，也不會放進 hello', () => {
  const core = room();
  for (const t of ['tplList', 'tplSave', 'tplDel']) assert.equal(errorOf(send(core, P1, { t, name: 'x', specs: SPECS, id: 'a' }))?.code, 'forbidden');
  send(core, GM, { t: 'tplSave', name: '範本 v1', specs: SPECS });
  assert.ok(!('templates' in core.hello(P1)));
  assert.ok(!('templates' in core.hello(GM)));
});

test('範本版本：新增、更新（改名、備註、覆蓋敵人清單）、刪除；新的排前面，建立時間不變', () => {
  const core = room();
  assert.deepEqual(listOf(send(core, GM, { t: 'tplList' })), []);
  const a = listOf(send(core, GM, { t: 'tplSave', name: '範本 v1', note: '第一版', specs: SPECS }));
  assert.equal(a.length, 1);
  assert.equal(a[0].name, '範本 v1');
  assert.equal(a[0].note, '第一版');
  assert.equal(a[0].snap, null);
  assert.deepEqual(a[0].specs[0], { kind: 'mob', count: 9, atkPower: 360, defPower: 270, hp: 600, absDef: 0, atkMod: '', defMod: '' });
  const v1 = a[0];
  const two = listOf(send(core, GM, { t: 'tplSave', name: '範本 v2', specs: [{ ...SPECS[0], count: 8 }, SPECS[1]], snap: { at: 5, runs: 100, win: 0.72, rounds: 7, drain: 0.55, hpLeft: 0.4, players: ['甲', '乙'] } }));
  assert.deepEqual(two.map((x) => x.name), ['範本 v2', '範本 v1']); // 新的在前
  assert.equal(two[0].snap.win, 0.72);
  assert.deepEqual(two[0].snap.players, ['甲', '乙']);
  // 更新 v1：改名、備註、敵人清單；沒給 snap 就保留原本的；建立時間不變、更新時間變新、跑到最前面
  const upd = listOf(send(core, GM, { t: 'tplSave', id: v1.id, name: '範本 v1（舊）', note: '改過', specs: [{ ...SPECS[0], hp: 700 }, SPECS[1]] }));
  assert.equal(upd[0].id, v1.id);
  assert.equal(upd[0].name, '範本 v1（舊）');
  assert.equal(upd[0].specs[0].hp, 700);
  assert.equal(upd[0].created, v1.created);
  assert.ok(upd[0].t > v1.t);
  // 刪除
  const del = listOf(send(core, GM, { t: 'tplDel', id: v1.id }));
  assert.deepEqual(del.map((x) => x.name), ['範本 v2']);
  assert.equal(errorOf(send(core, GM, { t: 'tplDel', id: v1.id }))?.code, 'bad_template');
  assert.equal(errorOf(send(core, GM, { t: 'tplSave', id: v1.id, name: 'x', specs: SPECS }))?.code, 'bad_template'); // 更新一個不存在的
});

test('範本版本：名稱、敵人清單的格式把關，數量有上限', () => {
  const core = room();
  const bad = (extra) => errorOf(send(core, GM, { t: 'tplSave', name: 'x', specs: SPECS, ...extra }))?.code;
  assert.equal(bad({ name: '  ' }), 'bad_template');
  assert.equal(bad({ specs: [] }), 'bad_template');
  assert.equal(bad({ specs: 'abc' }), 'bad_template');
  assert.equal(bad({ specs: [{ ...SPECS[0], kind: 'god' }] }), 'bad_template');
  assert.equal(bad({ specs: [{ ...SPECS[0], count: 0 }] }), 'bad_template');
  assert.equal(bad({ specs: [{ ...SPECS[1], count: 4 }] }), 'bad_template'); // BOSS 最多 3 隻
  assert.equal(bad({ specs: [{ ...SPECS[0], hp: 1.5 }] }), 'bad_template');
  assert.equal(bad({ specs: [{ ...SPECS[0], atkPower: 0 }] }), 'bad_template');
  assert.equal(bad({ specs: Array(13).fill(SPECS[0]) }), 'bad_template');
  assert.equal(bad({}), undefined); // 正常的可以存
  for (let i = 1; i < MAX_TEMPLATES; i++) send(core, GM, { t: 'tplSave', name: `v${i}`, specs: SPECS });
  assert.equal(errorOf(send(core, GM, { t: 'tplSave', name: '多的一個', specs: SPECS }))?.code, 'bad_template');
});

test('cleanSpecs／cleanSnap：只留已知欄位、字串清理、數字夾在範圍內', () => {
  const c = cleanSpecs([{ kind: 'elite', count: 2, atkPower: 1, defPower: 0, hp: 5, absDef: 3, atkMod: '5A\n3C', defMod: 'x'.repeat(100), evil: '<script>' }]);
  assert.equal(c.ok, true);
  assert.deepEqual(Object.keys(c.specs[0]).sort(), ['absDef', 'atkMod', 'atkPower', 'count', 'defMod', 'defPower', 'hp', 'kind']);
  assert.equal(c.specs[0].atkMod, '5A 3C');
  assert.equal(c.specs[0].defMod.length, 40);
  assert.equal(cleanSpecs([{ count: 1, atkPower: 1, defPower: 0, hp: 1 }]).specs[0].kind, 'mob'); // 沒給等級＝小怪
  assert.equal(cleanSnap(null), null);
  assert.equal(cleanSnap({ win: 'a', rounds: 1, drain: 0, hpLeft: 0 }), null);
  const s = cleanSnap({ at: 10, runs: 100, win: 5, rounds: 7, drain: -1, hpLeft: 0.5, players: Array(20).fill('甲') });
  assert.equal(s.win, 1);
  assert.equal(s.drain, 0);
  assert.equal(s.players.length, 12);
});
