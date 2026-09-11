import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useTerminalPanel } from './useTerminalPanel'

describe('useTerminalPanel', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('manages visibility and panel modes', () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1200 },
      innerHeight: { configurable: true, value: 800 },
    })
    const panel = useTerminalPanel()

    panel.toggle()
    expect(panel.visible.value).toBe(true)
    panel.popOut()
    expect(panel.mode.value).toBe('floating')
    expect(panel.floatRect.value).toEqual({ top: 220, left: 200, width: 1100, height: 500 })
    panel.popOut()
    panel.toggleMaximize()
    expect(panel.isMaximized.value).toBe(true)
    panel.toggleMaximize()
    expect(panel.isFloating.value).toBe(true)
    panel.dock()
    panel.dock()
    expect(panel.mode.value).toBe('docked')
  })

  it('loads and persists valid dimensions and falls back for invalid storage', () => {
    localStorage.setItem('pi-cloud-terminal-height', '420')
    localStorage.setItem('pi-cloud-terminal-float-rect-v2', JSON.stringify({ top: 1, left: 2, width: 700, height: 500 }))
    const panel = useTerminalPanel()
    expect(panel.terminalHeight.value).toBe(420)
    expect(panel.floatPanelStyle.value).toMatchObject({ top: '1px', left: '2px', width: '700px', height: '500px' })
    panel.updateHeight(350)
    expect(localStorage.getItem('pi-cloud-terminal-height')).toBe('350')

    localStorage.setItem('pi-cloud-terminal-height', 'bad')
    localStorage.setItem('pi-cloud-terminal-float-rect-v2', '{bad')
    const fallback = useTerminalPanel()
    expect(fallback.terminalHeight.value).toBe(300)
    expect(fallback.floatRect.value.width).toBeGreaterThanOrEqual(400)
  })

  it('moves floating panels after the drag threshold and clamps them to the viewport', () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1000 },
      innerHeight: { configurable: true, value: 700 },
    })
    const panel = useTerminalPanel()
    const start = new MouseEvent('mousedown', { clientX: 300, clientY: 200 })
    Object.defineProperty(start, 'target', { value: document.body })
    panel.startMove(start)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 302, clientY: 201 }))
    expect(panel.interaction.value.active).toBe(false)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2000, clientY: -100 }))
    expect(panel.interaction.value.active).toBe(true)
    expect(panel.floatRect.value.left).toBe(900)
    expect(panel.floatRect.value.top).toBe(0)
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(panel.interaction.value.active).toBe(false)
    expect(localStorage.getItem('pi-cloud-terminal-float-rect-v2')).toBeTruthy()
  })

  it('ignores move and resize starts on mobile and action buttons', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
    const panel = useTerminalPanel()
    panel.startMove(new MouseEvent('mousedown'))
    panel.startResize(new MouseEvent('mousedown'), 'se')
    expect(panel.interaction.value.mode).toBeNull()

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    const action = document.createElement('button')
    action.className = 'terminal-panel-actions'
    const closest = vi.spyOn(action, 'closest')
    const event = new MouseEvent('mousedown')
    Object.defineProperty(event, 'target', { value: action })
    panel.startMove(event)
    expect(closest).toHaveBeenCalled()
  })

  it.each([
    ['e', { top: 100, left: 100, width: 550, height: 300 }],
    ['s', { top: 100, left: 100, width: 500, height: 350 }],
    ['w', { top: 100, left: 150, width: 450, height: 300 }],
    ['n', { top: 150, left: 100, width: 500, height: 250 }],
    ['ne', { top: 150, left: 100, width: 550, height: 250 }],
    ['nw', { top: 150, left: 150, width: 450, height: 250 }],
    ['se', { top: 100, left: 100, width: 550, height: 350 }],
    ['sw', { top: 100, left: 150, width: 450, height: 350 }],
  ])('resizes in the %s direction', (direction, expected) => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 1000 },
      innerHeight: { configurable: true, value: 700 },
    })
    const panel = useTerminalPanel()
    panel.floatRect.value = { top: 100, left: 100, width: 500, height: 300 }
    const event = new MouseEvent('mousedown', { clientX: 400, clientY: 300 })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    panel.startResize(event, direction)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450, clientY: 350 }))
    expect(panel.floatRect.value).toEqual(expected)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    window.dispatchEvent(new Event('blur'))
  })

  it('creates, switches, updates, and disposes terminal sessions', async () => {
    const panel = useTerminalPanel()
    const first = panel.createSession('one', undefined, '/tmp')
    const second = panel.createSession('two', 'zsh')
    const dispose = vi.fn()
    const disconnect = vi.fn()
    const focus = vi.fn()
    first.terminal = { dispose }
    first.resizeObserver = { disconnect } as unknown as ResizeObserver
    second.terminal = { focus, dispose }

    panel.setHostRef('one', document.createElement('div'))
    panel.setHostRef('missing', null)
    panel.switchSession('two')
    await nextTick()
    expect(focus).toHaveBeenCalled()
    panel.removeSession('missing')
    panel.removeSession('two')
    expect(panel.activeId.value).toBe('one')
    panel.removeSession('one')
    expect(panel.activeId.value).toBeNull()
    expect(dispose).toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalled()

    const third = panel.createSession('three')
    third.terminal = { dispose: vi.fn(() => { throw new Error('already closed') }) }
    panel.disposeAll()
    expect(panel.sessions.value).toEqual([])
  })
})
