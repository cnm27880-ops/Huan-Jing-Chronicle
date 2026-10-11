// 每日自動備份：把房間 SQLite 的所有資料表打包成一個 gzip 的 JSON，存進 R2。
// dumpDatabase / backupKey / pickExpired 是純函式（測試在 worker/test/backup.test.js）；
// runBackup 只負責串 Durable Object 與 R2。
import { ROOM_IDS } from './config.js';

export const BACKUP_KEEP = 30; // 每個房間保留最近幾份（每天一份 = 30 天）
const PREFIX = 'backup';

/** 取出所有資料表的全部列（含立繪的 base64）。表名動態讀，之後新增資料表不用回來改這裡 */
export function dumpDatabase(db, now) {
  const names = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name").map((r) => r.name);
  const tables = {};
  for (const name of names) tables[name] = db.exec(`SELECT * FROM "${name.replaceAll('"', '""')}"`);
  return { format: 1, takenAt: now, tables };
}

/** 備份檔的物件名稱：同一天重跑會覆蓋同一份。日期用台灣時間（UTC+8） */
export function backupKey(roomId, now) {
  const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  return `${PREFIX}/${roomId}/${day}.json.gz`;
}

/** 從現有的物件名稱挑出該刪掉的（保留日期最新的 keep 份；名稱不符格式的一律不碰） */
export function pickExpired(keys, roomId, keep = BACKUP_KEEP) {
  const re = new RegExp(`^${PREFIX}/${roomId}/\\d{4}-\\d{2}-\\d{2}\\.json\\.gz$`);
  return keys.filter((k) => re.test(k)).sort().reverse().slice(keep);
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** 排程觸發時執行：每個房間各備份一份，再清掉過期的。失敗會丟錯（Cloudflare 後台的 Observability 看得到） */
export async function runBackup(env, now = Date.now()) {
  if (!env.BACKUP) throw new Error('backup: R2 bucket 沒有綁定（wrangler.jsonc 的 r2_buckets）');
  if (!env.ROOM) throw new Error('backup: Durable Object 沒有綁定');
  const done = [];
  for (const roomId of ROOM_IDS) {
    const dump = await env.ROOM.get(env.ROOM.idFromName(roomId)).dumpAll();
    const key = backupKey(roomId, now);
    await env.BACKUP.put(key, await gzip(JSON.stringify(dump)), { httpMetadata: { contentType: 'application/gzip' } });
    const listed = await env.BACKUP.list({ prefix: `${PREFIX}/${roomId}/` });
    const expired = pickExpired(listed.objects.map((o) => o.key), roomId);
    if (expired.length) await env.BACKUP.delete(expired);
    done.push({ key, deleted: expired.length });
  }
  return done;
}
