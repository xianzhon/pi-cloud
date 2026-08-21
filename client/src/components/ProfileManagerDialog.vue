<template>
  <Teleport to="body">
    <div v-if="visible" class="settings-backdrop">
      <section class="profile-manager" role="dialog" aria-modal="true" aria-labelledby="profile-manager-title">
        <header>
          <div>
            <h2 id="profile-manager-title">{{ t('components.profileManagerDialog.agentProfiles') }}</h2>
            <p>{{ t('components.profileManagerDialog.maintainAuthenticationAndNetworkSettingsWithoutChanging') }}</p>
          </div>
          <DialogCloseButton class="settings-close" :label="t('components.profileManagerDialog.close')" @click="emit('close')" />
        </header>
        <main>
          <nav class="profile-manager-list" :aria-label="t('components.profileManagerDialog.profiles')">
            <button v-for="profile in profiles" :key="profile.id" type="button" :class="{ active: profile.id === managedProfileId }" @click="select(profile.id)">
              <strong>{{ profile.id }}</strong><small>{{ profile.path }}</small>
            </button>
            <button class="create-profile-link" type="button" :class="{ active: creatingProfile }" @click="openCreate">{{ t('components.profileManagerDialog.createProfile') }}</button>
          </nav>
          <div class="profile-manager-form">
            <template v-if="creatingProfile">
              <h3>{{ t('components.profileManagerDialog.createProfile2') }}</h3>
              <p class="profile-help">{{ t('components.profileManagerDialog.thisCreatesANewPiProfileDirectory') }}</p>
              <input v-model="name" :placeholder="t('components.profileManagerDialog.eGCodex')" @keyup.enter="create" />
              <CustomSelect
                v-model="copySettingsFrom"
                :options="copySettingsOptions"
                :aria-label="t('components.profileManagerDialog.copySettingsFromAnotherProfile')"
              />
              <button class="profile-primary dialog-action" type="button" :disabled="creating || !name.trim()" @click="create">{{ creating ? t('components.profileManagerDialog.creating') : t('components.profileManagerDialog.createProfile2') }}</button>
            </template>
            <template v-else-if="managedProfileId">
              <h3>{{ t('components.profileManagerDialog.profileName', { profile: managedProfileId }) }}</h3>
              <p class="profile-help">{{ t('components.profileManagerDialog.authenticateWithPiInATerminal') }} <code>{{ authenticationCommand }}</code></p>
              <details :key="`local-${managedProfileId}`" class="profile-collapsible">
                <summary>
                  <span class="profile-section-heading">
                    <strong>{{ t('components.profileManagerDialog.localLlm') }}</strong>
                    <small>{{ t('components.profileManagerDialog.localLlmHelp') }}</small>
                  </span>
                  <span v-if="selectedLocalModelIds.length" class="profile-section-status">
                    {{ t('components.profileManagerDialog.modelsConfigured', { count: selectedLocalModelIds.length }) }}
                  </span>
                  <span class="profile-section-chevron" aria-hidden="true">›</span>
                </summary>
                <div class="profile-collapsible-content">
                  <CustomSelect
                    v-model="localLlmPreset"
                    :options="localLlmPresetOptions"
                    :aria-label="t('components.profileManagerDialog.localLlmPreset')"
                    @update:model-value="applyLocalLlmPreset"
                  />
                  <input
                    v-model="localLlmBaseUrl"
                    type="url"
                    :aria-label="t('components.profileManagerDialog.localLlmEndpoint')"
                    :placeholder="t('components.profileManagerDialog.localLlmEndpointPlaceholder')"
                    @keyup.enter="discoverLocalModels"
                  />
                  <div class="profile-key-actions">
                    <button class="profile-secondary dialog-action" type="button" :disabled="discoveringLocalModels || !localLlmBaseUrl.trim()" @click="discoverLocalModels">
                      {{ discoveringLocalModels ? t('components.profileManagerDialog.connecting') : t('components.profileManagerDialog.connectAndDiscover') }}
                    </button>
                    <span v-if="localLlmSaved" class="profile-success" role="status">{{ t('components.profileManagerDialog.localLlmSaved') }}</span>
                  </div>
                  <fieldset v-if="localModels.length" class="local-model-list">
                    <legend>{{ t('components.profileManagerDialog.discoveredModels') }}</legend>
                    <label v-for="model in localModels" :key="model.id">
                      <input v-model="selectedLocalModelIds" type="checkbox" :value="model.id" />
                      <span>{{ model.id }}</span>
                    </label>
                  </fieldset>
                  <div v-if="localModels.length" class="profile-remove-actions">
                    <button
                      class="profile-primary dialog-action"
                      type="button"
                      :disabled="savingLocalLlm || selectedLocalModelIds.length === 0"
                      @click="saveLocalLlm"
                    >
                      {{ savingLocalLlm ? t('components.profileManagerDialog.saving') : t('components.profileManagerDialog.saveLocalLlm') }}
                    </button>
                    <button class="profile-remove-button dialog-action" type="button" :disabled="removingLocalLlm" @click="removeLocalLlm">
                      {{ removingLocalLlm ? t('components.profileManagerDialog.removing') : t('components.profileManagerDialog.removeLocalLlm') }}
                    </button>
                  </div>
                  <span v-if="localLlmRemoved" class="profile-success" role="status">{{ t('components.profileManagerDialog.localLlmRemoved') }}</span>
                </div>
              </details>
              <details :key="`api-${managedProfileId}`" class="profile-collapsible">
                <summary>
                  <span class="profile-section-heading">
                    <strong>{{ t('components.profileManagerDialog.apiProviderKey') }}</strong>
                    <small>{{ t('components.profileManagerDialog.apiProviderKeyHelp') }}</small>
                  </span>
                  <span v-if="configuredApiKeyCount" class="profile-section-status">
                    {{ t('components.profileManagerDialog.keysConfigured', { count: configuredApiKeyCount }) }}
                  </span>
                  <span class="profile-section-chevron" aria-hidden="true">›</span>
                </summary>
                <div class="profile-collapsible-content">
                  <CustomSelect
                    v-model="apiKeyProvider"
                    :options="apiKeyProviderOptions"
                    :aria-label="t('components.profileManagerDialog.apiProviderKey')"
                  />
                  <input
                    v-model="apiKey"
                    type="password"
                    autocomplete="new-password"
                    :placeholder="t('components.profileManagerDialog.enterApiKey')"
                    @keyup.enter="saveApiKey"
                  />
                  <div class="profile-key-actions">
                    <button class="profile-secondary dialog-action" type="button" :disabled="savingApiKey || !apiKeyProvider || !apiKey.trim()" @click="saveApiKey">
                      {{ savingApiKey ? t('components.profileManagerDialog.saving') : t('components.profileManagerDialog.saveApiKey') }}
                    </button>
                    <button
                      v-if="selectedApiKeyProvider?.source === 'stored'"
                      class="profile-remove-button dialog-action"
                      type="button"
                      :disabled="removingApiKey"
                      @click="removeApiKey"
                    >
                      {{ removingApiKey ? t('components.profileManagerDialog.removing') : t('components.profileManagerDialog.removeApiKey') }}
                    </button>
                    <span v-if="selectedApiKeyProvider?.configured" class="profile-success" role="status">{{ t('components.profileManagerDialog.apiKeyConfigured') }}</span>
                    <span v-else-if="apiKeySaved" class="profile-success" role="status">{{ t('components.profileManagerDialog.apiKeySaved') }}</span>
                    <span v-else-if="apiKeyRemoved" class="profile-success" role="status">{{ t('components.profileManagerDialog.apiKeyRemoved') }}</span>
                  </div>
                </div>
              </details>
              <h3>{{ t('components.profileManagerDialog.defaultModel') }}</h3>
              <CustomSelect
                v-model="defaultModel"
                :options="modelOptions"
                :placeholder="t('components.profileManagerDialog.selectTheDefaultModel')"
                :aria-label="t('components.profileManagerDialog.defaultModel')"
              />
              <h3>{{ t('components.profileManagerDialog.automationModel') }}</h3>
              <p class="profile-help">{{ t('components.profileManagerDialog.chooseTheLightweightModelUsedForSupporting') }}</p>
              <CustomSelect
                v-model="automationModel"
                :options="modelOptions"
                :placeholder="t('components.profileManagerDialog.selectTheAutomationModel')"
                :aria-label="t('components.profileManagerDialog.automationModel')"
              />
              <h3>{{ t('components.profileManagerDialog.autoRename') }}</h3>
              <p class="profile-help">{{ t('components.profileManagerDialog.chooseTheLanguageUsedByWebUIS') }}</p>
              <CustomSelect
                v-model="autoRenameLanguage"
                :options="autoRenameLanguageOptions"
                :aria-label="t('components.profileManagerDialog.autoRenameLanguage')"
              />
              <h3>{{ t('components.profileManagerDialog.networkProxy') }}</h3>
              <input v-model="proxy.ALL_PROXY" placeholder="ALL_PROXY" /><input v-model="proxy.NO_PROXY" placeholder="NO_PROXY" />
              <div class="profile-actions">
                <button class="profile-primary dialog-action" type="button" :disabled="!defaultModel || !automationModel || savingSettings" @click="saveSettings">
                  {{ savingSettings ? t('components.profileManagerDialog.saving') : t('components.profileManagerDialog.saveSettings') }}
                </button>
                <button class="profile-secondary dialog-action profile-check-button" type="button" :disabled="checkingProxy" @click="checkProxy">
                  <span>{{ checkingProxy ? t('components.profileManagerDialog.checking') : t('components.profileManagerDialog.checkProxy') }}</span>
                  <span v-if="proxyCheckResult" :class="proxyCheckResult === 'ok' ? 'profile-check-ok' : 'profile-check-failed'" aria-hidden="true">
                    {{ proxyCheckResult === 'ok' ? '✓' : '✕' }}
                  </span>
                </button>
                <button v-if="managedProfileId !== 'default'" class="profile-delete" type="button" @click="deleteConfirm = true">{{ t('components.profileManagerDialog.deleteProfile') }}</button>
              </div>
              <p v-if="settingsSaved" class="profile-success" role="status">{{ t('components.profileManagerDialog.settingsSaved') }}</p>
            </template>
            <p v-if="error" class="profile-error">{{ error }}</p>
          </div>
        </main>
      </section>
      <ConfirmModal
        :visible="deleteConfirm"
        variant="danger"
        :confirm-text="t('components.profileManagerDialog.deleteProfile')"
        @confirm="deleteProfile"
        @cancel="deleteConfirm = false"
      >
        <template #title>{{ t('components.profileManagerDialog.deleteProfileName', { profile: managedProfileId }) }}</template>
        <template #message>{{ t('components.profileManagerDialog.thisPermanentlyRemovesTheProfileIncludingIts') }}</template>
      </ConfirmModal>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, reactive, ref, watch } from 'vue';
