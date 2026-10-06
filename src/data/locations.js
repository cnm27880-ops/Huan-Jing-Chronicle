// ============================================================
// 地點內容資料（原型階段的假資料，之後會改由 Cloudflare Worker 提供）
// 位置、名稱、類型改放在 public/map-data/markers.json（GM 日後在後台編輯）；
// 這裡只留「揭露狀態」與內容文字。格式說明請看同資料夾的 CLAUDE.md
// ============================================================

function loc(id, name, region, extra = {}) {
  return {
    id,
    name,
    region,
    status: 'hidden', // revealed = 已揭露 | hidden = 未揭露 | draft = 草稿
    ...extra,
  };
}

export const LOCATIONS = [
  // ---------- 西方大陸 ----------
  loc('ancient-range',  '遠古山脈', 'west'),
  loc('gloom-valley',   '幽暗谷',   'west'),
  loc('wizard-tower',   '巫師塔',   'west'),
  loc('dragon-bay',     '龍灣王國', 'west'),
  loc('death-rift',     '死亡裂谷', 'west'),
  loc('great-forest',   '大森林',   'west'),
  loc('crown-city',     '皇冠城',   'west'),
  loc('golden-plains',  '黃金平原', 'west'),
  loc('silverheart',    '銀心王國', 'west'),
  loc('falcon-kingdom', '獵鷹王國', 'west'),
  loc('world-tree',     '世界樹',   'west'),
  loc('iron-wall',      '鐵壁城',   'west'),
  loc('sword-gorge',    '劍峽林灣', 'west'),
  loc('khan-kingdom',   '可汗王國', 'west'),

  // ---------- 北方冰原 ----------
  loc('ice-pit',        '冰坑',       'north'),
  loc('gabet-city',     '嘉貝特企業城', 'north'),
  loc('old-capital',    '舊都',       'north'),
  loc('scrap-city',     '廢料城',     'north'),
  loc('core-factory',   '核心工廠',   'north'),
  loc('genesis-dome',   '創世紀穹頂', 'north'),
  loc('industry-port',  '工業港',     'north'),

  // ---------- 東方蓬萊仙島 ----------
  loc('wasteland',      '荒域',     'east'),
  {
    ...loc('shushan', '蜀山', 'east'),
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
  loc('peach-isle',     '桃心島',   'east'),
  loc('penglai',        '蓬萊仙島', 'east'),
  loc('myriad-demon',   '萬妖谷',   'east'),
  loc('wanxiang',       '萬象宗',   'east'),
  loc('jade-pool',      '白玉瑤池', 'east'),
  loc('kunlun',         '崑崙山',   'east'),
  loc('fengshen-tower', '封神塔',   'east'),

  // ---------- 南方現代都市 ----------
  loc('ghost-harbor',   '鬼港城',   'south'),
  loc('cursed-fog',     '詛咒霧都', 'south'),
  loc('twin-city',      '雙連市',   'south'),
  loc('dragon-capital', '龍城首都', 'south'),
  loc('harmony-city',   '和諧市',   'south'),
  loc('echo-bay',       '回聲海灣', 'south'),
  loc('fallen-a',       '淪陷A區',  'south'),
  loc('fallen-b',       '淪陷B區',  'south'),
  loc('fallen-c',       '淪陷C區',  'south'),

  // ---------- 中央海域 ----------
  loc('end-trench',     '盡頭海溝', 'sea'),
  loc('final-ice',      '終焉之冰', 'sea'),
  loc('cloud-sea',      '雲海',     'sea'),
  loc('lost-waters',    '迷失海域', 'sea'),
  loc('abyss-sea',      '深淵海',   'sea'),
];
