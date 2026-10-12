// 執行方式：npm test
// 招式使用紀錄（src/game/moveUse.js）與模擬戰的「出招優先順序」（simulate.js 的 pickMove）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { recordMoveUse, usageList, hasMoveUse, usagePlan, MAX_MOVE_USE_NAMES } from '../src/game/moveUse.js';
import { buildEncounter, pickMove, simulateBattle, seededRng } from '../src/game/simulate.js';
import { playerAttack } from '../src/game/combat.js';
import { blankCharacter } from '../src/game/importBot.js';
import { moveFromCatalog } from '../src/game/skills.js';
import { setResource } from '../src/game/resources.js';

const hero = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));

test('招式紀錄：同名累加、依次數排序、次數相同照名稱排；沒有紀錄時 hasMoveUse 是 false', () => {
  const s = { moveUse: {} };
  assert.equal(hasMoveUse(s), false);
  assert.equal(recordMoveUse(s, '普攻'), 1);
  assert.equal(recordMoveUse(s, '普攻'), 2);
  recordMoveUse(s, '爆裂火球');
  recordMoveUse(s, '暴徒');
  assert.deepEqual(usageList(s), [{ name: '普攻', count: 2 }, { name: '暴徒', count: 1 }, { name: '爆裂火球', count: 1 }]);
  assert.equal(hasMoveUse(s), true);
  // 沒有 moveUse 欄位的舊存檔也能記
  const old = {};
  recordMoveUse(old, '普攻');
  assert.deepEqual(old.moveUse, { 普攻: 1 });
  assert.equal(recordMoveUse(old, ''), 0);
});

test('招式紀錄：名稱種類有上限，滿了以後新名稱不記、舊名稱照常累加', () => {
  const s = { moveUse: {} };
  for (let i = 0; i < MAX_MOVE_USE_NAMES; i++) recordMoveUse(s, `招${i}`);
  assert.equal(recordMoveUse(s, '新招'), 0);
  assert.equal('新招' in s.moveUse, false);
  assert.equal(recordMoveUse(s, '招0'), 2);
});

test('出招優先順序（依紀錄）：只留還在招式清單裡的攻擊招式；輔助與已經換掉的招式不算', () => {
  const s = {
    moves: [{ id: 'basic', name: '普攻' }, { id: 'a', name: '暴徒', kind: 'attack' }, { id: 'h', name: '納米醫療蜂', kind: 'heal' }],
    moveUse: { 普攻: 3, 暴徒: 9, 納米醫療蜂: 20, 已換掉的招: 50 },
  };
  assert.deepEqual(usagePlan(s), ['暴徒', '普攻']);
  assert.deepEqual(usagePlan({ moves: s.moves, moveUse: {} }), []);
});

test('出手會自動記招式；打不出去（資源不足、找不到目標）不記', () => {
  const p = hero();
  p.moveUse = {};
  const enc = buildEncounter([{ kind: 'mob', count: 1, atkPower: 10, defPower: 10, hp: 100000 }], seededRng(1));
  const r = playerAttack(p, enc, 'basic', '小怪1', 0, seededRng(2));
  assert.equal(r.error, undefined);
  assert.deepEqual(p.moveUse, { 普攻: 1 });
  const bad = playerAttack(p, enc, 'basic', '不存在', 0, seededRng(2));
  assert.ok(bad.error);
  assert.deepEqual(p.moveUse, { 普攻: 1 });
});

test('模擬戰挑招：有出招優先順序就照順序（付得起的第一個）；全部付不起用普攻；順序無效就當沒設定', () => {
  const p = { ...blankCharacter('甲'), skills: { 爆裂火球: 5, 暴徒: 1 } };
  p.baseStats = { ...p.baseStats, 生命: 500, 魔力: 100, 鬥氣: 50 };
  p.moves.push({ ...moveFromCatalog('爆裂火球'), id: 'fb' }, { ...moveFromCatalog('暴徒'), id: 'th' });
  setResource(p, '魔力', 100);
  assert.equal(pickMove({ ...p, movePlan: ['暴徒', '爆裂火球'] }).name, '暴徒'); // 照順序，不是續航最長
  assert.equal(pickMove({ ...p, movePlan: ['爆裂火球', '暴徒'] }).name, '爆裂火球');
  setResource(p, '魔力', 0);
  assert.equal(pickMove({ ...p, movePlan: ['爆裂火球', '暴徒'] }).name, '暴徒'); // 爆裂火球付不起 → 下一個
  assert.equal(pickMove({ ...p, movePlan: ['爆裂火球'] }).name, '普攻'); // 都付不起 → 普攻
  const auto = pickMove(p);
  assert.equal(pickMove({ ...p, movePlan: ['不存在的招'] }).name, auto.name); // 順序無效 → 自動
  assert.equal(pickMove({ ...p, movePlan: [] }).name, auto.name);
});

test('模擬戰：出招優先順序會帶進整場戰鬥（玩家複本保留 movePlan），而且不影響原本的玩家資料', () => {
  const p = { ...blankCharacter('甲'), skills: { 暴徒: 1 } };
  p.baseStats = { ...p.baseStats, 生命: 800, 魔力: 100, 鬥氣: 50 };
  p.moves.push({ ...moveFromCatalog('暴徒'), id: 'th' });
  const specs = [{ kind: 'mob', count: 1, atkPower: 5, defPower: 1, hp: 100000 }];
  const withPlan = { ...p, movePlan: ['普攻'] };
  const a = simulateBattle([withPlan], specs, { rng: seededRng(3), maxRounds: 2 });
  assert.equal(a.perPlayer[0].actions, 2); // 每回合出一招
  assert.equal(p.moveUse === undefined || Object.keys(p.moveUse).length === 0, true); // 原資料沒被記到
  assert.equal(withPlan.moveUse === undefined || Object.keys(withPlan.moveUse).length === 0, true);
});