import ConfirmModal from './ConfirmModal.vue';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';
import DialogCloseButton from './DialogCloseButton.vue';

const t = i18n.global.t;

interface Profile {
  id: string;
  path: string;
  defaultProvider?: string;
  defaultModel?: string;
  automationProvider?: string;
  automationModel?: string;
}

interface ModelOption {
  provider: string;
  id: string;
  name?: string;
  current?: boolean;
}

interface ApiKeyProvider {
  envVar: string;
  label: string;
  configured: boolean;
  source?: string;
}

interface LocalModel {
  id: string;
}

interface DeleteResult {
  id: string;
  activeProfileChanged: boolean;
}

type ProxySettings = Record<'ALL_PROXY' | 'HTTP_PROXY' | 'HTTPS_PROXY' | 'NO_PROXY', string>;

const props = defineProps<{ visible: boolean; profiles: Profile[]; selectedId: string }>();
const emit = defineEmits<{ close: []; created: [id: string]; deleted: [result: DeleteResult]; updated: [] }>();

const managedProfileId = ref('');
const creatingProfile = ref(false);
const name = ref('');
const copySettingsFrom = ref('');
const creating = ref(false);
const deleteConfirm = ref(false);
const error = ref('');
const defaultModel = ref('');
const automationModel = ref('');
const autoRenameLanguage = ref<'english' | 'chinese'>('english');
const savingSettings = ref(false);
const settingsSaved = ref(false);
const checkingProxy = ref(false);
const proxyCheckResult = ref<'ok' | 'failed' | ''>('');
const models = ref<ModelOption[]>([]);
const apiKeyProviders = ref<ApiKeyProvider[]>([]);
const apiKeyProvider = ref('');
const apiKey = ref('');
const savingApiKey = ref(false);
const removingApiKey = ref(false);
const apiKeySaved = ref(false);
const apiKeyRemoved = ref(false);
const localLlmPreset = ref('ollama');
const localLlmBaseUrl = ref('http://127.0.0.1:11434/v1');
const localModels = ref<LocalModel[]>([]);
const selectedLocalModelIds = ref<string[]>([]);
const discoveringLocalModels = ref(false);
const savingLocalLlm = ref(false);
const removingLocalLlm = ref(false);
const localLlmSaved = ref(false);
const localLlmRemoved = ref(false);
const proxy = reactive<ProxySettings>({ ALL_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '' });

