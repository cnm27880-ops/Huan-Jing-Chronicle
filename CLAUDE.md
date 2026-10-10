# 幻境編年史（網遊網站）

GM 原本用 Discord 機器人跑的網遊，正在改成網站。目前是**原型**：世界地圖、修整日、背包、裝備、交易、跑團（三欄工作台：角色與招式、遭遇戰舞台、擲骰紀錄）分頁，資料存在瀏覽器（localStorage）。
**改到遊戲規則、擲骰、加值、胃袋、紀念品、裝備、戰鬥、藥水時，先讀 `GAME_RULES.md`，並在改完後執行 `npm test`。**
開發者是程式新手：回覆用繁體中文，步驟要具體，指令要能直接複製貼上。
**所有 UI 樣式依 `DESIGN.md`（黑金主題）。** 色碼只能寫在 `src/styles/theme.css`，其他檔案用變數。

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
| `src/main.js` | 進入點、分頁切換（#map / #rest / #bag / #gear / #session / #market（舊的 #battle 導到 #session））、角色存檔串接、GM 示範角色換成空白角色（`gmBlankCheck`，要先確認）與還原備份（`offerRestore`） |
| `GAME_RULES.md` | 遊戲規則規格（擲骰以機器人為準） |
| `DESIGN.md` | 視覺設計規格（黑金主題） |
| `RULES_OVERVIEW.md` | 規則原文整理（創角、每日養成、技能學習升級、資源、寶石、配方、特殊材料）；階段 2 的依據，含待確認清單 |
| `src/game/rules.js` | 規則數值：採集池、配方、DC、食物（照搬機器人） |
| `src/game/engine.js` | 規則邏輯：加值、熟練、胃袋、採集、製作、跑團檢定（純函式） |
| `src/game/dice.js` | 骰子基礎：擲骰、自訂骰式解析（rng 可替換） |
| `src/game/stats.js` | 數值面板：基礎 + 裝備 + 食物，附明細 |
| `src/game/equipment.js` | 裝備：鑑定骰式、裝備欄、比較、整理；寶石鑑定與鑲嵌（純函式） |
| `src/game/market.js` | 交易：交易大廳（每日原價 5 個）、黑市（擲骰溢價／壓價、勞動抵債、代金券換金幣）、特殊黑市（黑市團、50 個）（純函式） |
| `src/game/combat.js` | 戰鬥：A/B/C 結算、遭遇戰、藥水、倒地（純函式） |
| `src/game/mail.js` | 送東西與餵藥（純函式）：打包扣背包、收到時套用（禮物進背包、藥水回復＋毒性算收件人、毒性滿了退回） |
| `src/state/mailbox.js` | 信箱：收到伺服器的信 → 領取（只有第一個分頁拿得到）→ 套用到自己的角色 → 存檔 → 跳通知；不在線寄來的上線才收到 |
| `src/ui/mailNotice.js` | 「收到的東西」通知面板（右下角浮動，不需同意） |
| `src/ui/holdRepeat.js` | 長按連加／連減（按住＋／－會越按越快；`onEnd` 放開才重畫）：送東西數量用（鬥氣加骰已改成直接輸入數字） |
| `src/ui/itemPicker.js` | 背包物品挑選器（分類鈕＋格狀物品，沒有搜尋欄；金幣是其中一格；點一下選取、長按調數量）：贈送與交易共用 |
| `src/ui/giftSheet.js` | 「贈送／交易」面板（背包頁按鈕，唯一入口，原「送給別人」）：上方三個分頁——🎁 贈送（對方不用同意）、🤝 交易（物品與／或金幣互換，先扣押在交易單上）、📥 待回覆（清單在 playerTrade.js）；戰鬥面板的「餵給隊友」用同一個信箱機制 |
| `src/game/trade.js` | 玩家交易的付款檢查（純函式，含金幣）：兩邊付不付得起、扣押與退回（不夠＝交易失敗，伺服器退回 A 押的） |
| `src/ui/playerTrade.js` | 「📥 待回覆」清單（給 giftSheet 用）：收到的交易（接受／拒絕）、我發出的交易（取消）；交易單存在伺服器（`room-core.js` 的 `tradeList`／`tradeRespond`），A 的東西與金幣先扣押在單子上 |
| `src/game/simulate.js` | 模擬戰（階段 D，純函式）：續航最長招式、怪物隨機打人、自動喝藥與隊友救人、勝率／回合數／傷害／剩餘生命統計；不碰真實存檔 |
| `src/ui/simPanel.js` | GM 專用「模擬戰」面板（跑團頁房間區塊）：選玩家＋敵人來源（自訂強度每場重抽／場上的敵人／預組，後兩種固定 A/B/C）＋場數，畫回合分布與剩餘生命條狀圖 |
| `src/game/enemy.js` | 敵人等級（普通／菁英 2 打／BOSS 3 打）與技能 A 攻擊強化、B 防禦強化（每回合歸零）、C 喝血（整場戰鬥 1 次）的次數與效果（伺服器與前端共用）（純函式） |
| `src/game/nudge.js` | 戰鬥提醒與隊友資源條的判斷（純函式）：資源動用比例、資源條、隊伍摘要、偵測隊友倒地／危急／全隊吃緊、防連發、手上能做的事 |
| `src/ui/partyBars.js`、`src/ui/nudgeModal.js` | 隊友資源條（跑團頁右欄、房間上方；GM 不顯示）與戰鬥提醒視窗（戰鬥中出事才跳、必須按掉；GM 不顯示） |
| `src/ui/confirmPop.js` | 網頁自己的對話框（取代瀏覽器的 confirm／prompt）：`askConfirm`／`askText`，有給按鈕貼在旁邊、沒給就置中；**全站不要再用 `confirm()`／`prompt()`／`alert()`** |
| `src/game/fairness.js` | 模擬戰的公平性（純函式）：量每位玩家一次出手的傷害並排強弱、小怪血量依最弱玩家設、「第一名只出六成力」的情境（`FAIR` 常數可調） |
| `src/game/tuning.js` | 模擬戰的目標（2～3 回合、每場約耗一半資源）、評價與策略建議、自動調整（保守版／激進版兩個方案 `PLANS`）：先找回合數的結構下限、必要時拿掉最弱的怪，再二分搜尋血量與攻擊強度（自訂強度 `scaleSpecs`／固定敵人 `scaleEncounter` 都能調）（純函式） |
| `src/game/activity.js`、`src/state/activityLog.js`、`src/ui/logsView.js` | 玩家日誌：內容格式（修整／學習／物品）、回報點（房間伺服器，離線存本機）、「日誌」大分頁（`#logs`，所有玩家都看得到每位玩家的）；伺服器端在 `room-core.js` 的 `actPost`／`actList`，每人留 500 筆 |
| `src/game/events.js` | 把結果變成「擲骰事件」（格式見 rollLog.js）；戰鬥逐軌文字行的格式與解析 |
| `tests/*.test.js` | 規則測試（遭遇戰的房間邏輯在 `worker/test/encounter.test.js`，立繪與隊友狀態在 `worker/test/images.test.js`）：engine（採集製作）、combat、equipment（含寶石）、dice、market（交易） |
| `worker/` | Cloudflare Worker（`huan-jing-api`）：Discord 登入（1-A）＋固定團房間與即時共享擲骰（1-B）。設定在 `worker/wrangler.jsonc`（白名單、GM、開發者的 Discord ID 也在這），測試在 `worker/test/`，Secrets 放後台 |
| `worker/src/room-core.js` | 房間規則（純邏輯）：白名單、GM 權限、伺服器擲骰、紀錄 200 筆、限流、輸入驗證、遭遇戰（GM 建立怪物、玩家出招後自動同步傷害、先攻位置隨機＋交換＋鎖定）、信箱（送東西與餵藥，離線暫存、領取先刪先贏）、玩家交易（交易單也放在信箱表，`tradeRespond` 處理接受／拒絕／失敗／取消，先刪先贏）、GM 寫入玩家角色時記「異動」事件（`worker/src/audit.js` 比對前後差異；鑑定 identify、黑市 deal、異動 audit 不存進 200 筆的紀錄歷史，只即時廣播或寫進日誌頁）、GM 新增的特殊配方與材料（`specialSet`／`specialDel`）與專屬技能（`skillSet`／`skillDel`），存在 meta、全員同步、每次改動記異動；怪物立繪（`imgPut`／`imgDel`／`encImg`，GM 上傳、存 SQLite、`room.js` 的 GET `/img/:id` 讀，網址由 `index.js` 驗登入）；隊友狀態（`vitals`，每人回報生命與資源、全員廣播）；敵人預組（`presetList`／`presetSave`／`presetDel`／`presetLoad`，只有 GM，回覆只送 GM 自己） |
| `worker/src/room.js` | Durable Object 外殼（Hibernation WebSocket + SQLite）；`entry.js` 是 wrangler 進入點 |
| `src/state/roomClient.js` | 房間 WebSocket 連線：自動重連、心跳 |
| `src/state/diceTape.js` | 讓規則函式直接吃伺服器擲出的骰點（不複製、不改規則） |
| `src/ui/roomPanel.js` | 跑團頁裡的房間區塊：狀態、GM、成員、新戰鬥、暫代 GM |
| `src/api/auth.js` | 前端登入 API：查詢登入者、登出；任何失敗都當未登入（維持單機試玩） |
| `src/ui/userChip.js` | 頂部列的登入者頭像與登出 |
| `src/state/rollLog.js` | 擲骰紀錄，**畫面與房間之間唯一的接線點**：房間模式走 WebSocket、伺服器擲骰；本機模式（沒登入／連不上）照舊存 localStorage |
| `src/state/vitals.js` | 隊友狀態回報：存檔後 0.6 秒比對，生命／資源／毒性／護盾有變才送給房間；等 GM 匯入期間不送 |
| `src/state/charSync.js` | 角色存檔同步（階段 2）：登入連上房間後把角色上傳伺服器，版本號樂觀鎖、防抖 1.5 秒、兩邊不同時問玩家；全新裝置且伺服器沒有存檔時不上傳示範角色（標記等待，GM 匯入後自動採用，畫面在 `src/ui/waitNotice.js`，新玩家也可以在那裡自己建立空白角色）；另有 GM 用的 `listCharacters`／`fetchCharacter`（模擬戰用）。本機 localStorage 仍是主要存檔 |
| `src/game/importBot.js` | 機器人存檔（players_data.json 的一位玩家）→ 網站角色（純函式）：只填機器人有的欄位，技能與基礎數值空白；可合併進既有角色 |
| `src/ui/botImport.js` | GM 專用的「匯入機器人存檔」面板（在跑團頁的房間區塊）：檔案只在瀏覽器讀取轉換，轉好才送伺服器（`charImport`）；`players_data.json` 永遠不能進 git |
| `src/data/skills.js` | 技能目錄（**自動產生，不要手改**；試算表沒有的個人專屬技能放 `tools/extra-skills.json`）：119 個技能、每級累積數值、位階／類型／系別／效果文字、升級經驗表。由 `tools/extract-skills.py` 從 GM 的自動角色卡產生 |
| `tools/extract-skills.py` | 更新技能目錄用（需要 openpyxl，只在技能資料改版時才跑）：`python3 tools/extract-skills.py 標準卡.xlsx [補充卡.xlsx …]` |
| `src/game/skillTable.js` | 技能數值：查表、啟動類技能（武裝）、skills 模式（`statMode: 'skills'`）的規則、老狗識途與浮腫之軀的動態被動、GM 新增專屬技能的檢查與放進目錄（`validateCustomSkill`／`setCustomSkills`）（純函式） |
| `src/game/skillDraw.js` | 抽取技能書（3 選 1，結果存 `pendingDraws`，選完前不能做其他事）（純函式） |
| `src/game/special.js` | 特殊配方（內建 10 個）、特殊材料（每日 1 次）、餵肉球與收割（純函式）；GM 新增的配方與材料也在這裡檢查與合併（`allRecipes`／`allMaterials`，畫面一律用這兩個）；畫面在修整日「特殊」分頁 |
| `src/ui/skillEdit.js`、`src/state/customSkills.js` | GM 專用的「專屬技能」面板（新增、修改、刪除；每級填累積屬性加成＋效果文字；內建技能不能改）；`customSkills.js` 是 GM 專屬技能的本機快取（載入角色前先放進目錄，免得生命上限算低、生命被砍）。指定給玩家在「玩家角色」面板 |
| `src/ui/specialEdit.js` | GM 專用的「特殊配方與材料」面板（跑團頁房間區塊）：新增、修改、刪除 GM 自己加的配方與每日材料（只產生物品、效果寫文字）；內建的不能改 |
| `src/game/keepsakes.js` | 紀念品目錄（13 種：加值、困難／史詩製作產出雙倍、直接使用、手動處理）與 `syncKeepsakes`（背包有同名物品就補上效果）（純資料與函式） |
| `src/game/badges.js` | 生活技能徽章（神級、500 次）：判斷達標、製作後技能 +1（純函式） |
| `src/game/importSheet.js` | 試算表角色卡（貼上的文字）→ 網站角色：用標題文字找位置，不看固定格子；算出「手動調整」（純函式） |
| `src/ui/sheetImport.js` | GM 專用的「匯入角色卡」面板（跑團頁的房間區塊）：貼上文字、預覽、寫入伺服器 |
| `src/ui/gmCharEdit.js` | GM 專用的「玩家角色」面板：看並改玩家的手動調整、技能等級、啟動 |
| `public/manifest.webmanifest`、`public/sw.js`、`public/icons/` | PWA（可加到主畫面）：manifest、Service Worker（只快取 /assets、/icons、/img，網頁與 API 不碰，改版後要讓舊快取失效就把 `sw.js` 的 `CACHE` 版本號 +1）、圖示（暫用，`tools/make-icons.py` 產生；換正式圖示：`python3 tools/make-icons.py --source 圖片.png`） |
| `src/state/store.js` | 角色存檔（目前 localStorage，之後換 Cloudflare 只改這裡） |
| `src/data/sample/fude.js` | 示範角色資料 |
| `src/ui/skillTile.js` | 技能方格（一格一行：名稱、位階類型、等級；電腦滑過浮動顯示效果、手機點開面板）：修整日學習與裝備頁技能共用 |
| `src/ui/restView.js` | 修整日頁面：上方 HUD、採集／製作／跑團檢定分頁、設定步驟＋大按鈕、結果卡 |
| `src/ui/statusBar.js` | 修整日的 HUD（時間、熟練、胃袋）與「吃東西」面板 |
| `src/ui/bagView.js` | 背包頁面 |
| `src/ui/gearView.js` | 裝備頁：面板、裝備欄（電腦版四件一排）、鑑定、寶石、背包裝備（不能丟棄，只能賣出）；右欄是「啟動型技能」勾選（其他已學技能到修整日學習看）與生活徽章 |
| `src/ui/badgePanel.js` | 生活徽章面板（原本在修整日學習分頁，現在放裝備頁右欄）：製作、改名、「我已經做過了」 |
| `src/ui/reveal.js` | 鑑定開獎動畫（翻牌、數值跳動；只是畫面，數值鑑定時就已存好） |
| `src/ui/marketView.js` | 交易頁（交易大廳／黑市／特殊黑市）＋裝備頁「賣出」面板 |
| `src/ui/battleView.js` | 戰鬥的個人部分（跑團頁左欄常駐，原戰鬥面板拆開）：HUD（生命／資源／防禦三軌／狀態標籤）、手機膠囊 HUD、招式條（選中的有「出招」）、藥水、狀態與防禦骰 |
| `src/ui/valueSheet.js` | 數值調整面板：手機底部彈出、電腦小彈出框（戰鬥頁點生命／資源時用） |
| `src/ui/sessionView.js` | 跑團頁的三欄工作台（版面規格見 `DESIGN.md`「跑團頁」）：左欄 HUD＋招式／藥水與狀態／技能檢定分頁、中欄遭遇戰舞台、右欄房間＋紀錄（全部／擲骰／戰鬥，新的在下）＋快速擲骰（擲完播 `diceFx.js` 特效）；平板與手機的底部抽屜與快捷列；離開頁面會停掉紀錄更新 |
| `src/ui/encounterCard.js` | 遭遇戰舞台（跑團頁中欄）：先攻軸（隨機、玩家可交換、GM 開打後鎖定）、BOSS 大立繪與 3 段血條（只是視覺）、三種防禦（點選）與三種攻擊（點兩下＝承受，第一下只待命）同時列出、小怪矩陣、多選目標（上限＝招式目標數）、出招與承受攻擊、GM 的新增敵人／敵人管理／立繪庫（上傳前在瀏覽器縮成 WebP）。已加入房間：敵人由 GM 建立、存在伺服器、全員共享，怪物生命只有伺服器改（玩家回報傷害）；本機模式照舊自己建立 |
| `src/ui/diceFx.js` | 擲骰特效（只是畫面）：骰子翻滾→落定→總和放大，1D20 的 20／1 有大成功／大失敗效果 |
| `src/ui/battleSelect.js` | 跑團頁共用的「目前選擇」（出招招式、選中的目標、顯示哪隻 BOSS、怪物攻防模式），不存檔 |
| `src/ui/rollFeed.js` | 擲骰紀錄的畫面：一般檢定畫骰面、戰鬥畫 A／B／C 三軌摘要；`oldestFirst` 時新的在下並自動捲到底 |
| `src/ui/dom.js` | 建立元素的小工具 |
| `src/api/lore.js` | **資料存取層**。UI 只能透過這裡拿資料 |
| `src/data/regions.js` | 四大區域＋中央海域 |
| `src/data/locations.js` | 地點內容與揭露狀態。格式見 `src/data/CLAUDE.md` |
| `public/map-data/markers.json` | 地圖標記位置（百分比座標、類型、簡介、設定集 id） |
| `src/ui/mapView.js` | 地圖拖曳、縮放、熱點 |
| `src/ui/dossier.js` | 地點情報面板（點地圖標記打開） |
| `src/styles/theme.css` | **主題檔**：全站色碼、字體、稀有度色（改配色只改這裡，規格見 `DESIGN.md`） |
| `src/styles/tokens.css` | 非顏色的代號（頁首高度、圓角、動畫曲線） |
| `src/styles/layout.css` | 頂部列、按鈕 |
| `src/styles/map.css` | 地圖與熱點 |
| `src/styles/dossier.css` | 情報面板與四大區域主題 |
| `src/styles/pages.css` | 修整日、背包頁面 |
| `src/styles/dice.css` | 跑團頁、紀錄、裝備頁、戰鬥頁 |
| `src/styles/redesign.css` | 全站新版樣式（覆蓋前面幾個檔案） |
| `src/styles/polish.css` | 質感層：按鈕、卡片、物品格的舊版效果 |
| `src/styles/blackgold.css` | 黑金主題（最後載入）：星點背景、面板、標題、擲骰紀錄三軌摘要、稀有度、三欄／手機版面與底部導覽列 |
| `public/lore-data/*.json` | 設定集文字（Discord 匯出），點「查看設定集」時由 `lore.js` 讀取 |

