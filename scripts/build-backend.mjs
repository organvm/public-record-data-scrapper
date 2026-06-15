import { build } from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Plugin to resolve workspace package imports (relative paths to packages/)
const resolvePackages = {
  name: 'resolve-packages',
  setup(build) {
    // Match relative imports that reach into packages/
    build.onResolve({ filter: /\.\.\/.*packages\/core/ }, (args) => {
      const subpath = args.path.replace(/^.*packages\/core\/src\//, '')
      return { path: resolve(root, 'packages/core/src', subpath + '.ts') }
    })
  },
}

// Packages that must stay external (installed via npm, not bundled). Shared by
// every backend entrypoint (API server + worker) so the bundles stay in sync.
const external = [
  // Node built-ins
  'node:*',
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'tls',
  'stream', 'url', 'zlib', 'events', 'util', 'buffer', 'querystring',
  'child_process', 'cluster', 'dgram', 'dns', 'readline', 'string_decoder',
  'timers', 'tty', 'v8', 'vm', 'worker_threads', 'perf_hooks',
  'async_hooks', 'diagnostics_channel', 'inspector', 'trace_events',
  'assert', 'console',
  // npm packages — keep external (installed via npm install)
  'pg-native', 'bullmq', 'ioredis', 'pg',
  'puppeteer', 'sharp',
  'jsonwebtoken', 'express', 'compression', 'cors', 'helmet',
  'swagger-ui-express', 'yamljs', 'zod', 'dotenv', 'uuid',
  'dompurify', 'marked',
]

/**
 * Bundle a backend entrypoint (server or worker) into a single CommonJS file.
 *
 * @param {object} options
 * @param {string} options.entry   Entry file relative to the repo root, e.g. 'server/index.ts'.
 * @param {string} options.outfile Output file relative to the repo root, e.g. 'dist/server.cjs'.
 */
export async function bundleBackend({ entry, outfile }) {
  await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: resolve(root, outfile),
    plugins: [resolvePackages],
    external,
    sourcemap: true,
    minify: false,
    keepNames: true,
    define: {
      'import.meta.url': 'import_meta_url',
    },
    banner: {
      js: [
        'const import_meta_url = require("url").pathToFileURL(__filename).href;',
        'const __filename_esm = __filename;',
      ].join('\n'),
    },
  })

  console.log(`✓ Bundled ${entry} → ${outfile}`)
}
