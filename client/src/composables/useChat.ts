// client/src/composables/useChat.ts
import { computed, onUnmounted, ref } from 'vue';
import { useWebSocket } from './useWebSocket';
import { usePreferences } from './usePreferences';
import { createClientId } from '../utils/id';
import { initSoundNotifications, playTaskNotification } from '../services/soundNotifications';

type MessageKind = 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';
type MessageStatus = 'pending' | 'success' | 'failure' | 'info';

interface TokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

interface SessionActivityRecord {
  id: number;
  kind: 'commit_created' | 'commit_amended' | 'pr_created' | 'branch_deleted';
  data: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryRecallItem {
  id: string;
  scope: 'project' | 'global';
  category: 'rule' | 'preference' | 'decision' | 'fact' | 'pitfall';
  content: string;
  reason: 'pinned' | 'query-match';
}

export interface MemoryRecallDiagnostics {
  candidateIds: string[];
  rejectedBelowThresholdIds: string[];
  redundancyRejectedIds: string[];
  selected: Array<{ id: string; score: number; components: Record<string, number> }>;
  budgetCeiling: number;
  usedTokens: number;
  overflow: boolean;
  countingMethod: string;
  rankingPolicyVersion: string;
  promptFormatVersion: string;
  skipReason?: string;
}

export interface MessageMemoryRecall {
  injected: boolean;
  tokenCount: number;
  memories: MemoryRecallItem[];
  diagnostics?: MemoryRecallDiagnostics;
  createdAt?: string;
}

interface MemoryRecallEventPayload extends MessageMemoryRecall {
  profileId: string;
  projectId: string;
  sessionId?: string;
}

export interface ChatImage {
  type: 'image';
  data: string;
  mimeType: string;
  name?: string;
  size?: number;
  path?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // Thinking/reasoning content
  timestamp: number;
  hasTextContent?: boolean; // Track if message has actual text content
  kind?: MessageKind;
  status?: MessageStatus;
  title?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  toolCallId?: string;
  provider?: string;
  model?: string;
  usage?: TokenUsage;
  images?: ChatImage[];
  memory?: MessageMemoryRecall;
}

function stringifyValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getToolName(event: any): string {
  return event?.toolName || event?.tool_name || event?.name || event?.assistantMessageEvent?.name || event?.toolUseId || event?.tool_use_id || 'tool';
}

function isFailureEvent(event: any): boolean {
  const text = `${event?.type || ''} ${event?.status || ''} ${event?.assistantMessageEvent?.type || ''} ${event?.error || ''}`.toLowerCase();
  return text.includes('fail') || text.includes('error') || event?.is_error === true || event?.isError === true;
}

function getToolInput(event: any): string {
  return stringifyValue(event?.input ?? event?.args ?? event?.arguments ?? event?.parameters ?? '');
}

function shortHash(value: unknown): string {
  return typeof value === 'string' && value ? value.slice(0, 12) : '';
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function numberField(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === 'number' ? value : null;
}

function formatSessionActivity(activity: SessionActivityRecord[]): string {
  const lines = activity.map((event) => {
    if (event.kind === 'pr_created') {
      const data = event.data || {};
      const number = numberField(data, 'number');
      const url = stringField(data, 'url');
      const title = stringField(data, 'title');
      const source = stringField(data, 'sourceBranch');
      const target = stringField(data, 'targetBranch');
      const commit = shortHash(data.commit);
      return `- PR ${number ? `#${number}` : ''}${title ? `: ${title}` : ''}${url ? ` — ${url}` : ''}${source || target ? ` (${source || '?'} → ${target || '?'})` : ''}${commit ? `, commit \`${commit}\`` : ''}`;
    }

    if (event.kind === 'branch_deleted') {
      const data = event.data || {};
      const branch = stringField(data, 'branch');
      const commit = stringField(data, 'commit');
      return `- Branch \`${branch}\` deleted; last commit: \`${commit}\` (use this commit to restore it if needed)`;
    }

    const data = event.data || {};
    const commit = shortHash(data.commit);
    const message = stringField(data, 'message');
    const label = event.kind === 'commit_amended' ? 'Amended commit' : 'Commit';
    return `- ${label}${commit ? ` \`${commit}\`` : ''}${message ? `: ${message}` : ''}`;
  });
  return `### Session activity\n\n${lines.join('\n')}`;
}

function activityMessage(activity: SessionActivityRecord[]): Message | null {
  if (!activity.length) return null;
  return {
    id: 'session-activity',
    role: 'assistant',
    content: formatSessionActivity(activity),
    timestamp: Date.now(),
    kind: 'status',
    status: 'info',
    title: 'Session activity',
  };
}

function imageFromContentItem(item: any): ChatImage | null {
  if (normalizeType(item?.type) !== 'image' || typeof item?.data !== 'string' || typeof item?.mimeType !== 'string') return null;
  return { type: 'image', data: item.data, mimeType: item.mimeType };
}

function textFromContentArray(content: any[]): string {
  return content
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => stringifyValue(item.text || item.content || ''))
    .filter((text: string) => text.trim())
    .join('\n');
}

function uploadedImagePathsFromText(text: string): { content: string; paths: string[] } {
  const marker = '[Uploaded image files]';
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex < 0) return { content: text, paths: [] };

  const note = text.slice(markerIndex).split('\n');
  const paths = note.slice(1, -1)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
  if (!paths.length || !note.at(-1)?.startsWith('These are local files in the project.')) {
    return { content: text, paths: [] };
  }
  return { content: text.slice(0, markerIndex).trimEnd(), paths };
}

function textFromToolResult(result: any): string {
  if (Array.isArray(result?.content)) return textFromContentArray(result.content);
  if (Array.isArray(result)) return textFromContentArray(result);
  return stringifyValue(result);
}

function getToolOutput(event: any): string {
  if (event?.result != null) return textFromToolResult(event.result);
  if (event?.partialResult != null) return textFromToolResult(event.partialResult);
  if (event?.content != null) return Array.isArray(event.content) ? textFromContentArray(event.content) : stringifyValue(event.content);
  return stringifyValue(event?.output ?? event?.error ?? event?.message ?? '');
}

function normalizeType(type?: string): string {
  return String(type || '').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
}

function isToolCallType(type?: string): boolean {
  return [
    'tool_call',
    'tool_use',
    'tool_start',
    'tool_call_start',
    'tool_invocation_start',
    'toolcall_start',
    'toolcall_delta',
    'toolcall_end',
  ].includes(normalizeType(type));
}

function isToolResultType(type?: string): boolean {
  return [
    'tool_result',
    'tool_end',
    'tool_call_end',
    'tool_invocation_end',
    'tool_error',
    'tool_execution_end',
  ].includes(normalizeType(type));
}

function toolResultMessageFromHistory(msg: any): Message | null {
  const toolOutput = Array.isArray(msg.content) ? textFromContentArray(msg.content) : stringifyValue(msg.content);
  if (!toolOutput.trim()) return null;
  const failed = msg.isError === true || isFailureEvent(msg);
  return {
    id: msg.toolCallId || msg.id || createClientId(),
    role: 'assistant',
    content: toolOutput,
    timestamp: msg.timestamp || Date.now(),
    kind: 'tool_result',
    status: failed ? 'failure' : 'success',
    title: failed ? `Tool ${getToolName(msg)} failed` : `Tool ${getToolName(msg)} completed`,
    toolName: getToolName(msg),
    toolOutput,
    toolCallId: msg.toolCallId,
  };
}

function messageFromContentItem(item: any, role: 'user' | 'assistant', timestamp: number): Message | null {
  const type = normalizeType(item?.type);
  if (type === 'text') {
    const content = stringifyValue(item?.text || item?.content || '');
    if (!content.trim()) return null;
    return {
      id: item?.id || createClientId(),
      role,
      content,
      timestamp,
      kind: 'text',
    };
  }

  if (type === 'thinking' || type === 'reasoning') {
    const content = stringifyValue(item?.thinking || item?.reasoning || item?.text || item?.content || '');
    if (!content.trim()) return null;
    return {
      id: item?.id || createClientId(),
      role: 'assistant',
      content,
      thinking: content,
      timestamp,
      kind: 'thinking',
      status: 'info',
      title: 'Thinking',
    };
  }

  if (isToolCallType(type)) {
    const toolInput = getToolInput(item);
    return {
      id: item?.id || createClientId(),
      role: 'assistant',
      content: toolInput,
      timestamp,
      kind: 'tool_call',
      status: 'pending',
      title: `Executing tool ${getToolName(item)}`,
      toolName: getToolName(item),
      toolInput,
      toolCallId: item?.toolCallId || item?.tool_call_id || item?.id,
    };
  }

  if (isToolResultType(type)) {
    const failed = isFailureEvent(item);
    const toolOutput = getToolOutput(item);
    return {
      id: item?.id || createClientId(),
      role: 'assistant',
      content: toolOutput,
      timestamp,
      kind: 'tool_result',
      status: failed ? 'failure' : 'success',
      title: failed ? `Tool ${getToolName(item)} failed` : `Tool ${getToolName(item)} completed`,
      toolName: getToolName(item),
      toolOutput,
      toolCallId: item?.toolCallId || item?.tool_call_id || item?.id,
    };
  }

  return null;
}

export function useChat() {
  interface SessionChatState {
    messages: Message[];
    isStreaming: boolean;
    currentMessage: Message | null;
    pendingMemoryRecall: MessageMemoryRecall | null;
  }

  interface SendMessageOptions {
    displayText?: string;
    copySummaryOnComplete?: boolean;
    awaitAcceptance?: boolean;
    acceptanceTimeoutMs?: number;
    images?: ChatImage[];
    onRejected?: (message: string) => void;
  }

  interface LoadSessionHistoryOptions {
    force?: boolean;
  }

  const sessionStates = ref<Record<string, SessionChatState>>({});
  const sessionId = ref<string | null>(null);
  const streamingSessionId = ref<string | null>(null);
  const hideThinkingBlock = ref(false); // Toggle for showing/hiding thinking blocks
  const pendingSummaryCopySessions = new Set<string>();
  const pendingPromptPreflights = new Map<string, {
    targetSessionId: string | null;
    userMessage: Message;
    resolve: (accepted: boolean) => void;
    onRejected?: (message: string) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let reconnectReconciliationTimer: ReturnType<typeof setTimeout> | null = null;
  let isReconcilingStreamingSession = false;

  const { send, on, clientId } = useWebSocket();
  const { streamingMessageBehavior, soundNotification } = usePreferences();
  initSoundNotifications();

  function getMessageSessionId(data?: any): string | null {
    return data?.sessionId || data?.event?.sessionId || data?.event?.message?.sessionId || streamingSessionId.value || sessionId.value;
  }

  function emitSessionStreamingState(targetSessionId: string | null | undefined, isStreaming: boolean, completed = false) {
    if (!targetSessionId) return;
    window.dispatchEvent(new CustomEvent('session-streaming-state', {
      detail: {
        id: targetSessionId,
        isStreaming,
        completed,
      },
    }));
  }

  function settlePromptPreflight(requestId: string, accepted: boolean, message = '', imagePaths: string[] = []) {
    const pending = pendingPromptPreflights.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingPromptPreflights.delete(requestId);
    if (accepted) {
      pending.userMessage.images?.forEach((image, index) => {
        const path = imagePaths[index];
        if (path) image.path = path;
      });
    } else {
      removeMessage(pending.userMessage, pending.targetSessionId);
      const state = ensureSessionState(pending.targetSessionId);
      state.isStreaming = false;
      if (streamingSessionId.value === pending.targetSessionId) streamingSessionId.value = null;
      emitSessionStreamingState(pending.targetSessionId, false);
      pending.onRejected?.(message || 'The message was rejected. Try again.');
    }
    pending.resolve(accepted);
  }

  function getStateKey(targetSessionId?: string | null): string {
    return targetSessionId || '__draft__';
  }

  function getLastAssistantText(state: SessionChatState): string {
    return [...state.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.kind !== 'status' && message.content.trim())
      ?.content.trim() || '';
  }

  function emitSummaryGenerated(targetSessionId?: string | null) {
    const key = getStateKey(targetSessionId);
    if (!pendingSummaryCopySessions.delete(key)) return;

    const content = getLastAssistantText(ensureSessionState(targetSessionId));
    window.dispatchEvent(new CustomEvent('summary-generated', {
      detail: { sessionId: targetSessionId, content },
    }));
  }

  function emitAssistantResponseCompleted(targetSessionId?: string | null) {
    const message = [...ensureSessionState(targetSessionId).messages]
      .reverse()
      .find((item) => item.role === 'assistant' && item.kind !== 'status' && item.content.trim());
    if (!message) return;

    window.dispatchEvent(new CustomEvent('assistant-response-completed', {
      detail: { sessionId: targetSessionId, messageId: message.id, content: message.content.trim() },
    }));
  }

  function finishStreaming(targetSessionId?: string | null, completed = false) {
    removeEmptyCurrentMessage(targetSessionId);
    stopStreaming(targetSessionId, completed);
    window.dispatchEvent(new CustomEvent('refresh-sessions'));
  }

  function stopStreaming(targetSessionId?: string | null, completed = false) {
    const streamingState = getStreamingSessionState(targetSessionId);
    const wasStreaming = streamingState.isStreaming;
    streamingState.isStreaming = false;
    if (wasStreaming) playTaskNotification(soundNotification.value);
    emitSessionStreamingState(targetSessionId, false, completed);
  }

  function ensureSessionState(targetSessionId?: string | null): SessionChatState {
    const key = getStateKey(targetSessionId);
    if (!sessionStates.value[key]) {
      sessionStates.value[key] = {
        messages: [],
        isStreaming: false,
        currentMessage: null,
        pendingMemoryRecall: null,
      };
    }
    return sessionStates.value[key];
  }

  function getViewedSessionState(): SessionChatState {
    return ensureSessionState(sessionId.value);
  }

  function getStreamingSessionState(targetSessionId?: string | null): SessionChatState {
    return ensureSessionState(targetSessionId || streamingSessionId.value || sessionId.value);
  }

  const messages = computed(() => getViewedSessionState().messages);
  const isStreaming = computed(() => getViewedSessionState().isStreaming);

  function setViewedSession(newSessionId: string | null): void {
    sessionId.value = newSessionId;
    ensureSessionState(newSessionId);
  }

  function removeMessage(message: Message | null, targetSessionId?: string | null) {
    if (!message) return;
    const state = ensureSessionState(targetSessionId);
    const index = state.messages.indexOf(message);
    if (index > -1) state.messages.splice(index, 1);
  }

  function removeEmptyCurrentMessage(targetSessionId?: string | null) {
    const state = ensureSessionState(targetSessionId);
    if (state.currentMessage && !state.currentMessage.hasTextContent && !state.currentMessage.thinking?.trim()) {
      removeMessage(state.currentMessage, targetSessionId);
    }
    state.currentMessage = null;
  }

  function showCurrentMessage(targetSessionId?: string | null) {
    const state = ensureSessionState(targetSessionId);
    if (state.currentMessage && !state.messages.includes(state.currentMessage)) {
      state.messages.push(state.currentMessage);
    }
  }

  function takePendingMemoryRecall(state: SessionChatState): MessageMemoryRecall | undefined {
    const recall = state.pendingMemoryRecall || undefined;
    state.pendingMemoryRecall = null;
    return recall;
  }

  function findToolRow(toolCallId: string | undefined, kind: MessageKind, targetSessionId?: string | null) {
    if (!toolCallId) return undefined;
    return ensureSessionState(targetSessionId).messages.find((msg) => msg.kind === kind && msg.toolCallId === toolCallId);
  }

  function applyAssistantMetadata(target: Message | undefined | null, source: any) {
    if (!target || target.role !== 'assistant' || target.kind && target.kind !== 'text') return;
    target.provider = source?.provider;
    target.model = source?.model;
    target.usage = source?.usage;
  }

  function applyCompletedAssistantMetadata(message: any, targetSessionId?: string | null) {
    if (message?.role !== 'assistant') return;
    const id = message.responseId || message.id;
    const state = getStreamingSessionState(targetSessionId);
    const target = (id ? state.messages.find((msg) => msg.id === id) : undefined) || state.currentMessage;
    applyAssistantMetadata(target, message);
  }

  function upsertToolCallRow(event: any, targetSessionId?: string | null) {
    const state = getStreamingSessionState(targetSessionId);
    const partialTool = event.partial?.content?.find?.((item: any) => normalizeType(item?.type) === 'tool_call');
    const toolCallId = event.toolCallId || event.tool_call_id || event.id || partialTool?.toolCallId || partialTool?.tool_call_id || partialTool?.id;
    const source = partialTool ? { ...partialTool, toolCallId } : event;
    const toolInput = getToolInput(source) || stringifyValue(partialTool?.partialJson || '');
    const row = findToolRow(toolCallId, 'tool_call', targetSessionId || streamingSessionId.value || sessionId.value);

    if (row) {
      row.content = toolInput;
      row.toolInput = toolInput;
      row.toolName = getToolName(source);
      row.title = `Executing tool ${getToolName(source)}`;
      return;
    }

    state.messages.push({
      id: toolCallId || createClientId(),
      role: 'assistant',
      content: toolInput,
      timestamp: Date.now(),
      kind: 'tool_call',
      status: 'pending',
      title: `Executing tool ${getToolName(source)}`,
      toolName: getToolName(source),
      toolInput,
      toolCallId,
    });
  }

  function upsertToolResultRow(event: any, targetSessionId?: string | null) {
    const state = getStreamingSessionState(targetSessionId);
    const toolCallId = event.toolCallId || event.tool_call_id || event.id;
    const failed = isFailureEvent(event);
    const toolOutput = getToolOutput(event);
    if (!toolOutput.trim() && !failed) return;

    const toolCallRow = findToolRow(toolCallId, 'tool_call', targetSessionId || streamingSessionId.value || sessionId.value);
    const row = findToolRow(toolCallId, 'tool_result', targetSessionId || streamingSessionId.value || sessionId.value);
    const updateRow: Message = row || {
      id: `${toolCallId || createClientId()}-result`,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
      kind: 'tool_result' as const,
      toolCallId,
    };

    updateRow.content = toolOutput;
    updateRow.status = failed ? 'failure' : 'success';
    updateRow.title = failed ? `Tool ${getToolName(event)} failed` : `Tool ${getToolName(event)} completed`;
    updateRow.toolName = toolCallRow?.toolName || getToolName(event);
    updateRow.toolInput = toolCallRow?.toolInput;
    updateRow.toolOutput = toolOutput;

    if (!row) state.messages.push(updateRow);
  }

  function clearReconnectReconciliation() {
    if (reconnectReconciliationTimer) {
      clearTimeout(reconnectReconciliationTimer);
      reconnectReconciliationTimer = null;
    }
  }

  async function reconcileStreamingSession() {
    if (isReconcilingStreamingSession) return;
    isReconcilingStreamingSession = true;

    try {
      const targetSessionId = sessionId.value || streamingSessionId.value;
      if (!targetSessionId || !getStreamingSessionState(targetSessionId).isStreaming) {
        clearReconnectReconciliation();
        return;
      }

      await loadSessionHistory(targetSessionId, { force: true });
      if (!getStreamingSessionState(targetSessionId).isStreaming) {
        clearReconnectReconciliation();
        return;
      }

      reconnectReconciliationTimer = setTimeout(() => {
        reconnectReconciliationTimer = null;
        void reconcileStreamingSession();
      }, 2_000);
    } finally {
      isReconcilingStreamingSession = false;
    }
  }

  const unsubscribeDisconnected = on('disconnected', () => {
    const targetSessionId = sessionId.value || streamingSessionId.value;
    if (targetSessionId && getStreamingSessionState(targetSessionId).isStreaming) {
      void reconcileStreamingSession();
    }
  });

  const unsubscribeEvent = on('event', (data: any) => {
    const event = data.event;
    const targetSessionId = getMessageSessionId(data);
    
    switch (event.type) {
      case 'message_start': {
        const messageRole = event.role || event.message?.role;
        if (messageRole === 'assistant') {
          const state = getStreamingSessionState(targetSessionId);
          state.currentMessage = {
            id: event.message?.responseId || createClientId(),
            role: 'assistant',
            content: '',
            thinking: '',
            timestamp: event.message?.timestamp || Date.now(),
            hasTextContent: false,
            memory: takePendingMemoryRecall(state),
          };
        }
        break;
      }

      case 'message_update': {
        const update = event.assistantMessageEvent;
        const updateType = normalizeType(update?.type);

        const state = getStreamingSessionState(targetSessionId);

        if (!state.currentMessage && (updateType === 'text_start' || updateType === 'text_delta' || updateType === 'thinking_delta')) {
          state.currentMessage = {
            id: event.message?.responseId || createClientId(),
            role: 'assistant',
            content: '',
            thinking: '',
            timestamp: event.message?.timestamp || Date.now(),
            hasTextContent: false,
            memory: takePendingMemoryRecall(state),
          };
        }

        if (state.currentMessage) {
          if (updateType === 'text_delta') {
            state.currentMessage.content += update.delta || '';
            state.currentMessage.hasTextContent = !!state.currentMessage.content.trim();
            if (state.currentMessage.hasTextContent) showCurrentMessage(targetSessionId);
          } else if (updateType === 'thinking_delta') {
            state.currentMessage.thinking = (state.currentMessage.thinking || '') + (update.delta || '');
            if (state.currentMessage.thinking.trim()) showCurrentMessage(targetSessionId);
          } else if (isToolCallType(update?.type)) {
            upsertToolCallRow(update, targetSessionId);
          } else if (isToolResultType(update?.type)) {
            upsertToolResultRow(update, targetSessionId);
          }
        }
        break;
      }

      case 'message_end':
        applyCompletedAssistantMetadata(event.message, targetSessionId);
        // Keep message if it has text or thinking content
        removeEmptyCurrentMessage(targetSessionId);
        break;

      case 'tool_execution_start':
        upsertToolCallRow(event, targetSessionId);
        break;

      case 'tool_execution_update':
        upsertToolResultRow(event, targetSessionId);
        break;

      case 'tool_execution_end':
        upsertToolResultRow(event, targetSessionId);
        if (getToolName(event) === 'propose_plan' && !isFailureEvent(event)) {
          window.dispatchEvent(new CustomEvent('plan-report-updated', {
            detail: { sessionId: targetSessionId },
          }));
        }
        break;

      case 'agent_start':
      case 'compaction_start':
        if (targetSessionId) streamingSessionId.value = targetSessionId;
        getStreamingSessionState(targetSessionId).isStreaming = true;
        emitSessionStreamingState(targetSessionId, true);
        window.dispatchEvent(new CustomEvent('refresh-sessions'));
        break;

      case 'agent_end':
        finishStreaming(targetSessionId, true);
        emitSummaryGenerated(targetSessionId);
        emitAssistantResponseCompleted(targetSessionId);
        // One completion refresh covers edits from any tool without continuous Git polling.
        window.dispatchEvent(new CustomEvent('refresh-git-status'));
        break;

      case 'compaction_end':
        finishStreaming(targetSessionId);
        break;
    }
  });

  const unsubscribeMemoryRecall = on('memory_recall', (data: MemoryRecallEventPayload) => {
    const targetSessionId = getMessageSessionId(data);
    const state = ensureSessionState(targetSessionId);
    const recall: MessageMemoryRecall = {
      injected: data.injected === true,
      tokenCount: typeof data.tokenCount === 'number' ? data.tokenCount : 0,
      memories: Array.isArray(data.memories) ? data.memories : [],
      diagnostics: data.diagnostics && typeof data.diagnostics === 'object'
        ? data.diagnostics
        : undefined,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    };
    if (state.currentMessage) state.currentMessage.memory = recall;
    else state.pendingMemoryRecall = recall;
  });

  const unsubscribePromptPreflight = on('prompt_preflight', (data: any) => {
    if (typeof data?.requestId !== 'string') return;
    settlePromptPreflight(
      data.requestId,
      data.accepted === true,
      typeof data.message === 'string' ? data.message : '',
      Array.isArray(data.imagePaths) ? data.imagePaths.filter((path: unknown) => typeof path === 'string') : [],
    );
  });

  const unsubscribeStatus = on('status', (data: any) => {
    if (data.status === 'idle') {
      const targetSessionId = getMessageSessionId(data);
      stopStreaming(targetSessionId);
      window.dispatchEvent(new CustomEvent('refresh-sessions'));
    }
  });

  const unsubscribeError = on('error', (data: any) => {
    console.error('Chat error:', data.message);
    const targetSessionId = getMessageSessionId(data);
    getStreamingSessionState(targetSessionId).isStreaming = false;
    emitSessionStreamingState(targetSessionId, false);
  });

  const unsubscribeLoopDetected = on('loop_detected', (data: any) => {
    console.warn('Loop detected:', data.message);
    const targetSessionId = getMessageSessionId(data);
    const state = ensureSessionState(targetSessionId);
    state.messages.push({
      id: createClientId(),
      role: 'assistant',
      content: data.message || 'Loop detected. Stopping automatically.',
      timestamp: Date.now(),
      kind: 'text',
    });
    state.isStreaming = false;
    emitSessionStreamingState(targetSessionId, false);
    window.dispatchEvent(new CustomEvent('refresh-sessions'));
  });

  const unsubscribeCompactResult = on('compact_result', (data: any) => {
    const targetSessionId = getMessageSessionId(data);
    const state = ensureSessionState(targetSessionId);
    state.messages.push({
      id: createClientId(),
      role: 'assistant',
      content: data.message || 'Session compacted.',
      timestamp: Date.now(),
      kind: 'text',
    });
    state.isStreaming = false;
    emitSessionStreamingState(targetSessionId, false);
    window.dispatchEvent(new CustomEvent('refresh-sessions'));
  });

  onUnmounted(() => {
    clearReconnectReconciliation();
    for (const requestId of Array.from(pendingPromptPreflights.keys())) {
      settlePromptPreflight(requestId, false);
    }
    unsubscribeDisconnected();
    unsubscribeEvent();
    unsubscribeMemoryRecall();
    unsubscribePromptPreflight();
    unsubscribeStatus();
    unsubscribeError();
    unsubscribeLoopDetected();
    unsubscribeCompactResult();
  });

  function addLocalMessage(message: Omit<Message, 'id' | 'timestamp'> & Partial<Pick<Message, 'id' | 'timestamp'>>, targetSessionId?: string | null) {
    const state = ensureSessionState(targetSessionId || sessionId.value);
    state.messages.push({
      ...message,
      id: message.id || createClientId(),
      timestamp: message.timestamp || Date.now(),
    });
    return state.messages[state.messages.length - 1];
  }

  function sendMessage(
    text: string,
    targetSessionId?: string,
    options: SendMessageOptions = {},
  ): Promise<boolean> | boolean {
    const images = options.images || [];
    if (!text.trim() && images.length === 0) return false;

    // The server uses the original name when persisting the upload; size remains presentation-only metadata.
    const payloadImages = images.map(({ type, data, mimeType, name }) => ({
      type,
      data,
      mimeType,
      ...(name ? { name } : {}),
    }));
    const resolvedSessionId = targetSessionId || sessionId.value || null;
    const state = ensureSessionState(resolvedSessionId);
    const messageType = state.isStreaming ? streamingMessageBehavior.value : 'prompt';
    const userMessage: Message = {
      id: createClientId(),
      role: 'user',
      content: options.displayText || text,
      timestamp: Date.now(),
      ...(images.length ? { images } : {}),
    };

    if (!options.awaitAcceptance) {
      const sent = send({
        type: messageType,
        payload: {
          text,
          sessionId: resolvedSessionId || undefined,
          ...(payloadImages.length ? { images: payloadImages } : {}),
        },
      });
      if (!sent) return false;
      state.messages.push(userMessage);
      state.isStreaming = true;
      streamingSessionId.value = resolvedSessionId;
      if (options.copySummaryOnComplete) {
        pendingSummaryCopySessions.add(getStateKey(streamingSessionId.value));
      }
      emitSessionStreamingState(streamingSessionId.value, true);
      return true;
    }

    const requestId = createClientId();
    const acceptance = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        settlePromptPreflight(requestId, false);
      }, options.acceptanceTimeoutMs ?? 30_000);
      pendingPromptPreflights.set(requestId, {
        targetSessionId: resolvedSessionId,
        userMessage,
        resolve,
        onRejected: options.onRejected,
        timer,
      });
    });

    state.messages.push(userMessage);
    state.isStreaming = true;
    streamingSessionId.value = resolvedSessionId;
    if (options.copySummaryOnComplete) {
      pendingSummaryCopySessions.add(getStateKey(streamingSessionId.value));
    }
    emitSessionStreamingState(streamingSessionId.value, true);

    const sent = send({
      type: messageType,
      payload: {
        text,
        sessionId: resolvedSessionId || undefined,
        requestId,
        ...(payloadImages.length ? { images: payloadImages } : {}),
      },
    });
    if (!sent) settlePromptPreflight(requestId, false);
    return acceptance;
  }

  function steer(text: string) {
    send({
      type: 'steer',
      payload: { text, sessionId: sessionId.value || streamingSessionId.value || undefined },
    });
  }

  function followUp(text: string) {
    send({
      type: 'followUp',
      payload: { text, sessionId: sessionId.value || streamingSessionId.value || undefined },
    });
  }

  function abort() {
    send({ type: 'abort', payload: { sessionId: sessionId.value || streamingSessionId.value || undefined } });
  }

  function clearMessages() {
    sessionId.value = null;
    ensureSessionState(null).messages = [];
  }

  function toggleThinking() {
    hideThinkingBlock.value = !hideThinkingBlock.value;
  }

  async function loadSessionHistory(newSessionId: string, options: LoadSessionHistoryOptions = {}) {
    try {
      setViewedSession(newSessionId);
      const response = await fetch(`/api/sessions/${newSessionId}?clientId=${encodeURIComponent(clientId)}`);
      const data = await response.json();
      
      if (data.messages && Array.isArray(data.messages)) {
        const normalizedMessages: Message[] = [];
        const toolCallsById = new Map<string, Pick<Message, 'toolName' | 'toolInput'>>();

        data.messages.forEach((msg: any) => {
          if (msg.role === 'toolResult') {
            const normalized = toolResultMessageFromHistory(msg);
            if (normalized) {
              const matchingCall = normalized.toolCallId ? toolCallsById.get(normalized.toolCallId) : undefined;
              if (matchingCall) {
                normalized.toolName = matchingCall.toolName || normalized.toolName;
                normalized.toolInput = matchingCall.toolInput;
              }
              normalizedMessages.push(normalized);
            }
            return;
          }

          const role = msg.role === 'user' ? 'user' : 'assistant';
          const timestamp = msg.timestamp || Date.now();

          if (Array.isArray(msg.content)) {
            if (role === 'user') {
              const restored = uploadedImagePathsFromText(textFromContentArray(msg.content));
              const images = msg.content
                .map(imageFromContentItem)
                .filter((image: ChatImage | null): image is ChatImage => image !== null)
                .map((image: ChatImage, index: number) => {
                  const path = restored.paths[index];
                  return path ? { ...image, path, name: path.split(/[\\/]/).pop() } : image;
                });
              if (restored.content.trim() || images.length) {
                normalizedMessages.push({
                  id: msg.id || createClientId(),
                  role,
                  content: restored.content,
                  timestamp,
                  kind: 'text',
                  ...(images.length ? { images } : {}),
                });
              }
              return;
            }

            msg.content.forEach((item: any) => {
              const normalized = messageFromContentItem(item, role, timestamp);
              if (normalized) {
                if (role === 'assistant' && normalized.kind === 'text') {
                  applyAssistantMetadata(normalized, msg);
                }
                if (normalized.kind === 'tool_call' && normalized.toolCallId) {
                  toolCallsById.set(normalized.toolCallId, {
                    toolName: normalized.toolName,
                    toolInput: normalized.toolInput,
                  });
                }
                normalizedMessages.push(normalized);
              }
            });
            return;
          }

          const content = stringifyValue(msg.content);
          if (role === 'assistant' && !content.trim()) return;

          normalizedMessages.push({
            id: msg.id || msg.responseId || createClientId(),
            role,
            content,
            timestamp,
            kind: 'text',
            provider: role === 'assistant' ? msg.provider : undefined,
            model: role === 'assistant' ? msg.model : undefined,
            usage: role === 'assistant' ? msg.usage : undefined,
          });
        });

        const activity = Array.isArray(data.activity) ? activityMessage(data.activity) : null;
        if (activity) normalizedMessages.push(activity);

        const state = ensureSessionState(newSessionId);
        const shouldPreserveLiveState = !options.force && state.isStreaming && state.messages.length > 0;
        if (!shouldPreserveLiveState) {
          state.messages = normalizedMessages;
        }
        state.isStreaming = Boolean(data.isStreaming) || (!options.force && state.isStreaming);
      }
    } catch (error) {
      console.error('Failed to load session history:', error);
    }
  }

  return {
    messages,
    isStreaming,
    sessionId,
    hideThinkingBlock,
    addLocalMessage,
    sendMessage,
    steer,
    followUp,
    abort,
    clearMessages,
    toggleThinking,
    setViewedSession,
    loadSessionHistory,
  };
}
