import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  cacheDir: path.join(tmpdir(), 'libereal-vitest-cache'),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // 单 worker 串行跑所有 test；每个测试文件保持独立模块环境，避免 mock 泄漏。
    maxWorkers: 1,
    isolate: true,
    env: {
      NODE_ENV: 'test',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x0000000000000000000000000000000AA',
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        inline: ['next-auth'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*/{ts,tsx}'],
      exclude: ['src/test/**', 'node_modules/**', '.next/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      'next/server': path.resolve(root, './node_modules/next/server.js'),
      'next/headers': path.resolve(root, './node_modules/next/headers.js'),
      'next/navigation': path.resolve(root, './node_modules/next/navigation.js'),
    },
  },
})
