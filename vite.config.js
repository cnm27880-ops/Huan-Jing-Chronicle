import { defineConfig } from 'vite';

export default defineConfig({
  // 用相對路徑，放到 GitHub Pages 的子路徑（/repo 名稱/）也能正常載入
  base: './',
  server: { host: true, allowedHosts: true }, // 讓同一個 Wi-Fi 下的手機也能連進來測試
});
