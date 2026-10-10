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
