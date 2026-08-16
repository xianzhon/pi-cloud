<!-- client/src/components/TerminalPanel.vue -->
<template>
  <div
    v-show="visible"
    class="terminal-panel"
    :class="panelClasses"
    :style="panelStyle"
  >
    <!-- Floating: 8-direction resize handles -->
    <template v-if="isFloating">
      <div
        v-for="dir in resizeDirections"
        :key="dir"
        :class="['resize-handle', `resize-${dir}`]"
        @mousedown="$emit('startResize', $event, dir)"
      />
    </template>

    <!-- Docked: top-edge vertical resize handle -->
    <div
      v-else-if="!isMaximized"
      class="resize-handle resize-docked"
      :class="{ 'is-resizing': isDockedResizing }"
      @mousedown="onDockedResizeStart"
    />

    <div
      class="terminal-tabs-bar"
      @mousedown="onHeaderMouseDown"
      @dblclick.stop="$emit('toggleMaximize')"
    >
      <div class="terminal-tabs-label">{{ t('components.terminalPanel.terminal') }}</div>
      <div class="terminal-tabs">
        <div
          v-for="session in sessions"
          :key="session.terminal_id"
          class="terminal-tab"
          :class="{ active: activeId === session.terminal_id }"
          @click="$emit('switch', session.terminal_id)"
        >
          <span class="terminal-tab-title">{{ session.label || 'shell' }}</span>
          <button class="terminal-tab-close" @click.stop="$emit('closeTerminal', session.terminal_id)">✕</button>
        </div>
        <button class="terminal-tab terminal-tab-new tooltip" @click.stop="$emit('createTerminal')" :data-tooltip="t('components.terminalPanel.newTerminal')">＋</button>
      </div>
      <div class="terminal-panel-actions">
        <button
          v-if="isFloating || isMaximized"
          class="icon-btn tooltip"
          @click.stop="$emit('dock')"
          :data-tooltip="t('components.terminalPanel.dockToBottom')"
        >⤓</button>
        <button
          v-else
          class="icon-btn tooltip"
          @click.stop="$emit('popOut')"
          :data-tooltip="t('components.terminalPanel.popOut')"
        >↗</button>
        <button class="icon-btn tooltip" @click.stop="$emit('close')" :data-tooltip="t('components.terminalPanel.minimize')">—</button>
        <button class="icon-btn maximize-btn tooltip" @click.stop="$emit('toggleMaximize')" :data-tooltip="isMaximized ? t('components.terminalPanel.restore') : t('components.terminalPanel.maximize')">
          {{ isMaximized ? '❐' : '▢' }}
        </button>
        <button class="icon-btn tooltip" @click.stop="$emit('close')" :data-tooltip="t('components.terminalPanel.closePanel')">✕</button>
      </div>
    </div>

    <!-- Terminal content area -->
    <div class="terminal-content">
      <div v-if="sessions.length === 0" class="terminal-empty">
        <div>{{ t('components.terminalPanel.noTerminals') }}</div>
        <button class="terminal-empty-create" @click="$emit('createTerminal')">{{ t('components.terminalPanel.newTerminal') }}</button>
      </div>
      <div
        v-else
        v-for="session in sessions"
        :key="session.terminal_id"
        v-show="activeId === session.terminal_id"
        class="terminal-host-wrapper"
      >
        <div :ref="(el: any) => $emit('setHostRef', session.terminal_id, el as HTMLElement | null)" class="terminal-host"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';

const t = i18n.global.t;
import { computed, onUnmounted, ref } from 'vue'

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

const props = defineProps<{
  visible: boolean
  mode: 'docked' | 'floating' | 'maximized'
  isMaximized: boolean
  isFloating: boolean
  sessions: TerminalSession[]
  activeId: string | null
  terminalHeight: number
  floatPanelStyle: Record<string, string>
  resizeDirections: string[]
  interaction: { active: boolean; mode: string | null; direction: string | null }
}>()

