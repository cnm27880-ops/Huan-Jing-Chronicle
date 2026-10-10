// 執行方式：在專案根目錄 npm test
// 信箱：送東西、餵藥（對方不用同意；不在線留在伺服器；只有第一個領的人拿得到）
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { MAX_PENDING_MAIL } from '../src/config.js';
import { makeDb } from './helpers.js';

const P1 = { uid: '300', name: '玩家一', avatar: null };
const P2 = { uid: '400', name: '玩家二', avatar: null };
const OUT = { uid: '999', name: '路人', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,200,300,400', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '200' };

function room() {
  let clock = 1_000_000;
  const rng = () => 0.5;
  rng.int = () => 4; // 每顆骰子都是 4
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng, uuid: (() => { let n = 0; return () => `id${++n}`; })() });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 250; return handle(...a); };
  core.join(P1); core.join(P2);
  return core;
}
const send = (core, user, msg) => core.handle(user, JSON.stringify(msg));
const errorOf = (res) => res.out.find((o) => o.msg.t === 'error')?.msg;
const pushed = (res) => res.out.find((o) => o.to === 'user');

test('送東西：存進對方信箱、即時推給對方；對方上線（hello）也會帶著；寄件人只收到成功回覆', () => {
  const core = room();
  const res = send(core, P1, { t: 'mailSend', rid: 'r1', to: '400', kind: 'gift', items: { 紅藥水: 2, 鐵礦: 10 } });
  assert.ok(res.out.some((o) => o.to === 'self' && o.msg.t === 'mailSent'));
  const p = pushed(res);
  assert.equal(p.uid, '400');
  assert.deepEqual(p.msg.mails[0].items, { 紅藥水: 2, 鐵礦: 10 });
  assert.equal(p.msg.mails[0].fromName, '玩家一');
  assert.equal(core.hello(P2).mail.length, 1); // 對方當時不在線，上線時才看到
  assert.equal(core.hello(P1).mail.length, 0);
  assert.ok(!res.out.some((o) => o.to === 'all')); // 送東西不公開
});

test('領取：只有收件人、只有第一次拿得到；領完信箱就空了', () => {
  const core = room();
  const id = pushed(send(core, P1, { t: 'mailSend', to: '400', kind: 'gift', items: { 鐵礦: 1 } })).msg.mails[0].id;
  const claim = (u) => send(core, u, { t: 'mailClaim', rid: 'c', id }).out[0].msg;
  assert.equal(claim(P1).mail, null); // 寄件人不能領
  assert.equal(claim(P2).mail.id, id);
  assert.equal(claim(P2).mail, null); // 第二個分頁來晚了
  assert.equal(core.hello(P2).mail.length, 0);
});

test('送東西的驗證：不能寄給自己、不在白名單、空的、數量不對、太多種、信箱滿了', () => {
  const core = room();
  const gift = (to, items, from = P1) => errorOf(send(core, from, { t: 'mailSend', to, kind: 'gift', items }))?.code;
  assert.equal(gift('300', { 鐵礦: 1 }), 'bad_mail');
  assert.equal(gift('999', { 鐵礦: 1 }), 'bad_mail');
  assert.equal(gift('400', {}), 'bad_mail');
  assert.equal(gift('400', { 鐵礦: 0 }), 'bad_mail');
  assert.equal(gift('400', { 鐵礦: 1.5 }), 'bad_mail');
  assert.equal(gift('400', { 鐵礦: 10000 }), 'bad_mail');
  assert.equal(gift('400', Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`物${i}`, 1]))), 'bad_mail');
  assert.equal(send(core, OUT, { t: 'mailSend', to: '400', kind: 'gift', items: { 鐵礦: 1 } }).close?.code, 4403); // 白名單外的人連線就會被踢，不能寄
  assert.equal(errorOf(send(core, P1, { t: 'mailSend', to: '400', kind: 'weird' }))?.code, 'bad_mail');
  for (let i = 0; i < MAX_PENDING_MAIL; i++) assert.equal(gift('400', { 鐵礦: 1 }), undefined);
  assert.equal(gift('400', { 鐵礦: 1 }), 'mail_full');
});

test('餵藥：伺服器擲回復點數、寫進公開的戰鬥紀錄；只能餵回復藥水', () => {
  const core = room();
  const res = send(core, P1, { t: 'mailSend', rid: 'r', to: '400', kind: 'potion', potion: '紅藥水' });
  const mail = pushed(res).msg.mails[0];
  assert.deepEqual([mail.kind, mail.potion, mail.heal], ['potion', '紅藥水', 8]); // 2D10，每顆 4
  const ev = res.out.find((o) => o.to === 'all').msg.event;
  assert.equal(ev.kind, 'potion');
  assert.equal(ev.srv, true);
  assert.match(ev.label, /玩家一 餵 玩家二/);
  assert.equal(res.out.find((o) => o.msg.t === 'mailSent').msg.heal, 8);
  assert.equal(errorOf(send(core, P1, { t: 'mailSend', to: '400', kind: 'potion', potion: '黃藥水' }))?.code, 'bad_mail');
  assert.equal(errorOf(send(core, P1, { t: 'mailSend', to: '400', kind: 'potion', potion: '不存在' }))?.code, 'bad_mail');
});

