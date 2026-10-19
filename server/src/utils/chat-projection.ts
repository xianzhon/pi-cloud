type ChatPayload = Record<string, any>;

function messageMetadata(message: ChatPayload): ChatPayload {
  const { role, id, responseId, timestamp, provider, model, usage, stopReason, errorMessage } = message;
  return { role, id, responseId, timestamp, provider, model, usage, stopReason, errorMessage };
}

export function projectChatMessages(messages: any[], includeDetails = false): any[] {
  if (includeDetails) return messages;
  return messages.filter((message) => message.role === 'user' || message.role === 'assistant').map((message) => {
    if (message.role === 'user') return message;
    return {
      ...messageMetadata(message),
      content: Array.isArray(message.content)
        ? message.content.filter((item: ChatPayload) => item.type === 'text').map((item: ChatPayload) => ({ type: 'text', text: item.text }))
        : message.content,
    };
  });
}

// Full session data stays on the server. This is a transport-only view, shared
// by live delivery and history so lifecycle events cannot leak hidden payloads.
export function projectChatEvent(event: unknown, includeDetails = false): unknown | null {
  if (includeDetails || !event || typeof event !== 'object') return event;
  const source = event as ChatPayload;
  const { type } = source;
  switch (type) {
    case 'message_start':
    case 'message_end': {
      const message = source.message;
      if (!message) return { type };
      if (message.role !== 'assistant') return null;
      return { type, message: messageMetadata(message), hasContent: Boolean(message.content?.length) };
    }
    case 'message_update': {
      const update = source.assistantMessageEvent;
      if (!['text_start', 'text_delta', 'text_end'].includes(update?.type)) return null;
      return {
        type,
        message: source.message ? messageMetadata(source.message) : undefined,
        assistantMessageEvent: { type: update.type, contentIndex: update.contentIndex, delta: update.delta },
      };
    }
    case 'tool_execution_update':
      return null;
    case 'tool_execution_start':
    case 'tool_execution_end':
      return { type, toolCallId: source.toolCallId, toolName: source.toolName, isError: source.isError };
    case 'auto_retry_start':
      return { type, attempt: source.attempt, maxAttempts: source.maxAttempts, errorMessage: source.errorMessage };
    case 'auto_retry_end':
      return { type, success: source.success, finalError: source.finalError };
    default:
      return { type };
  }
}
