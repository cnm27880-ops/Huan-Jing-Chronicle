// 執行方式：在專案根目錄 npm test
// GM 新增的專屬技能：只有 GM 能改、嚴格驗證、不能蓋掉內建技能、全員收到更新、記進異動紀錄、連線時帶給新進的人
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
const def = { tier: '進階', kind: '被動', school: '獨特', text: '每級加生命', fx: [{ 生命: 5 }, { 生命: 10 }, { 生命: 10, 真實傷害: 1 }] };
const setSkill = (core, user, name, d = def) => send(core, user, { t: 'skillSet', rid: 's', name, def: d });

test('GM 新增專屬技能：回覆成功、全員收到更新、記一條異動紀錄、之後連線的人也拿得到', () => {
  const core = room();
  const res = setSkill(core, GM, '我的技能');
  assert.equal(first(res).t, 'skillOk');
  const upd = res.out.find((o) => o.msg.t === 'skills');
  assert.equal(upd.to, 'all');
  const saved = upd.msg.skills.我的技能;
  assert.equal(saved.tier, '進階'); assert.equal(saved.personal, true); assert.equal(saved.fx.length, 10); assert.deepEqual(saved.fx[2], { 生命: 10, 真實傷害: 1 });
  const ev = res.out.find((o) => o.msg.t === 'event').msg.event;
  assert.equal(ev.kind, 'audit'); assert.match(ev.label, /新增了專屬技能「我的技能」/);
  assert.ok(ev.lines.includes('1 級：生命+5') && ev.lines.includes('3 級：生命+10 真實傷害+1'));
  assert.deepEqual(core.hello(P1).skills.我的技能.fx[0], { 生命: 5 }); // 之後才連線的玩家
  const again = setSkill(core, GM, '我的技能', { ...def, text: '改過了' });
  assert.match(again.out.find((o) => o.msg.t === 'event').msg.event.label, /修改了專屬技能/);
  assert.equal(core.customSkills().我的技能.text, '改過了');
});

test('只有 GM 能改；玩家被拒絕、資料沒變', () => {
  const core = room();
  assert.equal(first(setSkill(core, P1, '偷改的技能')).code, 'forbidden');
  assert.equal(first(send(core, P1, { t: 'skillDel', rid: 's', name: 'x' })).code, 'forbidden');
  assert.deepEqual(core.customSkills(), {});
});

test('驗證：名稱、位階、類型、系別、數值表；不能蓋掉內建技能；被擋的都沒有寫入', () => {
  const core = room();
  const bad = (name, d) => first(setSkill(core, GM, name, d)).code;
  assert.equal(bad('', def), 'bad_skill');
  assert.equal(bad('x'.repeat(21), def), 'bad_skill');
  assert.equal(bad('八卦掌', def), 'bad_skill'); // 內建
  assert.equal(bad('老狗識途', def), 'bad_skill');
  assert.equal(bad('新', { ...def, tier: '神級' }), 'bad_skill');
  assert.equal(bad('新', { ...def, kind: '啟動' }), 'bad_skill');
  assert.equal(bad('新', { ...def, school: '亂來' }), 'bad_skill');
  assert.equal(bad('新', { ...def, text: 'x'.repeat(601) }), 'bad_skill');
  assert.equal(bad('新', { ...def, fx: [{ 亂寫: 1 }] }), 'bad_skill');
  assert.equal(bad('新', { ...def, fx: [{ 生命: 1.5 }] }), 'bad_skill');
  assert.equal(bad('新', { ...def, fx: Array.from({ length: 11 }, () => ({})) }), 'bad_skill');
  assert.equal(bad('新', null), 'bad_skill');
  assert.deepEqual(core.customSkills(), {});
  assert.equal(first(setSkill(core, GM, '新', { ...def, fx: [], text: '' })).t, 'skillOk'); // 沒有數值、沒有文字也可以
});

test('刪除：GM 可以刪自己加的；內建的與不存在的會被拒絕；刪除通知所有人', () => {
  const core = room();
  setSkill(core, GM, '我的技能');
  const del = send(core, GM, { t: 'skillDel', rid: 'd', name: '我的技能' });
  assert.equal(first(del).t, 'skillOk');
  assert.deepEqual(del.out.find((o) => o.msg.t === 'skills').msg.skills, {});
  assert.match(del.out.find((o) => o.msg.t === 'event').msg.event.label, /刪除了專屬技能「我的技能」/);
  assert.equal(first(send(core, GM, { t: 'skillDel', rid: 'd', name: '我的技能' })).code, 'bad_skill');
  assert.equal(first(send(core, GM, { t: 'skillDel', rid: 'd', name: '八卦掌' })).code, 'bad_skill');
});

test('數量上限：最多 60 個，超過要先刪；修改已有的不受影響', () => {
  const core = room();
  for (let i = 0; i < 60; i++) assert.equal(first(setSkill(core, GM, `技能${i}`)).t, 'skillOk');
  assert.equal(first(setSkill(core, GM, '第六十一個')).code, 'bad_skill');
  assert.equal(first(setSkill(core, GM, '技能3', { ...def, text: '改' })).t, 'skillOk');
});
