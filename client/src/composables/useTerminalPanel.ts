// client/src/composables/useTerminalPanel.ts
import { ref, computed, nextTick } from 'vue'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerminalSession {
  terminal_id: string
  label: string
  cwd?: string
  terminal: any | null
  hostEl: HTMLElement | null
  fitAddon: any | null
  resizeObserver: ResizeObserver | null
  history: string[]
  pending_output: string[]
}

export interface PanelRect {
  top: number
  left: number
  width: number
  height: number
}

export interface PanelInteraction {
  active: boolean
  mode: 'move' | 'resize' | null
  direction: string | null
  startX: number
  startY: number
  startTop: number
  startLeft: number
  startWidth: number
  startHeight: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

type PanelMode = 'docked' | 'floating' | 'maximized'

const MIN_HEIGHT = 140
const MIN_WIDTH = 400
const DEFAULT_HEIGHT = 300
const HEIGHT_STORAGE_KEY = 'pi-webui-terminal-height'
const FLOAT_STORAGE_KEY = 'pi-webui-terminal-float-rect-v2'
const DRAG_ACTIVATION_DISTANCE = 4
const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// ─── Composable ──────────────────────────────────────────────────────────────

export function useTerminalPanel() {
  // ── Visibility ────────────────────────────────────────────────────────────

  const visible = ref(false)

  function toggle() {
    visible.value = !visible.value
  }

  // ── Mode: docked / floating / maximized ───────────────────────────────────

  const mode = ref<PanelMode>('docked')
  const isMaximized = computed(() => mode.value === 'maximized')
  const isFloating = computed(() => mode.value === 'floating')

  function popOut() {
    if (mode.value === 'floating') return
    // Initialize floating rect from current docked height
    const h = Math.max(terminalHeight.value, 500)
    const w = Math.min(window.innerWidth - 40, 1100)
    floatRect.value = {
      top: Math.max(40, window.innerHeight - h - 80),
      left: Math.max(200, Math.round((window.innerWidth - w) / 2)),
      width: w,
      height: h,
    }
    mode.value = 'floating'
  }

  function dock() {
    if (mode.value === 'docked') return
    mode.value = 'docked'
  }

  function toggleMaximize() {
    if (mode.value === 'maximized') {
      // Restore to previous mode (docked or floating)
      mode.value = previousMode.value
    } else {
      previousMode.value = mode.value
      mode.value = 'maximized'
    }
  }

  const previousMode = ref<PanelMode>('docked')

  // ── Docked height ─────────────────────────────────────────────────────────

  function loadHeight(): number {
    try {
      const saved = localStorage.getItem(HEIGHT_STORAGE_KEY)
      if (saved) {
        const parsed = Number(saved)
        if (Number.isFinite(parsed) && parsed >= MIN_HEIGHT) return parsed
      }
    } catch {}
    return DEFAULT_HEIGHT
  }

  const terminalHeight = ref(loadHeight())

  function updateHeight(h: number) {
    terminalHeight.value = h
    localStorage.setItem(HEIGHT_STORAGE_KEY, String(h))
  }

  // ── Floating rect ─────────────────────────────────────────────────────────

  function getDefaultFloatRect(): PanelRect {
    const w = Math.min(window.innerWidth - 40, 1100)
    const h = Math.min(window.innerHeight - 80, 600)
    return {
      top: Math.max(40, Math.round((window.innerHeight - h) / 2)),
      left: Math.max(200, Math.round((window.innerWidth - w) / 2)),
      width: w,
      height: h,
    }
  }

  function loadFloatRect(): PanelRect {
    try {
      const saved = localStorage.getItem(FLOAT_STORAGE_KEY)
      if (saved) {
        const p = JSON.parse(saved)
        if (typeof p.top === 'number' && typeof p.left === 'number' &&
            typeof p.width === 'number' && typeof p.height === 'number') {
          return p
        }
      }
    } catch {}
    return getDefaultFloatRect()
  }

  const floatRect = ref<PanelRect>(loadFloatRect())

  function saveFloatRect() {
    localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify(floatRect.value))
  }

