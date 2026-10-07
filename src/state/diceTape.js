// ============================================================
// 「骰點帶」：讓遊戲規則函式（combat.js、equipment.js 的純函式）直接吃伺服器擲出的骰點，
// 而不用改任何規則程式。做法是三步：
//   1. planDice：在狀態的複本上「試跑」一次，記下規則總共要擲哪幾組骰子（每顆都經過 rollDie → rng.int(面數)）
//   2. （伺服器用安全亂數把每一顆擲好，見 worker/src/room-core.js 的 draw）
//   3. applyDice：把伺服器的點數依序餵給「同一個」規則函式，在另一份複本上真正執行，成功才換回真正的狀態
// 規則函式本身完全沒有被複製或修改，所以不會有兩邊規則漂移的問題。
// 擲骰的組數與面數只取決於招式、骰池與裝備等「事前已知」的資料，不取決於擲出的點數。
// ============================================================
export class TapeError extends Error {}

class Unsupported extends Error {}

/** 連續相同面數壓成一組：[4,4,4,15] → [[4,3],[15,1]] */
function compress(sidesList) {
  const pools = [];
  for (const s of sidesList) {
    if (pools.length && pools.at(-1)[0] === s) pools.at(-1)[1]++;
    else pools.push([s, 1]);
  }
  return pools;
}

const expand = (pools) => pools.flatMap(([sides, count]) => Array(count).fill(sides));

/** 試跑 run(state複本, rng)，回傳 { pools, total } 或 { unsupported: true }（規則用到了非骰子的隨機） */
export function planDice(state, run) {
  const sides = [];
  const rng = () => { throw new Unsupported(); };
  rng.int = (n) => { sides.push(n); return 1; };
  try {
    run(structuredClone(state), rng);
  } catch (e) {
    if (e instanceof Unsupported) return { unsupported: true };
    throw e;
  }
  return { pools: compress(sides), total: sides.length };
}

/** 依序吐出伺服器點數的 rng；面數對不上或點數超出範圍就報錯 */
export function replayRng(values, pools) {
  const expected = expand(pools);
  let i = 0;
  const rng = () => { throw new TapeError('unexpected float rng'); };
  rng.int = (sides) => {
    const v = values[i];
    if (i >= expected.length || expected[i] !== sides || !Number.isInteger(v) || v < 1 || v > sides) throw new TapeError('dice mismatch');
    i++;
    return v;
  };
  rng.done = () => i === expected.length && values.length === expected.length;
  return rng;
}

/** 把 next 的內容原地換進 target（畫面上到處拿著 target 這個物件，不能換掉物件本身） */
export function adopt(target, next) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, next);
}

/** 用伺服器的點數真正執行一次 run；全部成功才會改動 state，失敗時 state 完全不動 */
export function applyDice(state, run, values, pools) {
  const next = structuredClone(state);
  const rng = replayRng(values, pools);
  const result = run(next, rng);
  if (!rng.done()) throw new TapeError('dice left over');
  adopt(state, next);
  return result;
}
