// client/src/composables/useTerminal.ts
import { ref, onUnmounted, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'

export type TerminalThemeName = 'dark' | 'light'
export type TerminalConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const expectedSocketCloses = new WeakSet<WebSocket>()
const reconnectDelays = [0, 1_000, 2_000, 5_000, 10_000, 30_000]

const terminalFontFamily = [
  // Prefer Nerd Font variants for shell prompts that use Powerline/private-use glyphs,
  // then fall back to common monospace fonts available on mobile browsers.
  "'Pi Terminal Nerd Font'",
  "'MesloLGL Nerd Font Mono'",
  "'MesloLGM Nerd Font Mono'",
  "'Symbols Nerd Font Mono'",
  "'Fira Code'",
  "'Noto Sans Mono'",
  "'SFMono-Regular'",
  "'Roboto Mono'",
  "'Cascadia Mono'",
  "'Consolas'",
  "'Menlo'",
  "'Monaco'",
  "'Courier New'",
  'monospace',
].join(', ')

const terminalThemes: Record<TerminalThemeName, ITheme> = {
  dark: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#45475a',
  },
  light: {
    background: '#ffffff',
    foreground: '#1a1a2e',
    cursor: '#4a6cf7',
    selectionBackground: '#d8defd',
  },
}

function currentTerminalTheme(): TerminalThemeName {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function applyTerminalTheme(instance: TerminalInstance, theme: TerminalThemeName) {
  instance.terminal.options.theme = terminalThemes[theme]
}

export interface TerminalInstance {
  terminalId: Ref<string | undefined>
  connectionState: Ref<TerminalConnectionState>
  terminal: Terminal
  fitAddon: FitAddon
  socket: WebSocket | null
  isOpen: boolean
  disposables: { dispose(): void }[]
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
  reconnectNow: (() => void) | null
  disposalUrl: string | null
}

/** Create a single terminal instance bound to a container element. */
export function createTerminalInstance(): TerminalInstance {
  const terminalId = ref<string>()
  const terminal = new Terminal({
    theme: terminalThemes[currentTerminalTheme()],
    fontSize: 14,
    fontFamily: terminalFontFamily,
    fontWeight: 400,
    cursorBlink: true,
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  return {
    terminalId,
    connectionState: ref('disconnected'),
    terminal,
    fitAddon,
    socket: null,
    isOpen: false,
    disposables: [],
    reconnectTimer: null,
    reconnectAttempt: 0,
    reconnectNow: null,
    disposalUrl: null,
  }
}

export function openTerminal(instance: TerminalInstance, container: HTMLElement) {
  if (!instance.isOpen) {
    instance.terminal.open(container)
    instance.isOpen = true
  }
  instance.fitAddon.fit()
  instance.terminal.focus()
}

export function fitTerminal(instance: TerminalInstance) {
  instance.fitAddon.fit()
}

/** Connect to a new PTY, then automatically reattach to it after connection loss. */
export function connectTerminal(
  instance: TerminalInstance,
  clientId: string,
  cwd?: string,
  onCreated?: (terminalId: string, shell: string) => void,
  onExit?: (terminalId: string, exitCode: number) => void,
  onDisconnect?: () => void,
  onConnectionState?: (state: TerminalConnectionState) => void,
) {
  if (instance.socket) {
    expectedSocketCloses.add(instance.socket)
    instance.socket.close()
    instance.socket = null
  }
  if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer)
  instance.reconnectTimer = null
  instance.reconnectAttempt = 0

  const setConnectionState = (state: TerminalConnectionState) => {
    instance.connectionState.value = state
    onConnectionState?.(state)
  }

  const openSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({ clientId })
    if (cwd) params.set('cwd', cwd)
    if (instance.terminalId.value) params.set('terminalId', instance.terminalId.value)

    setConnectionState(instance.terminalId.value ? 'reconnecting' : 'connecting')
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal?${params}`)
    instance.socket = socket

    socket.onopen = () => {
      console.log('[Terminal] Connected')
    }

    socket.onmessage = (event) => {
      let message: any
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        console.error('[Terminal] Invalid server message', error)
        return
      }

      switch (message.type) {
        case 'created':
        case 'reattached':
          instance.terminalId.value = message.terminalId
          const disposalParams = new URLSearchParams({ clientId, terminalId: message.terminalId })
          instance.disposalUrl = `${protocol}://${window.location.host}/ws/terminal?${disposalParams}`
          instance.reconnectAttempt = 0
          setConnectionState('connected')
          onCreated?.(message.terminalId, message.shell || 'bash')
          instance.fitAddon.fit()
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'resize',
              terminalId: message.terminalId,
              cols: instance.terminal.cols,
              rows: instance.terminal.rows,
            }))
          }
          break
        case 'output':
          instance.terminal.write(message.data)
          break
        case 'exit':
          instance.terminal.write(`\r\nProcess exited with code ${message.exitCode}\r\n`)
          onExit?.(message.terminalId, message.exitCode)
          break
        case 'error':
          console.error('[Terminal]', message.message)
          break
      }
    }

    socket.onerror = (error) => {
      console.error('[Terminal] WebSocket error', error)
    }

    socket.onclose = (event) => {
      const expectedClose = expectedSocketCloses.has(socket)
      if (instance.socket === socket) instance.socket = null
      console.log(`[Terminal] Disconnected (${event.code}${event.reason ? `: ${event.reason}` : ''})`)
      if (expectedClose) return

      onDisconnect?.()
      if (event.code === 4404) {
        setConnectionState('disconnected')
        return
      }

      setConnectionState('reconnecting')
      const delay = reconnectDelays[Math.min(instance.reconnectAttempt, reconnectDelays.length - 1)]
      instance.reconnectAttempt += 1
      instance.reconnectTimer = setTimeout(() => {
        instance.reconnectTimer = null
        openSocket()
      }, delay)
    }
  }

  instance.reconnectNow = () => {
    if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer)
    instance.reconnectTimer = null
    instance.reconnectAttempt = 0
    if (instance.socket) {
      expectedSocketCloses.add(instance.socket)
      instance.socket.close()
      instance.socket = null
    }
    openSocket()
  }

  // Handlers refer to instance.socket so they continue to work after reattachment.
  instance.disposables.forEach(d => d.dispose())
  instance.disposables = [
    instance.terminal.onData((data) => {
      const socket = instance.socket
      if (socket?.readyState === WebSocket.OPEN && instance.terminalId.value) {
        socket.send(JSON.stringify({ type: 'input', terminalId: instance.terminalId.value, data }))
      }
    }),
    instance.terminal.onResize(({ cols, rows }) => {
      const socket = instance.socket
      if (socket?.readyState === WebSocket.OPEN && instance.terminalId.value) {
        socket.send(JSON.stringify({ type: 'resize', terminalId: instance.terminalId.value, cols, rows }))
      }
    }),
  ]

  openSocket()
}

