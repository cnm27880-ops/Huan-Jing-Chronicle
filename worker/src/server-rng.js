// 伺服器擲骰用的安全亂數：crypto.getRandomValues + 拒絕取樣（rejection sampling）。
// 為什麼要拒絕取樣：直接用「亂數 % 面數」時，32 位元亂數的總數不是面數的整數倍，
// 前面幾個點數會多出一點點機率。把落在「尾巴」的值丟掉重抽，每個點數的機率就完全相同。
// rng.int(sides) 會被 src/game/dice.js 的 rollDie 優先使用；rng() 則給不是擲骰的隨機（抽選、洗牌）用。
const U32 = 2 ** 32;

/** fill(typedArray) 預設是 crypto.getRandomValues；測試時可以換成固定序列 */
export function makeSecureRng(fill = (a) => crypto.getRandomValues(a)) {
  const buf = new Uint32Array(1);
  const u32 = () => fill(buf)[0];

  const int = (sides) => {
    if (!Number.isInteger(sides) || sides < 1 || sides > U32) throw new RangeError('bad sides');
    const limit = U32 - (U32 % sides); // 大於等於 limit 的值會造成偏差，丟掉重抽
    let x;
    do { x = u32(); } while (x >= limit);
    return (x % sides) + 1;
  };

  // 53 位元均勻小數 [0, 1)
  const rng = () => ((u32() >>> 5) * 67108864 + (u32() >>> 6)) / 9007199254740992;
  rng.int = int;
  return rng;
}

export const serverRng = makeSecureRng();
