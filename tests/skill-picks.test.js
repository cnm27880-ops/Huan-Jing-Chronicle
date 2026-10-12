// 技能自選屬性：選了鎖住、不能減成負數、算進數值面板
import test from 'node:test';
import assert from 'node:assert/strict';
import { setPick, pendingPicks, resetPicks, pickText } from '../src/game/skillPicks.js';
import { derivedStats } from '../src/game/stats.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => {
  const s = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  s.statMode = 'skills';
  s.skills = {};
  s.adjust = {};
  return s;
};

test('孕育：每級自選 5 點，選滿才算，選定後不能改', () => {
  const s = fresh();
  s.skills.孕育 = 2;
  assert.deepEqual(pendingPicks(s, '孕育'), [1, 2]);
  const before = derivedStats(s).體魄強韌.total;
  assert.equal(setPick(s, '孕育', 1, { gain: ['體魄強韌'] }).ok, false); // 不到 5 點
  assert.equal(setPick(s, '孕育', 1, { gain: Array(5).fill('體魄強韌') }).ok, true);
  assert.equal(derivedStats(s).體魄強韌.total, before + 5);
  assert.match(setPick(s, '孕育', 1, { gain: Array(5).fill('抗性免疫') }).error, /不能更改/);
  assert.equal(setPick(s, '孕育', 3, { gain: Array(5).fill('抗性免疫') }).ok, false); // 還沒到 3 級
  assert.equal(setPick(s, '孕育', 2, { gain: Array(5).fill('真實傷害') }).ok, false); // 真實傷害不能選
  assert.deepEqual(pendingPicks(s, '孕育'), [2]);
});

test('義體防護：減算力或生命、加三防之一；可以不使用；不能減到負數', () => {
  const s = fresh();
  s.skills.義體防護 = 4;
  const hp = derivedStats(s).生命.total;
  assert.match(setPick(s, '義體防護', 1, { lose: '算力', gain: ['抗性免疫'] }, { 算力: { total: 0 } }).error, /不夠減/);
  assert.equal(setPick(s, '義體防護', 1, { lose: '生命', gain: ['抗性免疫'] }, derivedStats(s)).ok, true);
  assert.equal(setPick(s, '義體防護', 1, { lose: '生命', gain: ['物理傷害'] }, derivedStats(s)).ok, false); // 已鎖
  assert.equal(setPick(s, '義體防護', 4, { skip: true }).ok, true);
  const st = derivedStats(s);
  assert.equal(st.生命.total, hp - 1);
  assert.equal(pickText('義體防護', s.skillPicks.義體防護[1]), '生命 −1，抗性免疫 +1');
});

test('呼吸法不能略過；血肉合同固定 生命 −6、能量 +3；等級降低時自選失效；GM 可重設', () => {
  const s = fresh();
  s.skills.呼吸法 = 1;
  assert.match(setPick(s, '呼吸法', 1, { skip: true }).error, /一定要選/);
  s.skills.血肉合同 = 1;
  s.baseStats.生命 = 100;
  const hp = derivedStats(s).生命.total;
  const en = derivedStats(s).能量.total;
  assert.equal(setPick(s, '血肉合同', 1, {}, derivedStats(s)).ok, true);
  assert.equal(derivedStats(s).生命.total, hp - 6);
  assert.equal(derivedStats(s).能量.total, en + 3);
  s.skills.血肉合同 = 0;
  assert.equal(derivedStats(s).能量.total, en);
  s.skills.血肉合同 = 1;
  resetPicks(s, '血肉合同');
  assert.deepEqual(pendingPicks(s, '血肉合同'), [1]);
});
