import { afterEach, describe, expect, it } from 'vitest'
import { useTerminalPanel } from './useTerminalPanel'

describe('useTerminalPanel', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('ends floating resize interactions when the window blurs', () => {
    const panel = useTerminalPanel()

    panel.startResize(new MouseEvent('mousedown', { clientX: 600, clientY: 400 }), 'se')
    expect(panel.interaction.value.active).toBe(true)

    window.dispatchEvent(new Event('blur'))
    expect(panel.interaction.value.active).toBe(false)

    panel.disposeAll()
  })
})