test('餵藥：對方存在伺服器的毒性已滿就不能餵', () => {
  const core = room();
  core.db.exec('INSERT INTO characters(uid, json, version, updated_at) VALUES (?, ?, 1, 1)', '400', JSON.stringify({ name: '乙', toxicity: 14 }));
  const e = errorOf(send(core, P1, { t: 'mailSend', to: '400', kind: 'potion', potion: '紅藥水' }));
  assert.equal(e?.code, 'toxic');
  assert.match(e.message, /毒性是 14/);
  assert.equal(core.pendingMail('400').length, 0); // 失敗不留信
});

test('隊友補血／護盾技能：伺服器驗證、記一筆紀錄（用對方的角色名）、對方領信時才套用', () => {
  const core = room();
  core.db.exec('INSERT INTO vitals(uid, json, t) VALUES (?, ?, 1)', '400', JSON.stringify({ name: '乙角色', hp: 10, maxHp: 100, downed: false, res: {} }));
  const res = send(core, P1, { t: 'mailSend', rid: 's1', to: '400', kind: 'support', skill: '納米醫療蜂', support: 'heal', pct: 20 });
  const ev = res.out.find((o) => o.msg.t === 'event').msg.event;
  assert.match(ev.label, /玩家一 對 乙角色 施放 納米醫療蜂/);
  assert.equal(pushed(res).msg.mails[0].kind, 'support');
  assert.equal(pushed(res).msg.mails[0].pct, 20);
  const shield = send(core, P1, { t: 'mailSend', to: '400', kind: 'support', skill: '生生造化印', support: 'shield', pct: 15, res: 6 });
  assert.equal(pushed(shield).msg.mails[0].res, 6);
  for (const bad of [{ support: 'x', pct: 10 }, { support: 'heal', pct: 0 }, { support: 'heal', pct: 101 }, { support: 'heal', pct: 1.5 }, { support: 'heal' }]) {
    assert.equal(errorOf(send(core, P1, { t: 'mailSend', to: '400', kind: 'support', skill: '納米醫療蜂', ...bad }))?.code, 'bad_mail', JSON.stringify(bad));
  }
  assert.equal(errorOf(send(core, P1, { t: 'mailSend', to: '400', kind: 'support', support: 'heal', pct: 10 }))?.code, 'bad_mail'); // 沒有技能名稱
});

// ---------- 玩家交易 ----------
const offerOf = (res) => pushed(res).msg.mails[0];
const mailsTo = (res, uid) => res.out.filter((o) => o.to === 'user' && o.uid === uid && o.msg.t === 'mail').flatMap((o) => o.msg.mails);
const tradeSend = (core, from = P1, to = '400', give = { 大師技能書: 10 }, want = { 豪華蓋飯: 10 }) => send(core, from, { t: 'mailSend', rid: 's', to, kind: 'trade', give, want });

test('玩家交易：發單存進對方信箱（hello 也看得到）；一般領取（mailClaim）領不走交易單', () => {
  const core = room();
  const res = tradeSend(core);
  const o = offerOf(res);
  assert.deepEqual([o.kind, o.give, o.want, o.to, o.toName, o.fromName], ['trade', { 大師技能書: 10 }, { 豪華蓋飯: 10 }, '400', '玩家二', '玩家一']);
  assert.equal(core.hello(P2).mail.length, 1);
  assert.equal(send(core, P2, { t: 'mailClaim', rid: 'c', id: o.id }).out[0].msg.mail, null); // 領不走，不然寄件人的東西就憑空消失
  assert.equal(core.hello(P2).mail.length, 1);
});

test('玩家交易：發單的驗證（要給與要換都至少一樣、不能寄給自己、未回覆上限）', () => {
  const core = room();
  const code = (res) => errorOf(res)?.code;
  assert.equal(code(tradeSend(core, P1, '400', {}, { 豪華蓋飯: 1 })), 'bad_mail');
  assert.equal(code(tradeSend(core, P1, '400', { 鐵礦: 1 }, {})), 'bad_mail');
  assert.equal(code(tradeSend(core, P1, '400', { 鐵礦: 1 }, { 豪華蓋飯: 0 })), 'bad_mail');
  assert.equal(code(tradeSend(core, P1, '300')), 'bad_mail');
  for (let i = 0; i < 10; i++) assert.equal(code(tradeSend(core)), undefined);
  assert.equal(code(tradeSend(core)), 'trade_full');
});

