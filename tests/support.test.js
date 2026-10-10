// 補血／護盾輔助技能（納米醫療蜂、生生造化印）：自己用、只對隊友用、隊友收到時套用
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../src/game/importBot.js';
import { moveFromCatalog } from '../src/game/skills.js';
import { useSupport } from '../src/game/combat.js';
import { applyMail } from '../src/game/mail.js';
import { maxHp } from '../src/game/stats.js';

function mk(skill, level = 5) {
  const s = { ...blankCharacter('施法者'), skills: { [skill]: level } };
  s.baseStats = { ...s.baseStats, 生命: 200, 算力: 100, 靈氣: 100 };
  s.resources = { ...s.resources, 算力: 100, 靈氣: 100 };
  s.moves.push({ ...moveFromCatalog(skill), id: 'sup' });
  s.hp = 50;
  return s;
}

test('納米醫療蜂：對自己回復最大生命的百分比、扣算力；只對隊友施放時自己不回血但照樣付花費', () => {
  const s = mk('納米醫療蜂');
  const r = useSupport(s, 'sup', 1); // 16 算力 → 20%
  assert.equal(r.kind, 'heal');
  assert.equal(r.amount, Math.floor(maxHp(s) * 0.2));
  assert.equal(s.hp, 50 + r.amount);
  assert.ok(s.resources.算力 < 100);
  assert.equal(r.targets, 3); // 5 級：2 + 1 個目標
  const t = mk('納米醫療蜂');
  const only = useSupport(t, 'sup', 0, { self: false });
  assert.equal(t.hp, 50); // 沒回血
  assert.equal(only.healed, 0);
  assert.ok(t.resources.算力 < 100); // 但花費付了
});

test('生生造化印：自己上護盾（不可疊加）；self=false 不上盾', () => {
  const s = mk('生生造化印', 4);
  const r = useSupport(s, 'sup', 0);
  assert.equal(r.kind, 'shield');
  assert.equal(s.shield.hp, Math.floor(maxHp(s) * 0.1));
  assert.equal(s.shield.res, 6); // 4 級 → 抗性免疫 +6
  const t = mk('生生造化印', 4);
  useSupport(t, 'sup', 2, { self: false });
  assert.equal(t.shield?.hp ?? 0, 0);
});

test('資源不夠、倒地時不能施放，而且不會扣資源', () => {
  const s = mk('納米醫療蜂');
  s.resources.算力 = 5;
  const before = s.resources.算力;
  assert.match(useSupport(s, 'sup', 0).error, /資源不足/);
  assert.equal(s.resources.算力, before);
  const d = mk('納米醫療蜂');
  d.hp = 0;
  assert.match(useSupport(d, 'sup', 0).error, /倒地/);
});

test('隊友收到補血：照「自己的最大生命」算、倒地的會站起來；收到護盾：取代舊護盾', () => {
  const mate = { ...blankCharacter('隊友'), hp: 0 };
  mate.baseStats = { ...mate.baseStats, 生命: 300 };
  const heal = applyMail(mate, { kind: 'support', fromName: '施法者', skill: '納米醫療蜂', support: 'heal', pct: 20 });
  assert.equal(mate.hp, 60);
  assert.match(heal.lines.join(''), /站起來/);
  mate.shield = { hp: 5, res: 0 };
  applyMail(mate, { kind: 'support', fromName: '施法者', skill: '生生造化印', support: 'shield', pct: 15, res: 6 });
  assert.deepEqual(mate.shield, { hp: 45, res: 6 });
  assert.match(applyMail(mate, { kind: 'support', fromName: 'x', support: 'heal', pct: -5 }).title, /無法使用/);
  assert.equal(mate.hp, 60); // 壞資料不會改動角色
});
