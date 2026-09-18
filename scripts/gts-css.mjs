import { createRequire } from 'node:module'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Compile the upstream OAuth page styles with its own PostCSS pipeline.
// The separate upstream React settings app is not part of Weave's E2E target.
const web = process.env.GTS_WEB ?? '/tmp/weave-gts-e2e/web'
const require = createRequire(resolve(web, 'source/package.json'))
const postcss = require('postcss')
const plugins = ['postcss-import', 'postcss-nested', 'postcss-custom-prop-vars', 'autoprefixer'].map(name => require(name)())
await mkdir(resolve(web, 'assets/dist'), { recursive: true })
for (const name of await readdir(resolve(web, 'source/css'))) {
  if (!name.endsWith('.css')) continue
  const from = resolve(web, 'source/css', name)
  const to = resolve(web, 'assets/dist', name)
  const result = await postcss(plugins).process(await readFile(from, 'utf8'), { from, to, map: false })
  await writeFile(to, result.css)
}
