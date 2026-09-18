import { describe, expect, it } from 'vitest'
import { renderContent, sanitizeContent } from './content'

describe('untrusted federated HTML', () => {
  it('renders only safe custom emoji URLs in text, leaving code and attributes intact', () => {
    const html = renderContent('<p>:wave: :unsafe:</p><code>:wave:</code><a href="https://example.org/:wave:">link</a>', [
      { shortcode: 'wave', url: 'https://example.org/wave.gif', static_url: 'https://example.org/wave.png' },
      { shortcode: 'unsafe', url: 'javascript:alert(1)', static_url: 'javascript:alert(1)' },
    ])
    expect(html).toContain('class="custom-emoji"')
    expect(html).toContain('<code>:wave:</code>')
    expect(html).toContain('href="https://example.org/:wave:"')
    expect(html).not.toContain('javascript:')
    expect(html).toContain(':unsafe:')
  })
  it('removes scripts, handlers, embedded content and dangerous links', () => {
    const html = sanitizeContent('<p>Hello<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><iframe src="https://example.org"></iframe><span style="position:fixed" onclick="alert(1)">text</span></p>')
    expect(html).not.toMatch(/script|onerror|onclick|iframe|javascript:|style=|<img/)
    expect(html).toContain('Hello')
  })
  it('preserves useful post markup and safe links', () => {
    const html = sanitizeContent('<p><strong>Hello</strong> <a href="https://example.org/@friend" class="mention">@friend</a></p><pre><code>const x = 1</code></pre>')
    expect(html).toContain('<strong>Hello</strong>')
    expect(html).toContain('href="https://example.org/@friend"')
    expect(html).toContain('<pre><code>')
  })
})
