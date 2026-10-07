// 簽名工具：HMAC-SHA256（Web Crypto，Workers 與 Node 都有）。
// 格式：<base64url(JSON)>.<base64url(簽名)>；驗證用 subtle.verify，是定時比較（constant-time）。
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad base64url');
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const keyCache = new Map();
function getKey(secret) {
  if (!keyCache.has(secret)) {
    keyCache.set(secret, crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  }
  return keyCache.get(secret);
}

/** 簽出 token。payload 是可轉 JSON 的物件。 */
export async function signToken(payload, secret) {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await getKey(secret), enc.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

/** 驗證 token。簽名錯、格式錯、已過期（payload.exp 為毫秒時間戳）一律回 null。 */
export async function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await getKey(secret), b64urlDecode(parts[1]), enc.encode(parts[0]));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 16) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}
