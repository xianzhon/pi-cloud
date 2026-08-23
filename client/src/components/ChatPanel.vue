<!-- client/src/components/ChatPanel.vue -->
<template>
  <div class="chat-workspace">
    <section class="chat-panel discussion-pane">
    <div class="messages-shell">
      <div
        class="messages"
        ref="messagesRef"
        tabindex="0"
        @keydown="handleMessagesKeydown"
      >
        <div
          v-for="(msg, index) in visibleMessages"
          :key="messageKey(msg)"
          class="message-block"
          :class="{ 'is-selected': selectedMessageIndex === index }"
          tabindex="-1"
          :aria-current="selectedMessageIndex === index ? 'true' : undefined"
          @click="selectMessageBlock(index)"
        >
          <MessageBubble
            :message="msg"
            :hideThinkingBlock="hideThinkingBlock"
            :showHintInfo="showHintInfo"
            :showCodeBlockLanguageHeaders="showCodeBlockLanguageHeaders"
            :expandThinkingByDefault="isStreaming"
            :showDetails="showDetails"
            @annotate="handleAnnotateImage"
            @openGitCommit="handleOpenGitCommit"
          />
        </div>
        <div v-if="isStreaming" class="streaming-indicator" role="status" aria-live="polite">
          <span class="streaming-spinner" aria-hidden="true">
            <span v-for="dot in 6" :key="dot" class="streaming-spinner-dot"></span>
          </span>
          <span class="streaming-copy">
            <span class="streaming-label">{{ streamingStatusLabel }}</span>
            <span class="streaming-elapsed">{{ formattedStreamingElapsed }}</span>
          </span>
        </div>
      </div>

      <div
        v-if="showGoToTopButton || showChatViewOptionsButton"
        class="floating-chat-controls"
        @mouseleave="closeViewOptions"
        @focusout="closeViewOptions"
      >
        <div v-if="showChatViewOptionsButton && showViewOptions" class="view-options-popover" role="menu" :aria-label="t('components.chatPanel.chatViewOptions')">
          <button
            type="button"
            class="details-toggle-btn view-option-row"
            role="menuitemcheckbox"
            :aria-checked="showDetails"
            @click="showDetails = !showDetails"
          >
            <span><PhListChecks v-if="showDetails" :size="14" /><PhListDashes v-else :size="14" /> {{ t('components.chatPanel.details') }}</span>
            <strong>{{ showDetails ? t('components.chatPanel.shown') : t('components.chatPanel.hidden') }}</strong>
          </button>
          <button
            type="button"
            class="thinking-toggle-btn view-option-row"
            role="menuitemcheckbox"
            :aria-checked="!hideThinkingBlock"
            @click="toggleThinking"
          >
            <span><PhLightbulb :size="14" weight="duotone" /> {{ t('components.chatPanel.thinking') }}</span>
            <strong>{{ hideThinkingBlock ? t('components.chatPanel.hidden') : t('components.chatPanel.shown') }}</strong>
          </button>
          <button
            type="button"
            class="export-pdf-btn view-option-row"
            role="menuitem"
            :disabled="!canExportPdf || isExportingPdf"
            :title="exportPdfError || ''"
            @click="handleExportPdf"
          >
            <span><PhDownloadSimple :size="14" weight="bold" /> {{ t('components.chatPanel.exportPDF') }}</span>
            <strong>{{ isExportingPdf ? t('components.chatPanel.exporting') : exportPdfError ? t('components.chatPanel.failed') : t('components.chatPanel.download') }}</strong>
          </button>
        </div>
        <div class="floating-button-row">
          <button
            v-if="showGoToTopButton"
            type="button"
            class="go-to-top-btn floating-chat-btn tooltip"
            :data-tooltip="t('components.chatPanel.goToTop')"
            :aria-label="t('components.chatPanel.goToTop')"
            @click="scrollMessagesToTop"
          >
            <PhArrowUp :size="20" weight="bold" />
          </button>
          <button
            v-if="showChatViewOptionsButton"
            type="button"
            class="view-options-toggle-btn floating-chat-btn tooltip"
            :data-tooltip="t('components.chatPanel.chatViewOptions')"
            :aria-label="t('components.chatPanel.chatViewOptions')"
            :aria-expanded="showViewOptions"
            @mouseenter="openViewOptions"
            @focus="openViewOptions"
            @click="toggleViewOptions"
          >
            <PhEye :size="20" weight="bold" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="isReviewMode" class="input-area">
      <div
        class="input-resize-handle"
        :class="{ 'is-resizing': inputResizeStartY !== null }"
        role="separator"
        :aria-label="t('components.chatPanel.resizeMessageInput')"
        aria-orientation="horizontal"
        :title="t('components.chatPanel.dragToResizeMessageInput')"
        @pointerdown="handleInputResizeStart"
        @pointermove="handleInputResizeMove"
        @pointerup="handleInputResizeEnd"
        @pointercancel="handleInputResizeEnd"
        @lostpointercapture="handleInputResizeEnd"
      ></div>
      <FileSearchMenu
        v-if="fileSearch.isOpen.value"
        :files="fileSearch.suggestions.value"
        :activeIndex="fileSearch.state.value.activeIndex"
        :isLoading="fileSearch.state.value.isLoading"
        :query="fileSearch.state.value.query"
        :isOpen="fileSearch.isOpen.value"
        @select="insertFileReference"
      />
      <div class="composer-shell">
        <textarea
          ref="inputRef"
          v-model="inputText"
          @input="handleInput"
          @click="handleCaretChange"
          @keyup="handleCaretChange"
          @keydown="handleInputKeydown"
          @focus="handleInputFocus"
          :placeholder="t('components.chatPanel.reviewFileSearchPlaceholder')"
          rows="1"
          id="chat-input"
          name="chat-input"
        ></textarea>
      </div>
      <div class="mobile-trigger-btns">
        <button class="trigger-btn" @click="insertTrigger('@')" type="button">@</button>
      </div>
      <div class="composer-actions">
        <button class="send-btn review-clear-btn" :disabled="!inputText" @click="clearReviewInput">
          {{ t('components.chatPanel.clear') }}
        </button>
      </div>
    </div>
    <div v-else class="input-area">
      <div
        class="input-resize-handle"
        :class="{ 'is-resizing': inputResizeStartY !== null }"
        role="separator"
        :aria-label="t('components.chatPanel.resizeMessageInput')"
        aria-orientation="horizontal"
        :title="t('components.chatPanel.dragToResizeMessageInput')"
        @pointerdown="handleInputResizeStart"
        @pointermove="handleInputResizeMove"
        @pointerup="handleInputResizeEnd"
        @pointercancel="handleInputResizeEnd"
        @lostpointercapture="handleInputResizeEnd"
      ></div>
      <SlashCommandMenu
        v-if="slashCommands.isOpen.value"
        :commands="slashCommands.suggestions.value"
        :activeIndex="slashCommands.activeIndex.value"
        @select="insertSlashCommand"
      />
      <FileSearchMenu
        v-if="fileSearch.isOpen.value"
        :files="fileSearch.suggestions.value"
        :activeIndex="fileSearch.state.value.activeIndex"
        :isLoading="fileSearch.state.value.isLoading"
        :query="fileSearch.state.value.query"
        :isOpen="fileSearch.isOpen.value"
        @select="insertFileReference"
      />
      <div
        class="composer-shell"
        :class="{ 'drag-over': isDraggingImages }"
        @dragenter.prevent="handleImageDrag"
        @dragover.prevent="handleImageDrag"
        @dragleave="handleDragLeave"
        @drop.prevent="handleImageDrop"
      >
        <div v-if="attachments.length" class="attachment-tray" :aria-label="t('components.chatPanel.attachedImages')">
          <div v-for="attachment in attachments" :key="attachment.id" class="attachment-item">
            <img
              :src="attachment.previewUrl"
              :alt="attachment.name"
              :title="t('components.chatPanel.doubleClickToEnlarge')"
              @dblclick="openAttachmentPreview(attachment)"
            />
            <span class="attachment-details">
              <strong>{{ attachment.name }}</strong>
              <small>{{ formatFileSize(attachment.size) }}</small>
            </span>
            <button type="button" class="attachment-remove" :aria-label="t('components.chatPanel.removeAttachment', { name: attachment.name })" @click="removeAttachment(attachment.id)">
              <PhX :size="14" weight="bold" />
            </button>
          </div>
        </div>
        <p v-if="attachmentError" class="attachment-error" role="alert">{{ attachmentError }}</p>
        <p v-if="promptPolishError" class="prompt-polish-error" role="alert">{{ promptPolishError }}</p>
        <p v-if="imagesBlocked" class="attachment-model-warning" role="alert">
          {{ t('components.chatPanel.thisModelCanTReadImagesSwitch') }}
          <button type="button" class="switch-model-btn" @click="openModelSelector()">{{ t('components.chatPanel.switchModel') }}</button>
        </p>
        <textarea
          ref="inputRef"
          v-model="inputText"
          @input="handleInput"
          @click="handleCaretChange"
          @keyup="handleCaretChange"
          @keydown="handleInputKeydown"
          @focus="handleInputFocus"
          @paste="handleImagePaste"
          :placeholder="t('components.chatPanel.typeAMessage')"
          rows="1"
          :disabled="false"
          id="chat-input"
          name="chat-input"
        ></textarea>
        <div class="composer-meta-row">
          <span class="composer-hint">{{ t('components.chatPanel.enterSendsShiftEnterForNewlineCtrl') }}</span>
          <button
            type="button"
            class="prompt-polish-btn tooltip tooltip-above"
            :disabled="!canPolishPrompt"
            :data-tooltip="promptPolishTooltip"
            :aria-label="t('components.chatPanel.polishPrompt')"
            @click="polishPrompt"
          >
            <PhMagicWand :size="16" :weight="isPolishingPrompt ? 'fill' : 'regular'" />
          </button>
          <button type="button" class="attach-image-btn tooltip tooltip-above" :aria-label="t('components.chatPanel.attachImages')" :data-tooltip="t('components.chatPanel.attachImages')" @click="imageInputRef?.click()">
            <PhImage :size="16" />
          </button>
          <button type="button" class="attach-image-btn mobile-camera-btn tooltip tooltip-above" :aria-label="t('components.chatPanel.takePhoto')" :data-tooltip="t('components.chatPanel.takePhoto')" @click="cameraInputRef?.click()">
            <PhCamera :size="16" />
          </button>
          <input
            ref="imageInputRef"
            class="image-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            @change="handleImageInput"
          />
          <input
            ref="cameraInputRef"
            class="image-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            @change="handleImageInput"
          />
          <button
            type="button"
            class="composer-skill-selector tooltip tooltip-above"
            :disabled="(!sessionId || !clientId) && !configureNewSession"
            :data-tooltip="sessionId && clientId ? t('components.chatPanel.configureSkills') : t('components.chatPanel.openASessionToConfigureSkills')"
            :aria-label="t('components.chatPanel.configureSkills')"
            @click="handleSkillSelectorClick"
          >
            <span class="composer-selector-label">{{ composerSkillLabel }}</span>
          </button>
          <button
            type="button"
            class="composer-model-selector tooltip tooltip-above"
            :disabled="(!sessionId || !clientId) && !configureNewSession"
            :data-tooltip="sessionId && clientId ? t('components.chatPanel.changeModel') : t('components.chatPanel.openASessionToChangeTheModel')"
            :aria-label="t('components.chatPanel.changeModel')"
            @click="handleModelSelectorClick"
          >
            <span class="composer-selector-label">{{ composerModelLabel }}</span>
          </button>
          <button
            v-if="sessionStatus?.model?.reasoning && thinkingLevels.length"
            type="button"
            class="composer-thinking-selector tooltip tooltip-above"
            :disabled="!sessionId || !clientId || isStreaming || thinkingLevelChanging"
            :aria-label="t('components.chatPanel.changeThinkingLevel')"
            :data-tooltip="t('components.chatPanel.changeThinkingLevel')"
            @click="openThinkingSelector"
          >
            <span class="composer-selector-label">{{ sessionStatus.thinkingLevel || 'Thinking' }}</span>
          </button>
          <span v-if="composerContextText" class="composer-context">{{ composerContextText }}</span>
        </div>
      </div>
      <div class="mobile-trigger-btns">
        <button class="trigger-btn" @click="insertTrigger('/')" type="button">/</button>
        <button class="trigger-btn" @click="insertTrigger('@')" type="button">@</button>
        <button
          class="trigger-btn fullscreen-trigger-btn"
          type="button"
          :aria-label="fullscreen ? t('components.chatPanel.exitFullscreen') : t('components.chatPanel.enterFullscreen')"
          :title="fullscreen ? t('components.chatPanel.exitFullscreen') : t('components.chatPanel.enterFullscreen')"
          @click="emit('toggleFullscreen')"
        >
          <PhCornersIn v-if="fullscreen" :size="18" weight="bold" />
          <PhCornersOut v-else :size="18" weight="bold" />
        </button>
        <button class="trigger-btn trigger-btn-clear" :disabled="!inputText" @click="inputText = ''; resizeInput()" type="button">✕</button>
      </div>
      <div class="composer-actions">
        <button 
          class="send-btn" 
          @click="handleSend"
          :disabled="isPreparingSession || !hasDraftContent || imagesBlocked"
        >
          {{ isPreparingSession ? '...' : t('components.chatPanel.send') }}
        </button>
        <button
          v-if="isStreaming"
          class="stop-btn"
          @click="abort"
          :disabled="isPreparingSession"
        >
          {{ t('components.chatPanel.stop') }}
        </button>
      </div>
    </div>
    <SessionTreeModal
      v-if="treeModalOpen && sessionId && clientId"
      :sessionId="sessionId"
      :clientId="clientId"
      @close="treeModalOpen = false"
      @navigated="handleTreeNavigated"
    />
    <ConfirmModal
      :visible="Boolean(commitPreview)"
      :hideIcon="true"
      :confirmText="commitDialogConfirmText"
      :cancelText="t('components.chatPanel.cancel')"
      variant="primary"
      initialFocus="none"
      @confirm="confirmCommit"
      @cancel="cancelCommit"
    >
      <template #title>{{ commitDialogTitle }}</template>
      <template #message>
        <div v-if="commitPreview" class="commit-preview">
          <div class="pr-ai-row">
            <label class="commit-preview-label" for="commit-message-input">{{ t('components.chatPanel.message') }}</label>
            <button
              type="button"
              class="stop-btn pr-ai-generate-btn"
              :disabled="commitGeneratingMessage"
              :title="props.clientId ? t('components.chatPanel.generateCommitMessageWithAi') : t('components.chatPanel.openASessionToGenerateACommitMessage')"
              @click="generateCommitMessage"
            >
              <PhRobot :size="16" weight="bold" aria-hidden="true" />
              <span>{{ commitGeneratingMessage ? t('components.chatPanel.generating') : t('components.chatPanel.aiGenerate') }}</span>
            </button>
          </div>
          <textarea
            id="commit-message-input"
            ref="commitMessageInputRef"
            v-model="commitPreview.message"
            class="commit-message-input"
            rows="3"
            :placeholder="t('components.chatPanel.commitMessage')"
          ></textarea>
          <label v-if="commitPreview.mode === 'commit'" class="branch-checkbox-row commit-staged-only">
            <input v-model="commitStagedOnly" type="checkbox" @change="refreshCommitFiles" />
            <span>{{ t('components.chatPanel.stagedChangesOnly') }}</span>
          </label>
          <div class="commit-preview-label">{{ t('components.chatPanel.files') }}</div>
          <ul v-if="commitPreview.files.length" class="commit-file-list">
            <li v-for="file in commitPreview.files" :key="`${file.status}:${file.path}`">
              <span class="commit-file-status">{{ file.status }}</span>
              <span>{{ file.path }}</span>
            </li>
          </ul>
          <p v-else class="commit-preview-empty">{{ t('components.chatPanel.noWorkingTreeChangesOnlyThePrevious') }}</p>
          <p v-if="commitGenerationError" class="model-selector-empty error">{{ commitGenerationError }}</p>
        </div>
      </template>
    </ConfirmModal>
    <ConfirmModal
      :visible="Boolean(prPreview)"
      :hide-icon="true"
      :confirmText="t('components.chatPanel.createPr')"
      :cancelText="t('components.chatPanel.cancel')"
      variant="primary"
      initialFocus="none"
      @confirm="confirmPr"
      @cancel="cancelPr"
    >
      <template #title>{{ t('components.chatPanel.createPullRequest') }}</template>
      <template #message>
        <div v-if="prPreview" class="commit-preview">
          <div class="commit-preview-label">{{ t('components.chatPanel.targetBranch') }}</div>
          <CustomSelect
            id="pr-target-branch-select"
            v-model="prPreview.targetBranch"
            :options="prTargetBranchOptions"
            placeholder="main"
            :aria-label="t('components.chatPanel.targetBranch')"
            :disabled="prUpdatingTargetBranch"
            @update:modelValue="updatePrTargetBranch"
          />
          <p v-if="prUpdatingTargetBranch" class="branch-dialog-hint">{{ t('components.chatPanel.updatingPRPreviewForTargetBranch') }}</p>
          <div class="pr-ai-row">
            <label class="commit-preview-label" for="pr-title-input">{{ t('components.chatPanel.prTitle') }}</label>
            <button
              type="button"
              class="stop-btn pr-ai-generate-btn"
              :disabled="prGeneratingContent"
              :title="props.clientId ? t('components.chatPanel.generatePrTitleAndBodyWithAi') : t('components.chatPanel.openASessionToGeneratePrContentWith')"
              @click="generatePrContent"
            >
              <PhRobot :size="16" weight="bold" aria-hidden="true" />
              <span>{{ prGeneratingContent ? t('components.chatPanel.generating') : t('components.chatPanel.aiGenerate') }}</span>
            </button>
          </div>
          <input id="pr-title-input" v-model="prPreview.title" class="commit-message-input" />
          <label class="commit-preview-label" for="pr-body-input">{{ t('components.chatPanel.prBody') }}</label>
          <textarea id="pr-body-input" v-model="prPreview.body" class="commit-message-input" rows="8"></textarea>
          <p v-if="prGenerationError" class="model-selector-empty error">{{ prGenerationError }}</p>
        </div>
      </template>
    </ConfirmModal>
    <Teleport to="body">
      <div v-if="skillSelectorOpen" class="model-selector-backdrop">
        <div class="model-selector-modal skill-selector-modal" role="dialog" aria-modal="true" :aria-label="t('components.chatPanel.configureSessionSkills')">
          <header class="model-selector-header">
            <div>
              <h3>{{ t('components.chatPanel.configureSkills') }}</h3>
              <p>{{ t('components.chatPanel.chooseWhichSkillsAreAvailableToThis') }}</p>
            </div>
            <DialogCloseButton :label="t('components.chatPanel.cancel')" @click="closeSkillSelector" />
          </header>
          <div class="skill-mode-options">
            <label class="skill-mode-option">
              <input v-model="skillMode" type="radio" value="all" />
              <span><strong>{{ t('components.chatPanel.allSkills') }}</strong><small>{{ t('components.chatPanel.useEverySkillFromTheSelectedAgent') }}</small></span>
            </label>
            <label class="skill-mode-option">
              <input v-model="skillMode" type="radio" value="enabled" />
              <span><strong>{{ t('components.chatPanel.onlySelectedEnabled') }}</strong><small>{{ t('components.chatPanel.makeOnlyCheckedSkillsAvailable') }}</small></span>
            </label>
            <label class="skill-mode-option">
              <input v-model="skillMode" type="radio" value="disabled" />
              <span><strong>{{ t('components.chatPanel.selectedDisabled') }}</strong><small>{{ t('components.chatPanel.useAllSkillsExceptCheckedSkills') }}</small></span>
            </label>
          </div>
          <div v-if="skillSelectorLoading" class="model-selector-empty">{{ t('components.chatPanel.loadingSkills') }}</div>
          <div v-else-if="skillSelectorError" class="model-selector-empty error">{{ skillSelectorError }}</div>
          <SkillPicker
            v-else
            v-model="selectedSkills"
            :skills="skillOptions"
            :class="{ 'skill-picker-muted': skillMode === 'all' }"
          />
          <footer class="skill-selector-actions">
            <button type="button" class="stop-btn" @click="closeSkillSelector">{{ t('components.chatPanel.cancel') }}</button>
            <button type="button" class="send-btn" :disabled="skillSelectorSaving || skillSelectorLoading" @click="saveSkillConfiguration">
              {{ skillSelectorSaving ? t('components.chatPanel.saving') : t('components.chatPanel.saveSkills') }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="branchDialogOpen" class="model-selector-backdrop">
        <div class="model-selector-modal branch-dialog-modal" role="dialog" aria-modal="true" :aria-label="t('components.chatPanel.gitBranch')">
          <header class="model-selector-header">
            <div>
              <h3>{{ t('components.chatPanel.gitBranch') }}</h3>
              <p>{{ t('components.chatPanel.switchBranchesOrCreateABranchFor') }}</p>
            </div>
            <DialogCloseButton :label="t('components.chatPanel.cancel')" @click="closeBranchDialog" />
          </header>
          <div class="skill-mode-options">
            <label class="skill-mode-option">
              <input v-model="branchDialogMode" type="radio" value="switch" />
              <span><strong>{{ t('components.chatPanel.switchToBranch') }}</strong><small>{{ t('components.chatPanel.checkoutAnExistingLocalBranch') }}</small></span>
            </label>
            <label class="skill-mode-option">
              <input v-model="branchDialogMode" type="radio" value="changes" />
              <span><strong>{{ t('components.chatPanel.createBranchForCurrentChanges') }}</strong><small>{{ t('components.chatPanel.nameItYourselfOrAskAITo') }}</small></span>
            </label>
            <label class="skill-mode-option">
              <input v-model="branchDialogMode" type="radio" value="base" />
              <span><strong>{{ t('components.chatPanel.createFromBaseBranch') }}</strong><small>{{ t('components.chatPanel.selectABaseBranchThenNameThe') }}</small></span>
            </label>
          </div>
          <div v-if="branchDialogLoading" class="model-selector-empty">{{ t('components.chatPanel.loadingBranches') }}</div>
          <div v-else class="branch-dialog-fields">
            <template v-if="branchDialogMode === 'switch'">
              <label class="commit-preview-label">{{ t('components.chatPanel.branch') }}</label>
              <CustomSelect id="branch-switch-select" v-model="branchSwitchName" :options="branchSelectOptions" :placeholder="t('components.chatPanel.selectABranch')" :aria-label="t('components.chatPanel.branch')" searchable :search-placeholder="t('components.chatPanel.searchBranches')" @update:model-value="rememberBranchSelection" />
              <label class="branch-checkbox-row">
                <input v-model="branchPullAfterSwitch" type="checkbox" />
                <span>{{ t('components.chatPanel.run') }} <code>git pull --ff-only</code> {{ t('components.chatPanel.afterSwitching') }}</span>
              </label>
              <label class="branch-checkbox-row">
                <input v-model="branchDeleteOriginal" type="checkbox" />
                <span>{{ t('components.chatPanel.deleteTheOriginalLocalBranchAfterSwitching') }}</span>
              </label>
            </template>
            <template v-else>
              <label v-if="branchDialogMode === 'base'" class="commit-preview-label">{{ t('components.chatPanel.baseBranch') }}</label>
              <CustomSelect v-if="branchDialogMode === 'base'" id="branch-base-select" v-model="branchBaseName" :options="branchSelectOptions" :placeholder="t('components.chatPanel.selectABaseBranch')" :aria-label="t('components.chatPanel.baseBranch')" searchable :search-placeholder="t('components.chatPanel.searchBranches')" @update:model-value="rememberBranchSelection" />
              <label class="commit-preview-label" for="branch-new-name">{{ t('components.chatPanel.newBranchName') }}</label>
              <div class="branch-name-row">
                <input id="branch-new-name" v-model="branchNewName" class="model-search-input" placeholder="feature/my-task" />
                <button type="button" class="stop-btn pr-ai-generate-btn" :disabled="branchGeneratingName || !branchHasChanges" :title="branchHasChanges ? t('components.chatPanel.generateFromStagedAndUnstagedChanges') : t('components.chatPanel.noStagedOrUnstagedChangesToGenerateFrom')" @click="generateBranchDialogName">
                  <PhRobot :size="16" weight="bold" aria-hidden="true" />
                  <span>{{ branchGeneratingName ? t('components.chatPanel.generating') : t('components.chatPanel.aiGenerate') }}</span>
                </button>
              </div>
              <p v-if="!branchHasChanges" class="branch-dialog-hint">{{ t('components.chatPanel.noStagedOrUnstagedChangesToGenerate') }}</p>
            </template>
          </div>
          <p v-if="branchDialogError" class="model-selector-empty error">{{ branchDialogError }}</p>
          <footer class="skill-selector-actions">
            <button type="button" class="stop-btn" @click="closeBranchDialog">{{ t('components.chatPanel.cancel') }}</button>
            <button type="button" class="send-btn" :disabled="branchDialogSubmitting" @click="submitBranchDialog">
              {{ branchDialogSubmitting ? t('components.chatPanel.working') : branchDialogActionLabel }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="modelSelectorOpen" class="model-selector-backdrop">
        <div class="model-selector-modal model-selector-dialog" role="dialog" aria-modal="true" :aria-label="t('components.chatPanel.selectModel')">
          <header class="model-selector-header">
            <div>
              <h3>{{ t('components.chatPanel.selectModel') }}</h3>
              <p>{{ t('components.chatPanel.chooseTheActiveModelForThisSession') }}</p>
            </div>
            <DialogCloseButton :label="t('components.chatPanel.cancel')" @click="closeModelSelector" />
          </header>
          <input
            ref="modelSearchRef"
            v-model="modelSearch"
            class="model-search-input"
            type="search"
            @keydown="handleModelSearchKeydown"
            :placeholder="t('components.chatPanel.searchModelsOrProviders')"
          />
          <div v-if="modelSelectorLoading" class="model-selector-empty">{{ t('components.chatPanel.loadingModels') }}</div>
          <div v-else-if="modelSelectorError" class="model-selector-empty error">{{ modelSelectorError }}</div>
          <div v-else ref="modelListRef" class="model-list" role="listbox" :aria-label="t('components.chatPanel.models')">
            <button
              v-for="(model, index) in filteredModels"
              :key="`${model.provider}:${model.id}`"
              type="button"
              class="model-option"
              :class="{ current: model.current, 'keyboard-active': index === activeModelIndex }"
              role="option"
              :aria-selected="index === activeModelIndex"
              @click="selectModel(model)"
            >
              <span class="model-option-main">
                <span class="model-name-row">
                  <span class="model-name">{{ model.name || model.id }}</span>
                  <span v-if="model.input?.includes('image')" class="model-capability">{{ t('components.chatPanel.images') }}</span>
                </span>
                <span class="model-id">{{ model.id }} [{{ model.provider }}]</span>
              </span>
              <span v-if="model.current" class="model-current">✓</span>
            </button>
            <div v-if="filteredModels.length === 0" class="model-selector-empty">{{ t('components.chatPanel.noMatchingModels') }}</div>
          </div>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="attachmentPreview"
        class="message-image-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="attachmentPreview.name"
        @click.self="closeAttachmentPreview"
      >
        <button
          type="button"
          class="message-image-lightbox-close"
          :aria-label="t('components.chatPanel.closeImagePreview')"
          @click="closeAttachmentPreview"
        >
          ×
        </button>
        <img
          class="message-image-lightbox-image"
          :src="attachmentPreview.previewUrl"
          :alt="attachmentPreview.name"
        />
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-if="thinkingSelectorOpen" class="model-selector-backdrop" @click.self="closeThinkingSelector">
        <div class="model-selector-modal thinking-selector-modal" role="dialog" aria-modal="true" :aria-label="t('components.chatPanel.selectThinkingLevel')">
          <header class="model-selector-header">
            <div>
              <h3>{{ t('components.chatPanel.selectThinkingLevel') }}</h3>
              <p>{{ t('components.chatPanel.chooseHowMuchReasoningTheModelShould') }}</p>
            </div>
            <DialogCloseButton :label="t('components.chatPanel.cancel')" @click="closeThinkingSelector" />
          </header>
          <div class="model-list" role="listbox" :aria-label="t('components.chatPanel.thinkingLevels')">
            <button
              v-for="level in thinkingLevels"
              :key="level"
              type="button"
              class="model-option"
              :class="{ current: level === sessionStatus?.thinkingLevel }"
              role="option"
              :aria-selected="level === sessionStatus?.thinkingLevel"
              @click="selectThinkingLevel(level)"
            >
              <span class="model-option-main">
                <span class="model-name">{{ level }}</span>
                <span class="model-id">{{ t('components.chatPanel.reasoningEffort') }}</span>
              </span>
              <span v-if="level === sessionStatus?.thinkingLevel" class="model-current">✓</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    </section>
  </div>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useChat, type ChatImage, type MessageMemoryRecall } from '../composables/useChat';
import { replaceSlashToken, useSlashCommands } from '../composables/useSlashCommands';
import { useFileSearch, replaceFileToken } from '../composables/useFileSearch';
import { useGitHosting, type GitHostingPrPreview } from '../composables/useGitHosting';
import type { SlashCommandItem } from '../types/slashCommands';
import type { FileSearchResult } from '../types/fileSearch';
import { PhArrowUp, PhCamera, PhCornersIn, PhCornersOut, PhDownloadSimple, PhEye, PhImage, PhLightbulb, PhListChecks, PhListDashes, PhMagicWand, PhRobot, PhX } from '@phosphor-icons/vue';
import MessageBubble from './MessageBubble.vue';
import SlashCommandMenu from './SlashCommandMenu.vue';
import FileSearchMenu from './FileSearchMenu.vue';
import ConfirmModal from './ConfirmModal.vue';
import DialogCloseButton from './DialogCloseButton.vue';
import SessionTreeModal from './SessionTreeModal.vue';
import SkillPicker from './SkillPicker.vue';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';
import type { AvailableSkill } from '../composables/useAvailableSkills';
import { exportSessionPdf, hasExportableMessages } from '../utils/sessionPdfExport';
import { getReviewTranscript } from '../services/reviewSourceService';
import type { ReviewSessionTranscript } from '../types/reviewSource';

const t = i18n.global.t;

const {
  messages,
  isStreaming,
  hideThinkingBlock,
  addLocalMessage,
  sendMessage,
  abort,
  toggleThinking,
  setViewedSession,
  loadSessionHistory,
  clearMessages,
} = useChat();
const gitHosting = useGitHosting();

const props = withDefaults(defineProps<{
  sessionId?: string;
  clientId?: string;
  projectPath?: string;
  sessionTitle?: string;
  ensureSession?: (targetSessionId?: string, initialMessage?: string) => Promise<string | undefined>;
  createInheritedSession?: (sourceSessionId: string, initialMessage: string) => Promise<string | undefined>;
  configureNewSession?: () => void;
  showHintInfo?: boolean;
  showCodeBlockLanguageHeaders?: boolean;
  modelInfo?: string;
  showGoToTopButton?: boolean;
  showChatViewOptionsButton?: boolean;
  fullscreen?: boolean;
  reviewSourceId?: string;
  reviewSessionId?: string;
}>(), {
  projectPath: '~',
  showHintInfo: true,
  showCodeBlockLanguageHeaders: true,
  showGoToTopButton: true,
  showChatViewOptionsButton: true,
  fullscreen: false,
});

const emit = defineEmits<{ branchChanged: []; toggleFullscreen: []; }>();

interface CommitStatusFile {
  path: string;
  status: string;
}

interface CommitPreview {
  cwd: string;
  message: string;
  files: CommitStatusFile[];
  mode: 'commit' | 'amend';
}

type BranchDialogMode = 'switch' | 'changes' | 'base';
type GitSyncCommand = 'push' | 'pull';

interface ModelOption {
  provider: string;
  id: string;
  name?: string;
  current?: boolean;
  input?: string[];
}

interface PendingAttachment extends ChatImage {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
}

type SkillMode = 'all' | 'enabled' | 'disabled';

interface SessionSkillConfiguration {
  skills?: AvailableSkill[];
  policy?: {
    mode?: SkillMode;
    appliedSkills?: string[];
  };
}

interface ChatLocalMessage {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'status';
  status?: 'pending' | 'success' | 'failure' | 'info';
  title?: string;
  memory?: MessageMemoryRecall;
}

interface ReviewVisibleMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind: 'text' | 'tool_call' | 'tool_result';
  status?: 'pending' | 'success' | 'failure';
  title?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  timestamp?: number;
}