  const floatPanelStyle = computed(() => ({
    top: `${floatRect.value.top}px`,
    left: `${floatRect.value.left}px`,
    width: `${floatRect.value.width}px`,
    height: `${floatRect.value.height}px`,
    zIndex: '1100',
  }))

  // ── Floating interaction (move / resize) ──────────────────────────────────

  const interaction = ref<PanelInteraction>({
    active: false,
    mode: null,
    direction: null,
    startX: 0,
    startY: 0,
    startTop: 0,
    startLeft: 0,
    startWidth: 0,
    startHeight: 0,
  })

  function getFloatBounds() {
    const HEADER_HEIGHT = 32
    const MIN_VISIBLE = 100
    return {
      minTop: 0,
      minLeft: 0,
      maxLeft: window.innerWidth - MIN_VISIBLE,
      maxTop: window.innerHeight - HEADER_HEIGHT,
    }
  }

  function startMove(event: MouseEvent) {
    if (window.innerWidth <= 768) return
    if ((event.target as HTMLElement).closest('.terminal-panel-actions')) return

    interaction.value = {
      active: false,
      mode: 'move',
      direction: null,
      startX: event.clientX,
      startY: event.clientY,
      startTop: floatRect.value.top,
      startLeft: floatRect.value.left,
      startWidth: floatRect.value.width,
      startHeight: floatRect.value.height,
    }

    document.addEventListener('mousemove', onPointerMove)
    document.addEventListener('mouseup', stopInteraction)
    window.addEventListener('blur', stopInteraction)
  }

  function startResize(event: MouseEvent, direction: string) {
    if (window.innerWidth <= 768) return

    interaction.value = {
      active: true,
      mode: 'resize',
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startTop: floatRect.value.top,
      startLeft: floatRect.value.left,
      startWidth: floatRect.value.width,
      startHeight: floatRect.value.height,
    }

    document.addEventListener('mousemove', onPointerMove)
    document.addEventListener('mouseup', stopInteraction)
    window.addEventListener('blur', stopInteraction)
    event.preventDefault()
    event.stopPropagation()
  }

  function onPointerMove(event: MouseEvent) {
    const deltaX = event.clientX - interaction.value.startX
    const deltaY = event.clientY - interaction.value.startY

    // Drag activation threshold
    if (interaction.value.mode === 'move' && !interaction.value.active) {
      if (Math.hypot(deltaX, deltaY) < DRAG_ACTIVATION_DISTANCE) return
      interaction.value = { ...interaction.value, active: true }
      event.preventDefault()
    }

    if (!interaction.value.active) return

    // ── Move ───────────────────────────────────────────────────────────────
    if (interaction.value.mode === 'move') {
      const bounds = getFloatBounds()
      floatRect.value.left = clamp(interaction.value.startLeft + deltaX, bounds.minLeft, bounds.maxLeft)
      floatRect.value.top = clamp(interaction.value.startTop + deltaY, bounds.minTop, bounds.maxTop)
      return
    }

    // ── Resize ─────────────────────────────────────────────────────────────
    const dir = interaction.value.direction || ''
    const sL = interaction.value.startLeft
    const sT = interaction.value.startTop
    const sW = interaction.value.startWidth
    const sH = interaction.value.startHeight

    let nextLeft = sL, nextTop = sT, nextWidth = sW, nextHeight = sH

    if (dir.includes('e')) {
      nextWidth = clamp(sW + deltaX, MIN_WIDTH, Math.max(window.innerWidth - sL, MIN_WIDTH))
    }
    if (dir.includes('s')) {
      nextHeight = clamp(sH + deltaY, MIN_HEIGHT, Math.max(window.innerHeight - sT, MIN_HEIGHT))
    }
    if (dir.includes('w')) {
      const desiredLeft = clamp(sL + deltaX, 0, sL + sW - MIN_WIDTH)
      nextLeft = desiredLeft
      nextWidth = sW - (desiredLeft - sL)
    }
    if (dir.includes('n')) {
      const desiredTop = clamp(sT + deltaY, 0, sT + sH - MIN_HEIGHT)
      nextTop = desiredTop
      nextHeight = sH - (desiredTop - sT)
    }

    if (nextLeft + nextWidth > window.innerWidth) {
      nextWidth = Math.max(MIN_WIDTH, window.innerWidth - nextLeft)
    }
    if (nextTop + nextHeight > window.innerHeight) {
      nextHeight = Math.max(MIN_HEIGHT, window.innerHeight - nextTop)
    }

    floatRect.value = {
      left: clamp(nextLeft, 0, Math.max(window.innerWidth - nextWidth, 0)),
      top: clamp(nextTop, 0, Math.max(window.innerHeight - nextHeight, 0)),
      width: clamp(nextWidth, MIN_WIDTH, Math.max(window.innerWidth - floatRect.value.left, MIN_WIDTH)),
      height: clamp(nextHeight, MIN_HEIGHT, Math.max(window.innerHeight - floatRect.value.top, MIN_HEIGHT)),
    }
  }

