// ============================================================
// 房間邏輯（純邏輯，不碰 Cloudflare API）：成員、GM 權限、擲骰、紀錄、限流、輸入驗證。
// Durable Object（room.js）只是一層薄薄的外殼：收 WebSocket 訊息 → 呼叫這裡 → 把結果送出去。
// 這樣整個房間規則可以在 Node 裡直接測（測試用 node:sqlite 當資料庫，SQL 也是真的）。
//
// 資料庫介面（db）：exec(sql, ...參數) → 資料列陣列；tx(fn) → 在交易中執行 fn
// ============================================================
import { parseDiceExpr, rollExpr, rollDie, MAX_SIDES } from '../../src/game/dice.js';
import { d20 } from '../../src/game/engine.js';
import { diceEvent, checkEvent } from '../../src/game/events.js';
import { LIFE_SKILLS, ART_SKILLS } from '../../src/game/rules.js';
import { parseIdList, roomAccessState } from './allowlist.js';
import { avatarUrl } from './avatar.js';
import { serverRng } from './server-rng.js';
import {
  DEFAULT_ROOM_ID, HISTORY_LIMIT, MAX_MESSAGE_CHARS, RATE_LIMIT_PER_SEC, RATE_ABUSE_PER_SEC,
  MAX_DRAW_DICE, MAX_DRAW_POOLS, DRAW_TTL_MS, MAX_PENDING_DRAWS_PER_USER, MAX_CHAR_MESSAGE_CHARS, MAX_CHAR_JSON_CHARS,
} from './config.js';

// 前端自己組好文字、再交給伺服器記錄的事件種類（擲骰與檢定由伺服器自己組，不在這裡）
const POST_KINDS = new Set(['note', 'skill', 'attack', 'defend', 'potion', 'identify']);
const TONES = new Set(['ok', 'fail', 'crit', 'warn']);
const SKILLS = new Set([...LIFE_SKILLS, ...ART_SKILLS]);
const RID = /^[A-Za-z0-9_-]{1,40}$/;
const UID = /^\d{1,25}$/;
const CHAR_PREFIX = '{"t":"charPut"'; // 前端組訊息時 t 一定排第一；只有這種訊息可以放寬大小上限

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const cleanStr = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/** 顯示用的角色名稱由前端送來（角色資料還在前端）；但「系統」保留給伺服器，不能冒用 */
const whoOf = (raw, user) => { const w = cleanStr(raw, 40); return !w || w === '系統' ? user.name : w; };

const err = (rid, code, message) => ({ out: [{ to: 'self', msg: { t: 'error', rid, code, message } }], close: null });
const closing = (code, reason) => ({ out: [], close: { code, reason } });

export class RoomCore {
  constructor({ db, env, roomId = DEFAULT_ROOM_ID, now = Date.now, rng = serverRng, uuid = () => crypto.randomUUID() }) {
    Object.assign(this, { db, env, roomId, now, rng, uuid });
    this.draws = new Map(); // drawId → { uid, t }（只放記憶體，60 秒就過期）
    this.hits = new Map(); // uid → 最近一秒的訊息時間
  }

