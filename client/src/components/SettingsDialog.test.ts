import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from './SettingsDialog.vue';
import { setLocale } from '../i18n';

enableAutoUnmount(afterEach);

const SkillPresetsPanelStub = {
  props: {
    presets: Array,
    availableSkills: Array,
  },
  template: '<section class="skill-presets-panel-stub">Skill presets</section>',
};

const SecurityPanelStub = {
  props: {
    totpEnabled: Boolean,
    embedded: Boolean,
  },
  emits: ['updated'],
  template: `
    <section class="security-panel-stub">
      <span>Security body</span>
      <span class="totp-state">{{ totpEnabled ? 'enabled' : 'disabled' }}</span>
      <span class="embedded-state">{{ embedded ? 'embedded' : 'standalone' }}</span>
      <button class="emit-updated" @click="$emit('updated')">updated</button>
    </section>
  `,
};

const FolderPickerModalStub = {
  props: {
    visible: Boolean,
    initialPath: String,
    clientId: String,
    title: String,
    showClone: Boolean,
  },
  emits: ['close', 'select'],
  template: `
    <section v-if="visible" class="folder-picker-stub">
      <span class="folder-picker-title">{{ title }}</span>
      <span class="folder-picker-client-id">{{ clientId }}</span>
      <span class="folder-picker-show-clone">{{ showClone ? 'clone' : 'browse-only' }}</span>
      <button class="select-folder" @click="$emit('select', { path: '/workspace/project-b' })">Select folder</button>
    </section>
  `,
};

