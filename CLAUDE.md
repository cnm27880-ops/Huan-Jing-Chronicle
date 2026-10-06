# 幻境編年史（網遊網站）

GM 原本用 Discord 機器人跑的網遊，正在改成網站。目前是**原型**：世界地圖、修整日、背包三個分頁，資料存在瀏覽器（localStorage）。
**改到遊戲規則、擲骰、加值、胃袋、紀念品時，先讀 `GAME_RULES.md`，並在改完後執行 `npm test`。**
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
| `src/main.js` | 進入點、分頁切換（#map / #rest / #bag）、角色存檔串接 |
| `GAME_RULES.md` | 遊戲規則規格（擲骰以機器人為準） |
| `src/game/rules.js` | 規則數值：採集池、配方、DC、食物（照搬機器人） |
| `src/game/engine.js` | 規則邏輯：加值、熟練、胃袋、採集、製作、跑團檢定（純函式） |
| `tests/engine.test.js` | 規則測試，確認與機器人一致 |
| `src/state/store.js` | 角色存檔（目前 localStorage，之後換 Cloudflare 只改這裡） |
| `src/data/sample/fude.js` | 示範角色資料 |
| `src/ui/restView.js` | 修整日頁面 |
| `src/ui/bagView.js` | 背包頁面 |
| `src/ui/dom.js` | 建立元素的小工具 |
| `src/api/lore.js` | **資料存取層**。UI 只能透過這裡拿資料 |
| `src/data/regions.js` | 四大區域＋中央海域 |
| `src/data/locations.js` | 地點內容與揭露狀態。格式見 `src/data/CLAUDE.md` |
| `public/map-data/markers.json` | 地圖標記位置（百分比座標、類型、簡介、設定集 id） |
| `src/ui/markerCard.js` | 點標記的小卡片 |
| `src/ui/mapView.js` | 地圖拖曳、縮放、熱點 |
| `src/ui/dossier.js` | 地點情報面板 |
| `src/ui/indexList.js` | 地點索引清單 |
| `src/styles/tokens.css` | 顏色、字體變數（改配色只改這裡） |
| `src/styles/layout.css` | 頂部列、索引面板 |
| `src/styles/map.css` | 地圖與熱點 |
| `src/styles/dossier.css` | 情報面板與四大區域主題 |
| `src/styles/pages.css` | 修整日、背包頁面 |
| `src/styles/redesign.css` | 全站新版樣式（最後載入，覆蓋前面幾個檔案） |
| `public/lore-data/*.json` | 設定集文字（Discord 匯出），點「查看設定集」時由 `lore.js` 讀取 |

## 不可違反的規則
1. **防劇透**：未揭露（`hidden`）與草稿（`draft`）的內容只能在 `src/api/lore.js` 被過濾掉，不能只在畫面上隱藏。UI 拿到的資料就不該包含它們。
2. 內容文字一律用 `textContent` 放進頁面，**禁止用 `innerHTML` 放資料內容**（之後內容由 GM 輸入，要防 XSS）。
3. `src/api/lore.js` 的函式名稱與回傳格式要保持穩定，之後會換成向 Cloudflare Worker 要資料。
4. 機密（Token、金鑰）和 `players_data.json` 永遠不能進 git。
5. 圖片路徑用相對路徑（`img/...`，不要開頭的 `/`），GitHub Pages 子路徑才不會壞。

## 未來規劃（現在不要做，除非我明確要求）
Cloudflare Workers + Durable Objects、Discord OAuth2 登入、GM 後台（地圖點選放標記、表單編輯、圖片上傳到 R2、揭露開關）、依技能自動計算戰鬥面板、從試算表匯入角色。
