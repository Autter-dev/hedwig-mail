import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { html as beautifyHtml } from 'js-beautify'

test('js-beautify 2 formats importmap JSON bodies', () => {
  const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.ok(
    Number(dependencies['js-beautify'].replace(/^\D+/, '').split('.')[0]) >= 2,
    'js-beautify must be at least 2.0.3',
  )
  const formatted = beautifyHtml(
    '<script type="importmap">{"imports":{"app":"/app.js"}}</script>',
    { indent_size: 2 },
  )
  assert.match(formatted, /"imports": \{\n\s+"app": "\/app\.js"/)
})
