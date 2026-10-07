// 測試用小工具：用 Node 內建的 node:sqlite 當 Durable Object 的 SQLite（SQL 是真的在跑）
import { DatabaseSync } from 'node:sqlite';

export function makeDb(raw = new DatabaseSync(':memory:')) {
  let depth = 0;
  return {
    raw,
    exec: (q, ...p) => raw.prepare(q).all(...p),
    tx(fn) { // 和 Durable Object 的 transactionSync 一樣，可以巢狀（用 SAVEPOINT）
      const name = `sp${depth++}`;
      raw.exec(`SAVEPOINT ${name}`);
      try {
        const r = fn();
        raw.exec(`RELEASE ${name}`);
        return r;
      } catch (e) {
        raw.exec(`ROLLBACK TO ${name}`);
        raw.exec(`RELEASE ${name}`);
        throw e;
      } finally { depth--; }
    },
  };
}

/** 固定點數的 rng：依序吐出 values；點數超出面數就報錯（確認呼叫端沒有搞錯面數） */
export function seqRng(values) {
  let i = 0;
  const rng = () => { throw new Error('unexpected float rng'); };
  rng.int = (sides) => {
    const v = values[i++ % values.length];
    if (!(v >= 1 && v <= sides)) throw new Error(`fixed value ${v} out of range for D${sides}`);
    return v;
  };
  return rng;
}
