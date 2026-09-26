import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// 共享的测试 DB 路径（所有 vitest worker 共享）
const TEST_DB_PATH = path.join('/tmp', `libereal-test-${process.pid}.db`)

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // 单 worker 串行跑所有 test；每个测试文件保持独立模块环境，避免 mock 泄漏。
    maxWorkers: 1,
    isolate: true,
    env: {
      DATABASE_PATH: TEST_DB_PATH,
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
      '@': path.resolve(__dirname, './src'),
      'next/server': path.resolve(__dirname, './node_modules/next/server.js'),
      'next/headers': path.resolve(__dirname, './node_modules/next/headers.js'),
      'next/navigation': path.resolve(__dirname, './node_modules/next/navigation.js'),
    },
  },
})
