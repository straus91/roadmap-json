import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development (`npm run dev`) the API runs separately on port 8000; proxy /api to it so
// the browser sees one origin, exactly as in production where FastAPI serves the built site.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' },
  },
})
