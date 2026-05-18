import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../shared'),
    },
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
})
