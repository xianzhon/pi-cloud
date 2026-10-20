// SDK updates contain two copies of the growing assistant message. Never send
// those snapshots on each token; the browser reconstructs text from deltas.
export function compactChatEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object' || !('type' in event) || event.type !== 'message_update') return event;
  const source = event as Record<string, any>;
  const update = source.assistantMessageEvent;
  if (!update || ![
    'text_start', 'text_delta', 'text_end',
    'thinking_start', 'thinking_delta', 'thinking_end',
    'toolcall_start', 'toolcall_delta', 'toolcall_end',
  ].includes(update.type)) return event;

  const { partial, ...compactUpdate } = update;
  if (update.type.startsWith('toolcall_')) {
    const tool = update.toolCall || partial?.content?.[update.contentIndex];
    compactUpdate.toolCallId = tool?.id;
    compactUpdate.toolName = tool?.name;
    if (update.type === 'toolcall_delta') compactUpdate.inputDelta = update.delta;
    if (update.type === 'toolcall_end') compactUpdate.args = tool?.arguments;
    delete compactUpdate.toolCall;
  } else {
    // End events repeat the text already delivered by delta events.
    delete compactUpdate.content;
  }

  return {
    ...source,
    message: {
      role: source.message?.role,
      responseId: source.message?.responseId,
      timestamp: source.message?.timestamp,
    },
    assistantMessageEvent: compactUpdate,
  };
}
