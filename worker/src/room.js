// Durable Object：固定團房間。薄外殼：Hibernation WebSocket + SQLite，房間規則都在 room-core.js。
// Hibernation：沒有訊息時 Durable Object 會被換出記憶體，閒置連線不佔運算；
// 每條連線的身分存在 WebSocket attachment（跟著連線走，睡醒後還在）。
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from './room-core.js';
import { MAX_SOCKETS_PER_USER } from './config.js';

function sqlAdapter(storage) {
  return {
    exec: (query, ...params) => storage.sql.exec(query, ...params).toArray(),
    tx: (fn) => storage.transactionSync(fn),
  };
}

const safeSend = (ws, data) => { try { ws.send(data); } catch { /* 對方已經斷線 */ } };

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore({ db: sqlAdapter(ctx.storage), env });
    ctx.blockConcurrencyWhile(async () => { this.core.migrate(); });
    // 心跳：前端送 "ping"，由 Cloudflare 直接回 "pong"，不用把 Durable Object 叫醒
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  online(except) {
    return [...new Set(this.ctx.getWebSockets().filter((w) => w !== except).map((w) => w.deserializeAttachment()?.uid).filter(Boolean))];
  }

  broadcast(text, except) {
    for (const w of this.ctx.getWebSockets()) if (w !== except) safeSend(w, text);
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    // 身分是 Worker 驗證過 session cookie 後才放進這些標頭的（Worker 會先刪掉瀏覽器自己送的 x-hj-*）
    const uid = request.headers.get('X-HJ-Uid');
    if (!uid || !/^\d+$/.test(uid)) return new Response('bad user', { status: 400 });
    let name;
    try { name = decodeURIComponent(request.headers.get('X-HJ-Name') || ''); } catch { name = ''; }
    const user = {
      uid, name: name.slice(0, 80) || uid, avatar: request.headers.get('X-HJ-Avatar') || null,
      exp: Number(request.headers.get('X-HJ-Exp')) || 0,
    };
    // 每次連線都重新確認白名單
    if (this.core.accessState(uid) !== 'ok') return new Response('not allowed', { status: 403 });
    if (request.headers.get('X-HJ-Room')) this.core.roomId = request.headers.get('X-HJ-Room');

    // 同一個人最多幾個分頁：超過就踢掉最舊的
    const mine = this.ctx.getWebSockets(uid);
    for (const w of mine.slice(0, Math.max(0, mine.length - (MAX_SOCKETS_PER_USER - 1)))) { try { w.close(4409, 'replaced'); } catch { /* ignore */ } }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [uid]);
    server.serializeAttachment(user);
    this.core.join(user);
    const online = this.online();
    safeSend(server, JSON.stringify(this.core.hello(user, online)));
    this.broadcast(JSON.stringify({ t: 'presence', members: this.core.membersView(online) }), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const user = ws.deserializeAttachment();
    if (!user) { ws.close(4401, 'no session'); return; }
    const res = this.core.handle(user, message, { online: this.online() });
    for (const o of res.out) {
      const text = JSON.stringify(o.msg);
      if (o.to === 'self') safeSend(ws, text);
      else if (o.to === 'user') for (const w of this.ctx.getWebSockets(o.uid)) safeSend(w, text); // 只送給某位玩家的所有分頁
      else this.broadcast(text);
    }
    if (res.close) { try { ws.close(res.close.code, res.close.reason); } catch { /* ignore */ } }
  }

  presenceAfterLeave(ws) {
    this.broadcast(JSON.stringify({ t: 'presence', members: this.core.membersView(this.online(ws)) }), ws);
  }

  async webSocketClose(ws, code) {
    const ok = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 && code !== 1015;
    try { ws.close(ok ? code : 1000, 'bye'); } catch { /* ignore */ }
    this.presenceAfterLeave(ws);
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* ignore */ }
    this.presenceAfterLeave(ws);
  }
}