interface SummaryGeneratedDetail {
  sessionId?: string | null;
  content?: string;
}

interface SessionRuntimeStatus {
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
    tokens?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
    cost?: number;
  };
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

interface SessionCommandInfo {
  name?: string;
  workDir?: string;
  model?: {
    provider?: string;
    id?: string;
  };
  stats: {
    sessionFile?: string;
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
    cost: number;
  };
}

const inputText = ref('');
const attachments = ref<PendingAttachment[]>([]);
const attachmentPreview = ref<PendingAttachment | null>(null);
const attachmentError = ref('');
const isDraggingImages = ref(false);
const isPolishingPrompt = ref(false);
const promptPolishError = ref('');
const sessionStatus = ref<SessionRuntimeStatus | null>(null);
const selectedMessageIndex = ref(0);
const reviewTranscript = ref<ReviewSessionTranscript | null>(null);
let reviewTranscriptRequestId = 0;
const isReviewMode = computed(() => Boolean(props.reviewSourceId && props.reviewSessionId));
const showDetails = ref(false);
const showViewOptions = ref(false);
const isExportingPdf = ref(false);
const exportPdfError = ref('');
const isPreparingSession = ref(false);
const thinkingLevelChanging = ref(false);
const commitPreview = ref<CommitPreview | null>(null);
const commitStatusMessage = ref<ChatLocalMessage | null>(null);
const commitGeneratingMessage = ref(false);
const commitGenerationError = ref('');
const commitStagedOnly = ref(false);
const prPreview = ref<GitHostingPrPreview | null>(null);
const prStatusMessage = ref<ChatLocalMessage | null>(null);
const prGeneratingContent = ref(false);
const prUpdatingTargetBranch = ref(false);
const prGenerationError = ref('');
const branchDialogOpen = ref(false);
const branchDialogMode = ref<BranchDialogMode>('switch');
const branchDialogLoading = ref(false);
const branchDialogSubmitting = ref(false);
const branchGeneratingName = ref(false);
const branchDialogError = ref('');
const branchOptions = ref<string[]>([]);
const branchHasChanges = ref(false);
const branchSwitchName = ref('');
const branchBaseName = ref('');
const branchNewName = ref('');
const branchPullAfterSwitch = ref(false);
const branchDeleteOriginal = ref(true);
const modelSelectorOpen = ref(false);
const thinkingSelectorOpen = ref(false);
const BRANCH_SELECTION_STORAGE_KEY = 'pi-webui:last-branch-selection';

