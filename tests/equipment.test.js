// 執行方式：npm test
// 裝備：鑑定骰式（試算表「生產表」）、裝備欄、比較、數值加成
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGeneric, rollGear, identify, equip, unequip, discard, equipmentEffects, compareGear,
  identifiable, effectText, findJunk,
  parseGem, rollGem, identifyGems, identifiableGems, socketGem, socketTargets,
} from '../src/game/equipment.js';
import { derivedStats } from '../src/game/stats.js';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';

const fresh = () => JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
/** 依序回傳指定「結果值」的假亂數：給 sides 面骰時回傳剛好擲出 v 的 rng 值 */
const rolls = (...pairs) => {
  let i = 0;
  return () => {
    const [v, sides] = pairs[Math.min(i++, pairs.length - 1)];
    return (v - 1) / sides + 0.0001;
  };
};

test('通用裝備名稱解析（低階 = 初階）', () => {
  assert.deepEqual(parseGeneric('傳說武器'), { tier: '傳說', slot: 'weapon' });
  assert.deepEqual(parseGeneric('低階飾品'), { tier: '初階', slot: 'accessory' });
  assert.equal(parseGeneric('物理傷害寶石'), null);
  assert.equal(parseGeneric('傳說技能書'), null);
});

test('武器：傳說 = 1D24+12，1D4 決定屬性（4 = 真實傷害）', () => {
  // 骰 24（滿骰）+ 骰 4 → 真實傷害 +36（與試算表背包一致）
  const g = rollGear('傳說', 'weapon', rolls([24, 24], [4, 4]));
  assert.deepEqual(g.effects, [{ stat: '真實傷害', value: 36 }]);
  // 骰 1 → 最低 13，1D4=3 → 靈魂傷害
  const low = rollGear('傳說', 'weapon', rolls([1, 24], [3, 4]));
  assert.deepEqual(low.effects, [{ stat: '靈魂傷害', value: 13 }]);
});

test('各等階武器範圍：初階 1D3、進階 1D6+3、大師 1D12+6、傳說 1D24+12', () => {
  const range = (tier) => {
    const lo = rollGear(tier, 'weapon', rolls([1, 100], [1, 4])).effects[0].value;
    const hi = rollGear(tier, 'weapon', rolls([100, 100], [1, 4])).effects[0].value;
    return [lo, hi];
  };
  // rolls 的 sides 只用來換算比例；比例 1/100 與 100/100 對任何面數都落在最小與最大面
  assert.deepEqual(range('初階'), [1, 3]);
  assert.deepEqual(range('進階'), [4, 9]);
  assert.deepEqual(range('大師'), [7, 18]);
  assert.deepEqual(range('傳說'), [13, 36]);
});

test('防具：1D4 → 體魄、抗性、精神、絕對防禦', () => {
  const stat = (d4) => rollGear('大師', 'armor', rolls([5, 12], [d4, 4])).effects[0];
  assert.deepEqual(stat(1), { stat: '體魄強韌', value: 11 });
  assert.equal(stat(2).stat, '抗性免疫');
  assert.equal(stat(3).stat, '精神意志');
  assert.equal(stat(4).stat, '絕對防禦');
});

