# 資料格式（只有在改 src/data/ 時才需要讀）

## 標記位置 `public/map-data/markers.json`（GM 日後在後台編輯）
`{ markers: [{ id, name, region, x, y, w, h, type, loreId, summary? }] }`
- `x`、`y`：地名標籤中心點，**佔圖片寬高的百分比**（換底圖也不跑位）；`w`、`h`：熱點框大小（同為百分比）。
- `type`：`kingdom` | `place` | `sea`。`loreId`：對應 `public/lore-data/` 的檔名（不含 .json），可為 `null`。
- `summary`：小卡片簡介。**只有已揭露的地點才能寫**，這個檔案是公開的。
- `id` 必須和 `locations.js` 的 id 一致，揭露狀態以 `locations.js` 為準。

## 地點內容 `locations.js`
用 `loc(id, 名稱, 區域, 額外欄位)` 建立，只管揭露狀態與內容，不放座標。
- `region`：`west` | `north` | `east` | `south` | `sea`
- `status`：預設 `revealed`（目前全圖都已揭露）。可用值：`revealed`（已揭露）| `hidden`（未揭露，只顯示地名）| `draft`（草稿，完全不出現）

已揭露地點可加的內容欄位：
```js
cover: { src: 'img/lore/xxx.webp', alt: '圖片說明' },
body: ['第一段', '第二段'],
factions: [{
  id, name, seat,                 // 勢力 id、名稱、據點
  image: { src, alt },            // 勢力場景圖（可省略）
  style: '門派風格描述',
  leader: { title, name, desc, image: { src, alt } }, // 宗主（可省略）
}],
```

## 區域 `regions.js`
`{ id, name, subtitle, theme }`，`theme` 對應 `src/styles/dossier.css` 的 `[data-theme]`。

## 圖片
放在 `public/img/lore/`，路徑寫 `img/lore/檔名.webp`。請先轉成 WebP。

## 設定集 `public/lore-data/<loreId>.json`
由 `src/api/lore.js` 的 `getLocationDetail()` 讀取，依 entries 順序顯示標題、圖片、文字。
圖片路徑（例如 `lore-img/xxx.webp`）會接在環境變數 `VITE_LORE_IMG_BASE`（Cloudflare R2 網址）後面；沒設定時圖片不顯示。
