import { defineConfig, type Plugin } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Endpoint só de desenvolvimento pra gravar screenshot do canvas em disco.
 * Todo marco fecha com imagem em docs/screenshots, então vale ter isso pronto.
 */
function screenshotSink(): Plugin {
  return {
    name: 'souls-screenshot-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('use POST')
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const safe = String(body.name ?? 'shot').replace(/[^a-z0-9._-]/gi, '-')
            const target = resolve(process.cwd(), 'docs/screenshots', `${safe}.png`)
            mkdirSync(dirname(target), { recursive: true })
            writeFileSync(target, Buffer.from(String(body.data).split(',').pop()!, 'base64'))
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: join('docs/screenshots', `${safe}.png`) }))
          } catch (error) {
            res.statusCode = 500
            res.end(String(error))
          }
        })
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [screenshotSink()],
  server: { port: 5173, host: true },
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
})
