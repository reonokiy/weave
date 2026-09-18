import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Overlay a version-matched web bundle; never change upstream routing or binaries.
const source = resolve(process.env.GTS_WEB ?? '/tmp/weave-gts-0.22.1/web')
const output = resolve(process.env.WEAVE_WEB_OUTPUT ?? 'artifacts/gts-web')
if (source === output) throw new Error('The output must be separate from the upstream web directory')
await mkdir(output, { recursive: true })
await cp(resolve(source, 'template'), resolve(output, 'template'), { recursive: true })
await cp(resolve(source, 'assets'), resolve(output, 'assets'), { recursive: true })
await cp('dist/assets', resolve(output, 'assets/weave'), { recursive: true })
const index = await readFile('dist/index.html', 'utf8')
const assets = [...index.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="[^"]*\/assets\/[^>]+>(?:<\/script>)?/g)]
  .map(match => match[0].replace(/(?:src|href)="[^"]*\/assets\//, value => value.split('=')[0] + '="/assets/weave/')).join('\n')
if (!assets.includes('type="module"')) throw new Error('Build Weave before creating the web bundle')
const original = await readFile(resolve(source, 'template/page.tmpl'), 'utf8')
const declarations = original.slice(0, original.indexOf('<!DOCTYPE html>'))
const keys = ['pageContent', 'instance', 'account', 'context', 'statuses', 'pinned_statuses', 'statuses_next', 'statuses_prev', 'accounts', 'accounts_next', 'accounts_prev', 'tagName', 'registrationOpen', 'reasonRequired', 'oidcEnabled', 'rules', 'user', 'username', 'email', 'token', 'oobToken', 'appname', 'appwebsite', 'scope', 'redirect', 'name', 'suggestedUsername', 'interactionURI', 'code', 'error', 'requestID', 'showAcctDir', 'blocklist', 'allowlist']
const data = keys.map(key => key === 'interactionURI' ? '"interactionURI": {{ if .interactionURI }}{{ .interactionURI.String }}{{ else }}null{{ end }}' : `"${key}": {{ .${key} }}`).join(',\n')
await writeFile(resolve(output, 'template/page.tmpl'), `${declarations}
<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="{{ if .robotsMeta }}{{ .robotsMeta }}{{ else }}noindex, nofollow, noai, noimageai{{ end }}">
{{ if .ogMeta }}{{ include "page_ogmeta.tmpl" . | outdentOGMeta }}{{ end }}
{{ if .rssFeed }}<link rel="alternate" type="application/rss+xml" href="{{ .rssFeed }}">{{ end }}
{{ if .account }}<link rel="alternate" type="application/activity+json" href="/users/{{ .account.Username }}">{{ else if .status }}<link rel="alternate" type="application/activity+json" href="/users/{{ .status.Account.Username }}/statuses/{{ .status.ID }}">{{ end }}
{{ if .instance }}<link rel="icon" href="{{ .instance.Thumbnail }}">{{ end }}
<title>{{ template "instanceTitle" . }}</title>
${assets}
</head><body>
<script type="application/json" id="weave-server-page">{${data}}</script>
<div id="app"></div>
<noscript>{{ include .pageContent . }}</noscript>
</body></html>
`)
const maintenance = await readFile(resolve(source, 'template/maintenance.tmpl'), 'utf8')
await writeFile(resolve(output, 'template/maintenance.tmpl'), `${maintenance.slice(0, maintenance.indexOf('<!DOCTYPE html>'))}
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{{ .host }}</title>${assets}</head><body><script type="application/json" id="weave-server-page">{"pageContent":"maintenance.tmpl"}</script><div id="app"></div><noscript>Temporarily unavailable.</noscript></body></html>
`)
await writeFile(resolve(output, 'weave-bundle.json'), JSON.stringify({ upstreamVersion: '0.22.1', upstreamRevision: 'fdff42baf16bdc8f793ce5137ecf2c2e6c67a9f2', source, createdAt: new Date().toISOString() }, null, 2))
console.log(output)
