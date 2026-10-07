import { defineConfig } from 'vite';

export default defineConfig({
  // 自訂網域 huan-jing.yuci8660.uk，網站放在網域根目錄
  base: '/',
  server: { host: true, allowedHosts: true }, // 讓同一個 Wi-Fi 下的手機也能連進來測試
});