test('飾品：1D15 決定屬性，數值固定（傳說 12/40/8/40/8/16/24）', () => {
  const acc = (d15, tier = '傳說') => rollGear(tier, 'accessory', rolls([d15, 15]));
  assert.deepEqual(acc(3).effects, [{ stat: '靈魂傷害', value: 12 }]);
  assert.deepEqual(acc(4).effects, [{ stat: '真實傷害', value: 12 }]);
  assert.deepEqual(acc(8).effects, [{ stat: '絕對防禦', value: 12 }]);
  assert.deepEqual(acc(9).effects, [{ stat: '生命', value: 40 }]);
  assert.deepEqual(acc(10).effects, [{ stat: '能量', value: 8 }]);
  assert.deepEqual(acc(11).effects, [{ stat: '魔力', value: 40 }]);
  assert.deepEqual(acc(12).effects, [{ stat: '鬥氣', value: 8 }]);
  assert.deepEqual(acc(13).effects, [{ stat: '算力', value: 16 }]);
  assert.deepEqual(acc(14).effects, [{ stat: '靈氣', value: 24 }]);
  assert.deepEqual(acc(1, '大師').effects, [{ stat: '物理傷害', value: 6 }]);
  assert.deepEqual(acc(9, '進階').effects, [{ stat: '生命', value: 10 }]);
  assert.deepEqual(acc(9, '初階').effects, [{ stat: '生命', value: 5 }]);
  // 特殊（15）：再骰兩次 D14（魂傷 3、生命 9）→ 兩條屬性
  const sp = rollGear('傳說', 'accessory', rolls([15, 15], [3, 14], [9, 14]));
  assert.equal(sp.special, true);
  assert.deepEqual(sp.effects, [{ stat: '靈魂傷害', value: 12 }, { stat: '生命', value: 40 }]);
  assert.deepEqual(sp.roll.extra, [3, 9]);
  // 兩次同屬性 → 數值相加
  const dup = rollGear('傳說', 'accessory', rolls([15, 15], [4, 14], [4, 14]));
  assert.deepEqual(dup.effects, [{ stat: '真實傷害', value: 24 }]);
  // 沒有效果的匯入特殊飾品（手動備註）仍顯示「特殊」
  assert.match(effectText({ special: true, effects: [] }), /特殊/);
});

test('鑑定：消耗通用裝備、產生個別裝備、原料不足就停', () => {
  const s = fresh();
  const have = s.inventory['傳說防具'];
  const before = s.gear.length;
  const made = identify(s, '傳說防具', 3);
  assert.equal(made.length, 3);
  assert.equal(s.inventory['傳說防具'], have - 3);
  assert.equal(s.gear.length, before + 3);
  assert.equal(new Set(s.gear.map((g) => g.id)).size, s.gear.length, 'id 不重複');
  const all = identify(s, '傳說武器', 99);
  assert.equal(all.length, 1);
  assert.equal(s.inventory['傳說武器'], undefined);
  assert.deepEqual(identify(s, '鐵礦石', 1), []);
});

test('裝備欄：武器/防具/飾品 ×2，換裝會把舊的放回背包，不能放錯欄', () => {
  const s = fresh();
  const spareWeapon = s.gear.find((g) => g.slot === 'weapon');
  const oldWeapon = s.equipment.weapon;
  assert.equal(equip(s, spareWeapon.id, 'weapon'), null);
  assert.equal(s.equipment.weapon.id, spareWeapon.id);
  assert.ok(s.gear.some((g) => g.id === oldWeapon.id));
  const armor = s.gear.find((g) => g.slot === 'armor');
  assert.match(equip(s, armor.id, 'weapon'), /不能放進武器欄/);
  const acc = s.gear.find((g) => g.slot === 'accessory');
  assert.equal(equip(s, acc.id, 'acc2'), null);
  unequip(s, 'acc2');
  assert.equal(s.equipment.acc2, null);
});

test('裝備加成進入面板，且與基礎、食物分開記錄', () => {
  const s = fresh();
  const eff = equipmentEffects(s);
  assert.equal(eff.真實傷害, 36 + 6);
  assert.equal(eff.絕對防禦, 36);
  assert.equal(eff.靈魂傷害, 12);
  assert.equal(eff.鬥氣, 8);
  const p = derivedStats(s);
  assert.equal(p.真實傷害.total, 87 + 42);
  assert.deepEqual(p.真實傷害.parts.map((x) => x.label), ['基礎', '裝備']);
  unequip(s, 'weapon');
  assert.equal(derivedStats(s).真實傷害.total, 87 + 6);
});

test('比較：同屬性比數值、不同屬性不比、空欄位標示 empty', () => {
  const s = fresh();
  const cmp = (stat, value, slot = 'weapon') => compareGear(s, { slot, effects: [{ stat, value }] });
  assert.equal(cmp('真實傷害', 37), 'better');
  assert.equal(cmp('真實傷害', 30), 'worse');
  assert.equal(cmp('真實傷害', 36), 'same');
  assert.equal(cmp('物理傷害', 99), 'different');
  unequip(s, 'armor');
  assert.equal(cmp('絕對防禦', 1, 'armor'), 'empty');
  // 飾品兩欄：同屬性只和較低的那件比（身上有 真傷+6 與 魂傷+12/鬥氣+8）
  assert.equal(cmp('真實傷害', 20, 'accessory'), 'better');
  assert.equal(cmp('魔力', 40, 'accessory'), 'different');
  assert.equal(compareGear(s, { slot: 'accessory', special: true, effects: [] }), 'different');
});

