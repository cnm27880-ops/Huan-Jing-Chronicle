// 全站樣式的載入順序（後面的蓋過前面的）。網站（main.js）和樣式規格預覽（styleguide.html）共用這一份，免得兩邊不一致。
import './theme.css';
import './tokens.css';
import './layout.css';
import './map.css';
import './dossier.css';
import './pages.css';
import './redesign.css';
import './dice.css';
import './polish.css';
import './blackgold.css';
import './shadowfx.css';
import './base.css'; // 按鈕、輸入框、面板、列表、底線分頁的最終樣式：最後載入
