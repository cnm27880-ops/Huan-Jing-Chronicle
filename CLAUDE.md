# 幻境編年史（網遊網站）

GM 原本用 Discord 機器人跑的網遊，正在改成網站。目前是**原型**：世界地圖、修整日、背包、裝備、戰鬥五個分頁，加上隨時可開的「骰盤」，資料存在瀏覽器（localStorage）。
**改到遊戲規則、擲骰、加值、胃袋、紀念品、裝備、戰鬥、藥水時，先讀 `GAME_RULES.md`，並在改完後執行 `npm test`。**
開發者是程式新手：回覆用繁體中文，步驟要具體，指令要能直接複製貼上。

## 省 token 規則（最重要）
- **不要掃描整個專案**。先看下面的檔案地圖，只開跟任務有關的檔案。
- 不確定要改哪裡時，先列出你打算讀／改的檔案，等我同意再動手。
- 不要讀圖片、`dist/`、`node_modules/`、`package-lock.json`（已在 `.claude/settings.json` 封鎖）。
- 小改動用局部編輯，不要整檔重寫。改完只回報改了哪些檔案、各一句話，不要貼整段程式碼。
- 不要主動重構、改名、加套件或改其他沒提到的檔案。

## 技術
Vite + 原生 JavaScript（ES modules）+ 純 CSS，沒有框架。
指令：`npm run dev`（開發）、`npm run build`（建置到 dist/）、`npm test`（規則測試）。

## 檔案地圖
| 檔案 | 用途 |
|---|---|
| `index.html` | 頁面骨架（頂部列、地圖、面板容器） |
| `src/main.js` | 進入點、分頁切換（#map / #rest / #bag / #gear / #battle）、角色存檔串接、骰盤 |
| `GAME_RULES.md` | 遊戲規則規格（擲骰以機器人為準） |
| `src/game/rules.js` | 規則數值：採集池、配方、DC、食物（照搬機器人） |
| `src/game/engine.js` | 規則邏輯：加值、熟練、胃袋、採集、製作、跑團檢定（純函式） |
| `src/game/dice.js` | 骰子基礎：擲骰、自訂骰式解析（rng 可替換） |
| `src/game/stats.js` | 數值面板：基礎 + 裝備 + 食物，附明細 |
| `src/game/equipment.js` | 裝備：鑑定骰式、裝備欄、比較、整理（純函式） |
| `src/game/combat.js` | 戰鬥：A/B/C 結算、遭遇戰、藥水、倒地（純函式） |
| `src/game/events.js` | 把結果變成「擲骰事件」（格式見 rollLog.js） |
| `tests/*.test.js` | 規則測試：engine（採集製作）、combat、equipment、dice |
| `worker/` | Cloudflare Worker（`huan-jing-api`）：Discord 登入（階段 1-A）。設定在 `wrangler.jsonc`，測試在 `worker/test/`，Secrets 放後台 |
| `src/api/auth.js` | 前端登入 API：查詢登入者、登出；任何失敗都當未登入（維持單機試玩） |
| `src/ui/userChip.js` | 頂部列的登入者頭像與登出 |
| `src/state/rollLog.js` | 擲骰紀錄。**之後接 Cloudflare 時只改這個檔案**（publish 送伺服器、subscribe 收廣播） |
| `src/state/store.js` | 角色存檔（目前 localStorage，之後換 Cloudflare 只改這裡） |
| `src/data/sample/fude.js` | 示範角色資料 |
| `src/ui/restView.js` | 修整日頁面 |
| `src/ui/bagView.js` | 背包頁面 |
| `src/ui/gearView.js` | 裝備頁：面板、裝備欄、鑑定、整理 |
| `src/ui/battleView.js` | 戰鬥頁：血量、藥水、招式、遭遇戰 |
| `src/ui/diceTray.js` | 骰盤抽屜：一鍵技能檢定、自訂骰、紀錄 |
| `src/ui/rollFeed.js` | 擲骰紀錄的畫面（骰盤與戰鬥頁共用） |
| `src/ui/dom.js` | 建立元素的小工具 |
| `src/api/lore.js` | **資料存取層**。UI 只能透過這裡拿資料 |
| `src/data/regions.js` | 四大區域＋中央海域 |
| `src/data/locations.js` | 地點內容與揭露狀態。格式見 `src/data/CLAUDE.md` |
| `public/map-data/markers.json` | 地圖標記位置（百分比座標、類型、簡介、設定集 id） |
| `src/ui/mapView.js` | 地圖拖曳、縮放、熱點 |
| `src/ui/dossier.js` | 地點情報面板（點地圖標記或索引直接打開） |
| `src/ui/indexList.js` | 地點索引清單 |
| `src/styles/tokens.css` | 顏色、字體變數（改配色只改這裡） |
| `src/styles/layout.css` | 頂部列、索引面板 |
| `src/styles/map.css` | 地圖與熱點 |
| `src/styles/dossier.css` | 情報面板與四大區域主題 |
| `src/styles/pages.css` | 修整日、背包頁面 |
| `src/styles/dice.css` | 骰盤、紀錄、裝備頁、戰鬥頁 |
| `src/styles/redesign.css` | 全站新版樣式（覆蓋前面幾個檔案） |
| `src/styles/polish.css` | 質感層：玻璃面板、按鈕光暈、hover 效果（最後載入） |
| `public/lore-data/*.json` | 設定集文字（Discord 匯出），點「查看設定集」時由 `lore.js` 讀取 |

## 不可違反的規則
1. **防劇透**：未揭露（`hidden`）與草稿（`draft`）的內容只能在 `src/api/lore.js` 被過濾掉，不能只在畫面上隱藏。UI 拿到的資料就不該包含它們。
2. 內容文字一律用 `textContent` 放進頁面，**禁止用 `innerHTML` 放資料內容**（之後內容由 GM 輸入，要防 XSS）。
3. `src/api/lore.js` 的函式名稱與回傳格式要保持穩定，之後會換成向 Cloudflare Worker 要資料。
4. 機密（Token、金鑰）和 `players_data.json` 永遠不能進 git。
5. 擲骰結果一律用 `rollLog.publish()` 發布，UI 不要自己維護另一份「大家看得到的紀錄」。
6. 圖片路徑用相對路徑（`img/...`，不要開頭的 `/`），GitHub Pages 子路徑才不會壞。

## 未來規劃（現在不要做，除非我明確要求）
Cloudflare Workers + Durable Objects（共享骰盤、伺服器端擲骰與鑑定、角色資料放伺服器）、Discord OAuth2 登入、GM 控制遭遇戰與先攻、GM 後台（地圖點選放標記、表單編輯、圖片上傳到 R2、揭露開關）、依技能自動計算戰鬥面板、從試算表匯入角色。網站日後會掛到自己的網域（同站）。