export function retryTerminal(instance: TerminalInstance) {
  instance.reconnectNow?.()
}

/** Disconnect the socket. Set terminate for an explicit user close. */
export function disconnectTerminal(instance: TerminalInstance, terminate = false) {
  if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer)
  instance.reconnectTimer = null
  instance.reconnectNow = null

  const terminalId = instance.terminalId.value
  if (instance.socket) {
    const socket = instance.socket
    expectedSocketCloses.add(socket)
    if (terminate && socket.readyState === WebSocket.OPEN && terminalId) {
      socket.send(JSON.stringify({ type: 'dispose', terminalId }))
    }
    socket.close()
    instance.socket = null
  } else if (terminate && terminalId && instance.disposalUrl) {
    // Reattach briefly so Close remains destructive even while the main socket is offline.
    const disposalSocket = new WebSocket(instance.disposalUrl)
    disposalSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'reattached' && disposalSocket.readyState === WebSocket.OPEN) {
          disposalSocket.send(JSON.stringify({ type: 'dispose', terminalId }))
          disposalSocket.close()
        }
      } catch {
        disposalSocket.close()
      }
    }
    disposalSocket.onerror = () => disposalSocket.close()
  }
  instance.connectionState.value = 'disconnected'
  if (terminate) {
    instance.terminalId.value = undefined
    instance.disposalUrl = null
  }
}

export function disposeTerminal(instance: TerminalInstance, terminate = true) {
  disconnectTerminal(instance, terminate)
  instance.disposables.forEach(d => d.dispose())
  instance.disposables = []
  if (instance.isOpen) {
    instance.terminal.dispose()
    instance.isOpen = false
  }
}

/** Legacy composable for a single terminal (backward compatible). */
export function useTerminal(containerRef: Ref<HTMLElement | null>) {
  const instance = createTerminalInstance()

  function connect(clientId: string, cwd?: string) {
    connectTerminal(instance, clientId, cwd)
  }

  function open() {
    if (containerRef.value) openTerminal(instance, containerRef.value)
  }

  function fit() {
    fitTerminal(instance)
  }

  function disconnect() {
    disconnectTerminal(instance)
  }

  function dispose() {
    disposeTerminal(instance)
  }

  onUnmounted(dispose)

  return {
    terminal: instance.terminal,
    terminalId: instance.terminalId,
    connectionState: instance.connectionState,
    connect,
    disconnect,
    open,
    fit,
    dispose,
  }
}
