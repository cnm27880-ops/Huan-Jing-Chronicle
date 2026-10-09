// ============================================================
// 房間邏輯（純邏輯，不碰 Cloudflare API）：成員、GM 權限、擲骰、紀錄、限流、輸入驗證。
// Durable Object（room.js）只是一層薄薄的外殼：收 WebSocket 訊息 → 呼叫這裡 → 把結果送出去。
// 這樣整個房間規則可以在 Node 裡直接測（測試用 node:sqlite 當資料庫，SQL 也是真的）。
//
// 資料庫介面（db）：exec(sql, ...參數) → 資料列陣列；tx(fn) → 在交易中執行 fn
// ============================================================
import { parseDiceExpr, rollExpr, rollDie, rollSum, MAX_SIDES } from '../../src/game/dice.js';
import { d20 } from '../../src/game/engine.js';
import { diceEvent, checkEvent } from '../../src/game/events.js';
import { LIFE_SKILLS, ART_SKILLS, POTIONS, TOXICITY_MAX } from '../../src/game/rules.js';
import { newEncounter, addMobs, addBosses, isDowned, SPLIT_TYPES, SPLIT_FOCUS } from '../../src/game/combat.js';
import { parseIdList, roomAccessState } from './allowlist.js';
import { avatarUrl } from './avatar.js';
import { describeCharChange } from './audit.js';
import { validateCustomRecipe, validateCustomMaterial, MAX_CUSTOM_RECIPES, MAX_CUSTOM_MATERIALS } from '../../src/game/special.js';
import { validateCustomSkill, formatFxLine, MAX_CUSTOM_SKILLS } from '../../src/game/skillTable.js';
import { serverRng } from './server-rng.js';
import {
  DEFAULT_ROOM_ID, HISTORY_LIMIT, MAX_MESSAGE_CHARS, RATE_LIMIT_PER_SEC, RATE_ABUSE_PER_SEC,
  MAX_DRAW_DICE, MAX_DRAW_POOLS, DRAW_TTL_MS, MAX_PENDING_DRAWS_PER_USER, MAX_CHAR_MESSAGE_CHARS, MAX_CHAR_JSON_CHARS,
  MAX_PENDING_MAIL, MAX_MAIL_ITEM_KINDS, MAX_MAIL_ITEM_QTY, MAX_IMAGES, MAX_IMAGE_B64_CHARS,
} from './config.js';