## 不可違反的規則
1. **防劇透**：未揭露（`hidden`）與草稿（`draft`）的內容只能在 `src/api/lore.js` 被過濾掉，不能只在畫面上隱藏。UI 拿到的資料就不該包含它們。
2. 內容文字一律用 `textContent` 放進頁面，**禁止用 `innerHTML` 放資料內容**（之後內容由 GM 輸入，要防 XSS）。
3. `src/api/lore.js` 的函式名稱與回傳格式要保持穩定，之後會換成向 Cloudflare Worker 要資料。
4. 機密（Token、金鑰）和 `players_data.json` 永遠不能進 git。
5. 擲骰結果一律用 `rollLog.publish()` 發布，UI 不要自己維護另一份「大家看得到的紀錄」。
6. 圖片路徑用相對路徑（`img/...`，不要開頭的 `/`），GitHub Pages 子路徑才不會壞。

## 未來規劃（現在不要做，除非我明確要求）
已經做完、從這份清單拿掉的：角色資料放伺服器（階段 2，伺服器保存並讓 GM 可讀）、從試算表匯入角色、依技能自動計算面板、GM 新增專屬技能／特殊配方／特殊材料、異動紀錄。
**不做**：防作弊（把規則搬到伺服器，使用者 2026-10-08：自由心證）、GM 後台的地圖標記／地圖圖片上傳／揭露開關（地圖全公開、不用再傳圖片；怪物立繪是另外的功能，已做）、跑團頁嵌入 Discord 或場外聊天輸入框（使用者 2026-10-09）。
**還沒做**（詳見 `RULES_OVERVIEW.md`「實作進度」）：GM 在網站編輯內建技能目錄與升級經驗表、神級料理與神級滴露的效果編輯器（等 GM 想出效果）、其他有「%」的技能、寶石取出與打洞配方。網站日後會掛到自己的網域（同站）。