  function stopInteraction() {
    interaction.value = {
      active: false,
      mode: null,
      direction: null,
      startX: 0, startY: 0,
      startTop: 0, startLeft: 0,
      startWidth: 0, startHeight: 0,
    }
    document.removeEventListener('mousemove', onPointerMove)
    document.removeEventListener('mouseup', stopInteraction)
    window.removeEventListener('blur', stopInteraction)
    saveFloatRect()
  }

  // ── Terminal sessions ─────────────────────────────────────────────────────

  const sessions = ref<TerminalSession[]>([])
  const activeId = ref<string | null>(null)

  function createSession(terminalId: string, label?: string, cwd?: string): TerminalSession {
    const session: TerminalSession = {
      terminal_id: terminalId,
      label: label || 'shell',
      cwd,
      terminal: null,
      hostEl: null,
      fitAddon: null,
      resizeObserver: null,
      history: [],
      pending_output: [],
    }
    sessions.value.push(session)
    activeId.value = terminalId
    return session
  }

  function removeSession(terminalId: string) {
    const idx = sessions.value.findIndex(s => s.terminal_id === terminalId)
    if (idx === -1) return

    const session = sessions.value[idx]
    if (session.terminal) try { session.terminal.dispose() } catch {}
    if (session.resizeObserver) session.resizeObserver.disconnect()

    sessions.value.splice(idx, 1)

    if (activeId.value === terminalId) {
      activeId.value = sessions.value.length > 0 ? sessions.value[0].terminal_id : null
    }
  }

  function switchSession(terminalId: string) {
    activeId.value = terminalId
    nextTick(() => {
      const session = sessions.value.find(s => s.terminal_id === terminalId)
      if (session?.terminal) try { session.terminal.focus() } catch {}
    })
  }

  function setHostRef(terminalId: string, el: HTMLElement | null) {
    const session = sessions.value.find(s => s.terminal_id === terminalId)
    if (session) session.hostEl = el
  }

  function disposeAll() {
    stopInteraction()
    for (const session of sessions.value) {
      if (session.terminal) try { session.terminal.dispose() } catch {}
      if (session.resizeObserver) session.resizeObserver.disconnect()
    }
    sessions.value = []
    activeId.value = null
  }

  return {
    visible,
    toggle,

    // Mode
    mode,
    isMaximized,
    isFloating,
    popOut,
    dock,
    toggleMaximize,

    // Docked
    terminalHeight,
    updateHeight,

    // Floating
    floatRect,
    floatPanelStyle,
    interaction,
    startMove,
    startResize,
    resizeDirections: RESIZE_DIRECTIONS,

    // Sessions
    sessions,
    activeId,
    createSession,
    removeSession,
    switchSession,
    setHostRef,
    disposeAll,
  }
}