const authenticationCommand = computed(() => (
  managedProfileId.value === 'default'
    ? 'pi'
    : `PI_CODING_AGENT_DIR=~/.pi/${managedProfileId.value} pi`
));
const copySettingsOptions = computed<CustomSelectOption[]>(() => [
  { value: '', label: t('components.profileManagerDialog.startEmpty') },
  ...props.profiles.map((profile) => ({ value: profile.id, label: t('components.profileManagerDialog.copySettingsFromProfile', { profile: profile.id }) })),
]);
const modelOptions = computed<CustomSelectOption[]>(() => models.value.map((model) => ({
  value: `${model.provider}\u0000${model.id}`,
  label: `${model.name || model.id} [${model.provider}]`,
})));
const apiKeyProviderOptions = computed<CustomSelectOption[]>(() => apiKeyProviders.value.map((provider) => ({
  value: provider.envVar,
  label: `${provider.label} (${provider.envVar})${provider.configured ? ` — ${t('components.profileManagerDialog.configured')}` : ''}`,
})));
const selectedApiKeyProvider = computed(() => apiKeyProviders.value.find((provider) => provider.envVar === apiKeyProvider.value));
const configuredApiKeyCount = computed(() => apiKeyProviders.value.filter((provider) => provider.configured).length);
const autoRenameLanguageOptions: CustomSelectOption[] = [
  { value: 'english', label: t('components.profileManagerDialog.english') },
  { value: 'chinese', label: t('components.profileManagerDialog.chinese') },
];
const localLlmPresets = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmStudio: 'http://127.0.0.1:1234/v1',
  llamaCpp: 'http://127.0.0.1:8080/v1',
} as const;
const localLlmPresetOptions: CustomSelectOption[] = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'lmStudio', label: 'LM Studio' },
  { value: 'llamaCpp', label: 'llama.cpp' },
  { value: 'custom', label: t('components.profileManagerDialog.customOpenAiCompatible') },
];

