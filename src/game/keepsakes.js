// ============================================================
// 紀念品目錄（GM 目前發過的 13 種，效果原文見 GAME_RULES.md「紀念品」）。純資料，不碰畫面。
// 欄位：
//   desc    效果原文（背包與修整日顯示）
//   scope   'rest' = 所有修整檢定；陣列 = 指定技能；沒有 scope = 不能在檢定時勾選
//   bonus   該次檢定加值
//   diff    只在這些製作難度、而且是一般製作（不含特殊配方）時有效
//   double  成功時產出的物品雙倍
//   use     直接使用：{ gives: { 物品: 數量 } } 得到物品，或 { time: N } 轉成時間
//   manual  效果要手動處理，網頁不自動計算
// 玩家背包有同名物品時，存檔升級與放進背包都會把這裡的效果補上（engine.js addItem、store.js）。
// ============================================================
export const KEEPSAKES = {
  臉哥的創意點子: { desc: '在進行非配方的困難鑄造時消耗 1 個，該次鑄造技能額外 +5，且產出的物品雙倍獲得，同項不能疊加。', scope: ['鑄造'], diff: ['困難'], bonus: 5, double: true },
  繃繃狗的爪爪: { desc: '挖礦時消耗 1 個，該次挖礦技能額外 +5，同項不能疊加。', scope: ['挖礦'], bonus: 5 },
  彌月思念的書信: { desc: '在進行非配方的困難書寫時消耗 1 個，該次書寫技能額外 +5，且產出的物品雙倍獲得，同項不能疊加。', scope: ['書寫'], diff: ['困難'], bonus: 5, double: true },
  兄弟好相助: { desc: '在進行日常檢定時消耗 1 個，該次檢定熟練額外 +3，同項不能疊加。', scope: 'rest', bonus: 3 },
  小廚的不甘: { desc: '在進行非配方的困難烹飪時消耗 1 個，該次烹飪技能額外 +5，且產出的物品雙倍獲得，同項不能疊加。', scope: ['烹飪'], diff: ['困難'], bonus: 5, double: true },
  旅行青蛙的禮物: { desc: '消耗後可以獲得 永恆草 ×10、傳說肉 ×10、隕星石 ×10。', use: { gives: { 永恆草: 10, 傳說肉: 10, 隕星石: 10 } } },
  鳥人的祖傳魚露配方: { desc: '在進行非配方的困難調劑時消耗 1 個，該次調劑技能額外 +5，且產出的物品雙倍獲得，同項不能疊加。', scope: ['調劑'], diff: ['困難'], bonus: 5, double: true },
  兔子俠的狩獵指南: { desc: '狩獵時消耗 1 個，該次狩獵技能額外 +5，同項不能疊加。', scope: ['狩獵'], bonus: 5 },
  微光的不定型擴容陣列: { desc: '在進行史詩製作時消耗 1 個，該次技能產出的物品雙倍獲得，同項不能疊加。', scope: ['烹飪', '鑄造', '書寫', '調劑'], diff: ['史詩'], double: true },
  掉毛喵的私人釣點: { desc: '釣魚時消耗 1 個，該次釣魚技能額外 +3，同項不能疊加。', scope: ['釣魚'], bonus: 3 },
  門門的採藥心得: { desc: '採藥時消耗 1 個，該次採藥技能額外 +5，同項不能疊加。', scope: ['採藥'], bonus: 5 },
  加爾姆的專屬時間: { desc: '消耗後可以轉化為 5 時間。', use: { time: 5 } },
  張亮的驚人發現: { desc: '在語音跑團中，檢定投骰前消耗，可以為該檢定增加一個獎勵骰。（網頁不自動計算，請自己在跑團時處理並從背包取出 1 個）', manual: true },
};

/** 這個名字是不是目錄裡的紀念品 */
export const isKeepsake = (name) => Object.prototype.hasOwnProperty.call(KEEPSAKES, name);

/** 把背包裡有的、目錄認得的紀念品效果補進 state.keepsakes（一律以目錄為準，自創的紀念品不動）。回傳有補的名稱 */
export function syncKeepsakes(state) {
  state.keepsakes = state.keepsakes ?? {};
  const names = new Set([...Object.keys(state.inventory ?? {}), ...Object.keys(state.keepsakes)]);
  const changed = [];
  for (const n of names) {
    if (!isKeepsake(n)) continue;
    const next = JSON.stringify(KEEPSAKES[n]);
    if (JSON.stringify(state.keepsakes[n]) !== next) { state.keepsakes[n] = JSON.parse(next); changed.push(n); }
  }
  return changed;
}

/** 效果的簡短標籤：「+5 雙倍」「直接使用」 */
export const keepsakeTag = (def) =>
  [def.bonus ? `+${def.bonus}` : '', def.double ? '產出雙倍' : '', def.use ? '直接使用' : '', def.manual ? '手動處理' : ''].filter(Boolean).join('　');
