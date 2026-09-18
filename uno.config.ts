import { defineConfig, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  theme: { colors: { ink: '#20372f', muted: '#69756e', accent: '#296b52', paper: '#f5f4ef', line: '#e3e7e0' } },
  shortcuts: {
    'btn': 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
    'btn-primary': 'btn bg-accent text-white hover:bg-ink',
    'btn-quiet': 'btn bg-transparent text-muted hover:bg-paper hover:text-ink',
    'field': 'w-full border border-line rounded-xl bg-white px-3 py-2.5 text-ink',
  },
})