  migrate() {
    const { db } = this;
    db.exec('CREATE TABLE IF NOT EXISTS members (uid TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, id TEXT NOT NULL, t INTEGER NOT NULL, json TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS characters (uid TEXT PRIMARY KEY, json TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
  }

  // ---------- 成員與權限 ----------
  /** 房間成員 = 在白名單內；白名單為空一律拒絕（安全預設） */
  accessState(uid) { return roomAccessState(this.env, uid); }

  getMeta(key) {
    const rows = this.db.exec('SELECT value FROM meta WHERE key = ?', key);
    return rows.length ? rows[0].value : null;
  }
  setMeta(key, value) {
    this.db.exec('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  }
  deleteMeta(key) { this.db.exec('DELETE FROM meta WHERE key = ?', key); }

  adminIds() { return parseIdList(this.env.ADMIN_DISCORD_IDS); }
  isAdmin(uid) { return this.adminIds().includes(String(uid)); }

  /** 暫代 GM 的人；對方若已不在白名單就當作沒有 */
  gmOverride() {
    const v = this.getMeta('gm_override');
    return v && this.accessState(v) === 'ok' ? v : null;
  }
  gmUids() {
    const o = this.gmOverride();
    return o ? [o] : parseIdList(this.env.GM_DISCORD_IDS);
  }
  isGm(uid) { return this.gmUids().includes(String(uid)); }

  memberName(uid) {
    const rows = this.db.exec('SELECT name FROM members WHERE uid = ?', uid);
    return rows.length ? rows[0].name : null;
  }

  gmInfo() {
    const uids = this.gmUids();
    const override = this.gmOverride();
    const names = {};
    for (const u of [...uids, ...(override ? [override] : [])]) {
      const n = this.memberName(u);
      if (n) names[u] = n;
    }
    return { uids, override, names };
  }

  join(user) {
    const t = this.now();
    this.db.exec(
      'INSERT INTO members(uid, name, avatar, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) '
      + 'ON CONFLICT(uid) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, last_seen = excluded.last_seen',
      user.uid, user.name, user.avatar ?? null, t, t);
  }

  membersView(online = []) {
    const on = new Set(online);
    return this.db.exec('SELECT uid, name, avatar FROM members ORDER BY first_seen, uid')
      .map((m) => ({ uid: m.uid, name: m.name, avatarUrl: avatarUrl({ id: m.uid, avatar: m.avatar }), online: on.has(m.uid) }));
  }

  history() {
    return this.db.exec(`SELECT json FROM events ORDER BY seq DESC LIMIT ${HISTORY_LIMIT}`).map((r) => JSON.parse(r.json));
  }

  battleNo() { return Number(this.getMeta('battle_no') ?? 0); }

  /** 新連線收到的第一則訊息：自己是誰、GM 是誰、成員、最近 200 筆紀錄 */
  hello(user, online = []) {
    return {
      t: 'hello',
      room: this.roomId,
      me: { uid: user.uid, name: user.name, avatarUrl: avatarUrl({ id: user.uid, avatar: user.avatar }), isGm: this.isGm(user.uid), isAdmin: this.isAdmin(user.uid) },
      gm: this.gmInfo(),
      battleNo: this.battleNo(),
      members: this.membersView(online),
      history: this.history(),
    };
  }

  // ---------- 紀錄 ----------
  record(fields, user) {
    const ev = {
      id: this.uuid(), t: this.now(), by: user.uid, byName: user.name,
      who: fields.who ?? '', kind: fields.kind, label: fields.label ?? '',
      big: fields.big ?? null, tone: fields.tone, lines: fields.lines ?? [],
    };
    if (fields.srv) ev.srv = true; // 骰點由伺服器擲出
    if (fields.battleNo != null) ev.battleNo = fields.battleNo;
    this.db.tx(() => {
      const [{ seq }] = this.db.exec('INSERT INTO events(id, t, json) VALUES (?, ?, ?) RETURNING seq', ev.id, ev.t, JSON.stringify(ev));
      this.db.exec('DELETE FROM events WHERE seq <= ?', seq - HISTORY_LIMIT); // 只留最近 200 筆
    });
    return ev;
  }

  // ---------- 限流 ----------
  rate(uid) {
    const now = this.now();
    const list = (this.hits.get(uid) ?? []).filter((t) => now - t < 1000);
    list.push(now);
    this.hits.set(uid, list);
    if (this.hits.size > 200) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 1000)) this.hits.delete(k);
    if (list.length > RATE_ABUSE_PER_SEC) return 'abuse';
    return list.length > RATE_LIMIT_PER_SEC ? 'limited' : 'ok';
  }

  // ---------- 處理一則訊息 ----------
  /**
   * user = { uid, name, avatar, exp }（來自連線時 Worker 驗證過的 session）
   * 回傳 { out: [{ to: 'self' | 'all', msg }], close: { code, reason } | null }
   */
  handle(user, raw, { online = [] } = {}) {
    // 每則訊息都重新確認：session 還沒過期、仍在白名單內（白名單被收緊或清空會立刻被踢）
    if (typeof user?.exp === 'number' && this.now() >= user.exp) return closing(4401, 'session expired');
    if (this.accessState(user.uid) !== 'ok') return closing(4403, 'not allowed');
    if (typeof raw !== 'string') return closing(1003, 'text only');
    if (raw.length > (raw.startsWith(CHAR_PREFIX) ? MAX_CHAR_MESSAGE_CHARS : MAX_MESSAGE_CHARS)) return closing(1009, 'message too big');
    const rate = this.rate(user.uid);
    if (rate === 'abuse') return closing(4429, 'rate limit');
    if (rate === 'limited') return err(undefined, 'rate_limited', '操作太快了，請稍等一下。');

    let msg;
    try { msg = JSON.parse(raw); } catch { return err(undefined, 'bad_json', '訊息格式錯誤。'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return err(undefined, 'bad_message', '訊息格式錯誤。');
    if (raw.length > MAX_MESSAGE_CHARS && msg.t !== 'charPut') return closing(1009, 'message too big');
    const rid = typeof msg.rid === 'string' && RID.test(msg.rid) ? msg.rid : undefined;

    switch (msg.t) {
      case 'dice': return this.onDice(user, msg, rid);
      case 'check': return this.onCheck(user, msg, rid);
      case 'draw': return this.onDraw(user, msg, rid);
      case 'post': return this.onPost(user, msg, rid);
      case 'newBattle': return this.onNewBattle(user, rid);
      case 'gm': return this.onGm(user, msg, rid);
      case 'charGet': return this.onCharGet(user, msg, rid);
      case 'charPut': return this.onCharPut(user, msg, rid);
      case 'charList': return this.onCharList(user, rid);
      default: return err(rid, 'unknown_type', '不認得的訊息類型。');
    }
  }

  broadcastEvent(ev, extra = []) {
    return { out: [{ to: 'all', msg: { t: 'event', event: ev } }, ...extra], close: null };
  }

  onDice(user, msg, rid) {
    const expr = typeof msg.expr === 'string' && msg.expr.length <= 40 ? parseDiceExpr(msg.expr) : { error: '格式不對，請輸入像 1D20 或 2D6+3 這樣的骰式。' };
    if (expr.error) return err(rid, 'bad_dice', expr.error); // 顆數、面數上限由 parseDiceExpr 把關（MAX_DICE、MAX_SIDES）
    const r = rollExpr(expr, this.rng);
    const ev = this.record({ ...diceEvent(whoOf(msg.who, user), r), srv: true }, user);
    return this.broadcastEvent(ev, [{ to: 'self', msg: { t: 'rolled', rid, event: ev } }]);
  }

  onCheck(user, msg, rid) {
    const { skill, mod, parts } = msg;
    if (typeof skill !== 'string' || !SKILLS.has(skill)) return err(rid, 'bad_check', '不認得這個技能。');
    if (!isInt(mod, -500, 5000)) return err(rid, 'bad_check', '加值格式錯誤。');
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 12) return err(rid, 'bad_check', '加值明細格式錯誤。');
    const clean = [];
    for (const p of parts) {
      if (!p || typeof p !== 'object' || typeof p.label !== 'string' || !isInt(p.value, -5000, 5000)) return err(rid, 'bad_check', '加值明細格式錯誤。');
      clean.push({ label: cleanStr(p.label, 24), value: p.value });
    }
    if (clean.reduce((a, p) => a + p.value, 0) !== mod) return err(rid, 'bad_check', '加值與明細不一致。');
    const roll = d20(this.rng);
    const r = { skill, roll, mod, parts: clean, total: roll + mod, isLife: LIFE_SKILLS.includes(skill) };
    const ev = this.record({ ...checkEvent(whoOf(msg.who, user), r), srv: true }, user);
    return this.broadcastEvent(ev, [{ to: 'self', msg: { t: 'rolled', rid, event: ev, roll, total: r.total } }]);
  }

  /** 戰鬥、藥水、鑑定：前端說「我要擲這幾組骰子」，伺服器擲好把每一顆的點數交回去 */
  onDraw(user, msg, rid) {
    const { pools } = msg;
    if (!Array.isArray(pools) || pools.length < 1 || pools.length > MAX_DRAW_POOLS) return err(rid, 'bad_draw', '骰子組數錯誤。');
    let total = 0;
    for (const p of pools) {
      if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0], 2, MAX_SIDES) || !isInt(p[1], 1, MAX_DRAW_DICE)) return err(rid, 'bad_draw', '骰子面數或顆數錯誤。');
      total += p[1];
    }
    if (total > MAX_DRAW_DICE) return err(rid, 'bad_draw', `單次最多只能擲 ${MAX_DRAW_DICE} 顆骰子。`);

