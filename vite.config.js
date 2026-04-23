import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

function getBasePath() {
  if (!process.env.GITHUB_ACTIONS) return '/'
  const repository = process.env.GITHUB_REPOSITORY || ''
  const repoName = repository.split('/')[1] || ''
  if (!repoName) return '/'
  if (repoName.endsWith('.github.io')) return '/'
  return `/${repoName}/`
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