function profileUrl(id: string, suffix: string = ''): string {
  return `/api/sessions/agent-profiles/${encodeURIComponent(id)}${suffix}`;
}

function resetProxy(): void {
  Object.assign(proxy, { ALL_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '' });
}

function resetSaveState(): void {
  defaultModel.value = '';
  automationModel.value = '';
  autoRenameLanguage.value = 'english';
  savingSettings.value = false;
  settingsSaved.value = false;
  checkingProxy.value = false;
  proxyCheckResult.value = '';
  apiKeyProviders.value = [];
  apiKeyProvider.value = '';
  apiKey.value = '';
  savingApiKey.value = false;
  removingApiKey.value = false;
  apiKeySaved.value = false;
  apiKeyRemoved.value = false;
  localLlmPreset.value = 'ollama';
  localLlmBaseUrl.value = localLlmPresets.ollama;
  localModels.value = [];
  selectedLocalModelIds.value = [];
  discoveringLocalModels.value = false;
  savingLocalLlm.value = false;
  removingLocalLlm.value = false;
  localLlmSaved.value = false;
  localLlmRemoved.value = false;
  error.value = '';
}

function applyProxy(savedProxy: Record<string, string>): void {
  const allProxy = savedProxy.ALL_PROXY
    || savedProxy.all_proxy
    || savedProxy.HTTP_PROXY
    || savedProxy.http_proxy
    || savedProxy.HTTPS_PROXY
    || savedProxy.https_proxy
    || '';
  Object.assign(proxy, {
    ALL_PROXY: allProxy,
    HTTP_PROXY: allProxy,
    HTTPS_PROXY: allProxy,
    NO_PROXY: savedProxy.NO_PROXY || savedProxy.no_proxy || '',
  });
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

async function select(id: string): Promise<void> {
  managedProfileId.value = id;
  creatingProfile.value = false;
  resetProxy();
  resetSaveState();
  models.value = [];

  const [proxyResponse, modelsResponse, automationResponse, autoRenameResponse, apiKeyProvidersResponse, localLlmResponse] = await Promise.all([
    fetch(profileUrl(id, '/proxy')),
    fetch(profileUrl(id, '/models')),
    fetch(profileUrl(id, '/automation-model')),
    fetch(profileUrl(id, '/auto-rename')),
    fetch(profileUrl(id, '/api-key-providers')),
    fetch(profileUrl(id, '/local-llm')),
  ]);
  if (proxyResponse.ok) {
    const data = await proxyResponse.json() as { proxy?: Record<string, string> };
    applyProxy(data.proxy || {});
  }
  if (modelsResponse.ok) {
    const data = await modelsResponse.json() as { models?: ModelOption[] };
    models.value = data.models || [];
    const current = models.value.find((model) => model.current);
    if (current) defaultModel.value = `${current.provider}\u0000${current.id}`;
  }
  if (automationResponse.ok) {
    const data = await automationResponse.json() as { model?: { provider?: string; modelId?: string } };
    if (data.model?.provider && data.model.modelId) automationModel.value = `${data.model.provider}\u0000${data.model.modelId}`;
  }
  if (autoRenameResponse.ok) {
    const data = await autoRenameResponse.json() as {
      config?: { language?: 'english' | 'chinese' };
    };
    autoRenameLanguage.value = data.config?.language === 'chinese' ? 'chinese' : 'english';
  }
  if (apiKeyProvidersResponse.ok) {
    const data = await apiKeyProvidersResponse.json() as { providers?: ApiKeyProvider[] };
    apiKeyProviders.value = data.providers || [];
    apiKeyProvider.value = apiKeyProviders.value.find((provider) => provider.configured)?.envVar
      || apiKeyProviders.value[0]?.envVar
      || '';
  }
  if (localLlmResponse.ok) {
    const data = await localLlmResponse.json() as { config?: { baseUrl?: string; modelIds?: string[] } };
    if (data.config?.baseUrl) {
      localLlmBaseUrl.value = data.config.baseUrl;
      localLlmPreset.value = Object.entries(localLlmPresets).find(([, url]) => url === data.config?.baseUrl)?.[0] || 'custom';
    }
    selectedLocalModelIds.value = data.config?.modelIds || [];
    localModels.value = selectedLocalModelIds.value.map((modelId) => ({ id: modelId }));
  }
}

function applyLocalLlmPreset(preset: string): void {
  if (preset in localLlmPresets) {
    localLlmBaseUrl.value = localLlmPresets[preset as keyof typeof localLlmPresets];
  }
  localLlmSaved.value = false;
  localLlmRemoved.value = false;
}

async function discoverLocalModels(): Promise<void> {
  if (!localLlmBaseUrl.value.trim()) return;
  error.value = '';
  localLlmSaved.value = false;
  localLlmRemoved.value = false;
  discoveringLocalModels.value = true;
  try {
    const response = await fetch(profileUrl(managedProfileId.value, '/local-llm/discover'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: localLlmBaseUrl.value }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, t('components.profileManagerDialog.failedToDiscoverLocalModels')));
    const data = await response.json() as { models?: LocalModel[] };
    localModels.value = data.models || [];
    selectedLocalModelIds.value = localModels.value.map((model) => model.id);
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToDiscoverLocalModels');
  } finally {
    discoveringLocalModels.value = false;
  }
}

