# 幻境編年史（原型）

GM 的網遊網站原型，目前有三個分頁：

- **世界地圖**：點地名查看情報
- **修整日**：批次採集與製作、兩組胃袋自動計算熟練、紀念品加值、跑團技能檢定
- **背包**：自動分區、自由增減、放入自創紀念品

規則說明請看 `GAME_RULES.md`。

---

## 第一次使用：在自己電腦上打開網站（Windows 11）

### 步驟 1：安裝 Node.js（只要做一次）

1. 打開 https://nodejs.org
2. 下載標示 **LTS** 的版本（本專案需要 20.19 以上或 22.12 以上，LTS 版都符合）
3. 執行安裝檔，全部按「下一步」用預設值即可
4. 確認安裝成功：按 `Win` 鍵，輸入 `終端機` 打開它，貼上下面這行按 Enter：

   ```
   node -v
   ```

   出現像 `v22.x.x` 的版本號就成功了。

### 步驟 2：解壓縮專案

把下載的 zip 解壓縮到你好找的地方，例如 `D:\projects\huanjing`。

> 路徑盡量不要有中文或空格，可以避免一些奇怪的錯誤。

### 步驟 3：在專案資料夾開啟終端機

1. 用檔案總管進到 `huanjing` 資料夾（看得到 `package.json` 那一層）
2. 在資料夾空白處按右鍵 → **在終端機中開啟**

### 步驟 4：安裝套件（只要做一次）

```
npm install
```

等它跑完，資料夾裡會多一個 `node_modules`，這是正常的。

### 步驟 5：啟動網站

```
npm run dev
```

看到類似下面的訊息就成功了：

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

按住 `Ctrl` 點 `Local` 那個網址，瀏覽器就會打開網站。

- **用手機測試**：手機和電腦連同一個 Wi-Fi，在手機瀏覽器輸入 `Network` 那個網址。
- **關閉網站**：在終端機按 `Ctrl + C`。
- 開著 `npm run dev` 時改程式碼，存檔後瀏覽器會自動更新。

---

## 上傳到 GitHub 並自動上線

### 步驟 1：建立 GitHub 儲存庫

1. 登入 GitHub，右上角 `+` → **New repository**
2. 名稱例如 `huanjing-chronicle`
3. **不要**勾選「Add a README」（專案裡已經有了）
4. 按 **Create repository**

> 注意：GitHub Pages 網站是公開的，任何人知道網址都能看。目前只有已公開的劇情會出現在網站上，未公開內容在原型階段雖然不會顯示，但**原始碼裡看得到**（見下方「已知限制」）。

### 步驟 2：上傳程式碼

在專案資料夾的終端機，依序貼上（把網址換成你剛建立的儲存庫網址）：

```
git init
git add .
git commit -m "第一版：互動世界地圖"
git branch -M main
git remote add origin https://github.com/你的帳號/huanjing-chronicle.git
git push -u origin main
```

### 步驟 3：開啟 GitHub Pages

1. 到儲存庫的 **Settings** → 左側 **Pages**
2. **Source** 選 **GitHub Actions**
3. 到 **Actions** 分頁，等「Deploy to GitHub Pages」跑完變綠勾
4. 回到 Settings → Pages，上方會顯示網站網址

之後每次 `git push`，網站會自動更新。

---

## 用 Claude Code 繼續修改

專案根目錄的 `CLAUDE.md` 已經寫好規則，Claude Code 會優先只讀需要的檔案。建議：

- 下指令時直接講檔案或功能，例如：「改 `src/styles/dossier.css`，把東方主題的印章改成深綠色」
- 一次只做一件事
- 輸入 `/context` 可以查看目前載入了哪些說明檔

---

## 新增或修改地點內容（目前要改程式碼，之後會有 GM 後台）

1. 圖片轉成 WebP，放進 `public/img/lore/`
2. 打開 `src/data/locations.js`，找到該地點
3. 把 `status` 改成 `'revealed'`，加上 `body`、`cover`、`factions` 等欄位（格式請看 `src/data/CLAUDE.md`，可以照抄蜀山的寫法）

---

## 確認規則沒有改壞（npm test）

改過 `src/game/` 裡的檔案後，在終端機執行：

```
npm test
```

全部顯示 `pass`、沒有 `fail` 就代表判定和機器人一致。

## 已知限制（原型階段）

- **角色資料只存在這台裝置的瀏覽器**。換手機或電腦就看不到，GM 也看不到。要大家共用，需要下一階段接上 Cloudflare。
- 示範角色是「新世紀福德正神」，技能取自試算表，背包取自機器人存檔。背包頁最下方可以還原成示範資料。

- **防劇透只是模擬**：目前資料是放在網頁程式裡的假資料，懂技術的人打開原始碼還是看得到全部內容。正式版改成 Cloudflare Worker 後，未公開內容才會真正留在伺服器上。所以**原型期間請只放可以公開的內容**。
- 蜀山、天工峰與宗主立繪是從 Discord 截圖裁切的低解析暫用圖，請換成原圖。
- 蜀山介紹文在截圖中被切斷，需要 GM 補完。
- 少數熱點位置可能和地圖標籤差幾像素，可在 `src/data/locations.js` 微調座標。