function mountSettingsDialog(props = {}) {
  return mount(SettingsDialog, {
    props: {
      visible: true,
      totpEnabled: false,
      showHintInfo: true,
      showCodeBlockLanguageHeaders: true,
      streamingMessageBehavior: 'steer',
      editorAutoRefresh: false,
      ...props,
    },
    global: { stubs: { SecurityPanel: SecurityPanelStub, SkillPresetsPanel: SkillPresetsPanelStub, FolderPickerModal: FolderPickerModalStub, Teleport: true } },
  });
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
  });

  afterEach(() => {
    setLocale('en');
    vi.restoreAllMocks();
  });
  it('does not render when hidden', () => {
    const wrapper = mountSettingsDialog({ visible: false });

    expect(wrapper.find('.settings-dialog').exists()).toBe(false);
  });

  it('shows only user prompt customization for commit messages', async () => {
    const wrapper = mountSettingsDialog({ projectPath: '/workspace/pi-cloud' });
    const gitButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Git'))!;

    await gitButton.trigger('click');

    const promptSettings = wrapper.find('.commit-prompt-settings');
    expect(promptSettings.text()).not.toContain('System prompt');
    expect(promptSettings.findAll('textarea')).toHaveLength(2);
  });

  it('renders the security menu and embedded security body when visible', async () => {
    const wrapper = mountSettingsDialog({ totpEnabled: true });

    expect(wrapper.find('.settings-dialog').exists()).toBe(true);
    // Click Security to show security panel
    const securityButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Security'))!;
    await securityButton.trigger('click');
    expect(wrapper.find('.settings-menu-item.active').text()).toContain('Security');
    expect(wrapper.find('.security-panel-stub').text()).toContain('Security body');
    expect(wrapper.find('.totp-state').text()).toBe('enabled');
    expect(wrapper.find('.embedded-state').text()).toBe('embedded');
  });

  it('emits close from close button but not backdrop click', async () => {
    const wrapper = mountSettingsDialog();

    await wrapper.find('.settings-backdrop').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    await wrapper.find('.settings-close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('forwards security updated events', async () => {
    const wrapper = mountSettingsDialog();

    // Click Security to show security panel
    const securityButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Security'))!;
    await securityButton.trigger('click');

    await wrapper.find('.emit-updated').trigger('click');

    expect(wrapper.emitted('updated')).toHaveLength(1);
  });

  it('switches between General, Security, and Chat sections from the sidebar', async () => {
    const wrapper = mountSettingsDialog();

    // Default is General
    expect(wrapper.find('.settings-body-header').text()).toContain('General');
    expect(wrapper.find('.display-settings').exists()).toBe(true);

    const securityButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Security'))!;
    await securityButton.trigger('click');

    expect(wrapper.find('.settings-menu-item.active').text()).toContain('Security');
    expect(wrapper.find('.settings-body-header').text()).toContain('Account security');
    expect(wrapper.find('.security-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.display-settings').exists()).toBe(false);

    const chatButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Chat'))!;
    await chatButton.trigger('click');

    expect(wrapper.find('.settings-menu-item.active').text()).toContain('Chat');
    expect(wrapper.find('.settings-body-header').text()).toContain('Chat behavior');
    expect(wrapper.find('.streaming-behavior-settings').exists()).toBe(true);
    expect(wrapper.find('.display-settings').exists()).toBe(false);
  });

  it('shows a Skills section in settings and renders the preset panel', async () => {
    const wrapper = mountSettingsDialog({
      availableSkills: [{ name: 'systematic-debugging', description: '...' }],
      skillPresets: [{ id: 'preset-1', name: 'debug', mode: 'enabled', skills: ['systematic-debugging'] }],
    });

    const skillsButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Skills'))!;
    await skillsButton.trigger('click');

    expect(wrapper.find('.skill-presets-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.settings-body-header').text()).toContain('Skill presets');
  });

  it('loads and saves project commit message prompt overrides', async () => {
    const promptConfiguration = {
      global: { userPrompt: 'Global user' },
      project: { userPrompt: 'Project user' },
      effective: { userPrompt: 'Project user' },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => promptConfiguration } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => promptConfiguration } as Response);
    const wrapper = mountSettingsDialog({ projectPath: '/workspace/project-a' });

    const gitButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Git'))!;
    await gitButton.trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('.commit-prompt-textarea')).toHaveLength(2));

    expect((wrapper.findAll('.commit-prompt-textarea')[1].element as HTMLTextAreaElement).value).toBe('Project user');
    await wrapper.findAll('.commit-prompt-textarea')[1].setValue('Project title only');
    await wrapper.findAll('.commit-prompt-scope')[1].find('button').trigger('click');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect(fetch).toHaveBeenLastCalledWith('/api/git/commit-message-prompts', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        cwd: '/workspace/project-a',
        scope: 'project',
        userPrompt: 'Project title only',
      }),
    }));
  });

  it('lists the task queue keyboard shortcut', async () => {
    const wrapper = mountSettingsDialog();

    const keyboardButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Keyboard'))!;
    await keyboardButton.trigger('click');

    expect(wrapper.find('.keyboard-shortcut-list').text()).toContain('Ctrl + Q');
    expect(wrapper.find('.keyboard-shortcut-list').text()).toContain('Toggle the task queue.');
  });

  it('renders general settings and emits hint info changes', async () => {
    const wrapper = mountSettingsDialog({ showHintInfo: false });

    // General is now the default tab
    expect(wrapper.find('.settings-menu').text()).toContain('General');
    expect(wrapper.find('.hint-info-toggle').exists()).toBe(true);
    expect((wrapper.find('.hint-info-toggle').element as HTMLInputElement).checked).toBe(false);

    await wrapper.find('.hint-info-toggle').setValue(true);

    expect(wrapper.emitted('update:showHintInfo')).toEqual([[true]]);
  });

  it('renders general settings and emits code block language header changes', async () => {
    const wrapper = mountSettingsDialog({ showCodeBlockLanguageHeaders: false });

    // General is the default tab, no need to click
    expect(wrapper.find('.code-language-headers-toggle').exists()).toBe(true);
    expect((wrapper.find('.code-language-headers-toggle').element as HTMLInputElement).checked).toBe(false);

    await wrapper.find('.code-language-headers-toggle').setValue(true);

    expect(wrapper.emitted('update:showCodeBlockLanguageHeaders')).toEqual([[true]]);
  });

  it('renders language settings and emits language changes', async () => {
    const wrapper = mountSettingsDialog({ language: 'en' });

    const languageSelect = wrapper.find('#settings-language-select');
    expect(languageSelect.exists()).toBe(true);
    expect(languageSelect.text()).toContain('English');

    await languageSelect.trigger('click');
    await wrapper.findAll('.custom-select-option').find((option) => option.text().includes('简体中文'))!.trigger('click');

    expect(wrapper.emitted('update:language')).toEqual([['zh-CN']]);
  });

  it('updates rendered settings when the active locale changes', async () => {
    const wrapper = mountSettingsDialog({ language: 'en' });

    setLocale('zh-CN');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('#settings-title').text()).toBe('设置');
    expect(wrapper.find('#language-settings-title').text()).toBe('语言');
    expect(wrapper.find('.language-settings').text()).toContain('选择界面显示语言');
  });

  it('renders chat floating button settings and emits changes', async () => {
    const wrapper = mountSettingsDialog({ showGoToTopButton: false, showChatViewOptionsButton: true });

    const chatButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Chat'))!;
    await chatButton.trigger('click');

    expect((wrapper.find('.go-to-top-toggle').element as HTMLInputElement).checked).toBe(false);
    expect((wrapper.find('.chat-view-options-toggle').element as HTMLInputElement).checked).toBe(true);

    await wrapper.find('.go-to-top-toggle').setValue(true);
    await wrapper.find('.chat-view-options-toggle').setValue(false);

    expect(wrapper.emitted('update:showGoToTopButton')).toEqual([[true]]);
    expect(wrapper.emitted('update:showChatViewOptionsButton')).toEqual([[false]]);
  });

  it('renders display setting and emits streaming message behavior changes', async () => {
    const wrapper = mountSettingsDialog({ streamingMessageBehavior: 'steer' });

    const chatButton = wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Chat'))!;
    await chatButton.trigger('click');

    const streamingSelect = wrapper.find('#settings-streaming-behavior-select');
    expect(streamingSelect.exists()).toBe(true);
    expect(streamingSelect.text()).toContain('Steer');

    await streamingSelect.trigger('click');
    await wrapper.findAll('.custom-select-option').find((option) => option.text().startsWith('Follow-up'))!.trigger('click');

    expect(wrapper.emitted('update:streamingMessageBehavior')).toEqual([['followUp']]);
  });

  it('uses one Git save button and emits only dirty Git fields', async () => {
    const wrapper = mountSettingsDialog({ giteaServerUrl: 'https://git.example.com', githubProxyUrl: 'http://old.proxy:7890' });

    await wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Git'))!.trigger('click');
    expect(wrapper.findAll('.git-save-btn')).toHaveLength(1);
    expect(wrapper.findAll('button').filter((button) => button.text().includes('Save'))).toHaveLength(1);

    const inputs = wrapper.findAll('.git-settings input');
    await inputs[0].setValue('https://git.changed.com');
    await inputs[5].setValue('http://new.proxy:7890');
    await wrapper.find('.git-save-btn').trigger('click');

    expect(wrapper.emitted('saveGitSettings')).toEqual([[{
      gitea: { serverUrl: 'https://git.changed.com', token: '' },
      githubProxyUrl: 'http://new.proxy:7890',
    }]]);
  });

  it('prompts before closing with unsaved Git changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = mountSettingsDialog({ giteaServerUrl: 'https://git.example.com' });

    await wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Git'))!.trigger('click');
    await wrapper.find('.git-settings input').setValue('https://dirty.example.com');
    await wrapper.find('.settings-close').trigger('click');

    expect(confirm).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('shows persisted WeChat pairing status in gateway settings', async () => {
    const wrapper = mountSettingsDialog();
    const viewModel = wrapper.vm as unknown as {
      activeSection: string;
      weixinGatewayStatus: { enabled: boolean; running: boolean; paired: boolean; accountId: string };
    };

    viewModel.activeSection = 'gateway';
    viewModel.weixinGatewayStatus = { enabled: true, running: false, paired: true, accountId: 'bot***123' };
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.weixin-status-badge').text()).toBe('Paired');
    expect(wrapper.find('[aria-label="WeChat pairing status"]').text()).toContain('Paired as bot***123.');
    expect(wrapper.find('.weixin-pairing-settings').text()).toContain('Env flagEnabled');
    expect(wrapper.find('.weixin-pairing-note').text()).toBe('The gateway starts automatically after successful pairing.');
    expect(wrapper.findAll('button').find((button) => button.text().includes('Pair again'))?.exists()).toBe(true);

    viewModel.weixinGatewayStatus.enabled = false;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.weixin-pairing-note').text()).toBe('Pairing saves the account credentials. To start the gateway, set PI_CLOUD_WECHAT_GATEWAY_ENABLED=true and restart Pi Cloud.');
  });

  it('unbinds a persisted WeChat account through the custom confirmation modal', async () => {
    const wrapper = mountSettingsDialog();
    const viewModel = wrapper.vm as unknown as {
      activeSection: string;
      weixinGatewayStatus: { enabled: boolean; running: boolean; paired: boolean; accountId?: string };
    };

    viewModel.activeSection = 'gateway';
    viewModel.weixinGatewayStatus = { enabled: true, running: true, paired: true, accountId: 'bot***123' };
    await wrapper.vm.$nextTick();

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      pairing: { status: 'idle' },
      status: { enabled: true, running: false, paired: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await wrapper.find('.weixin-unpair-action').trigger('click');

    expect(wrapper.find('.confirm-modal').text()).toContain('Unbind WeChat account?');
    expect(wrapper.find('.confirm-modal').text()).toContain('This removes the saved account credentials and stops the gateway.');
    expect(fetchMock).not.toHaveBeenCalled();

    await wrapper.find('.confirm-modal .btn-confirm').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.weixin-status-badge').text()).toBe('Not paired'));

    expect(fetchMock).toHaveBeenCalledWith('/api/gateways/weixin/pairing', expect.objectContaining({ method: 'DELETE' }));
    expect(wrapper.find('.weixin-unpair-action').exists()).toBe(false);
  });

  it('configures WeCom in the gateway wizard and reveals callback credentials', async () => {
    const wrapper = mountSettingsDialog();
    const viewModel = wrapper.vm as unknown as {
      activeSection: string;
      wecomGatewayStatus: { configured: boolean; managedBy: string; allowedUsers: string[]; callbackVerified: boolean };
    };
    viewModel.activeSection = 'gateway';
    viewModel.wecomGatewayStatus = { configured: false, managedBy: 'none', allowedUsers: [], callbackVerified: false };
    await wrapper.vm.$nextTick();

    await wrapper.find('.wecom-corp-id').setValue('corp-1');
    await wrapper.find('.wecom-agent-id').setValue('1000002');
    await wrapper.find('.wecom-corp-secret').setValue('app-secret');
    await wrapper.find('.wecom-allowed-users').setValue('alice, bob');
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      status: { configured: true, managedBy: 'database', corpId: 'corp-1', agentId: '1000002', allowedUsers: ['alice', 'bob'], callbackVerified: false },
      callbackToken: 'generated-token',
      encodingAesKey: 'generated-aes-key',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await wrapper.find('.wecom-save-action').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('.wecom-generated-secrets').exists()).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith('/api/gateways/wecom/configuration', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ corpId: 'corp-1', corpSecret: 'app-secret', agentId: '1000002', allowedUsers: ['alice', 'bob'] }),
    }));
    expect(wrapper.find('.wecom-generated-secrets').text()).toContain('generated-token');
    expect(wrapper.find('.wecom-generated-secrets').text()).toContain('generated-aes-key');
    expect((wrapper.find('.wecom-callback-url').element as HTMLInputElement).value).toContain('/api/gateways/wecom/callback');
  });

  it('adds and removes gateway working directories with the folder picker', async () => {
    const wrapper = mountSettingsDialog({
      clientId: 'client-1',
      gatewayCwds: ['/workspace/project-a'],
    });

    await wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Gateway'))!.trigger('click');

    expect(wrapper.find('.gateway-cwds-input').exists()).toBe(false);
    expect(wrapper.find('.gateway-cwd-row').text()).toContain('/workspace/project-a');

    await wrapper.find('.gateway-add-folder-btn').trigger('click');
    expect(wrapper.find('.folder-picker-stub').exists()).toBe(true);
    expect(wrapper.find('.folder-picker-title').text()).toBe('Add gateway folder');
    expect(wrapper.find('.folder-picker-client-id').text()).toBe('client-1');
    expect(wrapper.find('.folder-picker-show-clone').text()).toBe('browse-only');

    await wrapper.find('.select-folder').trigger('click');
    expect(wrapper.findAll('.gateway-cwd-row').map((row) => row.text()).join('\n')).toContain('/workspace/project-b');

    await wrapper.findAll('.gateway-remove-cwd-btn')[0].trigger('click');
    await wrapper.find('.gateway-save-btn').trigger('click');

    expect(wrapper.emitted('saveGatewaySettings')).toEqual([[{
      cwds: ['/workspace/project-b'],
      defaultProfile: '',
      defaultSkillset: '',
      defaultModelProvider: '',
      defaultModelId: '',
    }]]);
  });

  it('shows the GitHub proxy test result and country', async () => {
    const wrapper = mountSettingsDialog({ githubProxyCheckResult: 'ok', githubProxyCountry: 'US' });

    await wrapper.findAll('.settings-menu-item').find((button) => button.text().includes('Git'))!.trigger('click');

    expect(wrapper.find('.git-proxy-check-button').text()).toContain('✓ US');
    expect(wrapper.find('.git-check-ok').exists()).toBe(true);
  });
});