test('玩家交易：對方接受 → want 寄給 A、give 寄給 B（一般信箱），單子消失', () => {
  const core = room();
  const o = offerOf(tradeSend(core));
  const res = send(core, P2, { t: 'tradeRespond', rid: 'r', id: o.id, action: 'accept' });
  assert.equal(res.out.find((x) => x.to === 'self').msg.action, 'accept');
  const toA = mailsTo(res, '300')[0];
  const toB = mailsTo(res, '400')[0];
  assert.deepEqual([toA.kind, toA.items, toA.note], ['gift', { 豪華蓋飯: 10 }, '玩家二 接受了你的交易']);
  assert.deepEqual([toB.items, toB.note], [{ 大師技能書: 10 }, '與 玩家一 的交易成功']);
  assert.ok(res.out.some((x) => x.uid === '300' && x.msg.t === 'tradeChanged'));
  assert.equal(core.hello(P2).mail.filter((m) => m.kind === 'trade').length, 0);
  assert.equal(errorOf(send(core, P2, { t: 'tradeRespond', id: o.id, action: 'accept' }))?.code, 'bad_trade'); // 同一張單只能處理一次
});

test('玩家交易：拒絕、東西不夠（失敗）、A 取消 → give 都退回 A', () => {
  const core = room();
  const run = (user, action, label) => {
    const o = offerOf(tradeSend(core));
    const res = send(core, user, { t: 'tradeRespond', rid: 'r', id: o.id, action });
    const back = mailsTo(res, '300');
    assert.equal(back.length, 1, label);
    assert.deepEqual([back[0].items, back[0].bounced], [{ 大師技能書: 10 }, true], label);
    return back[0].note;
  };
  assert.match(run(P2, 'reject', '拒絕'), /拒絕了你的交易/);
  assert.match(run(P2, 'fail', '失敗'), /東西不夠，交易失敗/);
  assert.match(run(P1, 'cancel', '取消'), /你取消了給 玩家二 的交易/);
});

test('玩家交易：只有收件人能接受／拒絕、只有發單的人能取消；名單 tradeList 只列自己相關的', () => {
  const core = room();
  const o = offerOf(tradeSend(core));
  assert.equal(errorOf(send(core, P1, { t: 'tradeRespond', id: o.id, action: 'accept' }))?.code, 'bad_trade'); // 發單的人不能自己接受
  assert.equal(errorOf(send(core, P2, { t: 'tradeRespond', id: o.id, action: 'cancel' }))?.code, 'bad_trade'); // 收件人不能取消
  assert.equal(errorOf(send(core, P2, { t: 'tradeRespond', id: o.id, action: 'steal' }))?.code, 'bad_trade');
  const list = (u) => send(core, u, { t: 'tradeList', rid: 'l' }).out[0].msg.offers;
  assert.equal(list(P1).length, 1);
  assert.equal(list(P2).length, 1);
  assert.equal(send(core, { uid: '100', name: 'GM', avatar: null }, { t: 'tradeList', rid: 'l' }).out[0].msg.offers.length, 0);
  assert.equal(send(core, P2, { t: 'tradeRespond', id: o.id, action: 'reject' }).out[0].msg.t, 'tradeOk');
  assert.equal(list(P1).length, 0);
});

test('玩家交易加金幣：每一邊物品或金幣至少一樣；成交時金幣跟著信寄出；退回也帶金幣', () => {
  const core = room();
  const code = (res) => errorOf(res)?.code;
  const send2 = (extra, from = P1) => send(core, from, { t: 'mailSend', rid: 's', to: '400', kind: 'trade', give: {}, want: {}, ...extra });
  assert.equal(code(send2({})), 'bad_mail'); // 兩邊都空
  assert.equal(code(send2({ giveGold: 100 })), 'bad_mail'); // 只有一邊有東西
  assert.equal(code(send2({ giveGold: -1, wantGold: 5 })), 'bad_mail');
  assert.equal(code(send2({ giveGold: 1.5, wantGold: 5 })), 'bad_mail');
  assert.equal(code(send2({ giveGold: 2_000_000_000, wantGold: 5 })), 'bad_mail');
  const o = pushed(send2({ giveGold: 500, wantGold: 300, want: { 豪華蓋飯: 2 } })).msg.mails[0]; // 用 500 金幣換 2 個豪華蓋飯再加 300 金幣
  assert.deepEqual([o.give, o.giveGold, o.want, o.wantGold], [{}, 500, { 豪華蓋飯: 2 }, 300]);
  const res = send(core, P2, { t: 'tradeRespond', rid: 'r', id: o.id, action: 'accept' });
  const toA = mailsTo(res, '300')[0];
  const toB = mailsTo(res, '400')[0];
  assert.deepEqual([toA.items, toA.gold], [{ 豪華蓋飯: 2 }, 300]);
  assert.deepEqual([toB.items, toB.gold], [{}, 500]);
  const o2 = pushed(send2({ giveGold: 500, wantGold: 300, want: { 豪華蓋飯: 2 } })).msg.mails[0];
  const back = mailsTo(send(core, P2, { t: 'tradeRespond', rid: 'r', id: o2.id, action: 'reject' }), '300')[0];
  assert.deepEqual([back.gold, back.bounced], [500, true]); // 拒絕：A 押的金幣退回
  const noGold = pushed(send2({ give: { 鐵礦: 1 }, want: { 豪華蓋飯: 1 } })).msg.mails[0];
  const toB2 = mailsTo(send(core, P2, { t: 'tradeRespond', id: noGold.id, action: 'accept' }), '400')[0];
  assert.equal('gold' in toB2, false); // 沒有金幣就不帶這個欄位
});
