// 幻境編年史 API（階段 1-A）：只做 Discord 登入。
// 路由：GET /health、/auth/login、/auth/callback、/auth/me；POST /auth/logout
// 設計重點：登入完成後「不保存」Discord access token，只把 id/名稱/頭像簽進 session cookie。
import { signToken, verifyToken, randomToken } from './crypto.js';
import { parseCookies, setCookie, clearCookie } from './cookies.js';
import { parseAllowlist, isAllowed, roomAccessState } from './allowlist.js';
import { avatarUrl } from './avatar.js';
import { ROOM_IDS } from './config.js';

export { parseAllowlist, isAllowed }; // 階段 1-A 起就從這裡匯出（測試在用）

const SESSION_COOKIE = 'hj_session';
const STATE_COOKIE = 'hj_state';
const DAY_MS = 24 * 3600 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS; // 每次簽發的有效期
const RENEW_BELOW_MS = 15 * DAY_MS; // 剩餘有效期低於這個值，/auth/me 就換發新 token
const SESSION_MAX_AGE_MS = 90 * DAY_MS; // 從原始登入起算的上限，滿了必須重新登入
const STATE_TTL_MS = 10 * 60 * 1000;
const DISCORD_API = 'https://discord.com/api';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

// ---------- CORS：只允許網站來源，並帶 credentials ----------
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !env.SITE_ORIGIN || origin !== env.SITE_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

const withCors = (res, request, env) => {
  for (const [k, v] of Object.entries(corsHeaders(request, env))) res.headers.set(k, v);
  if (!res.headers.has('Vary') && request.headers.get('Origin')) res.headers.set('Vary', 'Origin');
  return res;
};

// ---------- 小工具 ----------
const configured = (env) =>
  env.SESSION_SECRET && env.DISCORD_CLIENT_SECRET && env.DISCORD_CLIENT_ID && env.DISCORD_REDIRECT_URI && env.SITE_ORIGIN;

function backToSite(env, result, extraCookies = []) {
  const url = new URL(env.SITE_ORIGIN);
  url.searchParams.set('login', result);
  const headers = new Headers({ Location: url.toString(), 'Cache-Control': 'no-store' });
  for (const c of extraCookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

const publicUser = (s) => ({ id: s.uid, name: s.name, avatarUrl: avatarUrl({ id: s.uid, avatar: s.avatar }) });

async function readSession(request, env, now = Date.now()) {
  if (!env.SESSION_SECRET) return null;
  const token = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  const s = await verifyToken(token, env.SESSION_SECRET, now);
  return s && typeof s.uid === 'string' ? s : null;
}

// ---------- 路由 ----------
async function login(request, env) {
  const nonce = randomToken(16);
  const signed = await signToken({ n: nonce, exp: Date.now() + STATE_TTL_MS }, env.SESSION_SECRET);
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', nonce);
  url.searchParams.set('prompt', 'none');
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': setCookie(STATE_COOKIE, signed, { path: '/auth', maxAge: STATE_TTL_MS / 1000 }),
    },
  });
}

async function callback(request, env) {
  const url = new URL(request.url);
  const clearState = clearCookie(STATE_COOKIE, { path: '/auth' });
  const fail = (reason) => backToSite(env, reason, [clearState]);

  if (url.searchParams.get('error')) return fail('cancelled');

  const stateParam = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const stateCookie = parseCookies(request.headers.get('Cookie'))[STATE_COOKIE];
  const st = await verifyToken(stateCookie, env.SESSION_SECRET);
  if (!st || !stateParam || st.n !== stateParam || !code) return fail('state');

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'huan-jing-api (login)' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) return fail('error');
    const { access_token: accessToken } = await tokenRes.json();
    if (!accessToken) return fail('error');

    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'huan-jing-api (login)' },
    });
    if (!meRes.ok) return fail('error');
    const me = await meRes.json();
    if (!me || typeof me.id !== 'string' || !/^\d+$/.test(me.id)) return fail('error');

    // access token 只活在這個函式裡，不寫入 cookie、不存任何地方
    if (!isAllowed(env, me.id)) return fail('denied');

    const now = Date.now();
    const session = await signToken({
      uid: me.id,
      iat: now, // 原始登入時間；續期時保留不變，用來計算 90 天上限
      name: String(me.global_name || me.username || me.id).slice(0, 80),
      avatar: typeof me.avatar === 'string' ? me.avatar : null,
      exp: now + SESSION_TTL_MS,
    }, env.SESSION_SECRET);
    return backToSite(env, 'ok', [
      clearState,
      setCookie(SESSION_COOKIE, session, { path: '/', maxAge: SESSION_TTL_MS / 1000 }),
    ]);
  } catch {
    return fail('error');
  }
}