function branchSelectionStorageKey(): string {
  return `${BRANCH_SELECTION_STORAGE_KEY}:${props.projectPath || '~'}`;
}
const skillSelectorOpen = ref(false);
const treeModalOpen = ref(false);
const modelSelectorLoading = ref(false);
const skillSelectorLoading = ref(false);
const skillSelectorSaving = ref(false);
const modelSelectorError = ref('');
const skillSelectorError = ref('');
const modelOptions = ref<ModelOption[]>([]);
const skillOptions = ref<AvailableSkill[]>([]);
const selectedSkills = ref<string[]>([]);
const skillMode = ref<SkillMode>('all');
const skillConfigurationLoaded = ref(false);
const modelSearch = ref('');
const activeModelIndex = ref(-1);
const inputRef = ref<HTMLTextAreaElement>();
const imageInputRef = ref<HTMLInputElement>();
const cameraInputRef = ref<HTMLInputElement>();
const commitMessageInputRef = ref<HTMLTextAreaElement>();
const modelSearchRef = ref<HTMLInputElement>();
const modelListRef = ref<HTMLElement>();
const messagesRef = ref<HTMLElement>();
const streamingStartedAt = ref<number | null>(null);
const streamingElapsedSeconds = ref(0);
let streamingElapsedTimerId: number | undefined;
let isUnmounted = false;
const slashCommands = useSlashCommands();
const fileSearch = useFileSearch(() => props.projectPath);
const MAX_INPUT_HEIGHT = 276;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AUTO_SCROLL_BOTTOM_THRESHOLD = 32;
const SESSION_SUMMARY_PROMPT = `Please summarize the current session for handoff to a new chat and for note-taking.

Include:
- The user's overall goal and current status
- Important decisions, assumptions, and constraints
- Files, commands, APIs, or components discussed or changed
- Problems encountered and how they were resolved
- Open questions and recommended next steps

Keep it concise but detailed enough that a new session can continue the work without reading the full transcript. Do not use tools.`;

const COMPOSING_TOOL_NAMES = new Set(['bash', 'edit', 'write']);

const formattedStreamingElapsed = computed(() => formatElapsedTime(streamingElapsedSeconds.value));
const hasDraftContent = computed(() => Boolean(inputText.value.trim()) || attachments.value.length > 0);
const canPolishPrompt = computed(() => Boolean(props.clientId && inputText.value.trim() && !isPolishingPrompt.value));
const promptPolishTooltip = computed(() => {
  if (isPolishingPrompt.value) return t('components.chatPanel.polishingPrompt');
  if (!props.clientId) return t('components.chatPanel.openASessionToPolishPrompts');
  if (!inputText.value.trim()) return t('components.chatPanel.typeAPromptToPolish');
  return t('components.chatPanel.polishPrompt');
});
const modelSupportsImages = computed(() => sessionStatus.value?.model?.input?.includes('image') === true);
const imagesBlocked = computed(() => attachments.value.length > 0 && !modelSupportsImages.value);
const streamingStatusLabel = computed(() => getStreamingStatusLabel());

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getStreamingStatusLabel(): string {
  const latestAssistantMessage = [...messages.value].reverse().find((message) => message.role === 'assistant');

  if (!latestAssistantMessage) return 'Thinking';
  if (latestAssistantMessage.hasTextContent) return 'Composing';
  if ((latestAssistantMessage.kind === 'tool_call' || latestAssistantMessage.kind === 'tool_result') && isComposingTool(latestAssistantMessage.toolName)) {
    return 'Composing';
  }

  return 'Thinking';
}

function isComposingTool(toolName?: string): boolean {
  if (!toolName) return false;
  return COMPOSING_TOOL_NAMES.has(toolName.toLowerCase());
}

function updateStreamingElapsed(): void {
  const startedAt = streamingStartedAt.value;
  if (startedAt === null) {
    streamingElapsedSeconds.value = 0;
    return;
  }

  streamingElapsedSeconds.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function clearStreamingElapsedTimer(): void {
  if (streamingElapsedTimerId === undefined) return;

  window.clearInterval(streamingElapsedTimerId);
  streamingElapsedTimerId = undefined;
}

function startStreamingElapsedTimer(): void {
  clearStreamingElapsedTimer();
  if (streamingStartedAt.value === null) {
    streamingStartedAt.value = Date.now();
  }
  updateStreamingElapsed();
  streamingElapsedTimerId = window.setInterval(updateStreamingElapsed, 1000);
}

function stopStreamingElapsedTimer(): void {
  clearStreamingElapsedTimer();
  streamingStartedAt.value = null;
}

function isMessagesScrolledNearBottom(threshold = AUTO_SCROLL_BOTTOM_THRESHOLD): boolean {
  const container = messagesRef.value;
  if (!container) return true;

  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

const inputHeightStorageKey = 'pi-webui-message-input-height';
const inputResizeStartY = ref<number | null>(null);
let inputResizeStartHeight = 0;
let userInputHeight = loadInputHeight();

function loadInputHeight(): number | null {
  try {
    const height = Number(sessionStorage.getItem(inputHeightStorageKey));
    return height >= 24 && height <= MAX_INPUT_HEIGHT ? height : null;
  } catch {
    return null;
  }
}

function resizeInput() {
  const input = inputRef.value;
  if (!input) return;

  input.style.height = 'auto';
  const nextHeight = Math.min(Math.max(input.scrollHeight, userInputHeight || 0), MAX_INPUT_HEIGHT);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > nextHeight ? 'auto' : 'hidden';
}

function handleInputResizeStart(event: PointerEvent) {
  const input = inputRef.value;
  if (!input) return;

  event.preventDefault();
  inputResizeStartY.value = event.clientY;
  inputResizeStartHeight = input.offsetHeight;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  window.addEventListener('blur', stopInputResize);
}

function handleInputResizeMove(event: PointerEvent) {
  const input = inputRef.value;
  if (!input || inputResizeStartY.value === null) return;

  const height = Math.min(Math.max(inputResizeStartHeight + inputResizeStartY.value - event.clientY, 24), MAX_INPUT_HEIGHT);
  userInputHeight = height;
  input.style.height = `${height}px`;
  input.style.overflowY = input.scrollHeight > height ? 'auto' : 'hidden';
}

function stopInputResize() {
  if (inputResizeStartY.value === null) return;

  inputResizeStartY.value = null;
  window.removeEventListener('blur', stopInputResize);
  if (userInputHeight !== null) {
    try {
      sessionStorage.setItem(inputHeightStorageKey, String(userInputHeight));
    } catch {
      // Keep the height for this component instance when storage is unavailable.
    }
  }
}

function handleInputResizeEnd(event: PointerEvent) {
  stopInputResize();
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}

interface FocusInputOptions {
  prefix?: string;
}

function focusInput(options: FocusInputOptions = {}) {
  const input = inputRef.value;
  if (!input) return;

  selectedMessageIndex.value = -1;
  input.focus();
  if (!options.prefix) return;

  const start = input.selectionStart ?? inputText.value.length;
  const end = input.selectionEnd ?? start;
  inputText.value = inputText.value.slice(0, start) + options.prefix + inputText.value.slice(end);

  nextTick(() => {
    input.setSelectionRange(start + options.prefix!.length, start + options.prefix!.length);
    handleInput();
  });
}

function messageKey(message: { id: string }): string {
  return `${props.sessionId || 'draft'}:${message.id}`;
}

function focusMessagesEnd() {
  const blocks = messagesRef.value?.querySelectorAll<HTMLElement>('.message-block');
  if (!blocks?.length) {
    messagesRef.value?.focus();
    return;
  }

  selectedMessageIndex.value = blocks.length - 1;
  const activeBlock = blocks[selectedMessageIndex.value];
  activeBlock?.focus({ preventScroll: true });
  activeBlock?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function resizeInputAfterDomUpdate() {
  await nextTick();
  resizeInput();
}

function openViewOptions() {
  showViewOptions.value = true;
}

function closeViewOptions() {
  showViewOptions.value = false;
}

function toggleViewOptions() {
  showViewOptions.value = !showViewOptions.value;
}

function scrollMessagesToTop() {
  const container = messagesRef.value;
  if (!container) return;

  container.scrollTo({ top: 0, behavior: 'smooth' });
}

function hasOnlyBoldSummary(message: { content: string; thinking?: string }): boolean {
  const content = (message.thinking || message.content).trim();
  const summaryOnlyPattern = /\*\*(.+?)\*\*(?:\s*<!--\s*-->)?/g;
  return Boolean(content.match(summaryOnlyPattern)?.length) && !content.replace(summaryOnlyPattern, '').trim();
}

function isSummaryOnlyThinking(message: { kind?: string; content: string; thinking?: string }): boolean {
  return message.kind === 'thinking' && hasOnlyBoldSummary(message);
}

function isBoldOnlyText(message: { kind?: string; content: string; thinking?: string }): boolean {
  return message.kind === 'text' && hasOnlyBoldSummary(message);
}

function reviewMessageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'type' in item && 'text' in item
        && item.type === 'text' && typeof item.text === 'string') {
        return item.text;
      }
      return JSON.stringify(item);
    }).join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

function stripReviewDetailBlocks(content: string): string {
  return content
    .replace(/<system_info>[\s\S]*?<\/system_info>/g, '')
    .replace(/<rules\b[^>]*>[\s\S]*?<\/rules>/g, '')
    .replace(/<available_skills>[\s\S]*?<\/available_skills>/g, '')
    .replace(/<observation\b[^>]*>[\s\S]*?<\/observation>/g, '')
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<file-view\b[^>]*>[\s\S]*?<\/file-view>/g, '');
}

function thinkingOnlyBody(content: string): string | undefined {
  const bodies: string[] = [];
  const pattern = /<thinking>([\s\S]*?)<\/thinking>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (content.slice(lastIndex, match.index).trim()) return undefined;
    if (match[1].trim()) bodies.push(match[1].trim());
    lastIndex = pattern.lastIndex;
  }

  if (!bodies.length || content.slice(lastIndex).trim()) return undefined;
  return bodies.join('\n\n');
}

function reviewObservationOutput(body: string): string {
  // Remove the tag wrapper's line breaks without stripping meaningful output indentation.
  const output = body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  try {
    const parsed = JSON.parse(output.trim());
    const results = Array.isArray(parsed.results) ? parsed.results : [parsed];
    return results.map((result: unknown) => {
      if (result && typeof result === 'object' && 'content' in result && typeof result.content === 'string') {
        return result.content;
      }
      return JSON.stringify(result, null, 2);
    }).join('\n\n');
  } catch {
    return output;
  }
}

function reviewTagAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1]?.replace(/&quot;/g, '"');
}

