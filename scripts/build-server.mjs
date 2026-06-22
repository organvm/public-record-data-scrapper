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

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  plugins: [resolvePackages],
  external: [
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
    'puppeteer', 'sharp', 'fsevents',
    'jsonwebtoken', 'express', 'compression', 'cors', 'helmet',
    'swagger-ui-express', 'yamljs', 'zod', 'dotenv', 'uuid',
    'dompurify', 'marked',
  ],
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
}

// Bundle both production entrypoints so the worker runs on plain `node`
// (parity with the API server) instead of `tsx`, which can spike memory
// during initialization on constrained hosts like Render. See issue #230.
const targets = [
  { entry: 'server/index.ts', out: 'dist/server.cjs', label: 'Server' },
  { entry: 'server/worker.ts', out: 'dist/worker.cjs', label: 'Worker' },
]

for (const { entry, out, label } of targets) {
  await build({
    ...sharedOptions,
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, out),
  })
  console.log(`✓ ${label} bundled to ${out}`)
}