async function me(request, env) {
  const s = await readSession(request, env);
  // 每次都重新檢查白名單：就算 session 還沒到期，被移出名單的人也視為未登入
  if (!s || !isAllowed(env, s.uid)) return json({ user: null });

  // 滑動續期：剩餘不到 15 天就換發；新的到期時間不會超過「原始登入 + 90 天」
  const now = Date.now();
  const headers = {};
  if (typeof s.iat === 'number' && s.exp - now < RENEW_BELOW_MS) {
    const exp = Math.min(now + SESSION_TTL_MS, s.iat + SESSION_MAX_AGE_MS);
    if (exp > s.exp) {
      const token = await signToken({ uid: s.uid, iat: s.iat, name: s.name, avatar: s.avatar, exp }, env.SESSION_SECRET);
      headers['Set-Cookie'] = setCookie(SESSION_COOKIE, token, { path: '/', maxAge: Math.floor((exp - now) / 1000) });
    }
  }
  return json({ user: publicUser(s) }, 200, headers);
}

function logout(request, env) {
  // 防 CSRF：只接受來自網站來源的請求
  if (request.headers.get('Origin') !== env.SITE_ORIGIN) return json({ error: 'forbidden' }, 403);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}

// ---------- 固定團房間（階段 1-B） ----------
const ROOM_PATH = /^\/rooms\/([a-z0-9_-]{1,32})\/(access|ws)$/;

/** 前端用來決定「進房間還是維持本機模式」，並能顯示明確原因。不會碰到 Durable Object。 */
async function roomAccess(request, env, roomId) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (!ROOM_IDS.includes(roomId)) return json({ error: 'not_found' }, 404);
  const s = await readSession(request, env);
  if (!s) return json({ state: 'unauthenticated' });
  return json({ state: roomAccessState(env, s.uid), user: publicUser(s) });
}

/**
 * WebSocket 不受 CORS 保護（任何網站都能對我們開連線，而且會自動帶 cookie），
 * 所以升級連線前一定要：檢查 Origin、驗證 session cookie、確認在白名單內。
 */
async function roomSocket(request, env, roomId) {
  const fail = (status, error) => json({ error }, status);
  if (request.method !== 'GET') return fail(405, 'method_not_allowed');
  if (!ROOM_IDS.includes(roomId)) return fail(404, 'not_found');
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426, 'upgrade_required');
  if (request.headers.get('Origin') !== env.SITE_ORIGIN) return fail(403, 'bad_origin');
  const s = await readSession(request, env);
  if (!s) return fail(401, 'unauthenticated');
  const state = roomAccessState(env, s.uid);
  if (state !== 'ok') return fail(403, state);
  if (!env.ROOM) return fail(500, 'server_misconfigured');

  const headers = new Headers(request.headers);
  for (const k of [...headers.keys()]) if (k.startsWith('x-hj-')) headers.delete(k); // 不信任瀏覽器自己帶的身分標頭
  headers.set('X-HJ-Uid', s.uid);
  headers.set('X-HJ-Name', encodeURIComponent(s.name));
  headers.set('X-HJ-Avatar', s.avatar ?? '');
  headers.set('X-HJ-Exp', String(s.exp));
  headers.set('X-HJ-Room', roomId);
  return env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (path === '/health' && request.method === 'GET') return withCors(json({ status: 'ok' }), request, env);

    const room = ROOM_PATH.exec(path);
    if (room) {
      if (!configured(env)) return withCors(json({ error: 'server_misconfigured' }, 500), request, env);
      return room[2] === 'ws' ? roomSocket(request, env, room[1]) : withCors(await roomAccess(request, env, room[1]), request, env);
    }

    const routes = {
      'GET /auth/login': login,
      'GET /auth/callback': callback,
      'GET /auth/me': me,
      'POST /auth/logout': logout,
    };
    const handler = routes[`${request.method} ${path}`];
    if (!handler) return withCors(json({ error: 'not_found' }, path.startsWith('/auth/') ? 405 : 404), request, env);

    if (!configured(env)) return withCors(json({ error: 'server_misconfigured' }, 500), request, env);
    return withCors(await handler(request, env), request, env);
  },
};
