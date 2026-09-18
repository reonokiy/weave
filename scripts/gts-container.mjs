import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

// Disposable container, anonymous storage volumes, and loopback-only test ports.
const name = 'weave-e2e-' + randomUUID()
const image = process.env.GTS_DOCKER_IMAGE ?? 'weave-gotosocial:0.22.1'
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Docker command failed')
  return result.stdout.trim()
}
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  spawnSync('docker', ['stop', '--time', '30', name], { stdio: 'ignore' })
  spawnSync('docker', ['rm', '-v', name], { stdio: 'ignore' })
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
const environment = {
  GTS_HOST: '127.0.0.1:8686', GTS_PROTOCOL: 'http', GTS_PORT: '8080',
  GTS_BIND_ADDRESS: '0.0.0.0', GTS_DB_TYPE: 'sqlite', GTS_DB_ADDRESS: '/gotosocial/storage/sqlite.db',
  GTS_STORAGE_LOCAL_BASE_PATH: '/gotosocial/storage', GTS_LOG_LEVEL: 'warn',
  GTS_ADVANCED_RATE_LIMIT_REQUESTS: '0', GTS_ACCOUNTS_REGISTRATION_OPEN: process.env.GTS_TEST_REGISTRATION ?? 'false',
}
try {
  docker(['create', '--name', name, '-p', '127.0.0.1:8686:8080', ...Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image])
  const attached = spawn('docker', ['start', '-a', name], { stdio: 'inherit' })
  attached.on('exit', code => { if (!stopping) stop(code || 1) })
  let ready = false
  for (let attempt = 0; attempt < 240; attempt++) {
    try { if ((await fetch('http://127.0.0.1:8686/api/v1/instance', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error('Container readiness timed out')
  for (const username of ['alice', 'bob', 'carol']) {
    docker(['exec', name, '/gotosocial/gotosocial', 'admin', 'account', 'create', '--username', username, '--email', `${username}@example.test`, '--password', 'Weave-local-e2e-only-2026!'])
  }
  docker(['exec', name, '/gotosocial/gotosocial', 'admin', 'account', 'promote', '--username', 'alice'])
  createServer(async (_request, response) => {
    try { response.writeHead((await fetch('http://127.0.0.1:8686/api/v1/instance')).status) }
    catch { response.writeHead(503) }
    response.end()
  }).listen(8687, '127.0.0.1')
  console.log(`Disposable GoToSocial container ready: ${name}`)
} catch (error) { console.error(error.message); stop(1) }