function structuredReviewMessages(): ReviewVisibleMessage[] {
  const normalized: ReviewVisibleMessage[] = [];
  // IDs keep parallel tool results attached to the right call; the queue supports older adapters.
  const pendingTools: Array<{ id?: string; name: string; input: string }> = [];
  const toolsById = new Map<string, { id?: string; name: string; input: string }>();
  const detailPattern = /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call>|<observation\b([^>]*)>([\s\S]*?)<\/observation>/g;

  for (const [messageIndex, message] of (reviewTranscript.value?.messages || []).entries()) {
    const content = reviewMessageContentToString(message.content);
    const role = message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant';
    let segmentIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    function pushText(text: string): void {
      if (text.trim()) normalized.push({ id: `review-${messageIndex}-${segmentIndex++}`, role, content: text, kind: 'text', timestamp: message.timestamp });
    }

    while (role === 'assistant' && (match = detailPattern.exec(content)) !== null) {
      pushText(content.slice(lastIndex, match.index));
      if (typeof match[2] === 'string') {
        const name = reviewTagAttribute(match[1], 'name') || 'tool';
        const id = reviewTagAttribute(match[1], 'id');
        const input = match[2].trim();
        const tool = { id, name, input };
        pendingTools.push(tool);
        if (id) toolsById.set(id, tool);
        normalized.push({
          id: `review-${messageIndex}-${segmentIndex++}`,
          role: 'assistant',
          content: input,
          kind: 'tool_call',
          status: 'pending',
          title: `Executing tool ${name}`,
          toolName: name,
          toolInput: input,
          timestamp: message.timestamp,
        });
      } else {
        const toolId = reviewTagAttribute(match[3], 'tool_call_id');
        const tool = toolId ? toolsById.get(toolId) : pendingTools.shift();
        if (tool) {
          const pendingIndex = pendingTools.indexOf(tool);
          if (pendingIndex >= 0) pendingTools.splice(pendingIndex, 1);
          if (tool.id) toolsById.delete(tool.id);
        }
        const output = reviewObservationOutput(match[4]);
        const failed = reviewTagAttribute(match[3], 'status') === 'failure';
        normalized.push({
          id: `review-${messageIndex}-${segmentIndex++}`,
          role: 'assistant',
          content: output,
          kind: 'tool_result',
          status: failed ? 'failure' : 'success',
          title: failed
            ? `Tool ${tool?.name || 'tool'} failed`
            : `Tool ${tool?.name || 'tool'} completed`,
          toolName: tool?.name || 'tool',
          toolInput: tool?.input,
          toolOutput: output,
          timestamp: message.timestamp,
        });
      }
      lastIndex = detailPattern.lastIndex;
    }
    pushText(content.slice(lastIndex));
  }

  return normalized;
}

const visibleMessages = computed(() => {
  if (isReviewMode.value) {
    if (showDetails.value) return structuredReviewMessages();

    const reviewMessages = (reviewTranscript.value?.messages || []).flatMap((message, index) => {
      if (message.detailOnly) return [];
      const content = stripReviewDetailBlocks(reviewMessageContentToString(message.content));
      if (!content.trim()) return [];
      return [{
        id: `review-${index}`,
        role: (message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant') as 'user' | 'assistant',
        content,
        kind: 'text' as const,
        timestamp: message.timestamp,
      }];
    });

    return reviewMessages.reduce<typeof reviewMessages>((visible, message) => {
      const body = message.role === 'assistant' ? thinkingOnlyBody(message.content) : undefined;
      const previous = visible.at(-1);
      const previousBody = previous?.role === 'assistant' ? thinkingOnlyBody(previous.content) : undefined;
      if (previous && body !== undefined && previousBody !== undefined) {
        previous.content = `<thinking>\n${previousBody}\n\n${body}\n</thinking>`;
      } else {
        visible.push(message);
      }
      return visible;
    }, []);
  }
  if (showDetails.value) return messages.value;

  const messagesWithoutTools = messages.value.filter((message) => (
    message.kind !== 'tool_call' && message.kind !== 'tool_result'
  ));
  if (!messagesWithoutTools.some(isSummaryOnlyThinking)) return messagesWithoutTools;

  const progressIndexes = new Set<number>();
  return messagesWithoutTools.reduce<typeof messages.value>((visible, message) => {
    const previous = visible.at(-1);
    const previousIndex = visible.length - 1;
    const shouldCondense = previous
      && progressIndexes.has(previousIndex)
      && (isSummaryOnlyThinking(message) || isBoldOnlyText(message));

    if (shouldCondense) {
      const content = `${previous.thinking || previous.content}\n\n${message.thinking || message.content}`;
      // Keep the first row's presentation so thinking summaries remain event rows while text summaries remain normal bubbles.
      visible[previousIndex] = previous.kind === 'thinking'
        ? { ...previous, content, thinking: content }
        : { ...previous, content, thinking: undefined };
      return visible;
    }

    visible.push(message);
    if (isSummaryOnlyThinking(message)) progressIndexes.add(visible.length - 1);
    return visible;
  }, []);
});

const pdfExportMessages = computed(() => isReviewMode.value ? visibleMessages.value : messages.value);

const canExportPdf = computed(() => hasExportableMessages({
  messages: pdfExportMessages.value,
  sessionTitle: props.sessionTitle,
  projectPath: props.projectPath,
  includeDetails: showDetails.value,
  includeThinking: !hideThinkingBlock.value,
}));

async function handleExportPdf() {
  if (!canExportPdf.value || isExportingPdf.value) return;

  isExportingPdf.value = true;
  exportPdfError.value = '';
  try {
    await exportSessionPdf({
      messages: pdfExportMessages.value,
      sessionTitle: props.sessionTitle,
      projectPath: props.projectPath,
      includeDetails: showDetails.value,
      includeThinking: !hideThinkingBlock.value,
    });
  } catch (error) {
    console.error(t('components.chatPanel.failedToExportSessionPdf'), error);
    exportPdfError.value = t('components.chatPanel.pdfExportFailedPleaseTryAgain');
  } finally {
    isExportingPdf.value = false;
  }
}

const composerContextText = computed(() => {
  const status = sessionStatus.value;
  const contextWindow = status?.contextUsage?.contextWindow || status?.model?.contextWindow || 0;
  if (contextWindow <= 0) return '';

  const percent = status?.contextUsage?.percent == null ? '?' : status.contextUsage.percent.toFixed(1);
  return `${percent}%/${formatTokens(contextWindow)}`;
});
function modelLabelWithoutProvider(label?: string): string {
  return label?.split(/\s+\/\s+/).pop()?.trim() || '';
}

const composerModelLabel = computed(() => {
  const model = sessionStatus.value?.model;
  return modelLabelWithoutProvider(model?.id) || props.modelInfo || t('components.chatPanel.selectModel');
});
const composerSkillLabel = computed(() => {
  if (!skillConfigurationLoaded.value) return t('components.chatPanel.skills');
  const count = activeSkillCount.value;
  return t(count === 1 ? 'components.chatPanel.skillCount' : 'components.chatPanel.skillsCount', { count });
});
const activeSkillCount = computed(() => {
  if (skillMode.value === 'enabled') return selectedSkills.value.length;
  if (skillMode.value === 'disabled') return Math.max(skillOptions.value.length - selectedSkills.value.length, 0);
  return skillOptions.value.length;
});
const thinkingLevels = computed(() => sessionStatus.value?.thinkingLevels || []);
const commitDialogTitle = computed(() => commitPreview.value?.mode === 'amend' ? t('components.chatPanel.amendPreviousCommit') : t('components.chatPanel.commitChanges'));
const commitDialogConfirmText = computed(() => commitPreview.value?.mode === 'amend' ? t('components.chatPanel.amend') : t('components.chatPanel.commit'));
const branchDialogActionLabel = computed(() => branchDialogMode.value === 'switch' ? t('components.chatPanel.switchBranch') : t('components.chatPanel.createBranch'));
const branchSelectOptions = computed<CustomSelectOption[]>(() => branchOptions.value.map((branch) => ({ value: branch, label: branch })));
const prTargetBranchOptions = computed<CustomSelectOption[]>(() => {
  const targetBranch = prPreview.value?.targetBranch || 'main';
  return Array.from(new Set([targetBranch, 'main', ...branchOptions.value]))
    .filter(Boolean)
    .map((branch) => ({ value: branch, label: branch }));
});

const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase();
  if (!query) return modelOptions.value;
  return modelOptions.value.filter((model) => [model.provider, model.id, model.name || ''].join(' ').toLowerCase().includes(query));
});

watch(filteredModels, (models) => {
  if (!models.length) {
    activeModelIndex.value = -1;
    return;
  }

  if (activeModelIndex.value >= models.length) {
    activeModelIndex.value = models.length - 1;
  }
});

watch(activeModelIndex, async () => {
  await nextTick();
  modelListRef.value?.querySelector<HTMLElement>('.model-option.keyboard-active')?.scrollIntoView({ block: 'nearest' });
});

function moveModelSelection(delta: number) {
  const lastIndex = filteredModels.value.length - 1;
  if (lastIndex < 0) return;
  activeModelIndex.value = Math.min(Math.max(activeModelIndex.value + delta, 0), lastIndex);
}

function handleModelSearchKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveModelSelection(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveModelSelection(-1);
      break;
    case 'Enter':
      if (activeModelIndex.value < 0) return;
      event.preventDefault();
      void selectModel(filteredModels.value[activeModelIndex.value]);
      break;
    case 'Escape':
      closeModelSelector();
      break;
  }
}

function formatTokens(count: number) {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function runWhenIdle(callback: () => void): void {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 1500 });
    return;
  }
  globalThis.setTimeout(callback, 0);
}

async function refreshSessionStatus() {
  if (!props.sessionId || !props.clientId) {
    sessionStatus.value = null;
    return;
  }

  try {
    const statusUrl = new URL(`/api/sessions/${props.sessionId}/status`, window.location.origin);
    statusUrl.searchParams.set('clientId', props.clientId);
    const response = await fetch(statusUrl.toString());
    if (!response.ok) throw new Error(t('components.chatPanel.failedToLoadSessionStatus'));
    sessionStatus.value = await response.json();
  } catch (error) {
    console.error(t('components.chatPanel.failedToLoadSessionStatus2'), error);
    sessionStatus.value = null;
  }
}

onMounted(async () => {
  window.addEventListener('summary-generated', handleSummaryGenerated as EventListener);
  await resizeInputAfterDomUpdate();
  if (selectedMessageIndex.value === 0) focusInput();
});

onBeforeUnmount(() => {
  isUnmounted = true;
  window.removeEventListener('summary-generated', handleSummaryGenerated as EventListener);
  stopInputResize();
  stopStreamingElapsedTimer();
});

watch(
  () => [props.sessionId, props.clientId] as const,
  ([sessionId, clientId]) => {
    runWhenIdle(() => {
      // The idle callback can outlive a quickly closed panel; do not start requests after teardown.
      if (isUnmounted) return;
      void slashCommands.loadCommands(sessionId, clientId);
      void refreshSessionStatus();
      void refreshSkillConfiguration().catch(() => {
        skillConfigurationLoaded.value = false;
      });
    });
  },
  { immediate: true },
);

watch(isStreaming, (streaming, wasStreaming) => {
  if (streaming && !wasStreaming) {
    startStreamingElapsedTimer();
  } else if (!streaming && wasStreaming) {
    stopStreamingElapsedTimer();
    void refreshSessionStatus();
  }
}, { immediate: true });

watch(commitPreview, async (preview) => {
  if (!preview) return;
  await nextTick();
  commitMessageInputRef.value?.focus();
});

// Watch for session changes and load history
watch(() => props.sessionId, async (newSessionId) => {
  if (newSessionId) {
    await loadSessionHistory(newSessionId);
    return;
  }

  clearMessages();
}, { immediate: true });

watch(() => [props.reviewSourceId, props.reviewSessionId], async ([sourceId, sessionId]) => {
  const requestId = ++reviewTranscriptRequestId;
  reviewTranscript.value = null;
  if (!sourceId || !sessionId) return;

  try {
    const transcript = await getReviewTranscript(sourceId, sessionId);
    if (requestId === reviewTranscriptRequestId) reviewTranscript.value = transcript;
  } catch (error) {
    if (requestId === reviewTranscriptRequestId) {
      console.error('Failed to load review transcript', error);
    }
  }
}, { immediate: true });

watch(visibleMessages, async () => {
  const shouldAutoScroll = isMessagesScrolledNearBottom();

  if (visibleMessages.value.length === 0) {
    selectedMessageIndex.value = 0;
  } else if (selectedMessageIndex.value >= visibleMessages.value.length) {
    selectedMessageIndex.value = visibleMessages.value.length - 1;
  }

  await nextTick();
  if (shouldAutoScroll && messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}, { deep: true });

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0 || !result.slice(comma + 1)) reject(new Error('read failed'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files: Iterable<File>): Promise<void> {
  const errors: string[] = [];
  attachmentError.value = '';

  for (const file of files) {
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      errors.push(t('components.chatPanel.unsupportedImage', { name: file.name }));
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(t('components.chatPanel.imageTooLarge', { name: file.name }));
      continue;
    }
    if (attachments.value.length >= MAX_IMAGE_COUNT) {
      errors.push(t('components.chatPanel.youCanAttachUpTo4Images'));
      continue;
    }

    try {
      const data = await readImage(file);
      attachments.value.push({
        id: `${Date.now()}-${Math.random()}`,
        type: 'image',
        data,
        mimeType: file.type,
        name: file.name,
        size: file.size,
        previewUrl: `data:${file.type};base64,${data}`,
      });
    } catch {
      errors.push(t('components.chatPanel.theImageCouldNotBeReadTry'));
    }
  }

  attachmentError.value = Array.from(new Set(errors)).join(' ');
}

function handleImageInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  void addImageFiles(Array.from(input.files || [])).finally(() => { input.value = ''; });
}

function handleImagePaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  void addImageFiles(files);
}

function handleImageDrag(event: DragEvent): void {
  const items = Array.from(event.dataTransfer?.items || []);
  isDraggingImages.value = items.some((item) => item.kind === 'file' && IMAGE_MIME_TYPES.has(item.type));
}

function handleDragLeave(event: DragEvent): void {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) isDraggingImages.value = false;
}

function handleImageDrop(event: DragEvent): void {
  isDraggingImages.value = false;
  void addImageFiles(Array.from(event.dataTransfer?.files || []));
}

async function polishPrompt(): Promise<void> {
  if (!canPolishPrompt.value) return;
  isPolishingPrompt.value = true;
  promptPolishError.value = '';
  try {
    const response = await fetch('/api/tasks/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, title: t('components.chatPanel.chatPrompt'), prompt: inputText.value }),
    });
    const data = await response.json().catch(() => ({})) as { content?: { prompt?: string }; error?: string };
    if (!response.ok || !data.content?.prompt) throw new Error(data.error || t('components.chatPanel.failedToPolishPrompt'));
    inputText.value = data.content.prompt;
    await resizeInputAfterDomUpdate();
    inputRef.value?.focus();
  } catch (error) {
    promptPolishError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToPolishPrompt');
  } finally {
    isPolishingPrompt.value = false;
  }
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter((attachment) => attachment.id !== id);
  attachmentError.value = '';
  if (attachmentPreview.value?.id === id) closeAttachmentPreview();
}

function openAttachmentPreview(attachment: PendingAttachment): void {
  attachmentPreview.value = attachment;
}

function closeAttachmentPreview(): void {
  attachmentPreview.value = null;
}

function handleAttachmentPreviewKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeAttachmentPreview();
}

watch(attachmentPreview, (preview, _previous, onCleanup) => {
  if (!preview) return;
  window.addEventListener('keydown', handleAttachmentPreviewKeydown);
  onCleanup(() => window.removeEventListener('keydown', handleAttachmentPreviewKeydown));
});

