// 執行方式：在專案根目錄 npm test
// 角色存檔（階段 2）：每人一份、版本號樂觀鎖、GM 可讀所有人、大小限制
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';
import { MAX_MESSAGE_CHARS, MAX_CHAR_JSON_CHARS } from '../src/config.js';
import { makeDb, seqRng } from './helpers.js';

const GM = { uid: '100', name: 'GM', avatar: null };
const P1 = { uid: '300', name: '玩家一', avatar: null };
const P2 = { uid: '400', name: '玩家二', avatar: null };
const env = { DISCORD_ALLOWED_IDS: '100,300,400', GM_DISCORD_IDS: '100', ADMIN_DISCORD_IDS: '' };

function room() {
  let clock = 1_000_000;
  const core = new RoomCore({ db: makeDb(), env, now: () => clock, rng: seqRng([3]), uuid: () => 'id' });
  core.migrate();
  const handle = core.handle.bind(core);
  core.handle = (...a) => { clock += 250; return handle(...a); }; // 避開限流
  return core;
}
const send = (core, user, msg) => core.handle(user, typeof msg === 'string' ? msg : JSON.stringify(msg));
const reply = (res) => res.out[0]?.msg;
const put = (core, user, base, data, rid = 'p') => reply(send(core, user, { t: 'charPut', rid, base, data }));
const get = (core, user, uid) => reply(send(core, user, uid === undefined ? { t: 'charGet', rid: 'g' } : { t: 'charGet', rid: 'g', uid }));

test('第一次存：版本 0 → 1；再存要帶 1，版本遞增', () => {
  const core = room();
  assert.deepEqual(get(core, P1), { t: 'char', rid: 'g', uid: '300', version: 0, updatedAt: null, data: null });
  const a = put(core, P1, 0, { name: '福德', hp: 5 });
  assert.equal(a.t, 'charSaved'); assert.equal(a.ok, true); assert.equal(a.version, 1);
  assert.equal(put(core, P1, 1, { name: '福德', hp: 4 }).version, 2);
  const c = get(core, P1);
  assert.equal(c.version, 2); assert.deepEqual(c.data, { name: '福德', hp: 4 });
});

test('樂觀鎖：版本不一致被拒絕且不覆蓋；回傳目前版本', () => {
  const core = room();
  put(core, P1, 0, { name: 'A', hp: 1 });
  const stale = put(core, P1, 0, { name: 'A', hp: 99 }); // 另一台裝置還以為是第 0 版
  assert.equal(stale.ok, false); assert.equal(stale.version, 1);
  assert.equal(get(core, P1).data.hp, 1);
  assert.equal(put(core, P1, 5, { name: 'A', hp: 99 }).ok, false); // 比現在新的版本也不行
});

test('隔離：玩家只能讀自己的；GM 可以讀所有人；玩家寫入只會寫到自己', () => {
  const core = room();
  put(core, P1, 0, { name: '一號' });
  put(core, P2, 0, { name: '二號' });
  assert.equal(get(core, P1).data.name, '一號');
  assert.equal(get(core, P2).data.name, '二號'); // 同樣是 base 0，各自獨立計版本
  assert.equal(reply(send(core, P1, { t: 'charGet', rid: 'x', uid: '400' })).code, 'forbidden');
  assert.equal(get(core, GM, '400').data.name, '二號');
  assert.equal(get(core, GM, '300').version, 1);
  assert.equal(reply(send(core, GM, { t: 'charGet', rid: 'x', uid: "300' OR 1=1" })).code, 'bad_char');
  assert.equal(put(core, P1, 1, { name: '一號改', uid: '400' }).ok, true);
  assert.equal(get(core, GM, '400').data.name, '二號'); // 資料裡寫別人的 uid 沒有用
});

test('GM 清單：只有 GM 看得到，含名稱與版本，不含角色內容', () => {
  const core = room();
  core.join(P1); core.join(P2);
  put(core, P1, 0, { name: '一號', secret: 1 });
  assert.equal(reply(send(core, P1, { t: 'charList', rid: 'l' })).code, 'forbidden');
  const l = reply(send(core, GM, { t: 'charList', rid: 'l' }));
  assert.equal(l.t, 'charList');
  assert.equal(l.list.length, 1);
  assert.equal(l.list[0].uid, '300'); assert.equal(l.list[0].name, '玩家一'); assert.equal(l.list[0].charName, '一號'); assert.equal(l.list[0].version, 1);
  assert.equal(l.list[0].json, undefined);
});

test('輸入驗證：資料格式、名稱、版本、大小', () => {
  const core = room();
  for (const [base, data] of [[0, null], [0, []], [0, 'x'], [0, {}], [0, { name: '' }], [0, { name: 5 }], [0, { name: 'x'.repeat(81) }], [-1, { name: 'a' }], [1.5, { name: 'a' }], ['0', { name: 'a' }]]) {
    assert.equal(put(core, P1, base, data).code, 'bad_char', JSON.stringify([base, data]).slice(0, 50));
  }
  assert.equal(put(core, P1, 0, { name: 'a', pad: 'x'.repeat(MAX_CHAR_JSON_CHARS) }).code, 'char_too_big');
  assert.equal(get(core, P1).version, 0); // 驗證失敗的不會寫入
});

