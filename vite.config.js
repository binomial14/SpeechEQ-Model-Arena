import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Apps Script may respond with 302 to another script.google.com URL. The browser would follow
 * that to an absolute https URL → CORS. Rewrite Location to stay under /api/google-macro so the
 * follow-up request stays same-origin to Vite.
 */
const appsScriptProxy = {
  target: 'https://script.google.com',
  changeOrigin: true,
  secure: true,
  rewrite: (path) => path.replace(/^\/api\/google-macro/, ''),
  configure(proxy) {
    proxy.on('proxyRes', (proxyRes) => {
      const code = proxyRes.statusCode
      if (code !== 301 && code !== 302 && code !== 307 && code !== 308) {
        return
      }
      const raw = proxyRes.headers.location
      if (typeof raw !== 'string' || !raw) {
        return
      }
      let absolute = raw
      if (raw.startsWith('/')) {
        absolute = `https://script.google.com${raw}`
      }
      if (absolute.startsWith('https://script.google.com')) {
        proxyRes.headers.location =
          '/api/google-macro' + absolute.slice('https://script.google.com'.length)
      }
    })
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/SpeechEQ-Model-Arena/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  // Avoid browser CORS: browser → /api/google-macro → script.google.com (see resolveAppsScriptUrl in App.jsx).
  server: {
    proxy: {
      '/api/google-macro': appsScriptProxy
    }
  },
  preview: {
    proxy: {
      '/api/google-macro': appsScriptProxy
    }
  }
}))