const emit = defineEmits<{
  toggleMaximize: []
  popOut: []
  dock: []
  createTerminal: []
  close: []
  switch: [terminalId: string]
  closeTerminal: [terminalId: string]
  setHostRef: [terminalId: string, el: HTMLElement | null]
  updateHeight: [height: number]
  startMove: [event: MouseEvent]
  startResize: [event: MouseEvent, direction: string]
}>()

// ── Panel classes & style ────────────────────────────────────────────────────

const panelClasses = computed(() => ({
  'terminal-panel-floating': props.isFloating,
  'terminal-panel-maximized': props.isMaximized,
  'terminal-panel-dragging': props.interaction.active,
}))

const panelStyle = computed(() => {
  if (props.isMaximized) {
    return { position: 'fixed' as const, top: '0', left: '0', width: '100vw', height: '100vh', zIndex: '1200' }
  }
  if (props.isFloating) {
    return props.floatPanelStyle
  }
  return { '--terminal-panel-height': `${props.terminalHeight}px` }
})

// ── Header drag: floating → move ─────────────────────────────────────────────

function onHeaderMouseDown(event: MouseEvent) {
  if (props.isFloating) {
    emit('startMove', event)
  }
}

// ── Docked vertical resize ───────────────────────────────────────────────────

const MIN_DOCKED_HEIGHT = 140
const MAX_HEIGHT_RATIO = 0.75

function clampHeight(h: number): number {
  const max = Math.max(MIN_DOCKED_HEIGHT, Math.floor(window.innerHeight * MAX_HEIGHT_RATIO))
  return Math.min(max, Math.max(MIN_DOCKED_HEIGHT, h))
}

let resizeStartY = 0
let resizeStartHeight = 0
const isDockedResizing = ref(false)

function onDockedResizeStart(event: MouseEvent) {
  event.preventDefault()
  isDockedResizing.value = true
  resizeStartY = event.clientY
  resizeStartHeight = props.terminalHeight
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDockedResizeMove)
  window.addEventListener('mouseup', onDockedResizeEnd)
  window.addEventListener('blur', onDockedResizeEnd)
}

function onDockedResizeMove(event: MouseEvent) {
  emit('updateHeight', clampHeight(resizeStartHeight - (event.clientY - resizeStartY)))
}

function onDockedResizeEnd() {
  isDockedResizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDockedResizeMove)
  window.removeEventListener('mouseup', onDockedResizeEnd)
  window.removeEventListener('blur', onDockedResizeEnd)
}

onUnmounted(onDockedResizeEnd)
</script>

<style scoped>
.icon-btn {
  width: 1.5rem;
  height: 1.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
}

