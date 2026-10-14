import { describe, expect, it } from 'vitest'
import base from './base.css?raw'
import components from './components.css?raw'
import dashboard from './dashboard.css?raw'
import layout from './layout.css?raw'
import settings from './settings.css?raw'
import tokens from './tokens.css?raw'
import workflow from './workflow.css?raw'

const stylesheets = { base, components, dashboard, layout, settings, tokens, workflow }

function token(name: string) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i').exec(tokens)
  if (!match) throw new Error(`Missing colour token --${name}`)
  return match[1]
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(foreground: string, background: string) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

const foregrounds = ['color-text', 'color-text-muted', 'color-text-subtle', 'color-accent', 'color-info', 'color-danger', 'color-warning', 'color-purple']
const backgrounds = ['color-bg', 'color-surface', 'color-surface-raised', 'color-surface-sunken', 'color-accent-soft',
  'color-info-soft', 'color-danger-soft', 'color-warning-soft', 'color-purple-soft']

describe('design tokens', () => {
  it.each(foregrounds.flatMap(fg => backgrounds.map(bg => [fg, bg])))('%s on %s meets WCAG AA', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it('primary buttons meet WCAG AA', () => {
    expect(contrast(token('color-accent-contrast'), token('color-accent'))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(Object.entries(stylesheets))('%s.css never renders text below 12px', (_name, css) => {
    const sizes = [...css.matchAll(/(?:font-size:|font:[^;]*?)\s(\d+)px/g)].map(match => Number(match[1]))
    expect(sizes.filter(size => size < 12)).toEqual([])
  })

  it('declares focus styles and honours reduced motion', () => {
    expect(base).toContain(':focus-visible')
    expect(base).toContain('prefers-reduced-motion')
  })
})