function addFileReference(path: string) {
  const separator = inputText.value && !/\s$/.test(inputText.value) ? ' ' : '';
  inputText.value += `${separator}@${path}`;
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.setSelectionRange(inputText.value.length, inputText.value.length);
    resizeInput();
  });
}

async function submitExternalPrompt(text: string): Promise<boolean> {
  inputText.value = text;
  await nextTick();
  return handleSend();
}

defineExpose({
  addFileReference,
  focusInput,
  focusMessagesEnd,
  submitExternalPrompt,
  setViewedSession,
});

async function sendImageMessage(text: string, targetSessionId: string | undefined, images: PendingAttachment[]): Promise<boolean> {
  return (await sendMessage(text, targetSessionId, {
    images,
    awaitAcceptance: true,
    onRejected: (message) => { attachmentError.value = message; },
  })) === true;
}

function handleAnnotateImage(image: ChatImage): void {
  if (!image.path) return;

  const normalizedPath = image.path.replace(/\\/g, '/');
  const uploadDirectory = 'tmp/upload_images/';
  const uploadDirectoryIndex = normalizedPath.lastIndexOf(`/${uploadDirectory}`);
  const imagePath = uploadDirectoryIndex >= 0
    ? normalizedPath.slice(uploadDirectoryIndex + 1)
    : normalizedPath;
  inputText.value = [
    `Annotate the image at ${JSON.stringify(imagePath)}, preserve the original image,`,
    'save the annotated copy beside it in tmp/upload_images/ with "-annotated-HHMMSS" before the extension, using the server local time at annotation.',
    'After saving it, show the output path as inline code, not as a Markdown link, so I can open it in the editor.',
  ].join(' ');
  void resizeInputAfterDomUpdate().then(() => inputRef.value?.focus());
}

function clearAcceptedDraft(imageDraft: PendingAttachment[]): void {
  inputText.value = '';
  if (imageDraft.length) {
    const acceptedIds = new Set(imageDraft.map((image) => image.id));
    attachments.value = attachments.value.filter((attachment) => !acceptedIds.has(attachment.id));
  }
  attachmentError.value = '';
  resizeInputAfterDomUpdate();
}

async function handleSendToNewSession() {
  const text = inputText.value;
  if (isReviewMode.value || !hasDraftContent.value || imagesBlocked.value || !props.sessionId || !props.createInheritedSession || isPreparingSession.value) return;

  isPreparingSession.value = true;
  try {
    const targetSessionId = await props.createInheritedSession(props.sessionId, text);
    if (!targetSessionId) return;

    slashCommands.close();
    const imageDraft = [...attachments.value];
    const sent = imageDraft.length
      ? await sendImageMessage(text, targetSessionId, imageDraft)
      : sendMessage(text, targetSessionId);
    if (!sent) return;

    window.dispatchEvent(new CustomEvent('session-first-message', {
      detail: { id: targetSessionId, firstMessage: text },
    }));
    clearAcceptedDraft(imageDraft);
    void refreshSessionStatus();
  } finally {
    isPreparingSession.value = false;
  }
}

async function handleSend(): Promise<boolean> {
  const text = inputText.value;
  if (isReviewMode.value || !hasDraftContent.value || isPreparingSession.value || imagesBlocked.value) return false;

  if (text.trim() && isSessionCommand(text)) {
    await handleSessionCommand(text);
    return true;
  }

  if (isTreeCommand(text)) {
    await handleTreeCommand(text);
    return true;
  }

  if (isDiffCommand(text)) {
    await handleDiffCommand(text);
    return true;
  }

  if (isStatusCommand(text)) {
    await handleStatusCommand(text);
    return true;
  }

  if (isCommitCommand(text)) {
    await handleCommitCommand(text);
    return true;
  }

  if (isAmendCommand(text)) {
    await handleAmendCommand(text);
    return true;
  }

  if (isPrCommand(text)) {
    await handlePrCommand(text);
    return true;
  }

  const gitSyncCommand = parseGitSyncCommand(text);
  if (gitSyncCommand) {
    await handleGitSyncCommand(text, gitSyncCommand);
    return true;
  }

  if (isBranchCommand(text)) {
    await handleBranchCommand(text);
    return true;
  }

  if (isModelCommand(text)) {
    await handleModelCommand(text);
    return true;
  }

  if (isSkillsCommand(text)) {
    await handleSkillsCommand(text);
    return true;
  }

  if (isCopyCommand(text)) {
    await handleCopyCommand();
    return true;
  }

  if (isSummaryCommand(text)) {
    await handleSummaryCommand(text);
    return true;
  }

  if (isChangelogCommand(text)) {
    await handleChangelogCommand(text);
    return true;
  }

  let targetSessionId = props.sessionId;
  if (props.ensureSession) {
    isPreparingSession.value = true;
    try {
      const ensuredSessionId = await props.ensureSession(props.sessionId, text);
      if (!ensuredSessionId) return false;
      targetSessionId = ensuredSessionId;
    } finally {
      isPreparingSession.value = false;
    }
  }

  slashCommands.close();
  const shouldNotifyFirstMessage = Boolean(targetSessionId && !isStreaming.value);
  const imageDraft = [...attachments.value];
  const sent = imageDraft.length
    ? await sendImageMessage(text, targetSessionId, imageDraft)
    : sendMessage(text, targetSessionId);
  if (!sent) return false;
  if (shouldNotifyFirstMessage) {
    window.dispatchEvent(new CustomEvent('session-first-message', {
      detail: {
        id: targetSessionId,
        firstMessage: text,
      },
    }));
  }
  clearAcceptedDraft(imageDraft);
  void refreshSessionStatus();
  return true;
}

function isSessionCommand(text: string) {
  return /^\/session(?:\s|$)/i.test(text.trim());
}

function isTreeCommand(text: string) {
  return /^\/tree(?:\s|$)/i.test(text.trim());
}

function isDiffCommand(text: string) {
  return /^\/diff(?:\s|$)/i.test(text.trim());
}

function isStatusCommand(text: string) {
  return /^\/status(?:\s|$)/i.test(text.trim());
}

function isCommitCommand(text: string) {
  return /^\/commit(?:\s|$)/i.test(text.trim());
}

function isAmendCommand(text: string) {
  return /^\/amend(?:\s|$)/i.test(text.trim());
}

function isPrCommand(text: string) {
  return /^\/pr(?:\s|$)/i.test(text.trim());
}

function parseGitSyncCommand(text: string): GitSyncCommand | null {
  const trimmed = text.trim();
  if (/^\/push(?:\s|$)/i.test(trimmed)) return 'push';
  if (/^\/pull(?:\s|$)/i.test(trimmed)) return 'pull';
  return null;
}

function isBranchCommand(text: string) {
  return /^\/branch(?:\s|$)/i.test(text.trim());
}

function isModelCommand(text: string) {
  return /^\/model(?:\s|$)/i.test(text.trim());
}

function isSkillsCommand(text: string) {
  return /^\/skills(?:\s|$)/i.test(text.trim());
}

function isCopyCommand(text: string) {
  return /^\/copy(?:\s|$)/i.test(text.trim());
}

function isSummaryCommand(text: string) {
  return /^\/summary(?:\s|$)/i.test(text.trim());
}

function isChangelogCommand(text: string) {
  return /^\/changelog(?:\s|$)/i.test(text.trim());
}

function parsePrTarget(text: string) {
  return text.trim().replace(/^\/pr(?:\s+|$)/i, '').trim().split(/\s+/)[0] || 'main';
}

function parseBranchArgs(text: string) {
  const [name, baseBranch] = text.trim().replace(/^\/branch(?:\s+|$)/i, '').trim().split(/\s+/).filter(Boolean);
  return { name, baseBranch };
}

function parseCommitMessageOverride(text: string) {
  return text.trim().replace(/^\/commit(?:\s+|$)/i, '').trim();
}

function parseAmendMessageOverride(text: string) {
  return text.trim().replace(/^\/amend(?:\s+|$)/i, '').trim();
}

function getCommitMessage(text: string) {
  return parseCommitMessageOverride(text) || props.sessionTitle?.trim() || t('components.chatPanel.updateChanges');
}

function getLastAssistantResponseText() {
  const lastCopyableIndex = [...messages.value]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'assistant' && message.kind !== 'status' && message.content.trim())?.index;

  if (lastCopyableIndex === undefined) return '';

  const previousUserIndex = messages.value
    .slice(0, lastCopyableIndex)
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'user')?.index ?? -1;

  return messages.value
    .slice(previousUserIndex + 1, lastCopyableIndex + 1)
    .filter((message) => message.role === 'assistant' && message.kind !== 'status' && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n\n');
}

async function writeClipboardText(text: string) {
  let clipboardError: unknown;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    textarea.focus();
    if (!document.execCommand('copy')) {
      throw clipboardError instanceof Error ? clipboardError : new Error(t('components.chatPanel.failedToCopyTextToSystemClipboard'));
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

async function handleCopyCommand() {
  slashCommands.close();
  inputText.value = '';
  resizeInputAfterDomUpdate();

  const responseText = getLastAssistantResponseText();
  if (!responseText) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.noResponseMessagesToCopyYet'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.copyFailed'),
    }, props.sessionId);
    return;
  }

  try {
    await writeClipboardText(responseText);
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.copiedLastResponseMessagesToSystemClipboard'),
      kind: 'status',
      status: 'success',
      title: t('components.chatPanel.copied'),
    }, props.sessionId);
  } catch (error) {
    addLocalMessage({
      role: 'assistant',
      content: error instanceof Error ? error.message : t('components.chatPanel.failedToCopyMessagesToSystemClipboard'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.copyFailed'),
    }, props.sessionId);
  }
}

async function handleSummaryCommand(text: string) {
  slashCommands.close();
  inputText.value = '';
  resizeInputAfterDomUpdate();

  if (isStreaming.value) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.waitForResponseBeforeSummary'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.summaryUnavailable'),
    }, props.sessionId);
    return;
  }

  if (!props.sessionId) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.openSessionBeforeSummary'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.summaryUnavailable'),
    }, props.sessionId);
    return;
  }

  sendMessage(SESSION_SUMMARY_PROMPT, props.sessionId, {
    displayText: text.trim(),
    copySummaryOnComplete: true,
  });
}

async function handleSummaryGenerated(event: Event) {
  const detail = (event as CustomEvent<SummaryGeneratedDetail>).detail;
  if (detail?.sessionId && props.sessionId && detail.sessionId !== props.sessionId) return;

  const summaryText = detail?.content?.trim() || '';
  if (!summaryText) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.theSummaryWasGeneratedButNoText'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.copyFailed'),
    }, props.sessionId);
    return;
  }

  try {
    await writeClipboardText(summaryText);
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.summaryCopiedToSystemClipboard'),
      kind: 'status',
      status: 'success',
      title: t('components.chatPanel.copied'),
    }, props.sessionId);
  } catch (error) {
    addLocalMessage({
      role: 'assistant',
      content: error instanceof Error ? error.message : t('components.chatPanel.failedToCopySummaryToSystemClipboard'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.copyFailed'),
    }, props.sessionId);
  }
}

async function handleChangelogCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({
    role: 'assistant',
    content: t('components.chatPanel.loadingChangelog'),
    kind: 'status',
    status: 'pending',
    title: t('components.chatPanel.changelog'),
  }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    const response = await fetch('/api/changelog');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = typeof data.content === 'string' && data.content.trim()
      ? data.content.trim()
      : t('components.chatPanel.noChangelogEntriesAreAvailable');
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.changelogUnavailable');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadChangelog');
  }
}

function parseDiffScope(text: string) {
  const scope = text.trim().replace(/^\/diff(?:\s+|$)/i, '').trim().split(/\s+/)[0]?.toLowerCase();
  if (scope === 'staged' || scope === '--staged' || scope === 'cached' || scope === '--cached') return 'staged';
  if (scope === 'unstaged' || scope === '--unstaged' || scope === 'worktree' || scope === '--worktree') return 'unstaged';
  return 'all';
}

function formatDiffSummary(data: { cwd?: string; stat?: string; diff?: string; oversized?: boolean; message?: string }, scope: string) {
  const stat = data.stat?.trim() || '';
  const diff = data.diff?.trimEnd() || '';
  const statSummary = stat.split('\n').at(-1)?.trim();
  const size = `${Math.max(1, Math.round(new Blob([diff]).size / 1024))} KB`;
  if (data.oversized) {
    return data.message || t('components.chatPanel.thisDiffIsTooLargeToShow');
  }
  if (!stat && !diff) return t('components.chatPanel.noWorkingTreeChanges');

  return t('components.chatPanel.gitDiffOpened', { scope, summary: statSummary ? ` · ${statSummary}` : '', size });
}

async function handleSessionCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({
    role: 'assistant',
    content: t('components.chatPanel.loadingSessionInfo'),
    kind: 'status',
    status: 'pending',
    title: t('components.chatPanel.sessionInfo'),
  }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  if (!props.sessionId || !props.clientId) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.sessionInfoUnavailable');
    responseMessage.content = t('components.chatPanel.openSessionBeforeSessionInfo');
    return;
  }

  try {
    const params = new URLSearchParams({ clientId: props.clientId });
    const response = await fetch(`/api/sessions/${props.sessionId}/info?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatSessionInfo(data);
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.sessionInfoFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadSessionInfo');
  }
}

function formatSessionInfo(info: SessionCommandInfo) {
  const stats = info.stats;
  const lines = ['## 📌 Session Info'];
  if (info.name) lines.push(`- **Name:** ${info.name}`);
  if (info.workDir) lines.push(`- **Work Dir:** \`${info.workDir}\``);
  if (info.model?.provider || info.model?.id) {
    lines.push(`- **Model:** \`${[info.model.provider, info.model.id].filter(Boolean).join('/')}\``);
  }
  lines.push(`- **File:** \`${stats.sessionFile || t('components.chatPanel.inMemory')}\``);
  lines.push(`- **ID:** \`${stats.sessionId}\``);
  lines.push('');
  lines.push('## 💬 Messages');
  lines.push(`- 👤 **User:** ${stats.userMessages.toLocaleString()}`);
  lines.push(`- 🤖 **Assistant:** ${stats.assistantMessages.toLocaleString()}`);
  lines.push(`- 🛠️ **Tool Calls:** ${stats.toolCalls.toLocaleString()}`);
  lines.push(`- ✅ **Tool Results:** ${stats.toolResults.toLocaleString()}`);
  lines.push(`- 📊 **Total:** ${stats.totalMessages.toLocaleString()}`);
  lines.push('');
  lines.push('## 🧮 Tokens');
  lines.push(`- ⬇️ **Input:** ${stats.tokens.input.toLocaleString()}`);
  lines.push(`- ⬆️ **Output:** ${stats.tokens.output.toLocaleString()}`);
  if (stats.tokens.cacheRead > 0) lines.push(`- ⚡ **Cache Read:** ${stats.tokens.cacheRead.toLocaleString()}`);
  if (stats.tokens.cacheWrite > 0) lines.push(`- 📝 **Cache Write:** ${stats.tokens.cacheWrite.toLocaleString()}`);
  lines.push(`- 📊 **Total:** ${stats.tokens.total.toLocaleString()}`);
  if (stats.cost > 0) {
    lines.push('');
    lines.push('## 💵 Cost');
    lines.push(`- **Total:** \`$${stats.cost.toFixed(4)}\``);
  }
  return lines.join('\n');
}