test('丟棄與可鑑定清單', () => {
  const s = fresh();
  const ids = s.gear.slice(0, 3).map((g) => g.id);
  assert.equal(discard(s, ids), 3);
  assert.ok(identifiable(s).every((x) => x.qty > 0 && x.tier));
  assert.ok(identifiable(s).some((x) => x.name === '傳說飾品'));
});

test('整理背包：同欄位同屬性只留最高（武器/防具 1 件、飾品 2 件），身上穿的不會被丟', () => {
  const s = fresh();
  const junk = new Set(findJunk(s));
  const byId = (id) => [...s.gear, ...Object.values(s.equipment)].find((g) => g.id === id);
  const label = (id) => { const g = byId(id); return `${g.slot}:${g.effects[0].stat}+${g.effects[0].value}`; };
  const junkLabels = [...junk].map(label);
  // 身上武器 真傷+36 → 背包 真傷+28、+27 都是多餘的
  assert.ok(junkLabels.includes('weapon:真實傷害+28'));
  assert.ok(junkLabels.includes('weapon:真實傷害+27'));
  // 身上防具 絕防+36 → 背包 絕防+28、+25 多餘；但體魄+36 是不同屬性要留
  assert.ok(junkLabels.includes('armor:絕對防禦+28'));
  assert.ok(junkLabels.includes('armor:絕對防禦+25'));
  assert.ok(!junkLabels.includes('armor:體魄強韌+36'));
  // 兩件魔力+40 飾品：飾品可穿兩件，所以都留
  assert.equal(junkLabels.filter((l) => l === 'accessory:魔力+40').length, 0);
  // 身上穿著的一件都不在名單
  Object.values(s.equipment).forEach((g) => assert.ok(!junk.has(g.id)));
  // 再多一件魔力+40：飾品只能穿兩件，第三件才是多餘
  s.gear.push({ id: 999, tier: '傳說', slot: 'accessory', effects: [{ stat: '魔力', value: 40 }], roll: {} });
  assert.equal(findJunk(s).filter((id) => id === 999 || byId(id)?.effects?.[0]?.stat === '魔力').length, 1);
});

// ---------- 寶石（規則原文「寶石鑲嵌」；鑑定時擲數值） ----------
test('寶石名稱解析', () => {
  assert.equal(parseGem('生命寶石'), '生命');
  assert.equal(parseGem('物理傷害寶石'), '物理傷害');
  assert.equal(parseGem('傳說武器'), null);
  assert.equal(parseGem('不存在寶石'), null);
});

test('寶石骰式：攻防與靈氣 1d12+10、生命／魔力 1d24+20、鬥氣 1d3+5、算力 1d8+8', () => {
  const range = (stat, sides) => [rollGem(stat, rolls([1, sides])).value, rollGem(stat, rolls([sides, sides])).value];
  assert.deepEqual(range('物理傷害', 12), [11, 22]);
  assert.deepEqual(range('精神意志', 12), [11, 22]);
  assert.deepEqual(range('靈氣', 12), [11, 22]);
  assert.deepEqual(range('生命', 24), [21, 44]);
  assert.deepEqual(range('魔力', 24), [21, 44]);
  assert.deepEqual(range('鬥氣', 3), [6, 8]);
  assert.deepEqual(range('算力', 8), [9, 16]);
});

test('鑑定寶石：消耗背包、存進 state.gems、數值固定', () => {
  const s = fresh();
  s.inventory.生命寶石 = 2;
  assert.deepEqual(identifiableGems(s).find((x) => x.stat === '生命')?.qty, 2);
  const made = identifyGems(s, '生命寶石', 5, rolls([24, 24], [1, 24]));
  assert.equal(made.length, 2); // 只有 2 顆
  assert.deepEqual(made.map((g) => g.value), [44, 21]);
  assert.equal(s.inventory.生命寶石 ?? 0, 0);
  assert.equal(s.gems.length, 2);
  assert.notEqual(made[0].id, made[1].id);
});