async function saveLocalLlm(): Promise<void> {
  if (!localLlmBaseUrl.value.trim() || selectedLocalModelIds.value.length === 0) return;
  error.value = '';
  localLlmSaved.value = false;
  savingLocalLlm.value = true;
  try {
    const response = await fetch(profileUrl(managedProfileId.value, '/local-llm'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: localLlmBaseUrl.value, modelIds: selectedLocalModelIds.value }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, t('components.profileManagerDialog.failedToSaveLocalLlm')));
    const data = await response.json() as { config?: { baseUrl?: string; modelIds?: string[] } };
    localLlmBaseUrl.value = data.config?.baseUrl || localLlmBaseUrl.value;
    selectedLocalModelIds.value = data.config?.modelIds || selectedLocalModelIds.value;
    localLlmSaved.value = true;

    const modelsResponse = await fetch(profileUrl(managedProfileId.value, '/models'));
    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json() as { models?: ModelOption[] };
      models.value = modelsData.models || [];
    }
    emit('updated');
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToSaveLocalLlm');
  } finally {
    savingLocalLlm.value = false;
  }
}

async function removeLocalLlm(): Promise<void> {
  error.value = '';
  localLlmSaved.value = false;
  localLlmRemoved.value = false;
  removingLocalLlm.value = true;
  try {
    const response = await fetch(profileUrl(managedProfileId.value, '/local-llm'), { method: 'DELETE' });
    if (!response.ok) throw new Error(await readErrorMessage(response, t('components.profileManagerDialog.failedToRemoveLocalLlm')));
    localLlmPreset.value = 'ollama';
    localLlmBaseUrl.value = localLlmPresets.ollama;
    localModels.value = [];
    selectedLocalModelIds.value = [];
    models.value = models.value.filter((model) => model.provider !== 'pi-webui-local');
    if (defaultModel.value.startsWith('pi-webui-local\u0000')) defaultModel.value = '';
    if (automationModel.value.startsWith('pi-webui-local\u0000')) automationModel.value = '';
    localLlmRemoved.value = true;
    emit('updated');
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToRemoveLocalLlm');
  } finally {
    removingLocalLlm.value = false;
  }
}

