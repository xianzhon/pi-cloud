import { computed, nextTick, ref, watch, type Ref } from 'vue';

export interface ModelOption {
  provider: string;
  id: string;
  name?: string;
  current?: boolean;
  input?: string[];
}

export interface SessionRuntimeStatus {
  model?: {
    provider?: string;
    id?: string;
    contextWindow?: number;
    reasoning?: boolean;
    input?: string[];
  };
  thinkingLevel?: string;
  thinkingLevels?: string[];
  usingSubscription?: boolean;
  autoCompactionEnabled?: boolean;
  stats?: {
    tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
    cost?: number;
  };
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

interface RuntimeNotification {
  role: 'assistant';
  content: string;
  kind: 'status';
  status: 'success' | 'failure';
  title: string;
}

interface SessionRuntimeOptions {
  sessionId: () => string | undefined;
  clientId: () => string | undefined;
  modelInfo: () => string | undefined;
  isStreaming: Ref<boolean>;
  configureNewSession?: () => void;
  notify: (message: RuntimeNotification) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

function isModelOption(value: unknown): value is ModelOption {
  const model = value as Partial<ModelOption>;
  return Boolean(model && typeof model.provider === 'string' && typeof model.id === 'string');
}

function modelLabelWithoutProvider(label?: string): string {
  return label?.split(/\s+\/\s+/).pop()?.trim() || '';
}

export function useSessionRuntime(options: SessionRuntimeOptions) {
  const sessionStatus = ref<SessionRuntimeStatus | null>(null);
  const thinkingLevelChanging = ref(false);
  const modelSelectorOpen = ref(false);
  const thinkingSelectorOpen = ref(false);
  const modelSelectorLoading = ref(false);
  const modelSelectorError = ref('');
  const modelOptions = ref<ModelOption[]>([]);
  const modelSearch = ref('');
  const activeModelIndex = ref(-1);
  const modelSearchRef = ref<HTMLInputElement>();
  const modelListRef = ref<HTMLElement>();

  const filteredModels = computed(() => {
    const query = modelSearch.value.trim().toLowerCase();
    if (!query) return modelOptions.value;
    return modelOptions.value.filter((model) => (
      [model.provider, model.id, model.name || ''].join(' ').toLowerCase().includes(query)
    ));
  });
  const thinkingLevels = computed(() => sessionStatus.value?.thinkingLevels || []);
  const composerModelLabel = computed(() => (
    modelLabelWithoutProvider(sessionStatus.value?.model?.id)
      || options.modelInfo()
      || options.t('components.chatPanel.selectModel')
  ));

  watch(filteredModels, (models) => {
    if (!models.length) {
      activeModelIndex.value = -1;
    } else if (activeModelIndex.value >= models.length) {
      activeModelIndex.value = models.length - 1;
    }
  });

  watch(activeModelIndex, async () => {
    await nextTick();
    modelListRef.value?.querySelector<HTMLElement>('.model-option.keyboard-active')?.scrollIntoView({ block: 'nearest' });
  });

  async function refreshSessionStatus() {
    const sessionId = options.sessionId();
    const clientId = options.clientId();
    if (!sessionId || !clientId) {
      sessionStatus.value = null;
      return;
    }

    try {
      const statusUrl = new URL(`/api/sessions/${sessionId}/status`, window.location.origin);
      statusUrl.searchParams.set('clientId', clientId);
      const response = await fetch(statusUrl.toString());
      if (!response.ok) throw new Error(options.t('components.chatPanel.failedToLoadSessionStatus'));
      sessionStatus.value = await response.json();
    } catch (error) {
      console.error(options.t('components.chatPanel.failedToLoadSessionStatus2'), error);
      sessionStatus.value = null;
    }
  }

  async function openModelSelector(initialSearch = '') {
    const sessionId = options.sessionId();
    const clientId = options.clientId();
    if (!sessionId || !clientId) return;

    modelSelectorOpen.value = true;
    modelSelectorLoading.value = true;
    modelSelectorError.value = '';
    modelSearch.value = initialSearch;
    activeModelIndex.value = -1;
    await nextTick();
    modelSearchRef.value?.focus();

    try {
      const params = new URLSearchParams({ clientId });
      const response = await fetch(`/api/sessions/${sessionId}/models?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      modelOptions.value = Array.isArray(data.models) ? data.models.filter(isModelOption) : [];
      const currentModelIndex = filteredModels.value.findIndex((model) => model.current);
      activeModelIndex.value = filteredModels.value.length ? Math.max(0, currentModelIndex) : -1;
    } catch (error) {
      modelOptions.value = [];
      modelSelectorError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToLoadModels');
    } finally {
      modelSelectorLoading.value = false;
    }
  }

  function closeModelSelector() {
    modelSelectorOpen.value = false;
    activeModelIndex.value = -1;
  }

  function handleModelSelectorClick(): void {
    if (!options.sessionId() || !options.clientId()) {
      options.configureNewSession?.();
      return;
    }
    void openModelSelector();
  }

  function moveModelSelection(delta: number) {
    const lastIndex = filteredModels.value.length - 1;
    if (lastIndex < 0) return;
    activeModelIndex.value = Math.min(Math.max(activeModelIndex.value + delta, 0), lastIndex);
  }

  function handleModelSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveModelSelection(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && activeModelIndex.value >= 0) {
      event.preventDefault();
      void selectModel(filteredModels.value[activeModelIndex.value]);
    } else if (event.key === 'Escape') {
      closeModelSelector();
    }
  }

  function openThinkingSelector(): void {
    if (!options.sessionId() || !options.clientId() || options.isStreaming.value || !thinkingLevels.value.length) return;
    thinkingSelectorOpen.value = true;
  }

  function closeThinkingSelector(): void {
    thinkingSelectorOpen.value = false;
  }

  async function selectThinkingLevel(level: string): Promise<void> {
    const sessionId = options.sessionId();
    const clientId = options.clientId();
    if (!sessionId || !clientId || !level) return;

    thinkingLevelChanging.value = true;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/thinking-level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, level }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      sessionStatus.value = data;
      closeThinkingSelector();
      options.notify({
        role: 'assistant', content: options.t('components.chatPanel.thinkingLevelChangedTo', { level }), kind: 'status', status: 'success', title: options.t('components.chatPanel.thinkingLevelChanged'),
      });
    } catch (error) {
      options.notify({
        role: 'assistant', content: error instanceof Error ? error.message : options.t('components.chatPanel.failedToChangeThinkingLevel'), kind: 'status', status: 'failure', title: options.t('components.chatPanel.thinkingLevelChangeFailed'),
      });
    } finally {
      thinkingLevelChanging.value = false;
    }
  }

  async function selectModel(model: ModelOption) {
    const sessionId = options.sessionId();
    const clientId = options.clientId();
    if (!sessionId || !clientId) return;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, provider: model.provider, modelId: model.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      sessionStatus.value = data;
      modelOptions.value = modelOptions.value.map((item) => ({
        ...item,
        current: item.provider === model.provider && item.id === model.id,
      }));
      closeModelSelector();
      options.notify({
        role: 'assistant', content: options.t('components.chatPanel.modelChangedTo', { model: model.name || model.id, provider: model.provider }), kind: 'status', status: 'success', title: options.t('components.chatPanel.modelChanged'),
      });
    } catch (error) {
      modelSelectorError.value = error instanceof Error ? error.message : options.t('components.chatPanel.failedToChangeModel');
    }
  }

  return {
    sessionStatus,
    thinkingLevelChanging,
    modelSelectorOpen,
    thinkingSelectorOpen,
    modelSelectorLoading,
    modelSelectorError,
    modelOptions,
    modelSearch,
    activeModelIndex,
    modelSearchRef,
    modelListRef,
    filteredModels,
    thinkingLevels,
    composerModelLabel,
    refreshSessionStatus,
    handleModelSelectorClick,
    openModelSelector,
    closeModelSelector,
    handleModelSearchKeydown,
    openThinkingSelector,
    closeThinkingSelector,
    selectThinkingLevel,
    selectModel,
  };
}
