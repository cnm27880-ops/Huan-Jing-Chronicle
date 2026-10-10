// 執行方式：npm test
// 戰鬥提醒與隊友資源條的判斷（src/game/nudge.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CHARACTER } from '../src/data/sample/fude.js';
import { addItem } from '../src/game/engine.js';
import { setResource } from '../src/game/resources.js';
import { usageOf, barsOf, partyDigest, detectEvents, createNudgeGate, canFeed, myOptions, NUDGE } from '../src/game/nudge.js';

const v = (o = {}) => ({ name: '甲', hp: 100, maxHp: 100, downed: false, res: { 魔力: [100, 100], 鬥氣: [50, 50] }, tox: 0, ...o });

test('資源用量：用掉的比例平均（含毒性）；滿的是 0、沒有資源也是 0', () => {
  assert.equal(usageOf(v()), 0);
  assert.ok(Math.abs(usageOf(v({ res: { 魔力: [0, 100], 鬥氣: [25, 50] }, tox: 15 })) - (1 + 0.5 + 1) / 3) < 1e-9);
  assert.equal(usageOf({ name: 'x', hp: 1, maxHp: 1, res: {} }), 0);
});

test('資源條：每條都是「還剩多少」，毒性畫成還能喝多少', () => {
  const bars = barsOf(v({ res: { 魔力: [25, 100] }, tox: 6 }));
  assert.deepEqual(bars.map((b) => [b.key, b.left]), [['魔力', 0.25], ['毒性', 0.6]]);
  assert.match(bars[1].text, /還能喝 9 點/);
  assert.equal(barsOf(v({ res: { 靈氣: [0, 0] }, tox: undefined })).length, 0); // 上限 0 的不畫
});

test('隊伍摘要：有人倒地是 bad、有人血低是 warn；戰鬥中資源很滿的人會被點名', () => {
  const mates = [v({ name: 'A' }), v({ name: 'B', hp: 30 }), v({ name: 'C', hp: 0, downed: true })];
  const d = partyDigest(mates, { inBattle: true });
  assert.equal(d.level, 'bad');
  assert.equal(d.downed, 1);
  assert.equal(d.low, 1);
  assert.equal(d.minPct, 0);
  assert.deepEqual(d.idle, ['A', 'B']); // 滿資源且沒倒地
  assert.deepEqual(partyDigest(mates).idle, []); // 沒在戰鬥不點名
  assert.equal(partyDigest([v()]).level, 'ok');
});

test('偵測事件：倒地、血量危急、全隊吃緊；第一次看到的人與自己不算', () => {
  const prev = { me: v({ name: '我' }), a: v({ name: 'A' }), b: v({ name: 'B' }), c: v({ name: 'C' }) };
  const down = detectEvents(prev, { ...prev, a: v({ name: 'A', hp: 0, downed: true }) }, { me: 'me' });
  assert.deepEqual(down.map((e) => [e.kind, e.uid]), [['downed', 'a']]);
  const danger = detectEvents(prev, { ...prev, b: v({ name: 'B', hp: 20 }) }, { me: 'me' });
  assert.deepEqual(danger.map((e) => [e.kind, e.uid]), [['danger', 'b']]);
  assert.deepEqual(detectEvents(prev, { ...prev, b: v({ name: 'B', hp: 35 }) }, { me: 'me' }), []); // 還沒到危急線
  assert.deepEqual(detectEvents(prev, { ...prev, d: v({ name: 'D', hp: 0, downed: true }) }, { me: 'me' }), []); // 剛出現的人
  assert.deepEqual(detectEvents(prev, { ...prev, me: v({ hp: 0, downed: true }) }, { me: 'me' }), []); // 自己倒地：不提醒
  assert.deepEqual(detectEvents(null, prev, { me: 'me' }), []);
  const bad = { ...prev, a: v({ hp: 0, downed: true }), b: v({ hp: 35 }) };
  const kinds = detectEvents(prev, bad, { me: 'me' }).map((e) => e.kind);
  assert.ok(kinds.includes('pressure'));
  assert.ok(kinds.includes('downed'));
  assert.equal(detectEvents(bad, { ...bad, c: v({ hp: 10 }) }, { me: 'me' }).some((e) => e.kind === 'pressure'), false); // 已經吃緊，不重複
});

test('防連發：同一個人同一種提醒要隔一段時間；脫離危險後才會再提醒', () => {
  const gate = createNudgeGate();
  const ev = { kind: 'downed', uid: 'a' };
  assert.equal(gate.allow(ev, {}, 0), true);
  assert.equal(gate.allow(ev, {}, NUDGE.cooldownMs - 1), false);
  assert.equal(gate.allow({ kind: 'downed', uid: 'b' }, {}, 1), true); // 別人不受影響
  gate.recovered({ a: v({ hp: 80 }) });
  assert.equal(gate.allow(ev, {}, 5), true); // 救回來了，再倒要再提醒
});

test('能不能餵、手上能做的事：藥水大瓶在前、還很滿的資源列出來', () => {
  assert.equal(canFeed(v({ tox: 14 }), '紅藥水'), false); // 毒性 +2 會超過 15
  assert.equal(canFeed(v({ tox: 13 }), '紅藥水'), true);
  const me = JSON.parse(JSON.stringify(SAMPLE_CHARACTER));
  addItem(me, '紅藥水', 2); addItem(me, '生命泉', 1);
  setResource(me, '魔力', 0);
  const o = myOptions(me);
  assert.equal(o.heals[0].name, '生命泉');
  assert.ok(o.heals.some((h) => h.name === '紅藥水' && h.qty >= 2));
  assert.equal(o.fresh.some((r) => r.key === '魔力'), false);
  assert.ok(o.fresh.length > 0);
});
