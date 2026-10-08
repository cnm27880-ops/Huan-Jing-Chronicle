// 執行方式：在專案根目錄 npm test
// GM 新增的特殊配方與特殊材料：只有 GM 能改、嚴格驗證、不能和內建重名、全員收到更新、記進異動紀錄、連線時帶給新進的人
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { makeDb, seqRng } from './helpers.js';

const GM = { uid: '100', name: 'GM', avatar: null };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,300', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '' };

function room() {
  let clock = 1_000_000;
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng: seqRng([3]), uuid: (() => { let n = 0; return () => `id${++n}`; })() });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 250; return handle(...a); };
  return core;
}
const send = (core, user, msg) => core.handle(user, JSON.stringify(msg));
const first = (res) => res.out[0].msg;
const recipe = { type: '進階藥水', skill: '調劑', dc: 18, materials: { 福瑞毛: 3, 南夢水: 2 }, effect: '喝了會變毛茸茸' };
const setRecipe = (core, user, name, def = recipe) => send(core, user, { t: 'specialSet', rid: 'r', kind: 'recipe', name, def });

test('GM 新增配方：回覆成功、全員收到更新、記一條異動紀錄、之後連線的人也拿得到', () => {
  const core = room();
  const res = setRecipe(core, GM, '毛茸茸藥水');
  assert.equal(first(res).t, 'specialOk');
  const upd = res.out.find((o) => o.msg.t === 'special');
  assert.equal(upd.to, 'all');
  assert.deepEqual(upd.msg.special.recipes.毛茸茸藥水, recipe);
  const ev = res.out.find((o) => o.msg.t === 'event').msg.event;
  assert.equal(ev.kind, 'audit'); assert.equal(ev.byName, 'GM');
  assert.match(ev.label, /新增了特殊配方「毛茸茸藥水」/);
  assert.ok(ev.lines.includes('材料：福瑞毛×3、南夢水×2'));
  assert.deepEqual(core.hello(P1).special.recipes.毛茸茸藥水, recipe); // 之後才連線的玩家
  const again = setRecipe(core, GM, '毛茸茸藥水', { ...recipe, dc: 20 });
  assert.match(again.out.find((o) => o.msg.t === 'event').msg.event.label, /修改了特殊配方/);
  assert.equal(core.special().recipes.毛茸茸藥水.dc, 20);
});

test('只有 GM 能改；玩家被拒絕、資料沒變', () => {
  const core = room();
  assert.equal(first(setRecipe(core, P1, '偷改的配方')).code, 'forbidden');
  assert.equal(first(send(core, P1, { t: 'specialDel', rid: 'r', kind: 'recipe', name: 'x' })).code, 'forbidden');
  assert.deepEqual(core.special(), { recipes: {}, materials: {} });
});

test('驗證：名稱、技能、DC、材料、效果文字；不能和內建的東西重名', () => {
  const core = room();
  const bad = (name, def) => first(setRecipe(core, GM, name, def)).code;
  assert.equal(bad('', recipe), 'bad_special');
  assert.equal(bad('x'.repeat(21), recipe), 'bad_special');
  assert.equal(bad('祕製桃花酒', recipe), 'bad_special'); // 內建配方
  assert.equal(bad('南夢水', recipe), 'bad_special'); // 內建特殊材料
  assert.equal(bad('鮮美肉', recipe), 'bad_special'); // 肉球吃的材料
  assert.equal(bad('動物春藥', recipe), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, skill: '社交' }), 'bad_special'); // 要是生活技能
  assert.equal(bad('新藥', { ...recipe, dc: 0 }), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, dc: 61 }), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, dc: 10.5 }), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, materials: {} }), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, materials: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 } }), 'bad_special'); // 最多 5 種
  assert.equal(bad('新藥', { ...recipe, materials: { 福瑞毛: 0 } }), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, materials: { 福瑞毛: 1000 } }), 'bad_special');
  assert.equal(bad('新藥', { ...recipe, materials: { 新藥: 1 } }), 'bad_special'); // 材料不能是自己
  assert.equal(bad('新藥', { ...recipe, effect: 'x'.repeat(121) }), 'bad_special');
  assert.equal(bad('新藥', null), 'bad_special');
  assert.deepEqual(core.special(), { recipes: {}, materials: {} }); // 全部被擋，沒有寫入
  assert.equal(first(setRecipe(core, GM, '新藥', { ...recipe, effect: '' })).t, 'specialOk'); // 效果可以留空
  assert.equal(first(send(core, GM, { t: 'specialSet', rid: 'r', kind: 'bogus', name: 'x', def: {} })).code, 'bad_special');
});

test('特殊材料：新增、技能要有效、刪除；刪除不存在的會被拒絕', () => {
  const core = room();
  const mat = (name, def) => send(core, GM, { t: 'specialSet', rid: 'm', kind: 'material', name, def });
  assert.equal(first(mat('微光的鱗粉', { hint: '找微光玩', skills: ['社交', '西幻'] })).t, 'specialOk');
  assert.deepEqual(core.special().materials.微光的鱗粉, { hint: '找微光玩', skills: ['社交', '西幻'] });
  assert.equal(first(mat('壞材料', { hint: '', skills: [] })).code, 'bad_special');
  assert.equal(first(mat('壞材料', { hint: '', skills: ['不存在的技能'] })).code, 'bad_special');
  assert.equal(first(mat('福瑞毛', { hint: '', skills: ['社交'] })).code, 'bad_special'); // 內建
  const del = send(core, GM, { t: 'specialDel', rid: 'd', kind: 'material', name: '微光的鱗粉' });
  assert.equal(first(del).t, 'specialOk');
  assert.equal(del.out.find((o) => o.msg.t === 'special').msg.special.materials['微光的鱗粉'], undefined);
  assert.equal(first(send(core, GM, { t: 'specialDel', rid: 'd', kind: 'material', name: '福瑞毛' })).code, 'bad_special'); // 內建的不能刪
});

test('數量上限：配方最多 40 個，超過要先刪；修改已有的不受影響', () => {
  const core = room();
  for (let i = 0; i < 40; i++) assert.equal(first(setRecipe(core, GM, `配方${i}`)).t, 'specialOk');
  assert.equal(first(setRecipe(core, GM, '第四十一個')).code, 'bad_special');
  assert.equal(first(setRecipe(core, GM, '配方3', { ...recipe, dc: 30 })).t, 'specialOk');
});
