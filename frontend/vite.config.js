import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../app/static'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://127.0.0.1:8000',
      '/accounts': 'http://127.0.0.1:8000',
      '/transfers': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/static': 'http://127.0.0.1:8000',
    }
  }
})