async function handleTreeCommand(text: string) {
  slashCommands.close();
  inputText.value = '';
  resizeInputAfterDomUpdate();

  if (!props.sessionId || !props.clientId) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.openSessionBeforeTree'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.sessionTreeUnavailable'),
    }, props.sessionId);
    return;
  }

  treeModalOpen.value = true;
}

async function handleTreeNavigated(result: { editorText?: string }) {
  treeModalOpen.value = false;
  if (props.sessionId) {
    await loadSessionHistory(props.sessionId);
  }
  if (result.editorText) {
    inputText.value = result.editorText;
    await resizeInputAfterDomUpdate();
    inputRef.value?.focus();
  }
  void refreshSessionStatus();
}

async function handleOpenGitCommit(commit: string) {
  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~', commit });
    const response = await fetch(`/api/git/diff?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.oversized) throw new Error(data.message || t('components.chatPanel.thisDiffIsTooLargeToShow'));
    if (typeof data.diff !== 'string' || !data.diff.trim()) return;

    window.dispatchEvent(new CustomEvent('open-virtual-diff-in-editor', {
      detail: {
        cwd: data.cwd || props.projectPath,
        scope: `commit-${commit}`,
        content: data.diff,
      },
    }));
  } catch (error) {
    addLocalMessage({
      role: 'assistant',
      content: error instanceof Error ? error.message : t('components.chatPanel.failedToLoadGitDiff'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.gitDiffFailed'),
    }, props.sessionId);
  }
}

async function handleDiffCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({
    role: 'assistant',
    content: t('components.chatPanel.loadingGitDiff'),
    kind: 'status',
    status: 'pending',
    title: t('components.chatPanel.gitDiff'),
  }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~' });
    const scope = parseDiffScope(text);
    if (scope !== 'all') params.set('scope', scope);
    const response = await fetch(`/api/git/diff?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    if (!data.oversized && typeof data.diff === 'string' && data.diff.trim()) {
      window.dispatchEvent(new CustomEvent('open-virtual-diff-in-editor', {
        detail: {
          cwd: data.cwd || props.projectPath,
          scope,
          content: data.diff,
        },
      }));
    }

    responseMessage.kind = 'text';
    responseMessage.status = data.oversized ? 'failure' : undefined;
    responseMessage.title = data.oversized ? t('components.chatPanel.gitDiffUnavailable') : undefined;
    responseMessage.content = formatDiffSummary(data, scope);
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.gitDiffFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadGitDiff');
  }
}

function formatStatusResponse(data: { cwd?: string; output?: string }) {
  const output = data.output?.trimEnd() || t('components.chatPanel.noStatusOutput');
  return `### Git status \`${data.cwd || props.projectPath}\`\n\n\`\`\`text\n${output}\n\`\`\``;
}