async function saveApiKey(): Promise<void> {
  if (!apiKeyProvider.value || !apiKey.value.trim()) return;
  error.value = '';
  apiKeySaved.value = false;
  apiKeyRemoved.value = false;
  savingApiKey.value = true;

  try {
    const response = await fetch(profileUrl(managedProfileId.value, '/api-key'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVar: apiKeyProvider.value, apiKey: apiKey.value }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, t('components.profileManagerDialog.failedToSaveApiKey')));
    const data = await response.json() as { providers?: ApiKeyProvider[] };
    apiKeyProviders.value = data.providers || apiKeyProviders.value;
    apiKey.value = '';
    apiKeySaved.value = true;

    const modelsResponse = await fetch(profileUrl(managedProfileId.value, '/models'));
    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json() as { models?: ModelOption[] };
      models.value = modelsData.models || [];
      const current = models.value.find((model) => model.current);
      if (current) defaultModel.value = `${current.provider}\u0000${current.id}`;
    }
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToSaveApiKey');
  } finally {
    savingApiKey.value = false;
  }
}

async function removeApiKey(): Promise<void> {
  if (!apiKeyProvider.value) return;
  error.value = '';
  apiKeySaved.value = false;
  apiKeyRemoved.value = false;
  removingApiKey.value = true;
  try {
    const suffix = `/api-key/${encodeURIComponent(apiKeyProvider.value)}`;
    const response = await fetch(profileUrl(managedProfileId.value, suffix), { method: 'DELETE' });
    if (!response.ok) throw new Error(await readErrorMessage(response, t('components.profileManagerDialog.failedToRemoveApiKey')));
    const data = await response.json() as { providers?: ApiKeyProvider[] };
    apiKeyProviders.value = data.providers || apiKeyProviders.value;
    apiKey.value = '';
    apiKeyRemoved.value = true;

    const modelsResponse = await fetch(profileUrl(managedProfileId.value, '/models'));
    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json() as { models?: ModelOption[] };
      models.value = modelsData.models || [];
      if (!models.value.some((model) => `${model.provider}\u0000${model.id}` === defaultModel.value)) defaultModel.value = '';
    }
    emit('updated');
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToRemoveApiKey');
  } finally {
    removingApiKey.value = false;
  }
}

function openCreate(): void {
  creatingProfile.value = true;
  name.value = '';
  copySettingsFrom.value = '';
  error.value = '';
}

