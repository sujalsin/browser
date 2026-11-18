import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict CSP for the packaged UI. Not applied in dev, where Vite's HMR needs inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Favicons come from any site; extension icons from crx://.
  "img-src 'self' data: https: http: crx:",
  "connect-src 'self'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'browser-ui-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

export default defineConfig({
  main: {
    build: {
      // Keep the extension libraries external: they locate their preload scripts
      // inside node_modules at runtime.
      externalizeDeps: true,
    },
  },
  preload: {
    build: {
      // Preloads run sandboxed, so they cannot require() from node_modules.
      // Bundle everything into them.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          h264: resolve('src/preload/h264.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      minify: true,
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
    plugins: [react(), cspPlugin()],
  },
})
