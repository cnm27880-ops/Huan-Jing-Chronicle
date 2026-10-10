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
  assert.equal(enc.locked, false);
  assert.equal(errorOf(send(core, GM, { t: 'encNext' }))?.code, 'bad_enc'); // 還沒開打不能換人
  assert.equal(encOf(send(core, GM, { t: 'encStart' })).round, 1);
  assert.equal(enc.order.length, 3); // 玩家一、玩家二、小怪1
  assert.ok(!enc.order.some((o) => o.uid === '100' || o.id === '小怪2'));
  assert.ok(res.out.find((o) => o.msg.t === 'event').msg.event.lines.length === 4); // 3 個位置 + 一行提示
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

test('換位置：玩家開打前只能換自己的格子；開打後只有 GM 能換', () => {
  const core = room((n) => n);
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 1 } });
  const { order } = encOf(send(core, GM, { t: 'encInit' }, { online: ['300', '400'] }));
  const slot = (uid) => order.findIndex((o) => o.uid === uid);
  const other = [0, 1, 2].find((i) => i !== slot('300') && i !== slot('400'));
  assert.equal(errorOf(send(core, P1, { t: 'encSwap', a: slot('400'), b: other }))?.code, 'forbidden'); // 不是自己的格子
  assert.equal(errorOf(send(core, P1, { t: 'encSwap', a: 0, b: 0 }))?.code, 'bad_enc');
  assert.equal(errorOf(send(core, P1, { t: 'encSwap', a: 0, b: 9 }))?.code, 'bad_enc');
  const mine = slot('300');
  const swapped = encOf(send(core, P1, { t: 'encSwap', a: mine, b: slot('400') }));
  assert.equal(swapped.order[slot('400')].uid, '300');
  assert.equal(swapped.order[mine].uid, '400');
  send(core, GM, { t: 'encStart' });
  assert.equal(errorOf(send(core, P1, { t: 'encSwap', a: slot('400'), b: mine }))?.code, 'forbidden');
  assert.ok(encOf(send(core, GM, { t: 'encSwap', a: 0, b: 1 })));
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

test('新增敵人時 GM 可以指定強度分配：極端型集中在指定軌、雙軌型集中在指定兩軌；不合法的拒絕', () => {
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { count: 3, atkPower: 1000, defPower: 1000, hp: 10, atkType: 'extreme', atkFocus: 'B', defType: 'dual', defFocus: 'AC' } });
  for (const m of core.encounter().monsters) {
    assert.ok(m.atk.B >= 500 && m.atk.B <= 700, `B 是集中軌 ${JSON.stringify(m.atk)}`);
    assert.ok(m.def.B <= 250 && m.def.A >= 375 && m.def.C >= 375, `B 是弱軌 ${JSON.stringify(m.def)}`);
  }
  send(core, GM, { t: 'encAdd', kind: 'boss', spec: { count: 1, atkPower: 999, defPower: 999, hp: 10, atkType: 'balanced' } });
  const boss = core.encounter().monsters.find((m) => m.kind === 'boss');
  assert.ok(boss.atk.every((a) => a.A === 333 && a.B === 333 && a.C === 333));
  for (const bad of [{ atkType: 'weird' }, { atkType: 'extreme', atkFocus: 'AB' }, { defType: 'dual', defFocus: 'A' }, { atkFocus: 'A' }]) {
    assert.equal(errorOf(send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, ...bad } }))?.code, 'bad_enc', JSON.stringify(bad));
  }
});

