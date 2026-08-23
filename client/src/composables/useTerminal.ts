// client/src/composables/useTerminal.ts
import { ref, onUnmounted, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'

export type TerminalThemeName = 'dark' | 'light'

const expectedSocketCloses = new WeakSet<WebSocket>()

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
  terminal: Terminal
  fitAddon: FitAddon
  socket: WebSocket | null
  isOpen: boolean
  disposables: { dispose(): void }[]
}

/**
 * Create a single terminal instance bound to a container element.
 * Each call creates an independent terminal with its own WebSocket connection.
 */
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
    terminal,
    fitAddon,
    socket: null,
    isOpen: false,
    disposables: [],
  }
}

/**
 * Open the terminal in a container element and fit it.
 */
export function openTerminal(instance: TerminalInstance, container: HTMLElement) {
  if (!instance.isOpen) {
    instance.terminal.open(container)
    instance.isOpen = true
  }
  instance.fitAddon.fit()
  instance.terminal.focus()
}

/**
 * Fit the terminal to its container.
 */
export function fitTerminal(instance: TerminalInstance) {
  instance.fitAddon.fit()
}

/**
 * Connect the terminal to the backend via WebSocket.
 */
export function connectTerminal(
  instance: TerminalInstance,
  clientId: string,
  cwd?: string,
  onCreated?: (terminalId: string, shell: string) => void,
  onExit?: (terminalId: string, exitCode: number) => void,
  onDisconnect?: () => void,
) {
  // Close existing socket if any
  if (instance.socket) {
    expectedSocketCloses.add(instance.socket)
    instance.socket.close()
    instance.socket = null
  }
  instance.terminalId.value = undefined

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl = `${protocol}://${window.location.host}/ws/terminal?clientId=${clientId}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''}`

  const socket = new WebSocket(wsUrl)
  instance.socket = socket

  socket.onopen = () => {
    console.log('[Terminal] Connected')
  }

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)

    switch (message.type) {
      case 'created':
        instance.terminalId.value = message.terminalId
        onCreated?.(message.terminalId, message.shell || 'bash')
        // Send initial size to PTY
        instance.fitAddon.fit()
        socket?.send(JSON.stringify({
          type: 'resize',
          terminalId: message.terminalId,
          cols: instance.terminal.cols,
          rows: instance.terminal.rows,
        }))
        break
      case 'output':
        instance.terminal.write(message.data)
        break
      case 'exit':
        instance.terminal.write(`\r\nProcess exited with code ${message.exitCode}\r\n`)
        onExit?.(message.terminalId, message.exitCode)
        break
    }
  }

  socket.onclose = () => {
    console.log('[Terminal] Disconnected')
    const expectedClose = expectedSocketCloses.has(socket)
    if (instance.socket === socket) {
      instance.socket = null
      instance.terminalId.value = undefined
    }
    if (!expectedClose) {
      instance.terminal.write('\r\n[terminal disconnected - create a new terminal tab to continue]\r\n')
      onDisconnect?.()
    }
  }

  // Dispose previous handlers to avoid duplicates
  instance.disposables.forEach(d => d.dispose())
  instance.disposables = []

  const dataDisposable = instance.terminal.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN && instance.terminalId.value) {
      socket.send(JSON.stringify({
        type: 'input',
        terminalId: instance.terminalId.value,
        data,
      }))
    }
  })

  const resizeDisposable = instance.terminal.onResize(({ cols, rows }) => {
    if (socket?.readyState === WebSocket.OPEN && instance.terminalId.value) {
      socket.send(JSON.stringify({
        type: 'resize',
        terminalId: instance.terminalId.value,
        cols,
        rows,
      }))
    }
  })

  instance.disposables.push(dataDisposable, resizeDisposable)
}

/**
 * Disconnect the terminal's WebSocket.
 */
export function disconnectTerminal(instance: TerminalInstance) {
  if (instance.socket) {
    expectedSocketCloses.add(instance.socket)
    instance.socket.close()
    instance.socket = null
  }
  instance.terminalId.value = undefined
}

/**
 * Fully dispose of the terminal instance.
 */
export function disposeTerminal(instance: TerminalInstance) {
  disconnectTerminal(instance)
  instance.disposables.forEach(d => d.dispose())
  instance.disposables = []
  if (instance.isOpen) {
    instance.terminal.dispose()
    instance.isOpen = false
  }
}

/**
 * Legacy composable for a single terminal (backward compatible).
 */
export function useTerminal(containerRef: Ref<HTMLElement | null>) {
  const instance = createTerminalInstance()

  function connect(clientId: string, cwd?: string) {
    connectTerminal(instance, clientId, cwd)
  }

  function open() {
    if (containerRef.value) {
      openTerminal(instance, containerRef.value)
    }
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
    connect,
    disconnect,
    open,
    fit,
    dispose,
  }
}