// 前端自己組好文字、再交給伺服器記錄的事件種類（擲骰與檢定由伺服器自己組，不在這裡）
const POST_KINDS = new Set(['note', 'skill', 'attack', 'defend', 'potion', 'identify']);
const TONES = new Set(['ok', 'fail', 'crit', 'warn']);
const SKILLS = new Set([...LIFE_SKILLS, ...ART_SKILLS]);
const RID = /^[A-Za-z0-9_-]{1,40}$/;
const UID = /^\d{1,25}$/;
const CHAR_PREFIXES = ['{"t":"charPut"', '{"t":"charImport"', '{"t":"imgPut"']; // 前端組訊息時 t 一定排第一；只有這幾種訊息可以放寬大小上限
const MAX_MONSTERS = 40;
const isCharType = (t) => t === 'charPut' || t === 'charImport' || t === 'imgPut';
// 怪物立繪：只收這三種格式，並檢查檔頭（不收 SVG，免得圖片裡藏程式）
const IMAGE_MAGIC = { // 參數是解碼後的開頭幾個位元組（每個字元一個位元組）
  'image/webp': (bin) => bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP',
  'image/jpeg': (bin) => bin.startsWith('\xff\xd8\xff'),
  'image/png': (bin) => bin.startsWith('\x89PNG'),
};
const IMAGE_ID = /^[a-f0-9]{32}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const VITAL_KEY = /^[\u4e00-\u9fff]{1,4}$/; // 資源名稱（靈氣、魔力…）

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
    db.exec('CREATE TABLE IF NOT EXISTS mail (id TEXT PRIMARY KEY, to_uid TEXT NOT NULL, t INTEGER NOT NULL, json TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS characters (uid TEXT PRIMARY KEY, json TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, data TEXT NOT NULL, t INTEGER NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS vitals (uid TEXT PRIMARY KEY, json TEXT NOT NULL, t INTEGER NOT NULL)');
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
      encounter: this.encounter(),
      mail: this.pendingMail(user.uid),
      special: this.special(),
      skills: this.customSkills(),
      images: this.imagesView(),
      vitals: this.vitalsView(),
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
    if (fields.target) ev.target = fields.target; // 異動紀錄：被修改的玩家 uid
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
    if (raw.length > (CHAR_PREFIXES.some((x) => raw.startsWith(x)) ? MAX_CHAR_MESSAGE_CHARS : MAX_MESSAGE_CHARS)) return closing(1009, 'message too big');
    const rate = this.rate(user.uid);
    if (rate === 'abuse') return closing(4429, 'rate limit');
    if (rate === 'limited') return err(undefined, 'rate_limited', '操作太快了，請稍等一下。');

    let msg;
    try { msg = JSON.parse(raw); } catch { return err(undefined, 'bad_json', '訊息格式錯誤。'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return err(undefined, 'bad_message', '訊息格式錯誤。');
    if (raw.length > MAX_MESSAGE_CHARS && !isCharType(msg.t)) return closing(1009, 'message too big');
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
      case 'charImport': return this.onCharImport(user, msg, rid);
      case 'specialSet': case 'specialDel': return this.onSpecial(user, msg, rid);
      case 'skillSet': case 'skillDel': return this.onSkillEdit(user, msg, rid);
      case 'mailSend': return this.onMailSend(user, msg, rid);
      case 'mailClaim': return this.onMailClaim(user, msg, rid);
      case 'encAdd': case 'encRemove': case 'encClear': case 'encHit': case 'encInit': case 'encSwap': case 'encStart': case 'encNext': return this.onEncounter(user, msg, rid, online);
      case 'encImg': return this.onEncImg(user, msg, rid);
      case 'imgPut': return this.onImgPut(user, msg, rid);
      case 'imgDel': return this.onImgDel(user, msg, rid);
      case 'vitals': return this.onVitals(user, msg);
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

  // ---------- 信箱：送東西、餵藥（對方不用同意） ----------
  // 東西與藥水的「增減」都在各自的瀏覽器裡做（和整個階段 2 一樣：角色在前端）。伺服器只負責轉交與暫存：
  //   寄的人先扣東西 → mailSend → 伺服器存進信箱並即時推給對方 → 對方 mailClaim（只有第一個領的人拿得到，不會重複）→ 對方加進自己的背包
  // 餵藥的回復點數由伺服器擲（和戰鬥的骰子一樣），並寫進公開的戰鬥紀錄。
  pendingMail(uid) {
    return this.db.exec('SELECT json FROM mail WHERE to_uid = ? ORDER BY t, id', uid).map((r) => JSON.parse(r.json));
  }

  onMailSend(user, msg, rid) {
    const to = String(msg.to ?? '');
    if (!UID.test(to) || this.accessState(to) !== 'ok') return err(rid, 'bad_mail', '找不到這位玩家。');
    if (to === user.uid) return err(rid, 'bad_mail', '不能寄給自己。');
    if (this.pendingMail(to).length >= MAX_PENDING_MAIL) return err(rid, 'mail_full', '對方還有太多東西沒領，請稍後再寄。');
    const toName = this.memberName(to) ?? to;
    const mail = { id: this.uuid(), from: user.uid, fromName: user.name, t: this.now() };
    const out = [];

    if (msg.kind === 'gift') {
      const items = {};
      const entries = msg.items && typeof msg.items === 'object' && !Array.isArray(msg.items) ? Object.entries(msg.items) : [];
      if (!entries.length || entries.length > MAX_MAIL_ITEM_KINDS) return err(rid, 'bad_mail', '請至少選一樣東西（最多 30 種）。');
      for (const [name, qty] of entries) {
        const n = cleanStr(name, 40);
        if (!n || !isInt(qty, 1, MAX_MAIL_ITEM_QTY)) return err(rid, 'bad_mail', '東西的名稱或數量錯誤。');
        items[n] = (items[n] ?? 0) + qty;
      }
      Object.assign(mail, { kind: 'gift', items });
      if (msg.bounced === true) mail.bounced = true; // 對方拒收的藥水退回
    } else if (msg.kind === 'potion') {
      const def = POTIONS[msg.potion];
      if (!def?.heal) return err(rid, 'bad_mail', '只有回復藥水可以餵給別人。');
      const stored = this.charRow(to);
      const tox = stored ? Number(JSON.parse(stored.json).toxicity) : NaN; // 對方存在伺服器的毒性（約略值；對方領取時還會再檢查一次）
      if (Number.isFinite(tox) && tox + def.toxicity > TOXICITY_MAX) return err(rid, 'toxic', `${toName} 的毒性是 ${tox}，喝${msg.potion}（毒性 +${def.toxicity}）會超過 ${TOXICITY_MAX}，不能餵。`);
      const heal = rollSum(def.heal.n, def.heal.sides, this.rng);
      Object.assign(mail, { kind: 'potion', potion: msg.potion, heal });
      const ev = this.record({
        who: user.name, kind: 'potion', label: `${user.name} 餵 ${toName}：${msg.potion}`, big: heal, srv: true,
        lines: [`回復 ${def.heal.n}D${def.heal.sides} = ${heal} 生命`, `毒性算在 ${toName} 身上（+${def.toxicity}）`],
      }, user);
      out.push({ to: 'all', msg: { t: 'event', event: ev } });
    } else return err(rid, 'bad_mail', '不認得這種寄送方式。');

    this.db.exec('INSERT INTO mail(id, to_uid, t, json) VALUES (?, ?, ?, ?)', mail.id, to, mail.t, JSON.stringify(mail));
    out.push({ to: 'self', msg: { t: 'mailSent', rid, heal: mail.heal } }, { to: 'user', uid: to, msg: { t: 'mail', mails: [mail] } });
    return { out, close: null };
  }

  /** 領取：先刪先贏（兩個分頁同時收到，只有一個拿得到） */
  onMailClaim(user, msg, rid) {
    const rows = typeof msg.id === 'string' ? this.db.exec('DELETE FROM mail WHERE id = ? AND to_uid = ? RETURNING json', msg.id, user.uid) : [];
    return { out: [{ to: 'self', msg: { t: 'mailClaimed', rid, mail: rows.length ? JSON.parse(rows[0].json) : null } }], close: null };
  }

  // ---------- 遭遇戰（階段 C） ----------
  // 怪物由 GM 建立，存在房間裡，所有人即時看到。怪物生命只有伺服器會改：
  // 玩家端算出傷害後回報「打了誰、扣多少」（和階段 1-B 一樣，傷害由前端算、伺服器負責保存與廣播）。
  // 先攻：GM 抽先攻 = 把在線玩家與怪物隨機洗成一排「位置」；GM 按開打之前，玩家可以討論並和別人交換自己的位置。
  // 目前只顯示順序與輪到誰，不強制玩家只能在自己的回合行動。
  encounter() {
    const v = this.getMeta('encounter');
    return v ? JSON.parse(v) : { ...newEncounter(), round: 0, order: [], turn: 0, locked: false };
  }

  saveEncounter(enc) { this.setMeta('encounter', JSON.stringify(enc)); }

  encOk(enc, rid, user, note) {
    const extra = [{ to: 'self', msg: { t: 'encOk', rid } }];
    const out = [{ to: 'all', msg: { t: 'enc', encounter: enc } }, ...extra];
    if (note) {
      const ev = this.record({ who: '系統', kind: 'note', label: note.label, lines: note.lines ?? [] }, user);
      out.push({ to: 'all', msg: { t: 'event', event: ev } });
    }
    return { out, close: null };
  }

  onEncounter(user, msg, rid, online = []) {
    const enc = this.encounter();
    if (msg.t === 'encHit') { // 玩家回報打到怪物：任何成員都可以
      const hits = msg.hits;
      if (!Array.isArray(hits) || hits.length < 1 || hits.length > 12) return err(rid, 'bad_enc', '傷害回報格式錯誤。');
      let applied = 0;
      for (const hit of hits) {
        if (!hit || typeof hit.id !== 'string' || !isInt(hit.dmg, 0, 10_000_000)) return err(rid, 'bad_enc', '傷害回報格式錯誤。');
        const m = enc.monsters.find((x) => x.id === hit.id);
        if (!m) continue; // 怪物剛好被 GM 移除：略過
        m.hp = Math.max(0, m.hp - hit.dmg);
        applied++;
      }
      if (!applied) return err(rid, 'bad_enc', '找不到這些怪物，可能已被移除。');
      this.saveEncounter(enc);
      return this.encOk(enc, rid, user);
    }
    if (msg.t === 'encSwap') { // 換位置：GM 隨時可以；玩家只能在 GM 開打之前、而且其中一格是自己的
      const { a, b } = msg;
      if (!isInt(a, 0, enc.order.length - 1) || !isInt(b, 0, enc.order.length - 1) || a === b) return err(rid, 'bad_enc', '位置錯誤。');
      if (!this.isGm(user.uid)) {
        if (enc.locked) return err(rid, 'forbidden', 'GM 已經開打，不能再換位置。');
        const mine = (i) => enc.order[i].kind === 'player' && enc.order[i].uid === user.uid;
        if (!mine(a) && !mine(b)) return err(rid, 'forbidden', '只能換自己的位置。');
      }
      [enc.order[a], enc.order[b]] = [enc.order[b], enc.order[a]];
      this.saveEncounter(enc);
      return this.encOk(enc, rid, user);
    }
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以操作遭遇戰。');

    if (msg.t === 'encAdd') {
      const sp = msg.spec;
      if (!sp || typeof sp !== 'object' || (msg.kind !== 'mob' && msg.kind !== 'boss')) return err(rid, 'bad_enc', '敵人資料格式錯誤。');
      if (!isInt(sp.count, 1, 20) || !isInt(sp.atkPower, 0, 100_000) || !isInt(sp.defPower, 0, 100_000) || !isInt(sp.hp, 1, 10_000_000) || !isInt(sp.absDef ?? 0, 0, 100_000)) {
        return err(rid, 'bad_enc', '敵人的數量、強度或血量超出範圍。');
      }
      if (enc.monsters.length + sp.count > MAX_MONSTERS) return err(rid, 'bad_enc', `場上最多 ${MAX_MONSTERS} 隻敵人。`);
      const spec = { count: sp.count, atkPower: sp.atkPower, defPower: sp.defPower, hp: sp.hp, absDef: sp.absDef ?? 0, atkMod: cleanStr(sp.atkMod, 40), defMod: cleanStr(sp.defMod, 40) };
      for (const side of ['atk', 'def']) { // GM 指定的強度分配（選填）：類型 extreme／dual／balanced，集中的軌道
        const type = sp[`${side}Type`];
        const focus = sp[`${side}Focus`];
        if (type == null && focus == null) continue;
        if (!SPLIT_TYPES.includes(type) || (focus != null && !(SPLIT_FOCUS[type] ?? []).includes(focus))) return err(rid, 'bad_enc', '強度分配的類型或集中軌道不正確。');
        spec[`${side}Type`] = type;
        if (focus != null) spec[`${side}Focus`] = focus;
      }
      const added = (msg.kind === 'boss' ? addBosses : addMobs)(enc, spec, this.rng);
      if (this.hasImage(msg.img)) added.forEach((m) => { m.img = msg.img; }); // 建立時就指定立繪（選填）
      this.saveEncounter(enc);
      return this.encOk(enc, rid, user, { label: `遭遇：新增 ${added.map((m) => m.id).join('、')}` });
    }
    if (msg.t === 'encRemove') {
      if (typeof msg.id !== 'string') return err(rid, 'bad_enc', '缺少敵人編號。');
      enc.monsters = enc.monsters.filter((m) => m.id !== msg.id);
      enc.order = enc.order.filter((o) => !(o.kind === 'monster' && o.id === msg.id));
      enc.turn = enc.order.length ? Math.min(enc.turn, enc.order.length - 1) : 0;
      this.saveEncounter(enc);
      return this.encOk(enc, rid, user);
    }
    if (msg.t === 'encClear') {
      this.saveEncounter({ ...newEncounter(), round: 0, order: [], turn: 0, locked: false });
      return this.encOk(this.encounter(), rid, user, { label: '遭遇：戰鬥結束，清空敵人' });
    }
    if (msg.t === 'encInit') { // 先攻：在線玩家（不含 GM）與還活著的怪物，純隨機洗牌
      const players = this.db.exec('SELECT uid, name FROM members ORDER BY first_seen, uid')
        .filter((m) => online.includes(m.uid) && !this.isGm(m.uid) && this.accessState(m.uid) === 'ok')
        .map((m) => ({ kind: 'player', uid: m.uid, name: m.name }));
      const monsters = enc.monsters.filter((m) => !isDowned(m)).map((m) => ({ kind: 'monster', id: m.id }));
      const order = [...players, ...monsters];
      for (let i = order.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1) - 1;
        [order[i], order[j]] = [order[j], order[i]];
      }
      Object.assign(enc, { order, turn: 0, round: 0, locked: false });
      this.saveEncounter(enc);
      const names = order.map((o, i) => `${i + 1}. ${o.kind === 'player' ? o.name : o.id}`);
      return this.encOk(enc, rid, user, { label: '遭遇：先攻位置（隨機）', lines: [...names, '玩家可以討論並交換自己的位置，GM 按「開打」後鎖定。'] });
    }
    if (msg.t === 'encStart') {
      if (!enc.order.length) return err(rid, 'bad_enc', '還沒有先攻順序，請先抽先攻。');
      Object.assign(enc, { locked: true, turn: 0, round: 1 });
      this.saveEncounter(enc);
      const names = enc.order.map((o, i) => `${i + 1}. ${o.kind === 'player' ? o.name : o.id}`);
      return this.encOk(enc, rid, user, { label: '遭遇：開打，先攻順序鎖定', lines: names });
    }
    // encNext：換下一位；已倒下的怪物自動跳過；繞完一圈回合數 +1
    if (!enc.order.length) return err(rid, 'bad_enc', '還沒有先攻順序，請先抽先攻。');
    if (!enc.locked) return err(rid, 'bad_enc', '請先按「開打」鎖定先攻順序。');
    for (let step = 0; step < enc.order.length; step++) {
      enc.turn += 1;
      if (enc.turn >= enc.order.length) { enc.turn = 0; enc.round += 1; }
      const cur = enc.order[enc.turn];
      const m = cur.kind === 'monster' ? enc.monsters.find((x) => x.id === cur.id) : null;
      if (cur.kind === 'player' || (m && !isDowned(m))) break;
    }
    this.saveEncounter(enc);
    return this.encOk(enc, rid, user);
  }

  /** GM 指定（或拿掉）某隻怪物的立繪：img = 立繪庫的編號，null = 拿掉 */
  onEncImg(user, msg, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以設定立繪。');
    const enc = this.encounter();
    const m = typeof msg.id === 'string' ? enc.monsters.find((x) => x.id === msg.id) : null;
    if (!m) return err(rid, 'bad_enc', '找不到這隻敵人，可能已被移除。');
    if (msg.img === null) delete m.img;
    else if (this.hasImage(msg.img)) m.img = msg.img;
    else return err(rid, 'bad_img', '找不到這張立繪，可能已被刪除。');
    this.saveEncounter(enc);
    return this.encOk(enc, rid, user);
  }

  // ---------- 怪物立繪（GM 上傳；所有人用網址讀，見 room.js 的 GET /img/:id） ----------
  imagesView() { return this.db.exec('SELECT id, name, t FROM images ORDER BY t DESC, id'); }

  hasImage(id) { return typeof id === 'string' && IMAGE_ID.test(id) && this.db.exec('SELECT 1 AS x FROM images WHERE id = ?', id).length > 0; }

  /** 讀一張立繪：{ mime, bytes } 或 null */
  imageFile(id) {
    if (typeof id !== 'string' || !IMAGE_ID.test(id)) return null;
    const row = this.db.exec('SELECT mime, data FROM images WHERE id = ?', id)[0];
    if (!row) return null;
    const bin = atob(row.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: row.mime, bytes };
  }

  /** GM 上傳立繪（base64）。assign = 怪物編號時，上傳完直接套到那隻怪物身上 */
  onImgPut(user, msg, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以上傳立繪。');
    const { mime, data } = msg;
    if (typeof mime !== 'string' || !Object.hasOwn(IMAGE_MAGIC, mime)) return err(rid, 'bad_img', '只能上傳 WebP、JPEG 或 PNG 圖片。');
    if (typeof data !== 'string' || data.length < 16 || data.length > MAX_IMAGE_B64_CHARS || data.length % 4 !== 0 || !B64.test(data)) {
      return err(rid, 'bad_img', '圖片太大或格式錯誤。');
    }
    let head;
    try { head = atob(data.slice(0, 16)); } catch { return err(rid, 'bad_img', '圖片格式錯誤。'); }
    if (!IMAGE_MAGIC[mime](head)) return err(rid, 'bad_img', '檔案內容不是圖片。');
    if (this.db.exec('SELECT COUNT(*) AS n FROM images')[0].n >= MAX_IMAGES) return err(rid, 'bad_img', `立繪庫最多 ${MAX_IMAGES} 張，請先刪掉不用的。`);
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.db.exec('INSERT INTO images(id, name, mime, data, t) VALUES (?, ?, ?, ?, ?)', id, cleanStr(msg.name, 40) || '立繪', mime, data, this.now());
    const out = [{ to: 'self', msg: { t: 'imgOk', rid, id } }, { to: 'all', msg: { t: 'images', images: this.imagesView() } }];
    if (typeof msg.assign === 'string') {
      const enc = this.encounter();
      const m = enc.monsters.find((x) => x.id === msg.assign);
      if (m) { m.img = id; this.saveEncounter(enc); out.push({ to: 'all', msg: { t: 'enc', encounter: enc } }); }
    }
    return { out, close: null };
  }

  /** GM 刪除立繪：用到它的怪物一起拿掉 */
  onImgDel(user, msg, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以刪除立繪。');
    if (!this.hasImage(msg.id)) return err(rid, 'bad_img', '找不到這張立繪。');
    this.db.exec('DELETE FROM images WHERE id = ?', msg.id);
    const out = [{ to: 'self', msg: { t: 'imgOk', rid, id: msg.id } }, { to: 'all', msg: { t: 'images', images: this.imagesView() } }];
    const enc = this.encounter();
    const used = enc.monsters.filter((m) => m.img === msg.id);
    if (used.length) {
      used.forEach((m) => delete m.img);
      this.saveEncounter(enc);
      out.push({ to: 'all', msg: { t: 'enc', encounter: enc } });
    }
    return { out, close: null };
  }

  // ---------- 隊友狀態：每位玩家自己回報生命與資源（前端算的，和角色存檔一樣的信任邊界），全員看得到 ----------
  vitalsView() {
    const out = {};
    for (const r of this.db.exec('SELECT uid, json FROM vitals')) { try { out[r.uid] = JSON.parse(r.json); } catch { /* 壞掉的略過 */ } }
    return out;
  }

  onVitals(user, msg) {
    const v = msg.v;
    const BIG = 10_000_000;
    if (!v || typeof v !== 'object' || !isInt(v.hp, 0, BIG) || !isInt(v.maxHp, 0, BIG)) return err(undefined, 'bad_vitals', '狀態格式錯誤。');
    const clean = { name: cleanStr(v.name, 40) || user.name, hp: v.hp, maxHp: v.maxHp, downed: v.downed === true, res: {} };
    if (isInt(v.shield, 1, BIG)) clean.shield = v.shield;
    if (isInt(v.tox, 0, 1000)) clean.tox = v.tox;
    if (v.res && typeof v.res === 'object' && !Array.isArray(v.res)) {
      for (const [k, pair] of Object.entries(v.res).slice(0, 8)) {
        if (VITAL_KEY.test(k) && Array.isArray(pair) && pair.length === 2 && isInt(pair[0], 0, BIG) && isInt(pair[1], 0, BIG)) clean.res[k] = pair;
      }
    }
    this.db.exec('INSERT INTO vitals(uid, json, t) VALUES (?, ?, ?) ON CONFLICT(uid) DO UPDATE SET json = excluded.json, t = excluded.t', user.uid, JSON.stringify(clean), this.now());
    return { out: [{ to: 'all', msg: { t: 'vitals', uid: user.uid, v: clean } }], close: null };
  }

  // ---------- 特殊配方與特殊材料（GM 新增的；內建的寫在 src/game/special.js，不能改） ----------
  /** GM 新增的資料：{ recipes: { 名稱: 定義 }, materials: { 名稱: 定義 } }，所有人都讀得到 */
  special() {
    try {
      const v = JSON.parse(this.getMeta('special') ?? '{}');
      return { recipes: v.recipes ?? {}, materials: v.materials ?? {} };
    } catch { return { recipes: {}, materials: {} }; }
  }

  /** GM 新增／修改（specialSet）或刪除（specialDel）一個配方或材料；每次改動記一條異動紀錄並通知所有人 */
  onSpecial(user, msg, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以編輯特殊配方與材料。');
    const kind = msg.kind === 'recipe' ? 'recipe' : msg.kind === 'material' ? 'material' : null;
    if (!kind) return err(rid, 'bad_special', '不認得這種資料。');
    const sp = this.special();
    const bag = kind === 'recipe' ? sp.recipes : sp.materials;
    const noun = kind === 'recipe' ? '特殊配方' : '特殊材料';
    let label; let lines = [];
    if (msg.t === 'specialDel') {
      const name = cleanStr(msg.name, 40);
      if (!(name in bag)) return err(rid, 'bad_special', `沒有「${name}」可以刪除（內建的不能刪）。`);
      delete bag[name];
      label = `${user.name} 刪除了${noun}「${name}」`;
    } else {
      const v = kind === 'recipe' ? validateCustomRecipe(msg.name, msg.def) : validateCustomMaterial(msg.name, msg.def);
      if (!v.ok) return err(rid, 'bad_special', v.error);
      const isNew = !(v.name in bag);
      if (isNew && Object.keys(bag).length >= (kind === 'recipe' ? MAX_CUSTOM_RECIPES : MAX_CUSTOM_MATERIALS)) return err(rid, 'bad_special', `${noun}已經太多了，請先刪掉不用的。`);
      bag[v.name] = v.def;
      label = `${user.name} ${isNew ? '新增' : '修改'}了${noun}「${v.name}」`;
      lines = kind === 'recipe'
        ? [`${v.def.type}・${v.def.skill} DC ${v.def.dc}`, `材料：${Object.entries(v.def.materials).map(([k, q]) => `${k}×${q}`).join('、')}`, v.def.effect ? `效果：${v.def.effect}` : '']
        : [`可用技能：${v.def.skills.join('、')}`, v.def.hint ? `說明：${v.def.hint}` : ''];
    }
    this.setMeta('special', JSON.stringify(sp));
    const ev = this.record({ who: '系統', kind: 'audit', label, lines: lines.filter(Boolean) }, user);
    return { out: [{ to: 'self', msg: { t: 'specialOk', rid } }, ...this.broadcastEvent(ev).out, { to: 'all', msg: { t: 'special', special: sp } }], close: null };
  }

  // ---------- 專屬技能（GM 新增的；內建的技能目錄在 src/data/skills.js，不能改） ----------
  /** GM 新增的技能：{ 名稱: 定義 }，所有人都讀得到 */
  customSkills() {
    try { return JSON.parse(this.getMeta('custom_skills') ?? '{}'); } catch { return {}; }
  }

  /** GM 新增／修改（skillSet）或刪除（skillDel）一個專屬技能；每次改動記一條異動紀錄並通知所有人 */
  onSkillEdit(user, msg, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以編輯專屬技能。');
    const all = this.customSkills();
    let label; let lines = [];
    if (msg.t === 'skillDel') {
      const name = cleanStr(msg.name, 40);
      if (!(name in all)) return err(rid, 'bad_skill', `沒有「${name}」可以刪除（內建技能不能刪）。`);
      delete all[name];
      label = `${user.name} 刪除了專屬技能「${name}」`;
    } else {
      const v = validateCustomSkill(msg.name, msg.def);
      if (!v.ok) return err(rid, 'bad_skill', v.error);
      const isNew = !(v.name in all);
      if (isNew && Object.keys(all).length >= MAX_CUSTOM_SKILLS) return err(rid, 'bad_skill', '專屬技能已經太多了，請先刪掉不用的。');
      all[v.name] = v.def;
      label = `${user.name} ${isNew ? '新增' : '修改'}了專屬技能「${v.name}」`;
      const fxLines = v.def.fx.map((f, i) => (Object.keys(f).length ? `${i + 1} 級：${formatFxLine(f)}` : '')).filter(Boolean);
      lines = [`${v.def.tier}・${v.def.kind}・${v.def.school}`, ...fxLines.slice(0, 12)];
    }
    this.setMeta('custom_skills', JSON.stringify(all));
    const ev = this.record({ who: '系統', kind: 'audit', label, lines }, user);
    return { out: [{ to: 'self', msg: { t: 'skillOk', rid } }, ...this.broadcastEvent(ev).out, { to: 'all', msg: { t: 'skills', skills: all } }], close: null };
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

  /** 驗證並寫入某人的角色（版本號對不上就不寫）。回傳要送給對方的訊息 */
  storeChar(uid, base, data, rid) {
    if (!isInt(base, 0, 1_000_000_000)) return err(rid, 'bad_char', '版本格式錯誤。');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return err(rid, 'bad_char', '角色資料格式錯誤。');
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80) return err(rid, 'bad_char', '角色缺少名稱。');
    const json = JSON.stringify(data);
    if (json.length > MAX_CHAR_JSON_CHARS) return err(rid, 'char_too_big', '角色資料太大，無法儲存。');
    let result;
    this.db.tx(() => {
      const cur = this.charRow(uid)?.version ?? 0;
      if (cur !== base) { result = { ok: false, version: cur }; return; }
      const t = this.now();
      this.db.exec(
        'INSERT INTO characters(uid, json, version, updated_at) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT(uid) DO UPDATE SET json = excluded.json, version = excluded.version, updated_at = excluded.updated_at',
        uid, json, cur + 1, t);
      result = { ok: true, version: cur + 1, updatedAt: t };
    });
    return result;
  }

  /** 存自己的角色。base = 前端上次確認的版本（從沒存過 = 0） */
  onCharPut(user, msg, rid) {
    const r = this.storeChar(user.uid, msg.base, msg.data, rid);
    if (r.out) return r;
    return { out: [{ to: 'self', msg: { t: 'charSaved', rid, ...r } }], close: null };
  }

  /** GM：替某位成員寫入角色（匯入舊機器人存檔用）。同樣要帶版本號，免得蓋掉對方剛存的 */
  onCharImport(user, msg, rid) {
    if (!this.isGm(user.uid)) return err(rid, 'forbidden', '只有 GM 可以匯入玩家角色。');
    const uid = String(msg.uid);
    if (!UID.test(uid) || this.accessState(uid) !== 'ok') return err(rid, 'bad_char', '這個玩家不在白名單內。');
    const before = this.charRow(uid);
    const r = this.storeChar(uid, msg.base, msg.data, rid);
    if (r.out) return r;
    const saved = [{ to: 'self', msg: { t: 'charSaved', rid, uid, ...r } }];
    if (!r.ok) return { out: saved, close: null }; // 版本對不上沒有寫入，不記
    // 異動紀錄：誰、何時、改了什麼（GM 替玩家改角色），所有人都看得到，和擲骰紀錄放在同一條時間軸
    const member = this.db.exec('SELECT name FROM members WHERE uid = ?', uid)[0]?.name ?? uid;
    const { lines } = describeCharChange(before ? JSON.parse(before.json) : null, msg.data);
    const ev = this.record({ who: '系統', kind: 'audit', target: uid, label: `${user.name} 修改了「${cleanStr(msg.data.name, 80)}」（${member}）的角色`, lines }, user);
    return { out: [...saved, ...this.broadcastEvent(ev).out], close: null };
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
