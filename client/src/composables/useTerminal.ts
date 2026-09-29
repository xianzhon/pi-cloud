// client/src/composables/useTerminal.ts
import { ref, onUnmounted, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ITheme } from '@xterm/xterm'

export type TerminalThemeName = 'dark' | 'light'
export type TerminalConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface TerminalResumeState {
  terminalId: string
  resumeToken: string
  lastSeq: number
  cwd?: string
  shell?: string
}

const expectedSocketCloses = new WeakSet<WebSocket>()
const reconnectDelays = [0, 1_000, 2_000, 5_000, 10_000, 30_000]
const RESUME_STORAGE_PREFIX = 'pi-cloud-terminals:'

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
  dark: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#45475a' },
  light: { background: '#ffffff', foreground: '#1a1a2e', cursor: '#4a6cf7', selectionBackground: '#d8defd' },
}

function currentTerminalTheme(): TerminalThemeName {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function clearReconnectTimer(instance: TerminalInstance): void {
  if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer)
  instance.reconnectTimer = null
}

function closeTerminalSocket(instance: TerminalInstance): void {
  if (!instance.socket) return

  expectedSocketCloses.add(instance.socket)
  instance.socket.close()
  instance.socket = null
}

function readResumeStates(clientId: string): TerminalResumeState[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${RESUME_STORAGE_PREFIX}${clientId}`) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((state): state is TerminalResumeState =>
      typeof state?.terminalId === 'string' &&
      typeof state?.resumeToken === 'string' &&
      Number.isSafeInteger(state?.lastSeq) && state.lastSeq >= 0,
    )
  } catch {
    return []
  }
}

function writeResumeState(clientId: string, state: TerminalResumeState): void {
  try {
    const states = readResumeStates(clientId).filter(item => item.terminalId !== state.terminalId)
    states.push(state)
    sessionStorage.setItem(`${RESUME_STORAGE_PREFIX}${clientId}`, JSON.stringify(states))
  } catch {
    // Reconnection still works in memory when browser storage is unavailable.
  }
}

function removeResumeState(clientId: string, terminalId: string): void {
  try {
    const states = readResumeStates(clientId).filter(item => item.terminalId !== terminalId)
    if (states.length) sessionStorage.setItem(`${RESUME_STORAGE_PREFIX}${clientId}`, JSON.stringify(states))
    else sessionStorage.removeItem(`${RESUME_STORAGE_PREFIX}${clientId}`)
  } catch {}
}

export function getResumableTerminals(clientId: string): TerminalResumeState[] {
  return readResumeStates(clientId)
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
  resumeToken: string | null
  lastOutputSeq: number
  receivedOutputSeq: number
  clientId: string | null
  cwd?: string
  shell?: string
  terminated: boolean
}

function createDisposalUrl(clientId: string, terminalId: string, resumeToken: string, lastSeq: number): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams({
    clientId,
    terminalId,
    resumeToken,
    lastSeq: String(lastSeq),
  })
  return `${protocol}://${window.location.host}/ws/terminal?${params}`
}

