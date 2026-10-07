// ============================================================
// 房間的 WebSocket 連線：自動重連（指數退避）、心跳、致命關閉碼不重連。
// 只負責「連線」，不懂遊戲訊息；訊息的意思由 rollLog.js 處理。
// ============================================================
const PING_MS = 45_000;
const PONG_TIMEOUT_MS = 10_000;
// 4401 登入過期、4403 不在白名單、4409 被其他分頁取代：重連也沒用
const FATAL = new Set([4401, 4403, 4409]);

/**
 * onStatus(status, info)：'connecting' | 'open' | 'retrying' | 'fatal'
 * beforeRetry()：每次重連前呼叫，回傳 false 就不再重連（例如發現已經不在白名單）
 */
export function createRoomClient({ url, onMessage, onStatus, beforeRetry }) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer = null;
  let pingTimer = null;
  let pongTimer = null;

  const clearTimers = () => { clearInterval(pingTimer); clearTimeout(pongTimer); clearTimeout(retryTimer); };

  function connect() {
    if (stopped) return;
    clearTimeout(retryTimer);
    onStatus('connecting', { attempt });
    let sock;
    try { sock = new WebSocket(url); } catch { return scheduleRetry(); }
    ws = sock;
    const onClosed = (code) => {
      clearInterval(pingTimer); clearTimeout(pongTimer);
      if (ws === sock) ws = null;
      if (stopped) return;
      if (FATAL.has(code)) { stopped = true; onStatus('fatal', { code }); return; }
      scheduleRetry(code === 4429 ? 10_000 : 0);
    };
    sock.onopen = () => {
      attempt = 0;
      onStatus('open');
      pingTimer = setInterval(() => {
        try { sock.send('ping'); } catch { return; }
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => { // 沒回 pong = 連線已死：網路斷掉時瀏覽器可能很久才觸發 onclose，不等它，直接當作斷線
          sock.onclose = null; sock.onmessage = null;
          try { sock.close(); } catch { /* ignore */ }
          onClosed(1006);
        }, PONG_TIMEOUT_MS);
      }, PING_MS);
    };
    sock.onmessage = (e) => {
      if (e.data === 'pong') { clearTimeout(pongTimer); return; }
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && typeof msg.t === 'string') onMessage(msg);
    };
    sock.onclose = (e) => onClosed(e.code);
    sock.onerror = () => { /* 緊接著會有 onclose，由那邊處理 */ };
  }

  function scheduleRetry(minDelay = 0) {
    if (stopped) return;
    const delay = Math.max(minDelay, Math.min(30_000, 1000 * 2 ** attempt)) * (0.75 + Math.random() * 0.25);
    attempt++;
    onStatus('retrying', { attempt, delay });
    retryTimer = setTimeout(async () => {
      if (stopped) return;
      let again = true;
      try { again = beforeRetry ? await beforeRetry() : true; } catch { again = true; }
      if (again && !stopped) connect(); else if (!stopped) { stopped = true; onStatus('fatal', { code: 0 }); }
    }, delay);
  }

  const wake = () => { if (!stopped && !ws && attempt > 0) { clearTimeout(retryTimer); connect(); } };
  const onVisible = () => { if (document.visibilityState === 'visible') wake(); };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', onVisible);

  return {
    connect,
    send(obj) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
    },
    close() {
      stopped = true;
      clearTimers();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisible);
      const s = ws; ws = null;
      try { s?.close(1000, 'bye'); } catch { /* ignore */ }
    },
  };
}
