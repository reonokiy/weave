import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

// Every run owns a fresh database and binds only to loopback.
const binary = process.env.GTS_BINARY ?? '/tmp/weave-gts-0.22.1/gotosocial'
const web = process.env.GTS_WEB ?? '/tmp/weave-gts-0.22.1/web'
await mkdir('/tmp/weave-gts-e2e', { recursive: true })
const directory = await mkdtemp('/tmp/weave-gts-e2e/run-')
const config = resolve(directory, 'config.yaml')
await writeFile(config, JSON.stringify({
  host: process.env.GTS_TEST_HOST ?? '127.0.0.1:8686', protocol: 'http', 'bind-address': '127.0.0.1', port: 8686,
  'db-type': 'sqlite', 'db-address': resolve(directory, 'sqlite.db'),
  'storage-local-base-path': resolve(directory, 'storage'),
  'web-template-base-dir': resolve(web, 'template'), 'web-asset-base-dir': resolve(web, 'assets'),
  'log-level': 'warn', 'advanced-rate-limit-requests': 0,
  'accounts-registration-open': process.env.GTS_TEST_REGISTRATION === 'true',
}))
// Initialize the instance application before the CLI can create accounts.
const server = spawn(binary, ['--config-path', config, 'server', 'start'], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.on('exit', code => process.exit(code ?? 0))
let initialized = false
for (let attempt = 0; attempt < 120; attempt++) {
  if (server.exitCode !== null) throw new Error('Instance initialization exited early')
  try { if ((await fetch('http://127.0.0.1:8686/api/v1/instance', { signal: AbortSignal.timeout(1000) })).ok) { initialized = true; break } } catch {}
  await new Promise(resolve => setTimeout(resolve, 250))
}
if (!initialized) throw new Error('Instance initialization timed out')
for (const username of ['alice', 'bob', 'carol']) {
  const result = spawnSync(binary, ['--config-path', config, 'admin', 'account', 'create', '--username', username, '--email', `${username}@example.test`, '--password', 'Weave-local-e2e-only-2026!'], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Could not create local test account ${username}: ${result.error ?? result.status}`)
}
if (process.env.GTS_TEST_ADMIN === 'alice') {
  const promoted = spawnSync(binary, ['--config-path', config, 'admin', 'account', 'promote', '--username', 'alice'], { stdio: 'inherit' })
  if (promoted.status !== 0) throw new Error('Could not promote the local admin test account')
}
console.log(`Local GoToSocial test data: ${directory}`)
createServer(async (_request, response) => {
  try { response.writeHead((await fetch('http://127.0.0.1:8686/api/v1/instance')).status) }
  catch { response.writeHead(503) }
  response.end()
}).listen(8687, '127.0.0.1')
