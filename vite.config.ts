import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  plugins: [vue(), UnoCSS()],
  test: {
    include: ['src/**/*.test.ts'], environment: 'jsdom', restoreMocks: true,
    coverage: { provider: 'v8', include: ['src/**/*.ts', 'src/**/*.vue'], exclude: ['src/**/*.test.ts', 'src/env.d.ts'], reporter: ['text', 'json-summary', 'html'] },
  },
})