test('敵人預組：只有 GM 能用；存下場上的敵人（生命全滿）、載入時取代場上並清空先攻、刪除', () => {
  const core = room();
  const presetsOf = (res) => res.out.find((o) => o.msg.t === 'presets');
  assert.equal(errorOf(send(core, P1, { t: 'presetList' }))?.code, 'forbidden');
  assert.equal(errorOf(send(core, GM, { t: 'presetSave', name: '空的' }))?.code, 'bad_preset');
  send(core, GM, { t: 'encAdd', kind: 'boss', spec: { count: 1, atkPower: 900, defPower: 900, hp: 500 } });
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 2 } });
  send(core, P1, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 100 }] });
  const saved = presetsOf(send(core, GM, { t: 'presetSave', name: '第三章魔王' }));
  assert.equal(saved.to, 'self');
  const p = saved.msg.list[0];
  assert.equal(p.name, '第三章魔王');
  assert.deepEqual(p.monsters.map((m) => m.id), ['BOSS1', '小怪1', '小怪2']);
  assert.equal(p.monsters[0].hp, 500); // 存成全滿
  const bossAtk = JSON.stringify(core.encounter().monsters[0].atk);
  send(core, GM, { t: 'encClear' });
  send(core, GM, { t: 'encAdd', kind: 'mob', spec: SPEC });
  send(core, GM, { t: 'encInit' }, { online: ['300'] });
  const res = send(core, GM, { t: 'presetLoad', name: '第三章魔王' });
  const enc = encOf(res);
  assert.equal(res.out.find((o) => o.msg.t === 'enc').to, 'all');
  assert.deepEqual(enc.monsters.map((m) => m.id), ['BOSS1', '小怪1', '小怪2']);
  assert.equal(JSON.stringify(enc.monsters[0].atk), bossAtk); // 抽好的 A/B/C 原封不動
  assert.deepEqual([enc.order.length, enc.locked, enc.next.mob, enc.next.boss], [0, false, 3, 2]);
  assert.ok(!res.out.find((o) => o.msg.t === 'event').msg.event.label.includes('第三章')); // 紀錄不寫預組名稱
  assert.equal(errorOf(send(core, GM, { t: 'presetLoad', name: '沒有這個' }))?.code, 'bad_preset');
  assert.equal(presetsOf(send(core, GM, { t: 'presetDel', name: '第三章魔王' })).msg.list.length, 0);
  assert.ok(!('presets' in core.hello(P1)));
});

// ---------- 2026/10 平衡更新：敵人等級與技能 ----------
const replyOf = (res) => res.out.find((o) => o.msg.t === 'encOk' && o.to === 'self')?.msg;

test('菁英：GM 用 kind: elite 新增，編號是「菁英N」，存 rank', () => {
  const core = room();
  const enc = encOf(send(core, GM, { t: 'encAdd', kind: 'elite', spec: { ...SPEC, count: 2 } }));
  assert.deepEqual(enc.monsters.map((m) => [m.id, m.rank, m.kind]), [['菁英1', 'elite', 'mob'], ['菁英2', 'elite', 'mob']]);
  assert.equal(encOf(send(core, GM, { t: 'encAdd', kind: 'mob', spec: { ...SPEC, count: 1 } })).monsters.at(-1).id, '小怪1');
  assert.equal(errorOf(send(core, GM, { t: 'encAdd', kind: 'zzz', spec: SPEC }))?.code, 'bad_enc');
});

test('承受攻擊（encUse atk）：任何玩家都能用，每回合有次數上限；GM 進下一回合後恢復', () => {
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'elite', spec: { ...SPEC, count: 1 } });
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'a', id: '菁英1', use: 'atk' })).left, 1);
  assert.equal(replyOf(send(core, P2, { t: 'encUse', rid: 'b', id: '菁英1', use: 'atk' })).left, 0);
  assert.match(errorOf(send(core, P1, { t: 'encUse', rid: 'c', id: '菁英1', use: 'atk' })).message, /已經攻擊 2 次/);
  assert.equal(errorOf(send(core, P1, { t: 'encRound' }))?.code, 'forbidden'); // 只有 GM 能進下一回合
  assert.equal(encOf(send(core, GM, { t: 'encRound' })).round, 1);
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'd', id: '菁英1', use: 'atk' })).left, 1);
});