async function create(): Promise<void> {
  creating.value = true;
  error.value = '';

  try {
    const response = await fetch('/api/sessions/agent-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value, copySettingsFrom: copySettingsFrom.value || undefined }),
    });
    const data = await response.json() as { error?: string; profile?: Profile };
    if (!response.ok || !data.profile) throw new Error(data.error || t('components.profileManagerDialog.failedToCreateProfile'));

    creatingProfile.value = false;
    emit('created', data.profile.id);
    await select(data.profile.id);
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToCreateProfile');
  } finally {
    creating.value = false;
  }
}

async function saveSettings(): Promise<void> {
  const [defaultProvider, defaultModelId] = defaultModel.value.split('\u0000');
  const [automationProvider, automationModelId] = automationModel.value.split('\u0000');
  error.value = '';
  settingsSaved.value = false;
  savingSettings.value = true;

  try {
    const responses = await Promise.all([
      fetch(profileUrl(managedProfileId.value, '/default-model'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: defaultProvider, modelId: defaultModelId }),
      }),
      fetch(profileUrl(managedProfileId.value, '/automation-model'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: automationProvider, modelId: automationModelId }),
      }),
      fetch(profileUrl(managedProfileId.value, '/auto-rename'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: autoRenameLanguage.value }),
      }),
      fetch(profileUrl(managedProfileId.value, '/proxy'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Keep protocol-specific variables populated for tools that ignore ALL_PROXY.
        body: JSON.stringify({
          proxy: {
            ...proxy,
            HTTP_PROXY: proxy.ALL_PROXY,
            HTTPS_PROXY: proxy.ALL_PROXY,
          },
        }),
      }),
    ]);
    const [defaultResponse, automationResponse, autoRenameResponse, proxyResponse] = responses;
    if (!defaultResponse.ok) throw new Error(await readErrorMessage(defaultResponse, t('components.profileManagerDialog.failedToSaveDefaultModel')));
    if (!automationResponse.ok) throw new Error(await readErrorMessage(automationResponse, t('components.profileManagerDialog.failedToSaveAutomationModel')));
    if (!autoRenameResponse.ok) throw new Error(await readErrorMessage(autoRenameResponse, t('components.profileManagerDialog.failedToSaveAutoRenameSettings')));
    if (!proxyResponse.ok) throw new Error(await readErrorMessage(proxyResponse, t('components.profileManagerDialog.failedToSaveProxySettings')));

    models.value = models.value.map((model) => ({ ...model, current: model.provider === defaultProvider && model.id === defaultModelId }));
    settingsSaved.value = true;
    emit('updated');
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToSaveSettings');
  } finally {
    savingSettings.value = false;
  }
}

async function checkProxy(): Promise<void> {
  error.value = '';
  proxyCheckResult.value = '';
  checkingProxy.value = true;

  try {
    const response = await fetch(profileUrl(managedProfileId.value, '/proxy/check'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proxy: {
          ...proxy,
          HTTP_PROXY: proxy.ALL_PROXY,
          HTTPS_PROXY: proxy.ALL_PROXY,
        },
      }),
    });
    if (!response.ok) throw new Error(await readErrorMessage(response, t('components.profileManagerDialog.failedToCheckProxy')));
    const data = await response.json() as { ok?: boolean };
    proxyCheckResult.value = data.ok ? 'ok' : 'failed';
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : t('components.profileManagerDialog.failedToCheckProxy');
  } finally {
    checkingProxy.value = false;
  }
}

async function deleteProfile(): Promise<void> {
  const id = managedProfileId.value;
  const response = await fetch(profileUrl(id), { method: 'DELETE' });
  const data = await response.json() as Partial<DeleteResult> & { error?: string };
  if (!response.ok) {
    error.value = data.error || t('components.profileManagerDialog.failedToDeleteProfile');
    return;
  }

  deleteConfirm.value = false;
  managedProfileId.value = '';
  emit('deleted', { id, activeProfileChanged: Boolean(data.activeProfileChanged) });
}

watch(apiKeyProvider, () => {
  apiKey.value = '';
  apiKeySaved.value = false;
  apiKeyRemoved.value = false;
});

watch([defaultModel, automationModel, autoRenameLanguage, proxy], () => {
  settingsSaved.value = false;
  proxyCheckResult.value = '';
});