/** Create a terminal instance, optionally restoring a detached server PTY. */
export function createTerminalInstance(resume?: TerminalResumeState, clientId: string | null = null): TerminalInstance {
  const terminalId = ref<string | undefined>(resume?.terminalId)
  const terminal = new Terminal({
    theme: terminalThemes[currentTerminalTheme()],
    fontSize: 14,
    fontFamily: terminalFontFamily,
    fontWeight: 400,
    cursorBlink: true,
    disableStdin: true,
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
    disposalUrl: clientId && resume
      ? createDisposalUrl(clientId, resume.terminalId, resume.resumeToken, resume.lastSeq)
      : null,
    resumeToken: resume?.resumeToken ?? null,
    // A refreshed page has a new xterm screen, so replay the retained buffer from its start.
    lastOutputSeq: 0,
    receivedOutputSeq: 0,
    clientId,
    cwd: resume?.cwd,
    shell: resume?.shell,
    terminated: false,
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
  instance.clientId = clientId
  instance.cwd = instance.cwd ?? cwd
  instance.terminated = false
  closeTerminalSocket(instance)
  clearReconnectTimer(instance)
  instance.reconnectAttempt = 0

  const persistResumeState = () => {
    if (instance.terminated || !instance.terminalId.value || !instance.resumeToken) return
    writeResumeState(clientId, {
      terminalId: instance.terminalId.value,
      resumeToken: instance.resumeToken,
      lastSeq: instance.lastOutputSeq,
      cwd: instance.cwd,
      shell: instance.shell,
    })
  }

  const setConnectionState = (state: TerminalConnectionState) => {
    instance.connectionState.value = state
    instance.terminal.options.disableStdin = state !== 'connected'
    onConnectionState?.(state)
  }

  const openSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({ clientId })
    if (instance.cwd) params.set('cwd', instance.cwd)
    params.set('lastSeq', String(instance.lastOutputSeq))
    if (instance.terminalId.value && instance.resumeToken) {
      params.set('terminalId', instance.terminalId.value)
      params.set('resumeToken', instance.resumeToken)
    }

    setConnectionState(instance.terminalId.value ? 'reconnecting' : 'connecting')
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal?${params}`)
    instance.socket = socket

    socket.onopen = () => console.log('[Terminal] Connected')

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
        case 'reattached': {
          instance.terminalId.value = message.terminalId
          instance.resumeToken = message.resumeToken
          const shell = message.shell || instance.shell || 'bash'
          instance.shell = shell
          instance.disposalUrl = createDisposalUrl(clientId, message.terminalId, message.resumeToken, instance.lastOutputSeq)
          instance.reconnectAttempt = 0
          persistResumeState()
          setConnectionState('connected')
          onCreated?.(message.terminalId, shell)
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
        }
        case 'output': {
          const seq = Number(message.seq)
          if (!Number.isSafeInteger(seq) || seq <= instance.receivedOutputSeq || typeof message.data !== 'string') break
          instance.receivedOutputSeq = seq
          instance.terminal.write(message.data, () => {
            instance.lastOutputSeq = Math.max(instance.lastOutputSeq, seq)
            persistResumeState()
            if (socket.readyState === WebSocket.OPEN && instance.terminalId.value) {
              socket.send(JSON.stringify({ type: 'ack', terminalId: instance.terminalId.value, seq: instance.lastOutputSeq }))
            }
          })
          break
        }
        case 'output_truncated':
          instance.terminal.write('\r\n[Output while disconnected was truncated.]\r\n')
          break
        case 'exit':
          instance.terminated = true
          instance.terminal.write(`\r\nProcess exited with code ${message.exitCode}\r\n`)
          if (instance.terminalId.value) removeResumeState(clientId, instance.terminalId.value)
          onExit?.(message.terminalId, message.exitCode)
          break
        case 'error':
          console.error('[Terminal]', message.message)
          break
      }
    }

    socket.onerror = (error) => console.error('[Terminal] WebSocket error', error)

    socket.onclose = (event) => {
      const expectedClose = expectedSocketCloses.has(socket)
      if (instance.socket === socket) instance.socket = null
      console.log(`[Terminal] Disconnected (${event.code}${event.reason ? `: ${event.reason}` : ''})`)
      if (expectedClose) return

      onDisconnect?.()
      if (event.code === 4404) {
        if (instance.terminalId.value) removeResumeState(clientId, instance.terminalId.value)
        setConnectionState('disconnected')
        return
      }

      setConnectionState('reconnecting')
      const baseDelay = reconnectDelays[Math.min(instance.reconnectAttempt, reconnectDelays.length - 1)]
      const delay = baseDelay === 0 ? 0 : Math.round(baseDelay * (0.8 + Math.random() * 0.4))
      instance.reconnectAttempt += 1
      instance.reconnectTimer = setTimeout(() => {
        instance.reconnectTimer = null
        openSocket()
      }, delay)
    }
  }

  instance.reconnectNow = () => {
    clearReconnectTimer(instance)
    instance.reconnectAttempt = 0
    closeTerminalSocket(instance)
    openSocket()
  }

  // Handlers refer to instance.socket so they continue to work after reattachment.
  instance.disposables.forEach(disposable => disposable.dispose())
  instance.disposables = [
    instance.terminal.onData((data) => {
      const socket = instance.socket
      if (instance.connectionState.value === 'connected' && socket?.readyState === WebSocket.OPEN && instance.terminalId.value) {
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
  clearReconnectTimer(instance)
  instance.reconnectNow = null

  const terminalId = instance.terminalId.value
  const socket = instance.socket
  const canDisposeOnCurrentSocket = terminate && terminalId && socket?.readyState === WebSocket.OPEN
  if (canDisposeOnCurrentSocket) {
    socket.send(JSON.stringify({ type: 'dispose', terminalId }))
  }
  closeTerminalSocket(instance)

  if (terminate && !canDisposeOnCurrentSocket && terminalId && instance.disposalUrl) {
    // Reattach briefly so Close remains destructive whenever the main socket cannot send.
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
  instance.terminal.options.disableStdin = true
  if (terminate) {
    instance.terminated = true
    if (terminalId && instance.clientId) removeResumeState(instance.clientId, terminalId)
    instance.terminalId.value = undefined
    instance.resumeToken = null
    instance.disposalUrl = null
  }
}

export function disposeTerminal(instance: TerminalInstance, terminate = true) {
  disconnectTerminal(instance, terminate)
  instance.disposables.forEach(disposable => disposable.dispose())
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
