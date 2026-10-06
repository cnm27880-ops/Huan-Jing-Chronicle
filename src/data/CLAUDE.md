# 資料格式（只有在改 src/data/ 時才需要讀）

## 地點 `locations.js`
用 `loc(id, 名稱, 區域, 像素X, 像素Y, 額外欄位)` 建立。
- 座標是**世界全圖原圖（1280×714）上地名標籤的中心點像素**，函式會自動轉成百分比。
- `boxW` / `boxH`：熱點框像素大小，省略時依名稱長度估算（直排標籤要手動給，例如盡頭海溝）。
- `region`：`west` | `north` | `east` | `south` | `sea`
- `status`：`revealed`（已揭露）| `hidden`（未揭露，只顯示地名）| `draft`（草稿，完全不出現）

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
