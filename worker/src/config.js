// 房間設定常數。之後要加第二個房間，只要把 id 加進 ROOM_IDS（這次不做房間選擇介面）。
export const DEFAULT_ROOM_ID = 'main';
export const ROOM_IDS = [DEFAULT_ROOM_ID];

export const HISTORY_LIMIT = 200; // 伺服器保存的擲骰紀錄筆數
export const MAX_MESSAGE_CHARS = 8192; // 單則 WebSocket 訊息上限
export const RATE_LIMIT_PER_SEC = 6; // 每人每秒訊息數；超過的丟棄並回錯誤
export const RATE_ABUSE_PER_SEC = 30; // 每秒超過這個數量：直接斷線
export const MAX_SOCKETS_PER_USER = 4; // 同一個人最多同時幾個分頁；超過就踢掉最舊的
export const MAX_DRAW_DICE = 5000; // 戰鬥／鑑定單次最多擲幾顆（一次鑑定很多件裝備也夠用）
export const MAX_DRAW_POOLS = 32;
export const DRAW_TTL_MS = 60_000;
export const MAX_PENDING_DRAWS_PER_USER = 20;

// 角色存檔（階段 2）：整份角色資料存在房間的 SQLite，每人一份
export const MAX_CHAR_MESSAGE_CHARS = 262_144; // 只有 charPut 可以超過 MAX_MESSAGE_CHARS，上限 256K 字
export const MAX_CHAR_JSON_CHARS = 200_000; // 角色 JSON 本身的上限

// 信箱（送東西、餵藥）：對方不用同意；不在線時留在伺服器，上線才送達
export const MAX_PENDING_MAIL = 50; // 每人最多同時放幾封未領取的
export const MAX_MAIL_ITEM_KINDS = 30; // 一封最多幾種東西
export const MAX_MAIL_ITEM_QTY = 9999; // 單一種東西的數量上限

// 怪物立繪（GM 上傳）：前端先縮成 WebP 再送，伺服器存在房間的 SQLite，用網址讀取
export const MAX_IMAGES = 40; // 立繪庫最多幾張；滿了要先刪
export const MAX_IMAGE_B64_CHARS = 240_000; // 單張 base64 字數上限（約 175 KB 的圖）

// 敵人預組（GM 備團）：把場上抽好的整團敵人存起來，跑團時一鍵載入、模擬戰當固定敵人
export const MAX_PRESETS = 30;
export const ACTIVITY_PER_USER = 500; // 玩家日誌：每人最多留最近幾筆
export const ACTIVITY_PAGE = 60; // 日誌一次回傳幾筆