test('鑲嵌：只能鑲傳說裝備、每件 1 顆，鑲在身上的會計入數值', () => {
  const s = fresh();
  s.inventory.生命寶石 = 2;
  const [a, b] = identifyGems(s, '生命寶石', 2, rolls([10, 24]));
  const before = derivedStats(s).生命.total;
  const weapon = s.equipment.weapon; // 示範角色身上是傳說武器
  assert.ok(socketTargets(s).some((g) => g.id === weapon.id));
  assert.equal(socketGem(s, a.id, weapon.id), null);
  assert.deepEqual(weapon.gem, { id: a.id, stat: '生命', value: 30 });
  assert.equal(derivedStats(s).生命.total, before + 30);
  assert.ok(!s.gems.some((g) => g.id === a.id));
  assert.match(socketGem(s, b.id, weapon.id), /只能鑲 1 顆/);
  assert.ok(!socketTargets(s).some((g) => g.id === weapon.id));
  // 非傳說裝備不能鑲
  const master = s.equipment.acc2; // 大師飾品
  assert.match(socketGem(s, b.id, master.id), /只能鑲進傳說/);
  assert.ok(s.gems.some((g) => g.id === b.id)); // 失敗時寶石還在
});

test('整理：背包裡鑲了寶石的裝備不會被列為可丟棄', () => {
  const s = fresh();
  s.inventory.生命寶石 = 1;
  const [gem] = identifyGems(s, '生命寶石', 1, rolls([10, 24]));
  const weak = s.gear.find((g) => g.slot === 'weapon' && g.effects[0].stat === '真實傷害' && g.effects[0].value === 27);
  assert.ok(findJunk(s).includes(weak.id));
  socketGem(s, gem.id, weak.id);
  assert.ok(!findJunk(s).includes(weak.id));
});

import { addManualGear as _addManualGear, equipmentEffects as _effects } from '../src/game/equipment.js';
import { blankCharacter as _blank } from '../src/game/importBot.js';

test('GM 手動放裝備：穿上並從手動調整扣掉，面板不變', () => {
  const s = _blank('測試');
  s.adjust = { 真實傷害: 34 };
  const r = _addManualGear(s, { name: '奶綠大劍', tier: '初階', slot: 'weapon', effects: [{ stat: '真實傷害', value: 29 }], equip: true, compensate: true });
  assert.ok(r.ok && r.equipped);
  assert.equal(s.equipment.weapon.name, '奶綠大劍');
  assert.equal(s.adjust.真實傷害, 5);
  assert.equal(_effects(s).真實傷害, 29);
});

test('GM 手動放裝備：欄位已有裝備時只放進背包；不合法的輸入被擋下', () => {
  const s = _blank('測試');
  s.adjust = {};
  assert.ok(_addManualGear(s, { tier: '初階', slot: 'weapon', effects: [{ stat: '真實傷害', value: 3 }], equip: true }).equipped);
  const second = _addManualGear(s, { tier: '初階', slot: 'weapon', effects: [{ stat: '真實傷害', value: 2 }], equip: true, compensate: true });
  assert.ok(second.ok && !second.equipped);
  assert.equal(s.gear.length, 1);
  assert.equal(s.adjust.真實傷害, undefined); // 沒穿上就不扣調整
  assert.ok(!_addManualGear(s, { tier: '神級', slot: 'weapon', effects: [{ stat: '真實傷害', value: 1 }] }).ok);
  assert.ok(!_addManualGear(s, { tier: '初階', slot: 'weapon', effects: [{ stat: '亂寫', value: 1 }] }).ok);
  assert.ok(!_addManualGear(s, { tier: '初階', slot: 'weapon', effects: [] }).ok);
  assert.ok(!_addManualGear(s, { tier: '初階', slot: 'weapon', effects: [{ stat: '真實傷害', value: 1 }, { stat: '物理傷害', value: 1 }] }).ok);
});
