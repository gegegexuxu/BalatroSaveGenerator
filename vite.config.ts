import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，dist/ 可从任意子目录或 file:// 打开
  base: './',
  build: {
    target: 'es2022',
  },
});
