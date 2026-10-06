// ============================================================
// 地點資料（原型階段的假資料，之後會改由 Cloudflare Worker 提供）
// 資料格式說明請看同資料夾的 CLAUDE.md
// ============================================================

// 地圖原圖尺寸（world.webp 為 1280 x 714）
const MAP_W = 1280;
const MAP_H = 714;

// 以「原圖像素中心點」標位置，轉成百分比，地圖縮放時熱點才會跟著走。
// boxW / boxH 是熱點框的像素大小，省略時依名稱長度自動估算。
function at(px, py, name, boxW, boxH) {
  const w = boxW ?? name.length * 20 + 18;
  const h = boxH ?? 34;
  return {
    x: +(px / MAP_W * 100).toFixed(2),
    y: +(py / MAP_H * 100).toFixed(2),
    w: +(w / MAP_W * 100).toFixed(2),
    h: +(h / MAP_H * 100).toFixed(2),
  };
}

function loc(id, name, region, px, py, extra = {}) {
  const { boxW, boxH, ...rest } = extra;
  return {
    id,
    name,
    region,
    ...at(px, py, name, boxW, boxH),
    status: 'hidden', // revealed = 已揭露 | hidden = 未揭露 | draft = 草稿
    ...rest,
  };
}

export const LOCATIONS = [
  // ---------- 西方大陸 ----------
  loc('ancient-range',  '遠古山脈', 'west', 269, 200),
  loc('gloom-valley',   '幽暗谷',   'west', 297, 245),
  loc('wizard-tower',   '巫師塔',   'west', 157, 264),
  loc('dragon-bay',     '龍灣王國', 'west', 449, 284),
  loc('death-rift',     '死亡裂谷', 'west', 153, 316),
  loc('great-forest',   '大森林',   'west', 169, 370),
  loc('crown-city',     '皇冠城',   'west', 270, 362),
  loc('golden-plains',  '黃金平原', 'west', 356, 381),
  loc('silverheart',    '銀心王國', 'west', 478, 381),
  loc('falcon-kingdom', '獵鷹王國', 'west', 70, 381),
  loc('world-tree',     '世界樹',   'west', 126, 440),
  loc('iron-wall',      '鐵壁城',   'west', 220, 442),
  loc('sword-gorge',    '劍峽林灣', 'west', 380, 458),
  loc('khan-kingdom',   '可汗王國', 'west', 239, 494),

  // ---------- 北方冰原 ----------
  loc('ice-pit',        '冰坑',       'north', 560, 82),
  loc('gabet-city',     '嘉貝特企業城', 'north', 733, 100),
  loc('old-capital',    '舊都',       'north', 845, 144),
  loc('scrap-city',     '廢料城',     'north', 437, 168),
  loc('core-factory',   '核心工廠',   'north', 456, 202),
  loc('genesis-dome',   '創世紀穹頂', 'north', 645, 233),
  loc('industry-port',  '工業港',     'north', 777, 209),

  // ---------- 東方蓬萊仙島 ----------
  loc('wasteland',      '荒域',     'east', 1030, 169),
  {
    ...loc('shushan', '蜀山', 'east', 1183, 218),
    status: 'revealed',
    cover: { src: 'img/lore/shushan.webp', alt: '蜀山雲海與懸浮峭壁' },
    body: [
      '蜀山坐落於東方蓬萊仙島的東北方，是全修仙界地勢最高、靈氣最為濃郁的核心區域。放眼望去，無數筆直插雲霄的巨型石柱與峭壁懸浮在翻騰的雲海之中，猶如一柄柄倒插的巨劍直指蒼穹。',
      '環境既莊嚴神聖又充滿自然險峻。山體陡峭，峭壁間生長著萬年古松與無數珍稀的靈藥仙草，瀑布倒掛入雲海。然而，這裡並非一片祥和，由於天地靈氣過於純粹濃郁，不僅吸引了無數強大的上古靈禽異獸盤踞，也孕育出了許多吸收靈氣與日月精華而生的獨特妖物。各大宗門就坐落在這些險峻峰巒之巔，……（截圖到此為止，請 GM 補完）',
    ],
    factions: [
      {
        id: 'tiangong',
        name: '天工寶閣',
        seat: '天工峰',
        image: { src: 'img/lore/tiangong-peak.webp', alt: '天工峰上的機關齒輪與青銅熔爐' },
        style: '坐落在地勢險要、形似巨錘的「天工峰」。峰上遍布著巨大的機關齒輪、青銅熔爐與懸浮的法器展臺。此派不以個人武力見長，而是專精於上古陣法、機關傀儡術以及頂級法器的煉製，整個山峰本身就是一座巨大的防禦機關城。',
        leader: {
          title: '神匠',
          name: '公輪盤',
          desc: '雙臂為機關義肢，能憑空煉製出威力絕倫的頂級法寶。',
          image: { src: 'img/lore/gong-lunpan.webp', alt: '天工寶閣宗主公輪盤' },
        },
      },
    ],
  },
  loc('peach-isle',     '桃心島',   'east', 898, 247),
  loc('penglai',        '蓬萊仙島', 'east', 1012, 324),
  loc('myriad-demon',   '萬妖谷',   'east', 1213, 323),
  loc('wanxiang',       '萬象宗',   'east', 837, 363),
  loc('jade-pool',      '白玉瑤池', 'east', 943, 488),
  loc('kunlun',         '崑崙山',   'east', 1162, 455),
  loc('fengshen-tower', '封神塔',   'east', 1053, 568),

  // ---------- 南方現代都市 ----------
  loc('ghost-harbor',   '鬼港城',   'south', 536, 490),
  loc('cursed-fog',     '詛咒霧都', 'south', 364, 569),
  loc('twin-city',      '雙連市',   'south', 489, 569),
  loc('dragon-capital', '龍城首都', 'south', 684, 553),
  loc('harmony-city',   '和諧市',   'south', 847, 522),
  loc('echo-bay',       '回聲海灣', 'south', 825, 586),
  loc('fallen-a',       '淪陷A區',  'south', 631, 639),
  loc('fallen-b',       '淪陷B區',  'south', 932, 606),
  loc('fallen-c',       '淪陷C區',  'south', 452, 669),

  // ---------- 中央海域 ----------
  loc('end-trench',     '盡頭海溝', 'sea', 27, 459, { boxW: 44, boxH: 124 }),
  loc('final-ice',      '終焉之冰', 'sea', 632, 274),
  loc('cloud-sea',      '雲海',     'sea', 731, 309),
  loc('lost-waters',    '迷失海域', 'sea', 534, 418),
  loc('abyss-sea',      '深淵海',   'sea', 399, 533),
];