watch(() => props.visible, (visible) => {
  if (visible && props.selectedId) void select(props.selectedId);
});
</script>
<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(5px);
}
.profile-manager {
  width: min(720px, calc(100vw - 2rem));
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}
header {
  display: flex;
  flex: none;
  justify-content: space-between;
  padding: 1.25rem;
  border-bottom: 1px solid var(--border);
}
h2,
h3 {
  margin: 0;
}
header p,
.profile-help {
  color: var(--text-secondary);
  font-size: 0.82rem;
  margin: 0.35rem 0 0;
}
main {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.profile-manager-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.75rem;
  overflow-y: auto;
  border-right: 1px solid var(--border);
}
.profile-manager-list button {
  display: block;
  width: 100%;
  padding: 0.7rem;
  text-align: left;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}
.profile-manager-list button.active,
.profile-manager-list button:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}
.create-profile-link {
  margin-top: auto;
  border-top: 1px solid var(--border);
  border-radius: 0 !important;
  padding-top: 1rem !important;
  color: var(--accent) !important;
}
small {
  display: block;
  margin-top: 0.2rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-manager-form {
  min-width: 0;
  padding: 1.25rem;
  overflow-y: auto;
}
.profile-manager-form input {
  display: block;
  width: 100%;
  margin: 0.55rem 0;
  padding: 0.6rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}
.profile-manager-form :deep(.custom-select) {
  margin: 0.55rem 0;
}
.profile-manager-form h3 + .profile-help {
  margin-bottom: 1.2rem;
}
.profile-manager-form h3:not(:first-child) {
  margin-top: 1.4rem;
}
.profile-collapsible {
  margin-top: 1rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}
.profile-collapsible summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  cursor: pointer;
  list-style: none;
  transition: background 0.15s ease;
}
.profile-collapsible summary::-webkit-details-marker {
  display: none;
}
.profile-collapsible summary:hover {
  background: var(--bg-surface);
}
.profile-collapsible summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.profile-section-heading {
  min-width: 0;
  flex: 1;
}
.profile-section-heading strong {
  display: block;
  font-size: 0.95rem;
}
.profile-section-heading small {
  margin-top: 0.2rem;
  color: var(--text-secondary);
  font-size: 0.76rem;
  line-height: 1.35;
}
.profile-section-status {
  flex: none;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}
.profile-section-chevron {
  flex: none;
  color: var(--text-secondary);
  font-size: 1.35rem;
  line-height: 1;
  transform: rotate(90deg);
  transition: transform 0.15s ease;
}
.profile-collapsible[open] .profile-section-chevron {
  transform: rotate(-90deg);
}
.profile-collapsible-content {
  padding: 0 1rem 1rem;
  border-top: 1px solid var(--border);
}
.profile-collapsible-content > :first-child {
  margin-top: 1rem;
}
.profile-key-actions,
.profile-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}
.profile-key-actions .profile-success {
  margin: 0;
}
.local-model-list {
  display: grid;
  gap: 0.45rem;
  max-height: 12rem;
  margin: 1rem 0 0;
  padding: 0.75rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.local-model-list label {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}
.profile-manager-form .local-model-list input {
  width: auto;
  margin: 0;
}
.local-model-list span {
  overflow-wrap: anywhere;
}
.profile-remove-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
}
.profile-remove-button {
  border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--border));
  background: transparent;
  color: var(--danger);
}
.profile-primary {
  background: var(--accent);
  color: white;
}
.profile-secondary {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-primary);
}
.profile-check-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.profile-check-ok {
  color: var(--success);
  font-weight: 700;
}
.profile-check-failed {
  color: var(--error);
  font-weight: 700;
}
.profile-delete {
  margin-left: auto;
  color: var(--danger);
  font-size: 0.82rem;
}
.profile-error {
  color: var(--error);
  margin-top: 0.75rem;
}
.profile-success {
  color: var(--success);
  font-size: 0.82rem;
  margin: 0.55rem 0 0;
}
@media (max-width: 600px) {
  .settings-backdrop {
    padding: 0.5rem;
  }
  .profile-manager {
    max-height: calc(100vh - 1rem);
  }
  main {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .profile-manager-list,
  .profile-manager-form {
    overflow: visible;
  }
  .profile-manager-list {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>