.icon-btn:hover:not(:disabled) {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.icon-btn:active:not(:disabled) {
  transform: none;
}

/* Tooltips — match project style */
.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  background: var(--bg-elevated, #2a2a3e);
  color: var(--text-primary, #e0e0e0);
  font-size: 0.75rem;
  border-radius: var(--radius-sm, 4px);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease-out;
  border: 1px solid var(--border, #3a3a52);
  z-index: 100;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.3));
}

.tooltip:hover::after {
  opacity: 1;
}

/* ── Docked mode (default) ───────────────────────────────────────────────── */

.terminal-panel {
  position: relative;
  flex: 0 0 var(--terminal-panel-height, 300px);
  height: var(--terminal-panel-height, 300px);
  min-height: 140px;
  background: var(--bg-primary, #1a1a2e);
  border-top: 1px solid var(--border, #3a3a52);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Floating mode ────────────────────────────────────────────────────────── */

.terminal-panel.terminal-panel-floating {
  position: fixed;
  border: 1px solid var(--border, #3a3a52);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  min-height: 0;
}

.terminal-panel.terminal-panel-floating .terminal-tabs-bar {
  cursor: move;
  border-radius: 7px 7px 0 0;
}

.terminal-panel.terminal-panel-dragging {
  user-select: none;
}

/* ── Maximized mode ────────────────────────────────────────────────────────── */

.terminal-panel.terminal-panel-maximized {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1200;
  border-radius: 0;
  border: none;
}

/* ── Tabs bar ─────────────────────────────────────────────────────────────── */

.terminal-tabs-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent),
    var(--bg-elevated, #2a2a3e);
  border-bottom: 1px solid color-mix(in srgb, var(--border, #3a3a52) 72%, var(--accent, #7c7cff));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 1px 0 rgba(0, 0, 0, 0.28);
  min-height: 32px;
  flex-shrink: 0;
}

.terminal-tabs-bar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent, #7c7cff);
  opacity: 0.85;
}

.terminal-tabs-label {
  margin-left: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  flex-shrink: 0;
}

.terminal-panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Tabs ──────────────────────────────────────────────────────────────────── */

.terminal-tabs {
  display: flex;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.terminal-tabs::-webkit-scrollbar {
  display: none;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--bg-secondary, #22223a);
  border: 1px solid var(--border, #3a3a52);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.terminal-tab:hover {
  background: var(--accent-muted, #2a2a5a);
  color: var(--accent, #7c7cff);
}

.terminal-tab.active {
  background: color-mix(in srgb, var(--accent-muted, #2a2a5a) 72%, var(--bg-elevated, #2a2a3e));
  color: var(--accent, #7c7cff);
  border-color: var(--accent, #7c7cff);
}

.terminal-tab-new {
  justify-content: center;
  min-width: 34px;
  font-size: 14px;
}

.terminal-tab-title {
  font-weight: 500;
}

.terminal-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--text-tertiary, #666);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.15s, color 0.15s;
}

.terminal-tab-close:hover {
  background: var(--error-muted, #3a1a1a);
  color: var(--error, #ff5555);
}

/* ── Content ───────────────────────────────────────────────────────────────── */

.terminal-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

.terminal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex: 1;
  color: var(--text-secondary, #888);
  font-size: 14px;
}

.terminal-empty-create {
  padding: 6px 12px;
  background: var(--accent-muted, #2a2a5a);
  border: 1px solid var(--accent, #7c7cff);
  border-radius: 4px;
  color: var(--accent, #7c7cff);
  cursor: pointer;
}

.terminal-host-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.terminal-host {
  width: 100%;
  height: 100%;
}

/* ── Resize handles ────────────────────────────────────────────────────────── */

/* Docked: top edge only */
.resize-docked {
  position: absolute;
  top: -5px;
  left: 0;
  width: 100%;
  height: 10px;
  cursor: row-resize;
  z-index: 2;
}

.resize-docked::after {
  content: '';
  position: absolute;
  top: 5px;
  left: 0;
  width: 100%;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}

.resize-docked:hover::after,
.resize-docked.is-resizing::after {
  background: var(--accent, #7c7cff);
}

/* Floating: 8-direction handles */
.resize-handle {
  position: absolute;
  z-index: 2;
}

.resize-n,
.resize-s {
  left: 8px;
  right: 8px;
  height: 8px;
}

.resize-n { top: -4px; cursor: ns-resize; }
.resize-s { bottom: -4px; cursor: ns-resize; }

.resize-e,
.resize-w {
  top: 8px;
  bottom: 8px;
  width: 8px;
}

.resize-e { right: -4px; cursor: ew-resize; }
.resize-w { left: -4px; cursor: ew-resize; }

.resize-ne,
.resize-nw,
.resize-se,
.resize-sw {
  width: 12px;
  height: 12px;
}

.resize-ne { top: -6px; right: -6px; cursor: nesw-resize; }
.resize-nw { top: -6px; left: -6px; cursor: nwse-resize; }
.resize-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.resize-sw { left: -6px; bottom: -6px; cursor: nesw-resize; }

/* ── Mobile ────────────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .terminal-panel-header {
    padding: 10px 12px;
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }

  .icon-btn {
    width: 44px;
    height: 44px;
  }

  .terminal-tab {
    padding: 8px 12px;
    min-height: 40px;
  }
}
</style>
