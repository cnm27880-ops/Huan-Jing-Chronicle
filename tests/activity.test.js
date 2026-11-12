// 玩家日誌的內容格式：修整結果卡 → 日誌、輸入整理
import test from 'node:test';
import assert from 'node:assert/strict';
import { restEntry, cleanActivity, lootLines, summarizeRolls, ACT_TEXT_MAX } from '../src/game/activity.js';

test('採集結果 → 日誌：標題含次數與經驗，細節是戰利品（多的在前）與用掉的紀念品', () => {
  const e = restEntry({ kind: 'gather', action: '釣魚', exp: 450, loot: { 鮮美肉: 7, 乾癟肉: 23 }, rolls: [{ used: ['掉毛喵的私人釣點'] }, { used: [] }, { used: ['掉毛喵的私人釣點'] }] });
  assert.equal(e.cat, 'rest');
  assert.equal(e.text, '採集 釣魚 ×3，經驗 +450');
  assert.deepEqual(e.lines, ['乾癟肉 ×23', '鮮美肉 ×7', '用掉紀念品：掉毛喵的私人釣點 ×2']);
});

test('製作結果 → 日誌：成功數、產出雙倍、全部失敗', () => {
  const ok = restEntry({ kind: 'craft', action: '烹飪', diff: '困難', loot: { 豪華蓋飯: 4 }, rolls: [{ success: true, doubled: true, used: ['小廚的不甘'] }, { success: false, used: [] }] });
  assert.equal(ok.text, '製作 烹飪（困難）×2，成功 1/2（含產出雙倍）');
  assert.ok(ok.lines.includes('豪華蓋飯 ×4'));
  const fail = restEntry({ kind: 'craft', action: '鑄造', diff: '普通', loot: {}, rolls: [{ success: false, used: [] }] });
  assert.deepEqual(fail.lines, ['全部失敗，原料全毀']);
  assert.match(restEntry({ kind: 'gather', action: '挖礦', rolls: [], loot: {} }).text, /時間不足/);
  assert.match(restEntry({ kind: 'craft', action: '調劑', diff: '簡單', rolls: [], loot: {} }).text, /原料不足/);
  assert.deepEqual(restEntry({ kind: 'note', text: '收割：肉球 ×10' }), { cat: 'rest', text: '收割：肉球 ×10', lines: [] });
});

test('整理輸入：類別要對、文字不能空、太長會截斷、控制字元變空白', () => {
  assert.equal(cleanActivity({ cat: 'zzz', text: 'a' }), null);
  assert.equal(cleanActivity({ cat: 'item', text: '  ' }), null);
  assert.equal(cleanActivity(null), null);
  const c = cleanActivity({ cat: 'item', text: `a\u0000b${'x'.repeat(300)}`, lines: ['ok', '', 5, 'y'.repeat(200)] });
  assert.equal(c.text.length, ACT_TEXT_MAX);
  assert.ok(c.text.startsWith('a b'));
  assert.equal(c.lines.length, 3); // 空字串被濾掉；數字轉成字串保留
  assert.equal(c.lines[2].length, 80);
  assert.deepEqual(lootLines({ 甲: 1, 乙: 5 }), ['乙 ×5', '甲 ×1']);
});

test('骰子明細濃縮成統計：次數、成功數、評級、最低最高、紀念品；二十萬筆也不會壞（不用展開參數）', () => {
  const s = summarizeRolls([
    { total: 19, success: true, used: ['甲'], doubled: true },
    { total: 38, success: true, used: [] },
    { total: 5, success: false, used: ['甲', '乙'] },
  ]);
  assert.deepEqual(s, { n: 3, ok: 2, tiers: {}, lo: 5, hi: 38, total: 62, used: 3, usedBy: { 甲: 2, 乙: 1 }, doubled: true });
  const g = summarizeRolls([{ total: 12, tier: '簡單', used: [] }, { total: 30, tier: '史詩', used: [] }, { total: 11, tier: '簡單', used: [] }]);
  assert.deepEqual(g.tiers, { 簡單: 2, 史詩: 1 });
  assert.equal(summarizeRolls([]).n, 0);
  const big = summarizeRolls(Array.from({ length: 200000 }, (_, i) => ({ total: 19 + (i % 20), success: true, used: [] })));
  assert.deepEqual([big.n, big.ok, big.lo, big.hi], [200000, 200000, 19, 38]);
});

test('規則函式給 maxRolls：次數超過只回統計、不留明細，背包與戰利品結果和原本一樣；沒超過照舊回明細', async () => {
  const { craft, gather } = await import('../src/game/engine.js');
  const { SAMPLE_CHARACTER } = await import('../src/data/sample/fude.js');
  const seeded = () => { let x = 12345; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };
  const mk = () => { const s = structuredClone(SAMPLE_CHARACTER); s.inventory['秘銀礦'] = 6000; s.time = 500; return s; };
  const a = mk(), b = mk();
  const full = craft(a, '鑄造', '普通', 1000, [], seeded());
  const lite = craft(b, '鑄造', '普通', 1000, [], seeded(), { maxRolls: 100 });
  assert.equal(lite.rolls, null);
  assert.deepEqual(lite.sum, summarizeRolls(full.rolls));
  assert.deepEqual(lite.loot, full.loot);
  assert.deepEqual(b, a);
  assert.deepEqual(restEntry({ kind: 'craft', action: '鑄造', diff: '普通', ...lite }), restEntry({ kind: 'craft', action: '鑄造', diff: '普通', ...full }));
  const g1 = gather(a, '釣魚', 300, [], seeded()), g2 = gather(b, '釣魚', 300, [], seeded(), { maxRolls: 100 });
  assert.deepEqual(g2.sum, summarizeRolls(g1.rolls));
  assert.deepEqual([g2.loot, g2.exp, b], [g1.loot, g1.exp, a]);
  assert.equal(craft(mk(), '鑄造', '普通', 100, [], seeded(), { maxRolls: 100 }).rolls.length, 100);
});