test('大小：charPut 可以超過一般訊息上限，其他訊息仍不行', () => {
  const core = room();
  const big = { name: 'a', pad: 'x'.repeat(MAX_MESSAGE_CHARS) };
  assert.equal(put(core, P1, 0, big).ok, true);
  const fake = JSON.stringify({ t: 'charPut', rid: 'z', base: 0, data: { name: 'a' }, pad: 'x'.repeat(300_000) }); // 超過 charPut 上限
  assert.equal(send(core, P1, fake).close?.code, 1009);
  const disguised = '{"t":"charPut","t":"dice","expr":"1D6","pad":"' + 'x'.repeat(MAX_MESSAGE_CHARS) + '"}'; // 重複的 t 想繞過上限
  assert.equal(send(core, P1, disguised).close?.code, 1009);
});

test('非成員（不在白名單）不能存取', () => {
  const core = room();
  const stranger = { uid: '999', name: '路人', avatar: null };
  assert.equal(send(core, stranger, { t: 'charPut', base: 0, data: { name: 'x' } }).close?.code, 4403);
});

test('GM 匯入：只有 GM、只能寫白名單內的成員、要帶版本號、不動別人的資料', () => {
  const core = room();
  const imp = (user, uid, base, data) => reply(send(core, user, { t: 'charImport', rid: 'i', uid, base, data }));
  assert.equal(imp(P1, '400', 0, { name: 'x' }).code, 'forbidden'); // 玩家不能替別人寫
  assert.equal(imp(GM, '999', 0, { name: 'x' }).code, 'bad_char'); // 不在白名單
  const a = imp(GM, '400', 0, { name: '匯入的角色', hp: 9 });
  assert.equal(a.ok, true); assert.equal(a.uid, '400'); assert.equal(a.version, 1);
  assert.equal(get(core, P2).data.name, '匯入的角色'); // 玩家二登入後讀得到
  assert.equal(get(core, GM, '300').version, 0); // 沒有動到玩家一
  put(core, P2, 1, { name: '玩家二自己改的', hp: 1 }); // 玩家二之後自己存了第 2 版
  const stale = imp(GM, '400', 1, { name: '舊的匯入', hp: 9 }); // GM 還以為是第 1 版
  assert.equal(stale.ok, false); assert.equal(stale.version, 2);
  assert.equal(get(core, P2).data.name, '玩家二自己改的');
  assert.equal(imp(GM, '400', 2, { name: 'x'.repeat(81) }).code, 'bad_char');
});

test('異動紀錄：GM 替玩家寫入角色 → 紀錄裡多一條 audit 事件（誰、改了什麼），全員看得到；玩家自己存檔、版本衝突都不記', () => {
  const core = room();
  const imp = (base, data) => send(core, GM, { t: 'charImport', rid: 'i', uid: '400', base, data });
  const events = (res) => res.out.filter((o) => o.msg.t === 'event').map((o) => o.msg.event);
  const first = imp(0, { name: '二號', gold: 10, skills: { 引氣訣: 1 }, adjust: { 物理傷害: 5 }, inventory: { 鐵礦石: 3 } });
  assert.equal(first.out[0].msg.t, 'charSaved'); // 先回覆 GM 自己的儲存結果
  const [ev] = events(first);
  assert.equal(ev.kind, 'audit'); assert.equal(ev.by, '100'); assert.equal(ev.byName, 'GM');
  assert.match(ev.label, /GM 修改了「二號」（.+）的角色/); // 括號裡是成員名稱（沒連線過的成員用 uid 代替）
  assert.ok(ev.lines[0].startsWith('新建角色'));
  assert.ok(ev.lines.includes('技能 引氣訣　0 → 1') && ev.lines.includes('手動調整 物理傷害　0 → 5') && ev.lines.includes('背包 鐵礦石　0 → 3') && ev.lines.includes('金幣　0 → 10'));
  assert.equal(first.out.find((o) => o.msg.t === 'event').to, 'all');
  const hist = core.hello(P1).history.filter((e) => e.kind === 'audit'); // 之後連線的人也看得到
  assert.equal(hist.length, 1);
  const second = imp(1, { name: '二號', gold: 10, skills: { 引氣訣: 3 }, adjust: { 物理傷害: 5 }, skillOn: { 終焉武裝: true }, inventory: { 鐵礦石: 3 } });
  assert.deepEqual(events(second)[0].lines, ['技能 引氣訣　1 → 3', '啟動 終焉武裝　關 → 開']);
  assert.deepEqual(events(imp(2, { name: '二號', gold: 10 })).length, 1); // 技能被清掉也記得到
  assert.equal(events(imp(0, { name: 'x' })).length, 0); // 版本衝突沒寫入，不記
  put(core, P2, 3, { name: '玩家自己存', gold: 999 });
  assert.equal(core.hello(P1).history.filter((e) => e.kind === 'audit').length, 3); // 玩家自己存檔不新增
});

test('異動紀錄：太多項時只列前 12 項並說明還有幾項；沒變更也有一行說明', () => {
  const core = room();
  const inv = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`物品${i}`, 1]));
  const res = send(core, GM, { t: 'charImport', rid: 'i', uid: '400', base: 0, data: { name: 'A', inventory: inv } });
  const ev = res.out.find((o) => o.msg.t === 'event').msg.event;
  assert.equal(ev.lines.length, 13);
  assert.equal(ev.lines[12], '…另外還有 9 項變更'); // 新建 1 + 背包 20 = 21 項，列 12，剩 9
  const same = send(core, GM, { t: 'charImport', rid: 'i', uid: '400', base: 1, data: { name: 'A', inventory: inv } });
  assert.deepEqual(same.out.find((o) => o.msg.t === 'event').msg.event.lines, ['沒有數值變更']);
});