    const now = this.now();
    for (const [id, d] of this.draws) if (now - d.t > DRAW_TTL_MS) this.draws.delete(id);
    if ([...this.draws.values()].filter((d) => d.uid === user.uid).length >= MAX_PENDING_DRAWS_PER_USER) return err(rid, 'too_many_draws', '還有太多擲骰沒有完成，請稍等。');

    const values = [];
    for (const [sides, count] of pools) for (let i = 0; i < count; i++) values.push(rollDie(sides, this.rng));
    const draw = this.uuid();
    this.draws.set(draw, { uid: user.uid, t: now });
    return { out: [{ to: 'self', msg: { t: 'drawn', rid, draw, values } }], close: null };
  }

  /** 前端組好文字的事件（出招、喝藥水、鑑定、備註）。帶有效的 draw 編號 = 骰點是伺服器擲的 */
  onPost(user, msg, rid) {
    const e = msg.event;
    if (!e || typeof e !== 'object' || !POST_KINDS.has(e.kind)) return err(rid, 'bad_event', '事件種類錯誤。');
    const label = cleanStr(e.label, 120);
    if (!label) return err(rid, 'bad_event', '事件缺少標題。');
    const big = typeof e.big === 'number' && Number.isFinite(e.big) ? e.big : typeof e.big === 'string' ? cleanStr(e.big, 40) : null;
    const lines = Array.isArray(e.lines) ? e.lines.slice(0, 40).map((l) => cleanStr(l, 200)).filter(Boolean) : [];
    let srv = false;
    if (typeof msg.draw === 'string') {
      const d = this.draws.get(msg.draw);
      if (d && d.uid === user.uid && this.now() - d.t <= DRAW_TTL_MS) { srv = true; this.draws.delete(msg.draw); }
    }
    const ev = this.record({
      who: whoOf(e.who, user), kind: e.kind, label, big, lines, srv,
      tone: TONES.has(e.tone) ? e.tone : undefined,
    }, user);
    return this.broadcastEvent(ev, [{ to: 'self', msg: { t: 'posted', rid, id: ev.id } }]);
  }

  /** GM 才能開新戰鬥：只在紀錄裡插一條分隔訊息，不改任何規則狀態 */
  onNewBattle(user, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以開始新戰鬥。');
    let ev;
    this.db.tx(() => {
      const n = this.battleNo() + 1;
      this.setMeta('battle_no', n);
      ev = this.record({ who: '', kind: 'divider', label: `第 ${n} 場戰鬥`, lines: [`由 ${user.name} 開始`], battleNo: n }, user);
    });
    return this.broadcastEvent(ev);
  }

  /** 暫代 GM：ADMIN_DISCORD_IDS 的人可以接管，之後再還給原 GM（測試網站用） */
  onGm(user, msg, rid) {
    const action = msg.action;
    if (action !== 'take' && action !== 'release') return err(rid, 'bad_gm', '不認得這個操作。');
    if (action === 'take') {
      if (!this.isAdmin(user.uid)) return err(rid, 'forbidden', '你沒有暫代 GM 的權限。');
      this.setMeta('gm_override', user.uid);
    } else {
      if (!(this.isAdmin(user.uid) || this.getMeta('gm_override') === user.uid)) return err(rid, 'forbidden', '你沒有權限還回 GM。');
      this.deleteMeta('gm_override');
    }
    const ev = this.record({
      who: '系統', kind: 'note',
      label: action === 'take' ? `${user.name} 暫代 GM` : 'GM 權限已還給原 GM',
      lines: action === 'take' ? ['測試用：原 GM 暫時沒有 GM 權限，之後會還回去。'] : [],
    }, user);
    return this.broadcastEvent(ev, [{ to: 'all', msg: { t: 'gm', gm: this.gmInfo() } }]);
  }

  // ---------- 角色存檔（階段 2） ----------
  // 角色資料仍由前端算、前端寫入（和骰子加值一樣的信任邊界）；伺服器只負責「保存」與「GM 可讀」。
  // version 是樂觀鎖：寫入時要帶上自己看到的版本，版本不一致就拒絕，避免手機與電腦互相悄悄覆蓋。
  charRow(uid) {
    const rows = this.db.exec('SELECT json, version, updated_at FROM characters WHERE uid = ?', uid);
    return rows[0] ?? null;
  }

  /** 讀角色：自己的永遠可以讀；讀別人的只有 GM */
  onCharGet(user, msg, rid) {
    const uid = msg.uid === undefined ? user.uid : String(msg.uid);
    if (!UID.test(uid)) return err(rid, 'bad_char', '玩家編號格式錯誤。');
    if (uid !== user.uid && !this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以讀取其他玩家的角色。');
    const row = this.charRow(uid);
    return { out: [{ to: 'self', msg: { t: 'char', rid, uid, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null, data: row ? JSON.parse(row.json) : null } }], close: null };
  }

  /** 存自己的角色。base = 前端上次確認的版本（從沒存過 = 0） */
  onCharPut(user, msg, rid) {
    const { base, data } = msg;
    if (!isInt(base, 0, 1_000_000_000)) return err(rid, 'bad_char', '版本格式錯誤。');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return err(rid, 'bad_char', '角色資料格式錯誤。');
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80) return err(rid, 'bad_char', '角色缺少名稱。');
    const json = JSON.stringify(data);
    if (json.length > MAX_CHAR_JSON_CHARS) return err(rid, 'char_too_big', '角色資料太大，無法儲存。');
    let result;
    this.db.tx(() => {
      const cur = this.charRow(user.uid)?.version ?? 0;
      if (cur !== base) { result = { ok: false, version: cur }; return; }
      const t = this.now();
      this.db.exec(
        'INSERT INTO characters(uid, json, version, updated_at) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT(uid) DO UPDATE SET json = excluded.json, version = excluded.version, updated_at = excluded.updated_at',
        user.uid, json, cur + 1, t);
      result = { ok: true, version: cur + 1, updatedAt: t };
    });
    return { out: [{ to: 'self', msg: { t: 'charSaved', rid, ...result } }], close: null };
  }

  /** GM：所有已存檔玩家的清單（不含角色內容），模擬戰挑人用 */
  onCharList(user, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以查看玩家角色清單。');
    const list = this.db.exec(
      'SELECT c.uid AS uid, COALESCE(m.name, c.uid) AS name, c.version AS version, c.updated_at AS updatedAt, '
      + "COALESCE(json_extract(c.json, '$.name'), '') AS charName "
      + 'FROM characters c LEFT JOIN members m ON m.uid = c.uid ORDER BY m.first_seen, c.uid');
    return { out: [{ to: 'self', msg: { t: 'charList', rid, list } }], close: null };
  }
}