async function handleStatusCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({
    role: 'assistant',
    content: t('components.chatPanel.loadingGitStatus'),
    kind: 'status',
    status: 'pending',
    title: t('components.chatPanel.gitStatus'),
  }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~' });
    const response = await fetch(`/api/git/status?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatStatusResponse(data);
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.gitStatusFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadGitStatus');
  }
}

function formatBranchSuccess(data: { cwd?: string; name?: string; baseBranch?: string; output?: string }) {
  const output = data.output?.trim() || t('components.chatPanel.switchedToNewBranch', { name: data.name || '' });
  const base = data.baseBranch ? `\n\nBase: \`${data.baseBranch}\`` : '';
  return `### Git branch created\n\n\`${data.cwd || props.projectPath}\`\n\nBranch: \`${data.name || ''}\`${base}\n\n\`\`\`text\n${output}\n\`\`\``;
}

function formatBranchSwitchSuccess(data: { cwd?: string; name?: string; pulled?: boolean; deletedBranch?: { name?: string; commit?: string }; output?: string }) {
  const output = data.output?.trim() || t('components.chatPanel.switchedToBranch', { name: data.name || '' });
  const pulled = data.pulled ? '\n\nPulled: `git pull --ff-only`' : '';
  const deleted = data.deletedBranch
    ? `\n\nDeleted original branch: \`${data.deletedBranch.name || ''}\` (last commit \`${data.deletedBranch.commit || ''}\`)`
    : '';
  return `### Git branch switched\n\n\`${data.cwd || props.projectPath}\`\n\nBranch: \`${data.name || ''}\`${pulled}${deleted}\n\n\`\`\`text\n${output}\n\`\`\``;
}

function formatGitSyncSuccess(command: GitSyncCommand, data: { cwd?: string; output?: string }) {
  const title = `Git ${command}`;
  const output = data.output?.trim() || `git ${command} completed.`;
  return `### ${title}\n\n\`${data.cwd || props.projectPath}\`\n\n\`\`\`text\n${output}\n\`\`\``;
}

async function handleGitSyncCommand(text: string, command: GitSyncCommand) {
  const title = `Git ${command}`;
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({ role: 'assistant', content: t('components.chatPanel.runningGitCommand', { command }), kind: 'status', status: 'pending', title }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    const response = await fetch(`/api/git/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: props.projectPath || '~' }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatGitSyncSuccess(command, data);
    void refreshSessionStatus();
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = `${title} failed`;
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToRunGitCommand', { command });
  }
}

function defaultMainBranch() {
  return branchOptions.value.find((branch) => branch === 'main') || branchOptions.value[0] || '';
}

function rememberBranchSelection(branch: string): void {
  if (branch) localStorage.setItem(branchSelectionStorageKey(), branch);
}

async function loadBranchOptions() {
  branchDialogLoading.value = true;
  branchDialogError.value = '';
  branchHasChanges.value = false;
  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~' });
    const [branchesResponse, statusResponse] = await Promise.all([
      fetch(`/api/git/branches?${params}`),
      fetch(`/api/git/status?${params}`),
    ]);
    const branchesData = await branchesResponse.json();
    const statusData = await statusResponse.json();
    if (!branchesResponse.ok) throw new Error(branchesData.error || `HTTP ${branchesResponse.status}`);
    if (!statusResponse.ok) throw new Error(statusData.error || `HTTP ${statusResponse.status}`);
    branchOptions.value = Array.isArray(branchesData.branches) ? branchesData.branches : [];
    branchHasChanges.value = Array.isArray(statusData.files) && statusData.files.length > 0;
    const savedBranch = localStorage.getItem(branchSelectionStorageKey()) || '';
    const rememberedBranch = branchOptions.value.includes(savedBranch) ? savedBranch : '';
    // Reuse one saved choice for both branch selectors while it remains valid.
    branchSwitchName.value = rememberedBranch || defaultMainBranch();
    branchBaseName.value = rememberedBranch || branchesData.current || defaultMainBranch();
  } catch (error) {
    branchDialogError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadGitBranches');
  } finally {
    branchDialogLoading.value = false;
  }
}

function closeBranchDialog() {
  branchDialogOpen.value = false;
  branchDialogError.value = '';
}

async function openBranchDialog() {
  slashCommands.close();
  inputText.value = '';
  resizeInputAfterDomUpdate();
  branchDialogMode.value = 'switch';
  branchNewName.value = '';
  branchPullAfterSwitch.value = true;
  branchDeleteOriginal.value = true;
  branchDialogOpen.value = true;
  await loadBranchOptions();
}

async function generateBranchDialogName() {
  if (!props.clientId) {
    branchDialogError.value = 'clientId is required to generate a branch name with AI';
    return;
  }
  branchGeneratingName.value = true;
  branchDialogError.value = '';
  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~', clientId: props.clientId });
    const response = await fetch(`/api/git/branch-name?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    branchNewName.value = data.name || '';
  } catch (error) {
    branchDialogError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToGenerateBranchName');
  } finally {
    branchGeneratingName.value = false;
  }
}

async function submitBranchDialog() {
  branchDialogSubmitting.value = true;
  branchDialogError.value = '';
  try {
    if (branchDialogMode.value === 'switch') {
      const name = branchSwitchName.value.trim();
      if (!name) throw new Error(t('components.chatPanel.selectABranchToSwitchTo'));
      await runBranchSwitch(name, branchPullAfterSwitch.value, branchDeleteOriginal.value, '/branch');
    } else {
      const name = branchNewName.value.trim();
      const baseBranch = branchDialogMode.value === 'base' ? branchBaseName.value.trim() : undefined;
      if (!name) throw new Error(t('components.chatPanel.branchNameIsRequired'));
      if (branchDialogMode.value === 'base' && !baseBranch) throw new Error(t('components.chatPanel.selectABaseBranch'));
      await runBranchCreate(name, baseBranch, '/branch');
    }
    closeBranchDialog();
  } catch (error) {
    branchDialogError.value = error instanceof Error ? error.message : t('components.chatPanel.gitBranchOperationFailed');
  } finally {
    branchDialogSubmitting.value = false;
  }
}

async function runBranchCreate(name: string, baseBranch: string | undefined, userText: string) {
  addLocalMessage({ role: 'user', content: userText, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({ role: 'assistant', content: t('components.chatPanel.creatingGitBranch'), kind: 'status', status: 'pending', title: t('components.chatPanel.gitBranch') }, props.sessionId);

  try {
    const response = await fetch('/api/git/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: props.projectPath || '~', name, baseBranch }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatBranchSuccess(data);
    emit('branchChanged');
    void refreshSessionStatus();
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.gitBranchFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToCreateGitBranch');
    throw error;
  }
}

async function runBranchSwitch(name: string, pull: boolean, deleteOriginal: boolean, userText: string) {
  addLocalMessage({ role: 'user', content: userText, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({ role: 'assistant', content: t('components.chatPanel.switchingGitBranch'), kind: 'status', status: 'pending', title: t('components.chatPanel.gitBranch') }, props.sessionId);

  try {
    const response = await fetch('/api/git/switch-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: props.projectPath || '~', name, pull, deleteOriginal, sessionId: props.sessionId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatBranchSwitchSuccess(data);
    emit('branchChanged');
    void refreshSessionStatus();
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.gitBranchFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToSwitchGitBranch');
    throw error;
  }
}

async function handleBranchCommand(text: string) {
  const branchArgs = parseBranchArgs(text);
  if (!branchArgs.name) {
    await openBranchDialog();
    return;
  }

  slashCommands.close();
  inputText.value = '';
  resizeInputAfterDomUpdate();
  await runBranchCreate(branchArgs.name, branchArgs.baseBranch, text);
}

function formatCommitPreview(preview: CommitPreview) {
  const files = preview.files.length
    ? preview.files.map((file) => `- ${file.status.padEnd(2, ' ')} ${file.path}`).join('\n')
    : t('components.chatPanel.noWorkingTreeChanges');
  const action = preview.mode === 'amend' ? 'amend the previous commit' : 'create this commit';
  const heading = preview.mode === 'amend' ? '### Proposed git amend' : '### Proposed git commit';
  return `${heading}\n\nMessage:\n\n\`${preview.message}\`\n\nFiles:\n\n\`\`\`text\n${files}\n\`\`\`\n\nConfirm in the dialog to ${action}, or cancel to do nothing.`;
}

function formatCommitSuccess(data: { cwd?: string; message?: string; commit?: string; output?: string }, mode: 'commit' | 'amend') {
  const output = data.output?.trim() || (mode === 'amend' ? t('components.chatPanel.commitAmended') : t('components.chatPanel.commitCreated'));
  const heading = mode === 'amend' ? '### Git commit amended' : '### Git commit created';
  const commit = data.commit ? `\n\nCommit: \`${data.commit.slice(0, 7)}\`` : '';
  return `${heading}\n\n\`${data.cwd || props.projectPath}\`\n\nMessage: \`${data.message || commitPreview.value?.message || ''}\`${commit}\n\n\`\`\`text\n${output}\n\`\`\``;
}

async function handleCommitCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({
    role: 'assistant',
    content: t('components.chatPanel.preparingGitCommitPreview'),
    kind: 'status',
    status: 'pending',
    title: t('components.chatPanel.gitCommit'),
  }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~' });
    const commitMessage = getCommitMessage(text);
    params.set('message', commitMessage);
    const response = await fetch(`/api/git/status?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (!Array.isArray(data.files) || data.files.length === 0) {
      responseMessage.kind = 'text';
      responseMessage.status = undefined;
      responseMessage.title = undefined;
      responseMessage.content = `### Git commit\n\nNo changes to commit in \`${data.cwd || props.projectPath}\`.`;
      return;
    }

    const preview: CommitPreview = {
      cwd: data.cwd || props.projectPath || '~',
      message: data.message || commitMessage,
      files: data.files,
      mode: 'commit',
    };
    commitGenerationError.value = '';
    commitStagedOnly.value = false;
    commitPreview.value = preview;
    commitStatusMessage.value = responseMessage;
    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatCommitPreview(preview);
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.gitCommitFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToPrepareGitCommit');
  }
}

async function handleAmendCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({
    role: 'assistant',
    content: t('components.chatPanel.preparingGitAmendPreview'),
    kind: 'status',
    status: 'pending',
    title: t('components.chatPanel.gitAmend'),
  }, props.sessionId);

  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~' });
    const amendMessage = parseAmendMessageOverride(text);
    if (amendMessage) params.set('message', amendMessage);
    const response = await fetch(`/api/git/amend-status?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    const preview: CommitPreview = {
      cwd: data.cwd || props.projectPath || '~',
      message: data.message || amendMessage,
      files: Array.isArray(data.files) ? data.files : [],
      mode: 'amend',
    };
    commitGenerationError.value = '';
    commitPreview.value = preview;
    commitStatusMessage.value = responseMessage;
    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatCommitPreview(preview);
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.gitAmendFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToPrepareGitAmend');
  }
}

async function refreshCommitFiles() {
  const preview = commitPreview.value;
  if (!preview || preview.mode !== 'commit') return;

  commitGenerationError.value = '';
  try {
    const params = new URLSearchParams({ cwd: preview.cwd });
    if (commitStagedOnly.value) params.set('stagedOnly', 'true');
    const response = await fetch(`/api/git/status?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    preview.files = Array.isArray(data.files) ? data.files : [];
  } catch (error) {
    commitGenerationError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToPrepareGitCommit');
  }
}

async function generateCommitMessage() {
  const preview = commitPreview.value;
  if (!preview) return;
  if (!props.clientId) {
    commitGenerationError.value = 'clientId is required to generate a commit message with AI';
    return;
  }
  if (preview.mode === 'amend' && preview.files.length === 0) {
    commitGenerationError.value = t('components.chatPanel.noWorkingTreeChangesToGenerateA');
    return;
  }

  commitGeneratingMessage.value = true;
  commitGenerationError.value = '';
  try {
    const params = new URLSearchParams({ cwd: preview.cwd, clientId: props.clientId });
    if (preview.mode === 'commit' && commitStagedOnly.value) params.set('stagedOnly', 'true');
    const response = await fetch(`/api/git/commit-message?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    preview.message = data.message || preview.message;
  } catch (error) {
    commitGenerationError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToGenerateCommitMessage');
  } finally {
    commitGeneratingMessage.value = false;
  }
}

function cancelCommit() {
  if (commitStatusMessage.value) {
    commitStatusMessage.value.content += '\n\nCommit cancelled.';
  }
  commitPreview.value = null;
  commitStatusMessage.value = null;
  commitGenerationError.value = '';
}

async function confirmCommit() {
  const preview = commitPreview.value;
  const responseMessage = commitStatusMessage.value;
  if (!preview || !responseMessage) return;

  commitPreview.value = null;
  commitGenerationError.value = '';
  responseMessage.kind = 'status';
  responseMessage.status = 'pending';
  responseMessage.title = preview.mode === 'amend' ? t('components.chatPanel.gitAmend') : t('components.chatPanel.gitCommit');
  responseMessage.content = preview.mode === 'amend' ? t('components.chatPanel.amendingGitCommit') : t('components.chatPanel.creatingGitCommit');

  try {
    const endpoint = preview.mode === 'amend' ? '/api/git/amend' : '/api/git/commit';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cwd: preview.cwd,
        message: preview.message,
        sessionId: props.sessionId,
        ...(preview.mode === 'commit' && commitStagedOnly.value ? { stagedOnly: true } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatCommitSuccess(data, preview.mode);
    window.dispatchEvent(new CustomEvent('refresh-file-tree'));
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = preview.mode === 'amend' ? t('components.chatPanel.gitAmendFailed') : t('components.chatPanel.gitCommitFailed');
    responseMessage.content = error instanceof Error ? error.message : preview.mode === 'amend' ? t('components.chatPanel.failedToAmendGitCommit') : t('components.chatPanel.failedToCreateGitCommit');
  } finally {
    commitStatusMessage.value = null;
  }
}

function formatPrPreview(preview: GitHostingPrPreview) {
  const files = preview.files.length ? preview.files.map((file) => `- ${file.status.padEnd(2, ' ')} ${file.path}`).join('\n') : t('components.chatPanel.noUncommittedFiles');
  const provider = preview.provider === 'github' ? 'GitHub' : 'Gitea';
  return `### Proposed ${provider} PR\n\nRepository: \`${preview.owner}/${preview.repo}\`\n\nSource: \`${preview.sourceBranch}\`\nTarget: \`${preview.targetBranch}\`\n\nTitle: \`${preview.title}\`\n\nFiles:\n\n\`\`\`text\n${files}\n\`\`\`\n\nConfirm in the dialog to commit if needed, push, and create the PR.`;
}

async function loadPrBranchOptions() {
  try {
    const params = new URLSearchParams({ cwd: props.projectPath || '~' });
    const response = await fetch(`/api/git/branches?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    branchOptions.value = Array.isArray(data.branches) ? data.branches : [];
  } catch {
    branchOptions.value = [];
  }
}

async function handlePrCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  const responseMessage = addLocalMessage({ role: 'assistant', content: t('components.chatPanel.preparingPrPreview'), kind: 'status', status: 'pending', title: t('components.chatPanel.pullRequest') }, props.sessionId);
  inputText.value = '';
  resizeInputAfterDomUpdate();

  try {
    await loadPrBranchOptions();
    const preview = await gitHosting.previewPr(props.projectPath || '~', parsePrTarget(text));
    prPreview.value = preview;
    prGenerationError.value = '';
    prStatusMessage.value = responseMessage;
    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    responseMessage.content = formatPrPreview(preview);
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.pullRequestFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToPreparePullRequest');
  }
}

function cancelPr() {
  if (prStatusMessage.value) prStatusMessage.value.content += '\n\nPR creation cancelled.';
  prPreview.value = null;
  prStatusMessage.value = null;
  prGenerationError.value = '';
}

async function updatePrTargetBranch(targetBranch: string) {
  const preview = prPreview.value;
  if (!preview || !targetBranch) return;

  const previousTitle = preview.title;
  const previousBody = preview.body;
  prUpdatingTargetBranch.value = true;
  prGenerationError.value = '';
  try {
    const updatedPreview = await gitHosting.previewPr(props.projectPath || '~', targetBranch);
    updatedPreview.title = previousTitle;
    updatedPreview.body = previousBody;
    prPreview.value = updatedPreview;
    if (prStatusMessage.value) prStatusMessage.value.content = formatPrPreview(updatedPreview);
  } catch (error) {
    prGenerationError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToUpdatePrTargetBranch');
  } finally {
    prUpdatingTargetBranch.value = false;
  }
}

async function generatePrContent() {
  const preview = prPreview.value;
  if (!preview) return;
  if (prUpdatingTargetBranch.value) {
    prGenerationError.value = t('components.chatPanel.waitForTheTargetBranchPreviewTo');
    return;
  }
  if (!props.clientId) {
    prGenerationError.value = 'clientId is required to generate PR content with AI';
    return;
  }

  prGeneratingContent.value = true;
  prGenerationError.value = '';
  try {
    const content = await gitHosting.generatePrContent(props.clientId, preview, props.sessionId);
    preview.title = content.title;
    preview.body = content.body;
  } catch (error) {
    prGenerationError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToGeneratePrContent');
  } finally {
    prGeneratingContent.value = false;
  }
}

async function confirmPr() {
  const preview = prPreview.value;
  const responseMessage = prStatusMessage.value;
  if (!preview || !responseMessage) return;
  if (prUpdatingTargetBranch.value) {
    prGenerationError.value = t('components.chatPanel.waitForTheTargetBranchPreviewTo');
    return;
  }

  prPreview.value = null;
  prGenerationError.value = '';
  responseMessage.kind = 'status';
  responseMessage.status = 'pending';
  responseMessage.title = t('components.chatPanel.pullRequest');
  responseMessage.content = t('components.chatPanel.creatingPullRequest');

  try {
    const result = await gitHosting.createPr({ preview, title: preview.title, body: preview.body, commitMessage: preview.commitMessage, sessionId: props.sessionId });
    responseMessage.kind = 'text';
    responseMessage.status = undefined;
    responseMessage.title = undefined;
    const provider = preview.provider === 'github' ? 'GitHub' : 'Gitea';
    responseMessage.content = `### ${provider} PR created\n\n#${result.pullRequest.number}: ${result.pullRequest.url}`;
    window.dispatchEvent(new CustomEvent('refresh-file-tree'));
  } catch (error) {
    responseMessage.status = 'failure';
    responseMessage.title = t('components.chatPanel.pullRequestFailed');
    responseMessage.content = error instanceof Error ? error.message : t('components.chatPanel.failedToCreatePullRequest');
  } finally {
    prStatusMessage.value = null;
  }
}

async function handleModelCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  inputText.value = '';
  resizeInputAfterDomUpdate();

  if (!props.sessionId || !props.clientId) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.openOrCreateASessionBeforeChanging'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.modelSelectionFailed'),
    }, props.sessionId);
    return;
  }

  await openModelSelector(text.trim().replace(/^\/model(?:\s+|$)/i, '').trim());
}

function handleModelSelectorClick(): void {
  if (!props.sessionId || !props.clientId) {
    props.configureNewSession?.();
    return;
  }
  void openModelSelector();
}

async function openModelSelector(initialSearch = '') {
  if (!props.sessionId || !props.clientId) return;

  modelSelectorOpen.value = true;
  modelSelectorLoading.value = true;
  modelSelectorError.value = '';
  modelSearch.value = initialSearch;
  activeModelIndex.value = -1;

  await nextTick();
  modelSearchRef.value?.focus();

  try {
    const params = new URLSearchParams({ clientId: props.clientId });
    const response = await fetch(`/api/sessions/${props.sessionId}/models?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    modelOptions.value = Array.isArray(data.models) ? data.models.filter(isModelOption) : [];
    const currentModelIndex = filteredModels.value.findIndex((model) => model.current);
    activeModelIndex.value = filteredModels.value.length ? Math.max(0, currentModelIndex) : -1;
  } catch (error) {
    modelOptions.value = [];
    modelSelectorError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadModels');
  } finally {
    modelSelectorLoading.value = false;
  }
}

function closeModelSelector() {
  modelSelectorOpen.value = false;
  activeModelIndex.value = -1;
}

async function handleSkillsCommand(text: string) {
  slashCommands.close();
  addLocalMessage({ role: 'user', content: text, kind: 'text' }, props.sessionId);
  inputText.value = '';
  resizeInputAfterDomUpdate();

  if (!props.sessionId || !props.clientId) {
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.openOrCreateASessionBeforeConfiguring'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.skillConfigurationFailed'),
    }, props.sessionId);
    return;
  }

  await openSkillSelector();
}

function handleSkillSelectorClick(): void {
  if (!props.sessionId || !props.clientId) {
    props.configureNewSession?.();
    return;
  }
  void openSkillSelector();
}

async function openSkillSelector() {
  if (!props.sessionId || !props.clientId) return;

  skillSelectorOpen.value = true;
  skillSelectorLoading.value = true;
  skillSelectorError.value = '';

  try {
    await refreshSkillConfiguration();
  } catch (error) {
    skillOptions.value = [];
    skillSelectorError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToLoadSessionSkills');
  } finally {
    skillSelectorLoading.value = false;
  }
}

async function refreshSkillConfiguration(): Promise<void> {
  if (!props.sessionId || !props.clientId) {
    skillOptions.value = [];
    selectedSkills.value = [];
    skillMode.value = 'all';
    skillConfigurationLoaded.value = false;
    return;
  }

  const params = new URLSearchParams({ clientId: props.clientId });
  const response = await fetch(`/api/sessions/${props.sessionId}/skills?${params}`);
  const data: SessionSkillConfiguration & { error?: string } = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

  skillOptions.value = Array.isArray(data.skills) ? data.skills : [];
  skillMode.value = data.policy?.mode || 'all';
  selectedSkills.value = Array.isArray(data.policy?.appliedSkills) ? data.policy.appliedSkills : [];
  skillConfigurationLoaded.value = true;
}

function closeSkillSelector() {
  skillSelectorOpen.value = false;
}

async function saveSkillConfiguration() {
  if (!props.sessionId || !props.clientId) return;

  skillSelectorSaving.value = true;
  skillSelectorError.value = '';

  try {
    const response = await fetch(`/api/sessions/${props.sessionId}/skills`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: props.clientId,
        mode: skillMode.value,
        skills: skillMode.value === 'all' ? [] : selectedSkills.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    await slashCommands.loadCommands(props.sessionId, props.clientId);
    skillConfigurationLoaded.value = true;
    closeSkillSelector();
    addLocalMessage({
      role: 'assistant',
      content: formatSkillConfigurationSaved(skillMode.value, selectedSkills.value),
      kind: 'status',
      status: 'success',
      title: t('components.chatPanel.skillsUpdated'),
    }, props.sessionId);
  } catch (error) {
    skillSelectorError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToUpdateSessionSkills');
  } finally {
    skillSelectorSaving.value = false;
  }
}

function formatSkillConfigurationSaved(mode: SkillMode, skills: string[]) {
  if (mode === 'all') return t('components.chatPanel.allSkillsAreNowAvailableToThis');
  const list = skills.length ? skills.map((skill) => `\`${skill}\``).join(', ') : t('components.chatPanel.noSkills');
  return mode === 'enabled'
    ? t('components.chatPanel.onlySelectedSkillsAvailable', { list })
    : t('components.chatPanel.selectedSkillsDisabled', { list });
}

function isModelOption(value: unknown): value is ModelOption {
  const model = value as Partial<ModelOption>;
  return Boolean(model && typeof model.provider === 'string' && typeof model.id === 'string');
}

function openThinkingSelector(): void {
  if (!props.sessionId || !props.clientId || isStreaming.value || !thinkingLevels.value.length) return;
  thinkingSelectorOpen.value = true;
}

function closeThinkingSelector(): void {
  thinkingSelectorOpen.value = false;
}

async function selectThinkingLevel(level: string): Promise<void> {
  if (!props.sessionId || !props.clientId || !level) return;

  thinkingLevelChanging.value = true;
  try {
    const response = await fetch(`/api/sessions/${props.sessionId}/thinking-level`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, level }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    sessionStatus.value = data;
    closeThinkingSelector();
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.thinkingLevelChangedTo', { level }),
      kind: 'status',
      status: 'success',
      title: t('components.chatPanel.thinkingLevelChanged'),
    }, props.sessionId);
  } catch (error) {
    addLocalMessage({
      role: 'assistant',
      content: error instanceof Error ? error.message : t('components.chatPanel.failedToChangeThinkingLevel'),
      kind: 'status',
      status: 'failure',
      title: t('components.chatPanel.thinkingLevelChangeFailed'),
    }, props.sessionId);
  } finally {
    thinkingLevelChanging.value = false;
  }
}

async function selectModel(model: ModelOption) {
  if (!props.sessionId || !props.clientId) return;

  try {
    const response = await fetch(`/api/sessions/${props.sessionId}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: props.clientId, provider: model.provider, modelId: model.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    sessionStatus.value = data;
    modelOptions.value = modelOptions.value.map((item) => ({
      ...item,
      current: item.provider === model.provider && item.id === model.id,
    }));
    closeModelSelector();
    addLocalMessage({
      role: 'assistant',
      content: t('components.chatPanel.modelChangedTo', { model: model.name || model.id, provider: model.provider }),
      kind: 'status',
      status: 'success',
      title: t('components.chatPanel.modelChanged'),
    }, props.sessionId);
  } catch (error) {
    modelSelectorError.value = error instanceof Error ? error.message : t('components.chatPanel.failedToChangeModel');
  }
}

function insertTrigger(char: string) {
  const input = inputRef.value;
  if (!input) return;

  const start = input.selectionStart ?? inputText.value.length;
  const end = input.selectionEnd ?? start;
  inputText.value = inputText.value.slice(0, start) + char + inputText.value.slice(end);

  // Move cursor after the inserted character
  nextTick(() => {
    input.focus();
    input.setSelectionRange(start + 1, start + 1);
    handleInput();
  });
}

function handleInput() {
  promptPolishError.value = '';
  handleCaretChange();
  resizeInput();
}

function handleInputFocus() {
  selectedMessageIndex.value = -1;
}

function handleCaretChange() {
  updateSlashQuery();
  updateFileSearchQuery();
}

function deletePreviousInputWord(event: KeyboardEvent) {
  const input = inputRef.value;
  if (event.target !== input || !input) return false;

  event.preventDefault();

  const start = input.selectionStart ?? inputText.value.length;
  const end = input.selectionEnd ?? start;
  let deleteStart = start;

  if (start === end) {
    while (deleteStart > 0 && /\s/.test(inputText.value[deleteStart - 1])) deleteStart -= 1;
    while (deleteStart > 0 && !/\s/.test(inputText.value[deleteStart - 1])) deleteStart -= 1;
  }

  inputText.value = inputText.value.slice(0, deleteStart) + inputText.value.slice(end);

  nextTick(() => {
    input.setSelectionRange(deleteStart, deleteStart);
    handleInput();
  });

  return true;
}

function clearInput(event: KeyboardEvent) {
  const input = inputRef.value;
  if (event.target !== input || !input) return false;

  event.preventDefault();
  inputText.value = '';

  nextTick(() => {
    input.setSelectionRange(0, 0);
    handleInput();
  });

  return true;
}

function updateFileSearchQuery() {
  const input = inputRef.value;
  if (!input) return;
  fileSearch.updateQuery(inputText.value, input.selectionStart ?? inputText.value.length);
}

function updateSlashQuery() {
  if (isReviewMode.value) {
    slashCommands.close();
    return;
  }

  const input = inputRef.value;
  if (!input) return;
  slashCommands.updateQuery(inputText.value, input.selectionStart ?? inputText.value.length);
}

async function insertSlashCommand(command: SlashCommandItem) {
  const token = slashCommands.activeToken.value;
  if (!token) return;

  const next = replaceSlashToken(inputText.value, token, command.insertText);
  inputText.value = next.text;
  slashCommands.close();

  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.setSelectionRange(next.cursor, next.cursor);
  resizeInput();
}

function clearReviewInput(): void {
  inputText.value = '';
  fileSearch.close();
  resizeInputAfterDomUpdate();
}

async function insertFileReference(file: FileSearchResult) {
  const token = fileSearch.activeToken.value;
  if (!token) return;

  const next = replaceFileToken(inputText.value, token, file.path);
  inputText.value = next.text;
  fileSearch.selectFile(file);

  await nextTick();
  inputRef.value?.focus();
  inputRef.value?.setSelectionRange(next.cursor, next.cursor);
  resizeInput();
  
  window.dispatchEvent(new CustomEvent('open-file-in-editor', {
    detail: { path: file.path, kind: 'path', onlyIfEditorVisible: !isReviewMode.value }
  }));
}

function selectMessageBlock(index: number) {
  selectedMessageIndex.value = index;
}

function handleMessagesKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();

  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

  if (key === 'escape' || key === 'enter' || key === 'i') {
    event.preventDefault();
    event.stopPropagation();
    focusInput();
    return;
  }

  if (key === '/') {
    event.preventDefault();
    event.stopPropagation();
    focusInput({ prefix: '/' });
    return;
  }

  if (key !== 'arrowdown' && key !== 'arrowup') return;

  const target = event.target as HTMLElement | null;
  if (target?.matches('textarea, input, [contenteditable="true"]')) return;

  const blocks = messagesRef.value?.querySelectorAll<HTMLElement>('.message-block');
  if (!blocks?.length) return;

  event.preventDefault();

  if (key === 'arrowdown' && selectedMessageIndex.value >= blocks.length - 1) {
    selectedMessageIndex.value = -1;
    inputRef.value?.focus();
    return;
  }

  const direction = key === 'arrowdown' ? 1 : -1;
  selectedMessageIndex.value = Math.min(
    blocks.length - 1,
    Math.max(0, selectedMessageIndex.value + direction),
  );

  const activeBlock = blocks[selectedMessageIndex.value];
  activeBlock?.focus({ preventScroll: true });
  activeBlock?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function handleInputKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();

  if (key === 'backspace' && event.ctrlKey && deletePreviousInputWord(event)) return;
  if (key === 'u' && event.ctrlKey && clearInput(event)) return;

  if (slashCommands.isOpen.value) {
    if (key === 'arrowdown') {
      event.preventDefault();
      slashCommands.move(1);
      return;
    }

    if (key === 'arrowup') {
      event.preventDefault();
      slashCommands.move(-1);
      return;
    }

    if (key === 'escape') {
      event.preventDefault();
      slashCommands.close();
      return;
    }

    if (key === 'tab' || key === 'enter') {
      event.preventDefault();
      const command = slashCommands.getActiveCommand();
      if (command) insertSlashCommand(command);
      return;
    }
  }

  if (fileSearch.isOpen.value) {
    if (key === 'arrowdown') {
      event.preventDefault();
      fileSearch.move(1);
      return;
    }

    if (key === 'arrowup') {
      event.preventDefault();
      fileSearch.move(-1);
      return;
    }

    if (key === 'escape') {
      event.preventDefault();
      fileSearch.close();
      return;
    }

    if (key === 'tab' || key === 'enter') {
      event.preventDefault();
      const file = fileSearch.getActiveFile();
      if (file) insertFileReference(file);
      return;
    }
  }

  if (key === 'arrowup' && !inputText.value && (inputRef.value?.selectionStart ?? 0) === 0) {
    const target = event.target as HTMLElement | null;
    if (target === inputRef.value) {
      event.preventDefault();
      focusMessagesEnd();
      return;
    }
  }

  // Review composers remain editable, so Enter inserts a newline instead of invoking any send path.
  if (isReviewMode.value && key === 'enter') return;

  if (key === 'enter' && event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    void handleSendToNewSession();
    return;
  }

  if (key === 'enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}
</script>

<style scoped>
.chat-workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}



.discussion-pane,


.chat-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-shell {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.messages {
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* Keep the final message above the floating controls at the scroll boundary. */
  padding: 1rem 1rem 5.875rem;
  display: flex;
  flex-direction: column;
}

.message-block {
  display: flow-root;
  flex: 0 0 auto;
}

.message-block:focus {
  outline: none;
}

.message-block.is-selected :deep(.message-bubble),
.message-block.is-selected :deep(.chat-event-row) {
  box-shadow: 0 0 0 1px var(--accent);
}

.floating-chat-controls {
  position: absolute;
  right: 2rem;
  bottom: 2.25rem;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

.floating-button-row {
  display: flex;
  gap: 0.5rem;
}

.floating-chat-btn,
.view-option-row {
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(10px);
}

.floating-chat-btn {
  width: 2.625rem;
  height: 2.625rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
}

.view-options-popover {
  min-width: 11rem;
  padding: 0.375rem;
  background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.view-option-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.625rem;
  border-radius: var(--radius-sm);
  box-shadow: none;
  font-size: 0.75rem;
  text-align: left;
}

.view-option-row span {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.view-option-row strong {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
}

.view-option-row:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.floating-chat-btn:hover,
.floating-chat-btn:focus-visible,
.view-option-row:hover,
.view-option-row:focus-visible {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--border-subtle);
  outline: none;
}

.floating-chat-btn:active,
.view-option-row:active:not(:disabled) {
  transform: scale(0.96);
}

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
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.75rem;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast) var(--ease-out);
  border: 1px solid var(--border);
  z-index: 100;
  box-shadow: var(--shadow-md);
}

.tooltip:hover::after {
  opacity: 1;
}

.tooltip-above::after {
  top: auto;
  bottom: calc(100% + 6px);
}

/* Let above-positioned tooltips escape the selector buttons' text clipping. */
.composer-skill-selector.tooltip,
.composer-model-selector.tooltip,
.composer-thinking-selector.tooltip {
  overflow: visible;
}

.streaming-indicator {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.5rem;
  width: fit-content;
  margin: 0 0 0.6rem 1rem;
  padding: 0.25rem 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.streaming-spinner {
  display: grid;
  grid-template-columns: repeat(2, 0.28rem);
  grid-template-rows: repeat(3, 0.28rem);
  gap: 0.105rem;
  flex: 0 0 auto;
}

.streaming-spinner-dot {
  width: 0.28rem;
  height: 0.28rem;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--accent-muted);
  animation: streaming-spinner-dot 1s infinite ease-in-out;
}

.streaming-spinner-dot:nth-child(1) { animation-delay: 0s; }
.streaming-spinner-dot:nth-child(2) { animation-delay: 0.12s; }
.streaming-spinner-dot:nth-child(3) { animation-delay: 0.6s; }
.streaming-spinner-dot:nth-child(4) { animation-delay: 0.24s; }
.streaming-spinner-dot:nth-child(5) { animation-delay: 0.48s; }
.streaming-spinner-dot:nth-child(6) { animation-delay: 0.36s; }

.streaming-copy {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5rem;
  line-height: 1;
}

.streaming-label {
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1;
}

.streaming-elapsed {
  position: relative;
  top: 0.06em;
  min-width: 2ch;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

@keyframes streaming-spinner-dot {
  0%, 100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.input-area {
  position: relative;
  min-width: 0;
  padding: 0.875rem 1rem 1rem;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
}

.input-resize-handle {
  position: absolute;
  z-index: 2;
  top: -5px;
  left: 0;
  width: 100%;
  height: 10px;
  cursor: ns-resize;
  touch-action: none;
}

.input-resize-handle::after {
  content: '';
  position: absolute;
  top: 4px;
  left: 0;
  width: 100%;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}

.input-resize-handle:hover::after,
.input-resize-handle.is-resizing::after {
  background: var(--accent);
}

.composer-shell {
  flex: 1;
  min-width: 0;
  padding: 0.625rem 0.875rem 0.5rem;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: border-color var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out);
}

.composer-shell:focus-within,
.composer-shell.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.composer-shell.drag-over {
  background: color-mix(in srgb, var(--accent-muted) 45%, var(--bg-surface));
}

.attachment-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.attachment-item {
  width: min(16rem, 100%);
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.attachment-item img {
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: zoom-in;
}

.message-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.82);
}

.message-image-lightbox-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xl);
}

.message-image-lightbox-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  color: #fff;
  background: rgba(0, 0, 0, 0.48);
  font-size: 1.75rem;
  line-height: 1;
}

.message-image-lightbox-close:hover {
  background: rgba(255, 255, 255, 0.16);
}

.attachment-details {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
}

.attachment-details strong,
.attachment-details small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-details strong {
  font-size: 0.75rem;
}

.attachment-details small {
  color: var(--text-tertiary);
  font-size: 0.65rem;
}

.attachment-remove,
.attach-image-btn,
.prompt-polish-btn,
.switch-model-btn {
  color: var(--text-secondary);
}

.attachment-remove,
.attach-image-btn,
.prompt-polish-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
}

.attachment-remove:hover,
.attach-image-btn:hover,
.prompt-polish-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.mobile-camera-btn {
  display: none;
}

.prompt-polish-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.attachment-error,
.prompt-polish-error,
.attachment-model-warning {
  margin: 0 0 0.5rem;
  color: var(--error);
  font-size: 0.75rem;
  line-height: 1.35;
}

.switch-model-btn {
  margin-left: 0.25rem;
  color: var(--accent);
  font-weight: 700;
  text-decoration: underline;
}

.image-file-input {
  display: none;
}

.composer-shell textarea {
  display: block;
  width: 100%;
  min-height: 36px;
  max-height: 276px;
  padding: 0;
  resize: none;
  overflow-y: hidden;
  background: transparent;
  border: 0;
  border-radius: 0;
  line-height: 1.5;
  font-size: 0.9375rem;
}

.composer-shell textarea:focus {
  border-color: transparent;
  box-shadow: none;
}

.composer-shell textarea::placeholder {
  color: var(--text-tertiary);
}

.composer-meta-row {
  margin-top: 0.375rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  gap: 0.75rem;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.2;
}

.composer-hint {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-skill-selector,
.composer-model-selector {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 35%;
  display: inline-flex;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
}

.composer-skill-selector:hover:not(:disabled),
.composer-model-selector:hover:not(:disabled) {
  color: var(--text-primary);
}

.composer-skill-selector:disabled,
.composer-model-selector:disabled {
  cursor: not-allowed;
}

.composer-thinking-selector {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 7rem;
  display: inline-flex;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.composer-selector-label {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-thinking-selector:hover:not(:disabled) {
  color: var(--text-primary);
}

.composer-thinking-selector:disabled {
  cursor: not-allowed;
}

.model-selector-modal.thinking-selector-modal {
  width: min(480px, 100%);
}

.model-selector-modal.model-selector-dialog {
  width: min(460px, 100%);
}

.composer-context {
  flex: 0 1 auto;
  color: var(--text-secondary);
  white-space: nowrap;
}

.composer-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}

/* Keep the stop action prominent above Send without changing mobile's row layout. */
.composer-actions > .stop-btn {
  order: -1;
}

.send-btn,
.stop-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0.625rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 600;
  transition: color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out);
}

.send-btn {
  min-width: 4.5rem;
  background: var(--accent);
  color: white;
}

.stop-btn {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.stop-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--text-tertiary);
}

.send-btn:active:not(:disabled),
.stop-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.send-btn:disabled,
.stop-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.commit-preview {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}

.commit-preview-label {
  margin-top: 0.25rem;
  color: var(--text-primary);
  font-weight: 700;
}

.pr-ai-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.pr-ai-generate-btn {
  min-height: 34px;
  padding: 0.375rem 0.625rem;
  gap: 0.35rem;
}

.commit-message-input {
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  resize: vertical;
}

.commit-preview-empty {
  margin: 0;
  padding: 0.625rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-secondary);
}

.commit-file-list {
  max-height: 220px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.commit-file-list li {
  display: flex;
  gap: 0.375rem;
  padding: 0.2rem 0.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
}

.commit-file-status {
  flex: 0 0 2.5rem;
  color: var(--text-secondary);
  font-weight: 700;
}

.model-selector-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.model-selector-modal {
  width: min(720px, 100%);
  max-height: min(720px, calc(100vh - 2rem));
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1.25rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}

.model-selector-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.model-selector-header h3 {
  margin: 0 0 0.25rem;
  color: var(--text-primary);
}

.model-selector-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.model-search-input {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
}

.model-list {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.model-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.model-option:last-child {
  border-bottom: 0;
}

.model-option:hover,
.model-option.current,
.model-option.keyboard-active {
  background: var(--bg-elevated);
}

.model-option-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.model-name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}

.model-capability {
  flex: 0 0 auto;
  width: fit-content;
  padding: 0.1rem 0.35rem;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: var(--radius-full);
  font-size: 0.65rem;
  font-weight: 700;
}

.model-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
}

.model-current {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 800;
}

.model-selector-empty {
  padding: 1rem;
  color: var(--text-secondary);
  text-align: center;
}

.model-selector-empty.error {
  color: var(--error);
}

.skill-selector-modal {
  width: min(760px, 100%);
}

.skill-mode-options {
  display: grid;
  gap: 0.5rem;
}

.skill-mode-option {
  display: flex;
  gap: 0.625rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
}

.skill-mode-option span {
  display: grid;
  gap: 0.2rem;
}

.skill-mode-option small {
  color: var(--text-secondary);
}

.skill-picker-muted {
  opacity: 0.55;
}

.skill-selector-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.branch-dialog-modal {
  width: min(600px, 100%);
}

.branch-dialog-fields {
  display: grid;
  gap: 0.75rem;
}

.branch-name-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
}

.branch-checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-primary);
}

.branch-checkbox-row code {
  color: var(--text-secondary);
}

.branch-dialog-hint {
  margin: -0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

/* ── Mobile trigger buttons (hidden on desktop) ────────────────────────── */

.mobile-trigger-btns {
  display: none;
}

/* ── Mobile ────────────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .messages {
    padding: 0.75rem;
    overscroll-behavior-y: contain;
  }

  .input-area {
    flex-wrap: wrap;
    padding: 0.75rem;
    gap: 0.5rem;
  }

  .composer-shell {
    flex-basis: 100%;
  }

  .composer-hint {
    display: none;
  }

  .mobile-camera-btn {
    display: inline-flex;
  }

  .composer-skill-selector,
  .composer-model-selector,
  .composer-thinking-selector,
  .composer-context {
    max-width: 100%;
  }

  .mobile-trigger-btns {
    display: flex;
    gap: 0.5rem;
    order: 2;
  }

  .trigger-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 40px;
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 1.125rem;
    font-weight: 600;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    transition: background var(--duration-fast) var(--ease-out),
                color var(--duration-fast) var(--ease-out);
  }

  .trigger-btn:hover {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .trigger-btn:active {
    transform: scale(0.95);
  }

  .trigger-btn-clear {
    display: none;
  }

  .composer-actions {
    flex: 1;
    order: 3;
    flex-direction: row;
    gap: 0.5rem;
    min-width: 0;
  }

  .composer-actions > .stop-btn {
    order: initial;
  }

  .send-btn,
  .stop-btn {
    flex: 1;
    min-height: 40px;
    padding: 0.5rem 0.75rem;
  }

  .floating-chat-controls {
    display: none;
  }
}
</style>