test('敵人技能：只有 GM 能用；A 蓄力讓下一次承受攻擊多 20 顆；B 蓄力在 encHit 帶 usedB 時消耗；C 喝血由伺服器擲並寫紀錄', () => {
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'boss', spec: { ...SPEC, count: 1 } });
  assert.equal(errorOf(send(core, P1, { t: 'encUse', id: 'BOSS1', use: 'A' }))?.code, 'forbidden');
  const a = send(core, GM, { t: 'encUse', rid: 'a', id: 'BOSS1', use: 'A' });
  assert.match(a.out.find((o) => o.msg.t === 'event').msg.event.label, /BOSS1 使用 A 技能/);
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'x', id: 'BOSS1', use: 'atk' })).extraAtk, 20);
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'y', id: 'BOSS1', use: 'atk' })).extraAtk, 0); // 蓄力用掉了
  assert.match(errorOf(send(core, GM, { t: 'encUse', id: 'BOSS1', use: 'A' })).message, /用完了/);
  // B：蓄力兩次（BOSS 一回合 2 次），玩家打中時回報 usedB 才會扣
  send(core, GM, { t: 'encUse', id: 'BOSS1', use: 'B' });
  send(core, GM, { t: 'encUse', id: 'BOSS1', use: 'B' });
  assert.equal(core.encounter().monsters[0].charge.B, 2);
  send(core, P1, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 10, usedB: true }] });
  assert.equal(core.encounter().monsters[0].charge.B, 1);
  send(core, P1, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 10 }] }); // 沒帶 usedB：不扣
  assert.equal(core.encounter().monsters[0].charge.B, 1);
  // C：先受點傷才看得到回血
  send(core, P1, { t: 'encHit', hits: [{ id: 'BOSS1', dmg: 50 }] });
  const c = send(core, GM, { t: 'encUse', rid: 'c', id: 'BOSS1', use: 'C' });
  const ev = c.out.find((o) => o.msg.t === 'event').msg.event;
  assert.match(ev.label, /BOSS1 喝血（30D16）/);
  assert.equal(core.encounter().monsters[0].hp, 60); // 剩 30 血；測試的骰子每顆都擲 1，30D16 = 30，回到 60
  assert.match(errorOf(send(core, GM, { t: 'encUse', id: 'BOSS1', use: 'C' })).message, /用完了/);
});

test('預組換上場：技能次數與蓄力清掉，菁英編號接得上', () => {
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'elite', spec: { ...SPEC, count: 1 } });
  send(core, GM, { t: 'encUse', id: '菁英1', use: 'A' });
  send(core, GM, { t: 'presetSave', rid: 's', name: '測試' });
  send(core, GM, { t: 'presetLoad', rid: 'l', name: '測試' });
  const m = core.encounter().monsters[0];
  assert.equal(m.uses, undefined);
  assert.equal(m.charge, undefined);
  assert.equal(encOf(send(core, GM, { t: 'encAdd', kind: 'elite', spec: { ...SPEC, count: 1 } })).monsters.at(-1).id, '菁英2');
});

test('替隊友擋：每位玩家每回合 1 次；對象要是房間裡的玩家；擋不了不扣敵人的攻擊次數；新回合恢復', () => {
  const replyOf = (res) => res.out.find((o) => o.msg.t === 'encOk')?.msg;
  const core = room();
  send(core, GM, { t: 'encAdd', kind: 'boss', spec: { ...SPEC, count: 1 } }); // BOSS 一回合 3 次攻擊
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'a', id: 'BOSS1', use: 'atk', cover: P2.uid })).covered, P2.uid);
  // 同一回合第二次：被擋下，而且敵人的攻擊次數沒有被扣（還剩 2 次）
  assert.match(errorOf(send(core, P1, { t: 'encUse', id: 'BOSS1', use: 'atk', cover: P2.uid })).message, /已經替隊友擋過/);
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'b', id: 'BOSS1', use: 'atk' })).left, 1); // 自己承受不受擋人限制
  // 別的玩家各有自己的 1 次
  assert.ok(replyOf(send(core, P2, { t: 'encUse', rid: 'c', id: 'BOSS1', use: 'atk', cover: P1.uid })));
  // 不能替自己、GM、不存在的人擋
  assert.match(errorOf(send(core, P1, { t: 'encUse', id: 'BOSS1', use: 'atk', cover: P1.uid })).message, /不在房間/);
  assert.match(errorOf(send(core, P1, { t: 'encUse', id: 'BOSS1', use: 'atk', cover: GM.uid })).message, /不在房間/);
  assert.match(errorOf(send(core, P1, { t: 'encUse', id: 'BOSS1', use: 'atk', cover: '999' })).message, /不在房間/);
  // 新回合：恢復
  send(core, GM, { t: 'encRound' });
  assert.equal(replyOf(send(core, P1, { t: 'encUse', rid: 'd', id: 'BOSS1', use: 'atk', cover: P2.uid })).covered, P2.uid);
});
