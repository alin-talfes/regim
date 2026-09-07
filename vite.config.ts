import { defineConfig } from 'vite'

export default defineConfig({
  base: '/regim/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
