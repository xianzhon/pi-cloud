<template>
  <Teleport to="body">
    <Transition name="memory-center">
      <div v-if="visible" class="memory-center-backdrop">
        <section
          ref="dialogRef"
          class="memory-center-dialog memory-center-dialog--responsive"
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-center-title"
          @keydown="handleKeydown"
        >
          <header class="memory-center-header">
            <div class="memory-title-block">
              <div class="memory-title-line">
                <span class="memory-title-mark" aria-hidden="true"><PhBrain :size="18" weight="fill" /></span>
                <h2 id="memory-center-title">{{ t('components.memoryCenter.memoryCenter') }}</h2>
              </div>
              <p class="memory-context">{{ profileLabel }} <span aria-hidden="true">·</span> {{ projectPath }}</p>
            </div>
            <div class="memory-header-actions">
              <button
                v-if="sessionId"
                class="memory-button memory-button--quiet memory-extract-button"
                type="button"
                @click="extractCurrentSession"
              >
                <PhDownloadSimple :size="15" weight="bold" />
                <span>{{ t('components.memoryCenter.extractCurrentSession') }}</span>
              </button>
              <button
                v-if="activeTab !== 'review'"
                class="memory-button memory-button--quiet memory-tidy-button"
                type="button"
                :disabled="tidyBusy"
                @click="reviewTidySuggestions"
              >
                <PhBroom :size="15" weight="bold" />
                <span>{{ t('components.memoryCenter.tidyUp') }}</span>
              </button>
              <button class="memory-button memory-button--primary memory-add-button" type="button" @click="startAdd">
                <PhPlus :size="15" weight="bold" />
                <span>{{ t('components.memoryCenter.addMemory') }}</span>
              </button>
              <button class="memory-icon-button memory-close" type="button" :aria-label="t('components.memoryCenter.closeMemoryCenter')" @click="emit('close')">
                <PhX :size="17" weight="bold" />
              </button>
            </div>
          </header>

          <nav class="memory-tabs" :aria-label="t('components.memoryCenter.memoryScopes')">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              class="memory-tab"
              :class="{ 'is-active': activeTab === tab.id, 'memory-tab--review': tab.id === 'review' }"
              :data-tab="tab.id"
              @click="selectTab(tab.id)"
            >
              <span>{{ tab.label }}</span>
              <span class="memory-tab-count">{{ tab.count }}</span>
            </button>
          </nav>

          <div class="memory-center-body">
            <aside class="memory-filter-rail" :aria-label="t('components.memoryCenter.memoryFilters')">
              <label class="memory-search-wrap">
                <PhMagnifyingGlass :size="15" aria-hidden="true" />
                <input
                  ref="searchInputRef"
                  v-model="searchQuery"
                  class="memory-search"
                  type="search"
                  :placeholder="t('components.memoryCenter.searchMemories')"
                  :aria-label="t('components.memoryCenter.searchMemories2')"
                  @input="onFilterChange"
                />
              </label>

              <label class="memory-filter-field">
                <span>{{ t('components.memoryCenter.category') }}</span>
                <CustomSelect
                  id="memory-category-filter"
                  class="memory-filter-select memory-category-select"
                  :model-value="selectedCategory"
                  :options="categoryFilterOptions"
                  :aria-label="t('components.memoryCenter.category')"
                  @update:model-value="setCategoryFilter"
                />
              </label>

              <label class="memory-filter-field">
                <span>{{ t('components.memoryCenter.state') }}</span>
                <CustomSelect
                  id="memory-state-filter"
                  class="memory-filter-select memory-state-select"
                  :model-value="selectedState"
                  :options="stateFilterOptions"
                  :aria-label="t('components.memoryCenter.state')"
                  @update:model-value="setStateFilter"
                />
              </label>

              <div class="memory-scope-note">
                <span class="memory-scope-dot" aria-hidden="true"></span>
                <p v-if="activeTab === 'project'">{{ t('components.memoryCenter.sharedWithManagedWorktreesForThisBase') }}</p>
                <p v-else-if="activeTab === 'global'">{{ t('components.memoryCenter.availableAcrossProjectsInThisProfile') }}</p>
                <p v-else>{{ t('components.memoryCenter.globalProposalsStayInactiveUntilApproved') }}</p>
              </div>
            </aside>

            <main class="memory-list-pane">
              <div v-if="counts.pinnedOverflow" class="memory-notice memory-pinned-warning" role="status">
                {{ t('components.memoryCenter.pinnedMemoryExceedsTheRecallBudgetUnpin') }}
              </div>
              <div v-if="warning" class="memory-notice memory-warning" role="status">
                <div class="memory-warning-heading">
                  <strong>{{ warning }}</strong>
                  <span v-if="failedExtractions.length === 0">{{ t('components.memoryCenter.openServerLogsForDetails') }}</span>
                </div>
                <div v-for="run in failedExtractions" :key="run.id" class="memory-failed-run">
                  <div class="memory-failed-run-body">
                    <span>{{ run.error || 'No error reason was recorded.' }}</span>
                    <small>{{ failedRunModelLabel(run) }} · {{ formatFailedRunDate(run) }}</small>
                  </div>
                  <div class="memory-failed-run-actions">
                    <button class="memory-text-button" type="button" @click="retryFailure(run.id)">{{ t('components.memoryCenter.retry') }}</button>
                    <button class="memory-text-button" type="button" @click="clearFailure(run.id)">{{ t('components.memoryCenter.clear') }}</button>
                  </div>
                </div>
              </div>

              <form v-if="showAddEditor" class="memory-editor memory-add-editor" @submit.prevent="submitAdd">
                <div class="memory-editor-heading">
                  <strong>{{ t('components.memoryCenter.newScopeMemory', { scope: t(`components.memoryCenter.scope.${addDraft.scope}`) }) }}</strong>
                  <button type="button" class="memory-text-button" @click="showAddEditor = false">{{ t('components.memoryCenter.cancel') }}</button>
                </div>
                <textarea v-model="addDraft.content" rows="3" maxlength="2000" :placeholder="t('components.memoryCenter.oneConciseDurableClaim')" required></textarea>
                <div class="memory-editor-grid">
                  <select v-model="addDraft.category" :aria-label="t('components.memoryCenter.newMemoryCategory')">
                    <option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
                  </select>
                  <input v-model="addDraft.tags" type="text" :placeholder="t('components.memoryCenter.tagsCommaSeparated')" :aria-label="t('components.memoryCenter.newMemoryTags')" />
                  <label class="memory-check"><input v-model="addDraft.pinned" type="checkbox" /> {{ t('components.memoryCenter.pinForRecall') }}</label>
                  <select
                    v-if="addDraft.pinned"
                    v-model="addDraft.pinnedApplicability"
                    :aria-label="t('components.memoryCenter.newPinnedApplicability')"
                  >
                    <option value="always">{{ t('components.memoryCenter.alwaysApplicable') }}</option>
                    <option value="matched">{{ t('components.memoryCenter.onlyWhenMatched') }}</option>
                  </select>
                  <button class="memory-button memory-button--primary" type="submit">{{ t('components.memoryCenter.saveMemory') }}</button>
                </div>
              </form>

              <section v-if="showTidyReview" class="memory-tidy-panel" aria-live="polite">
                <div class="memory-tidy-heading">
                  <div>
                    <strong>{{ t('components.memoryCenter.tidyUpSuggestions') }}</strong>
                    <p>{{ t('components.memoryCenter.reviewFirstApplyingArchivesSelectedStaleOr') }}</p>
                  </div>
                  <button class="memory-text-button" type="button" @click="closeTidyReview">{{ t('components.memoryCenter.close') }}</button>
                </div>
                <div v-if="tidyStatus" class="memory-tidy-status" role="status">{{ tidyStatus }}</div>
                <div v-if="tidyBusy" class="memory-tidy-empty" role="status">{{ t('components.memoryCenter.checkingActiveMemories', { scope: t(`components.memoryCenter.scope.${activeTab}`) }) }}</div>
                <div v-else-if="tidySuggestions.length === 0" class="memory-tidy-empty">
                  No duplicates or stale contradictions found in active {{ activeTab }} memories.
                </div>
                <template v-else>
                  <label v-for="suggestion in tidySuggestions" :key="suggestion.id" class="memory-tidy-suggestion">
                    <input
                      type="checkbox"
                      :checked="selectedTidyIds.has(suggestion.archive.id)"
                      @change="toggleTidySelection(suggestion.archive.id)"
                    />
                    <span class="memory-tidy-copy">
                      <span class="memory-chip memory-chip--category">{{ tidyReasonLabel(suggestion.reason) }}</span>
                      <span>{{ suggestion.explanation }}</span>
                      <del>{{ suggestion.archive.content }}</del>
                      <strong>{{ t('components.memoryCenter.keepMemory', { content: suggestion.keep.content }) }}</strong>
                    </span>
                  </label>
                </template>
                <div v-if="tidySuggestions.length" class="memory-tidy-actions">
                  <button class="memory-button memory-button--quiet" type="button" :disabled="tidyBusy" @click="selectAllTidySuggestions">{{ t('components.memoryCenter.selectAll') }}</button>
                  <button class="memory-button memory-button--primary" type="button" :disabled="tidyBusy || selectedTidySuggestions.length === 0" @click="applyTidySuggestions">
                    Archive {{ selectedTidySuggestions.length }} selected
                  </button>
                </div>
              </section>

              <div class="memory-list-heading">
                <div>
                  <span class="memory-eyebrow">{{ activeTab === 'review' ? t('components.memoryCenter.approvalQueue') : t('components.memoryCenter.scopeLedger', { scope: t(`components.memoryCenter.scope.${activeTab}`) }) }}</span>
                  <strong>{{ t(totalMemories === 1 ? 'components.memoryCenter.memoryCount' : 'components.memoryCenter.memoriesCount', { count: totalMemories }) }}</strong>
                </div>
                <span class="memory-list-hint">{{ t('components.memoryCenter.toInspect') }}</span>
              </div>

              <div v-if="loading" class="memory-state memory-loading" role="status">
                <span class="memory-spinner" aria-hidden="true"></span>
                {{ t('components.memoryCenter.loadingMemory') }}
              </div>
              <div v-else-if="error" class="memory-state memory-error" role="alert">{{ error }}</div>
              <div v-else-if="displayedMemories.length === 0" class="memory-state memory-empty">
                <PhBrain :size="28" weight="duotone" aria-hidden="true" />
                <strong>{{ t('components.memoryCenter.noMemoriesInThisView') }}</strong>
                <span>{{ t('components.memoryCenter.adjustTheFiltersOrAddOneDurable') }}</span>
              </div>

              <div v-else ref="rowListRef" class="memory-list" role="list">
                <article
                  v-for="(memory, index) in displayedMemories"
                  :key="memory.id"
                  data-memory-row
                  class="memory-row"
                  :class="{ 'is-focused': focusedIndex === index, 'is-pending': memory.status === 'pending' }"
                  :aria-current="focusedIndex === index ? 'true' : undefined"
                  tabindex="-1"
                  role="listitem"
                  @mouseenter="focusedIndex = index"
                  @focus="focusedIndex = index"
                >
                  <div class="memory-row-topline">
                    <div class="memory-chips">
                      <span class="memory-chip memory-chip--category">{{ memory.category }}</span>
                      <span class="memory-chip">{{ sourceLabel(memory.source) }}</span>
                      <span v-if="memory.pinned" class="memory-chip memory-chip--pinned"><PhPushPin :size="11" weight="fill" /> {{ t('components.memoryCenter.pinnedApplicability', { applicability: t(`components.memoryCenter.applicability.${memory.pinnedApplicability || 'always'}`) }) }}</span>
                      <span v-if="memory.status !== 'active'" class="memory-chip" :class="`memory-chip--${memory.status}`">{{ t(`components.memoryCenter.statuses.${memory.status}`) }}</span>
                    </div>
                    <div v-if="activeTab !== 'review'" class="memory-row-actions">
                      <button class="memory-row-button memory-action-edit" type="button" :aria-label="t('components.memoryCenter.editMemoryLabel', { content: memory.content })" @click="startEdit(memory)">
                        <PhPencilSimple :size="14" />
                      </button>
                      <button class="memory-row-button memory-action-pin" type="button" :aria-label="memory.pinned ? t('components.memoryCenter.unpinMemory') : t('components.memoryCenter.pinMemory')" @click="togglePin(memory)">
                        <PhPushPin :size="14" :weight="memory.pinned ? 'fill' : 'regular'" />
                      </button>
                      <button
                        v-if="memory.status === 'archived'"
                        class="memory-row-button memory-action-restore"
                        type="button"
                        :aria-label="t('components.memoryCenter.restoreMemory')"
                        @click="restore(memory)"
                      >
                        <PhArrowCounterClockwise :size="14" />
                      </button>
                      <button v-else class="memory-row-button memory-action-archive" type="button" :aria-label="t('components.memoryCenter.archiveMemory')" @click="archive(memory)">
                        <PhArchive :size="14" />
                      </button>
                      <button class="memory-row-button memory-action-delete" type="button" :aria-label="t('components.memoryCenter.deleteMemory')" @click="deleteMemory(memory)">
                        <PhTrash :size="14" />
                      </button>
                    </div>
                  </div>

                  <p class="memory-content">{{ memory.content }}</p>

                  <form v-if="editingId === memory.id" class="memory-editor memory-edit-editor" @submit.prevent="submitEdit(memory)">
                    <textarea v-model="editDraft.content" rows="3" maxlength="2000" required></textarea>
                    <div class="memory-editor-grid">
                      <select v-model="editDraft.category" :aria-label="t('components.memoryCenter.editMemoryCategory')">
                        <option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
                      </select>
                      <input v-model="editDraft.tags" :aria-label="t('components.memoryCenter.editMemoryTags')" />
                      <label class="memory-check"><input v-model="editDraft.pinned" type="checkbox" /> {{ t('components.memoryCenter.pinned') }}</label>
                      <select
                        v-if="editDraft.pinned"
                        v-model="editDraft.pinnedApplicability"
                        :aria-label="t('components.memoryCenter.editPinnedApplicability')"
                      >
                        <option value="always">{{ t('components.memoryCenter.alwaysApplicable') }}</option>
                        <option value="matched">{{ t('components.memoryCenter.onlyWhenMatched') }}</option>
                      </select>
                      <button class="memory-button memory-button--primary" type="submit">{{ t('components.memoryCenter.saveChanges') }}</button>
                    </div>
                  </form>

                  <blockquote v-if="activeTab === 'review' && memory.evidence" class="memory-evidence">
                    <span>{{ t('components.memoryCenter.evidence') }}</span>
                    {{ memory.evidence }}
                  </blockquote>

                  <form v-if="reviewEditingId === memory.id" class="memory-editor memory-review-editor" @submit.prevent="approveEdited(memory)">
                    <textarea v-model="reviewDraft.content" rows="3" maxlength="2000" required></textarea>
                    <div class="memory-editor-grid">
                      <select v-model="reviewDraft.category" :aria-label="t('components.memoryCenter.reviewMemoryCategory')">
                        <option v-for="category in categories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
                      </select>
                      <input v-model="reviewDraft.tags" :aria-label="t('components.memoryCenter.reviewMemoryTags')" />
                      <span></span>
                      <button class="memory-button memory-button--primary" type="submit">{{ t('components.memoryCenter.approveChanges') }}</button>
                    </div>
                  </form>

                  <div v-if="activeTab === 'review'" class="memory-review-actions">
                    <button class="memory-button memory-button--approve memory-review-approve" type="button" @click="approve(memory)"><PhCheck :size="14" weight="bold" /> {{ t('components.memoryCenter.approve') }}</button>
                    <button class="memory-button memory-button--quiet memory-review-edit" type="button" @click="startReviewEdit(memory)"><PhPencilSimple :size="14" /> {{ t('components.memoryCenter.editAndApprove') }}</button>
                    <button class="memory-button memory-button--danger memory-review-reject" type="button" @click="reject(memory)"><PhTrash :size="14" /> {{ t('components.memoryCenter.reject') }}</button>
                  </div>

                  <footer class="memory-row-footer">
                    <span v-if="memory.tags.length">{{ memory.tags.join(' · ') }}</span>
                    <span v-else>{{ t('components.memoryCenter.noTags') }}</span>
                    <span class="memory-provenance">
                      <button
                        v-if="memory.sourceSessionId"
                        class="memory-source-session"
                        type="button"
                        @click="emit('openSession', memory.sourceSessionId)"
                      >{{ t('components.memoryCenter.sourceSession') }}</button>
                      <span>{{ formatDate(memory.updatedAt) }}</span>
                    </span>
                  </footer>
                </article>
              </div>

              <button
                v-if="canLoadMore"
                class="memory-load-more"
                type="button"
                @click="loadMore"
              >
                Load {{ Math.min(50, totalMemories - filteredMemories.length) }} more
              </button>
            </main>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { i18n } from '../i18n';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import {
  PhArchive,
  PhArrowCounterClockwise,
  PhBrain,
  PhBroom,
  PhCheck,
  PhDownloadSimple,
  PhMagnifyingGlass,
  PhPencilSimple,
  PhPlus,
  PhPushPin,
  PhTrash,
  PhX,
} from '@phosphor-icons/vue';
import type { MemoryController } from '../composables/useMemories';
import type { MemoryCategory, MemoryExtractionRun, MemoryFilters, MemoryPinnedApplicability, MemoryRecord, MemoryScope, MemoryStatus } from '../types/memory';
import { findMemoryTidySuggestions, type MemoryTidyReason, type MemoryTidySuggestion } from '../utils/memoryTidy';
import CustomSelect, { type CustomSelectOption } from './CustomSelect.vue';

const t = i18n.global.t;

type MemoryTab = 'project' | 'global' | 'review';
type MemoryStateFilter = 'active' | 'pending' | 'pinned' | 'archived' | 'all';

const props = defineProps<{
  visible: boolean;
  controller: MemoryController;
  profileLabel: string;
  projectPath: string;
  sessionId?: string;
  reviewRunId?: string;
}>();

const emit = defineEmits<{
  close: [];
  openSession: [sessionId: string];
  reviewRunConsumed: [];
}>();

const categories: MemoryCategory[] = ['rule', 'preference', 'decision', 'fact', 'pitfall'];
const dialogRef = ref<HTMLElement>();
const rowListRef = ref<HTMLElement>();
const searchInputRef = ref<HTMLInputElement>();
const activeTab = ref<MemoryTab>(props.reviewRunId ? 'review' : 'project');
const searchQuery = ref('');
const selectedCategory = ref<MemoryCategory | 'all'>('all');
const selectedState = ref<MemoryStateFilter>(props.reviewRunId ? 'pending' : 'active');
const focusedIndex = ref(-1);
const showAddEditor = ref(false);
const showTidyReview = ref(false);
const tidyBusy = ref(false);
const tidyStatus = ref('');
const tidySuggestions = ref<MemoryTidySuggestion[]>([]);
const selectedTidyIds = ref(new Set<string>());
const editingId = ref<string>();
const reviewEditingId = ref<string>();
let previouslyFocused: HTMLElement | null = null;

const addDraft = reactive({
  scope: 'project' as MemoryScope,
  category: 'fact' as MemoryCategory,
  content: '',
  tags: '',
  pinned: false,
  pinnedApplicability: 'always' as MemoryPinnedApplicability,
});
const editDraft = reactive({
  category: 'fact' as MemoryCategory,
  content: '',
  tags: '',
  pinned: false,
  pinnedApplicability: 'always' as MemoryPinnedApplicability,
});
const reviewDraft = reactive({ category: 'fact' as MemoryCategory, content: '', tags: '' });

const memories = computed(() => props.controller.memories.value);
const counts = computed(() => props.controller.counts.value);
const failedExtractions = computed(() => props.controller.failedExtractions.value);
const loading = computed(() => props.controller.loading.value);
const error = computed(() => props.controller.error.value);
const warning = computed(() => props.controller.warning.value);
const tabs = computed(() => [
  { id: 'project' as const, label: t('components.memoryCenter.project'), count: counts.value.projectActive },
  { id: 'global' as const, label: t('components.memoryCenter.global'), count: counts.value.globalActive },
  { id: 'review' as const, label: t('components.memoryCenter.review'), count: counts.value.globalPending },
]);
const categoryFilterOptions = computed<CustomSelectOption[]>(() => [
  { value: 'all', label: t('components.memoryCenter.allCategories') },
  ...categories.map((category) => ({ value: category, label: categoryLabel(category) })),
]);
const stateFilterOptions = computed<CustomSelectOption[]>(() => [
  { value: 'active', label: t('components.memoryCenter.active') },
  { value: 'pending', label: t('components.memoryCenter.pending') },
  { value: 'pinned', label: t('components.memoryCenter.pinnedOnly') },
  { value: 'archived', label: t('components.memoryCenter.archived') },
  { value: 'all', label: t('components.memoryCenter.allStates') },
]);

const filteredMemories = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const scope = activeTab.value === 'project' ? 'project' : 'global';
  return memories.value.filter((memory) => {
    if (memory.scope !== scope) return false;
    if (selectedCategory.value !== 'all' && memory.category !== selectedCategory.value) return false;
    if (selectedState.value === 'pinned' && (!memory.pinned || memory.status !== 'active')) return false;
    if (selectedState.value !== 'all' && selectedState.value !== 'pinned' && memory.status !== selectedState.value) return false;
    if (!query) return true;
    return memory.content.toLowerCase().includes(query)
      || memory.tags.some((tag) => tag.toLowerCase().includes(query));
  });
});

const displayedMemories = computed(() => filteredMemories.value);
const totalMemories = computed(() => props.controller.total.value);
const canLoadMore = computed(() => filteredMemories.value.length < totalMemories.value);
const selectedTidySuggestions = computed(() => (
  tidySuggestions.value.filter((suggestion) => selectedTidyIds.value.has(suggestion.archive.id))
));

watch(displayedMemories, (items) => {
  focusedIndex.value = items.length === 0
    ? -1
    : Math.min(Math.max(focusedIndex.value, 0), items.length - 1);
}, { immediate: true });

watch(() => props.visible, async (visible) => {
  if (visible) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (props.reviewRunId) {
      activeTab.value = 'review';
      selectedState.value = 'pending';
    }
    await nextTick();
    searchInputRef.value?.focus();
    await reload();
    if (activeTab.value === 'review' && props.reviewRunId) emit('reviewRunConsumed');
  } else {
    await nextTick();
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
}, { immediate: true });

watch(() => props.reviewRunId, async (runId) => {
  if (!props.visible || !runId) return;
  activeTab.value = 'review';
  selectedState.value = 'pending';
  await reload();
  emit('reviewRunConsumed');
});

watch([() => props.profileLabel, () => props.projectPath], async () => {
  activeTab.value = props.reviewRunId ? 'review' : 'project';
  searchQuery.value = '';
  selectedCategory.value = 'all';
  selectedState.value = props.reviewRunId ? 'pending' : 'active';
  focusedIndex.value = -1;
  showAddEditor.value = false;
  closeTidyReview();
  editingId.value = undefined;
  reviewEditingId.value = undefined;
  if (props.visible) await reload();
});

function requestFilters(): Partial<MemoryFilters> {
  const state = selectedState.value === 'pinned' ? 'active' : selectedState.value;
  const statuses: MemoryStatus[] = state === 'all' ? ['active', 'pending', 'archived'] : [state];
  return {
    scope: activeTab.value === 'project' ? 'project' : 'global',
    statuses,
    categories: selectedCategory.value === 'all' ? [] : [selectedCategory.value],
    query: searchQuery.value,
    extractionRunId: activeTab.value === 'review' ? props.reviewRunId : undefined,
    offset: 0,
  };
}

async function reload(): Promise<void> {
  await props.controller.loadMemories(requestFilters());
}

async function selectTab(tab: MemoryTab): Promise<void> {
  activeTab.value = tab;
  selectedCategory.value = 'all';
  selectedState.value = tab === 'review' ? 'pending' : 'active';
  focusedIndex.value = displayedMemories.value.length ? 0 : -1;
  await reload();
  if (tab === 'review' && props.reviewRunId) emit('reviewRunConsumed');
}

function onFilterChange(): void {
  void reload();
}

function setCategoryFilter(value: string): void {
  selectedCategory.value = value as MemoryCategory | 'all';
  onFilterChange();
}

function setStateFilter(value: string): void {
  selectedState.value = value as MemoryStateFilter;
  onFilterChange();
}

function startAdd(): void {
  addDraft.scope = activeTab.value === 'project' ? 'project' : 'global';
  addDraft.category = 'fact';
  addDraft.content = '';
  addDraft.tags = '';
  addDraft.pinned = false;
  addDraft.pinnedApplicability = 'always';
  showAddEditor.value = true;
}

async function submitAdd(): Promise<void> {
  if (!addDraft.content.trim()) return;
  await perform(() => props.controller.createMemory({
    scope: addDraft.scope,
    category: addDraft.category,
    content: addDraft.content.trim(),
    tags: parseTags(addDraft.tags),
    pinned: addDraft.pinned,
    pinnedApplicability: addDraft.pinned ? addDraft.pinnedApplicability : 'always',
  }));
  showAddEditor.value = false;
}

function startEdit(memory: MemoryRecord): void {
  editingId.value = memory.id;
  editDraft.category = memory.category;
  editDraft.content = memory.content;
  editDraft.tags = memory.tags.join(', ');
  editDraft.pinned = memory.pinned;
  editDraft.pinnedApplicability = memory.pinnedApplicability || 'always';
}

async function submitEdit(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.updateMemory(memory.id, memory.revision, {
    category: editDraft.category,
    content: editDraft.content.trim(),
    tags: parseTags(editDraft.tags),
    pinned: editDraft.pinned,
    pinnedApplicability: editDraft.pinned ? editDraft.pinnedApplicability : 'always',
  }));
  editingId.value = undefined;
}

function startReviewEdit(memory: MemoryRecord): void {
  reviewEditingId.value = memory.id;
  reviewDraft.category = memory.category;
  reviewDraft.content = memory.content;
  reviewDraft.tags = memory.tags.join(', ');
}

async function approveEdited(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.approveMemory(memory.id, memory.revision, {
    category: reviewDraft.category,
    content: reviewDraft.content.trim(),
    tags: parseTags(reviewDraft.tags),
  }));
  reviewEditingId.value = undefined;
}

async function approve(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.approveMemory(memory.id, memory.revision));
}

async function reject(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.rejectMemory(memory.id, memory.revision));
}

async function togglePin(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.updateMemory(memory.id, memory.revision, { pinned: !memory.pinned }));
}

async function archive(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.archiveMemory(memory.id, memory.revision));
}

async function restore(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.restoreMemory(memory.id, memory.revision));
}

async function deleteMemory(memory: MemoryRecord): Promise<void> {
  await perform(() => props.controller.deleteMemory(memory.id, memory.revision));
}

async function reviewTidySuggestions(): Promise<void> {
  activeTab.value = activeTab.value === 'review' ? 'project' : activeTab.value;
  searchQuery.value = '';
  selectedCategory.value = 'all';
  selectedState.value = 'active';
  showTidyReview.value = true;
  tidyBusy.value = true;
  tidyStatus.value = '';
  try {
    const activeMemories = await loadActiveMemoriesForTidy();
    tidySuggestions.value = findMemoryTidySuggestions(activeMemories);
    selectedTidyIds.value = new Set(tidySuggestions.value.map((suggestion) => suggestion.archive.id));
  } finally {
    tidyBusy.value = false;
  }
}

async function loadActiveMemoriesForTidy(): Promise<MemoryRecord[]> {
  const allMemories: MemoryRecord[] = [];
  const pageSize = 100;
  let offset = 0;
  let total = 0;

  do {
    await props.controller.loadMemories({ ...requestFilters(), limit: pageSize, offset });
    allMemories.push(...memories.value);
    total = props.controller.total.value;
    offset += pageSize;
  } while (offset < total && offset < 1000);

  await props.controller.loadMemories({ ...requestFilters(), limit: pageSize, offset: 0 });
  return allMemories;
}

function closeTidyReview(): void {
  showTidyReview.value = false;
  tidyBusy.value = false;
  tidyStatus.value = '';
  tidySuggestions.value = [];
  selectedTidyIds.value = new Set();
}

function toggleTidySelection(id: string): void {
  const next = new Set(selectedTidyIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedTidyIds.value = next;
}

function selectAllTidySuggestions(): void {
  selectedTidyIds.value = new Set(tidySuggestions.value.map((suggestion) => suggestion.archive.id));
}

async function applyTidySuggestions(): Promise<void> {
  const selected = selectedTidySuggestions.value;
  if (selected.length === 0) return;

  tidyBusy.value = true;
  tidyStatus.value = '';
  const results = await Promise.allSettled(
    selected.map((suggestion) => props.controller.archiveMemory(suggestion.archive.id, suggestion.archive.revision)),
  );
  tidyBusy.value = false;

  const succeededIds = new Set(selected
    .filter((_, index) => results[index].status === 'fulfilled')
    .map((suggestion) => suggestion.archive.id));
  const failedCount = selected.length - succeededIds.size;

  if (failedCount === 0) {
    closeTidyReview();
    return;
  }

  tidySuggestions.value = tidySuggestions.value.filter((suggestion) => !succeededIds.has(suggestion.archive.id));
  selectedTidyIds.value = new Set(tidySuggestions.value.map((suggestion) => suggestion.archive.id));
  tidyStatus.value = t('components.memoryCenter.tidyResult', { archived: succeededIds.size, failed: failedCount });
  await reload();
}

function tidyReasonLabel(reason: MemoryTidyReason): string {
  if (reason === 'exact_duplicate') return t('components.memoryCenter.exactDuplicate');
  if (reason === 'stale_contradiction') return t('components.memoryCenter.staleContradiction');
  return t('components.memoryCenter.nearDuplicate');
}

async function extractCurrentSession(): Promise<void> {
  const sessionId = props.sessionId;
  if (sessionId) await perform(() => props.controller.extractSession(sessionId));
}

async function retryFailure(runId: string): Promise<void> {
  await perform(() => props.controller.retryExtraction(runId));
}

async function clearFailure(runId: string): Promise<void> {
  await perform(() => props.controller.clearExtractionFailure(runId));
}

async function perform(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // The controller exposes the server error in its reactive error state.
  }
}

async function loadMore(): Promise<void> {
  await props.controller.loadMoreMemories();
}

function moveFocus(delta: number): void {
  if (displayedMemories.value.length === 0) return;
  const start = focusedIndex.value < 0
    ? (delta > 0 ? 0 : displayedMemories.value.length - 1)
    : focusedIndex.value;
  focusedIndex.value = Math.min(displayedMemories.value.length - 1, Math.max(0, start + delta));
  nextTick(() => rowListRef.value
    ?.querySelectorAll<HTMLElement>('[data-memory-row]')[focusedIndex.value]
    ?.scrollIntoView({ block: 'nearest' }));
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key === 'Tab') {
    trapFocus(event);
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, textarea, select')) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveFocus(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveFocus(-1);
  }
}

function trapFocus(event: KeyboardEvent): void {
  const focusable = dialogRef.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!focusable?.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)));
}

function categoryLabel(category: MemoryCategory): string {
  return t(`components.memoryCenter.categories.${category}`);
}

function sourceLabel(source: MemoryRecord['source']): string {
  return source.replace('_', ' ');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function failedRunModelLabel(run: MemoryExtractionRun): string {
  if (!run.modelProvider || !run.modelId) return 'model unavailable';
  return `${run.modelProvider}/${run.modelId}`;
}

function formatFailedRunDate(run: MemoryExtractionRun): string {
  return formatDateTime(run.completedAt || run.startedAt || run.createdAt);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
</script>

<style scoped>
.memory-center-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  padding: 28px;
  background: color-mix(in srgb, #05070c 74%, transparent);
  backdrop-filter: blur(8px) saturate(0.8);
}

.memory-center-dialog {
  position: relative;
  width: min(940px, 96vw);
  max-height: min(760px, 90vh);
  min-height: min(620px, 86vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent) 5%, transparent),
      transparent 110px
    ),
    var(--bg-secondary);
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--text-tertiary));
  border-radius: 15px;
  box-shadow:
    0 28px 90px rgba(0, 0, 0, 0.46),
    inset 0 1px rgba(255, 255, 255, 0.035);
}

.memory-center-dialog::before {
  content: "";
  position: absolute;
  z-index: 2;
  inset: 0 0 auto;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 15%, transparent) 64%,
    transparent
  );
}

.memory-center-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.memory-title-line,
.memory-header-actions,
.memory-row-topline,
.memory-chips,
.memory-row-actions,
.memory-review-actions,
.memory-row-footer,
.memory-provenance,
.memory-button,
.memory-title-mark {
  display: flex;
  align-items: center;
}

.memory-title-block {
  min-width: 0;
}
.memory-title-line {
  gap: 9px;
}
.memory-title-line h2 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.memory-title-mark {
  justify-content: center;
  width: 30px;
  height: 30px;
  color: var(--accent);
  background: var(--accent-muted);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 9px;
}
.memory-context {
  margin: 4px 0 0 39px;
  color: var(--text-tertiary);
  font:
    11px/1.3 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.memory-header-actions {
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 7px;
}

.memory-button,
.memory-icon-button,
.memory-row-button,
.memory-text-button,
.memory-tab,
.memory-load-more,
.memory-source-session {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.memory-button {
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11px;
  font-weight: 650;
}
.memory-button:hover {
  border-color: var(--text-tertiary);
}
.memory-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.memory-button--primary {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.memory-button--quiet {
  color: var(--text-secondary);
  background: transparent;
}
.memory-button--approve {
  color: var(--success, #4ade80);
  background: color-mix(in srgb, var(--success, #4ade80) 9%, var(--bg-surface));
  border-color: color-mix(in srgb, var(--success, #4ade80) 28%, var(--border));
}
.memory-button--danger {
  color: var(--danger);
  background: transparent;
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border));
}
.memory-icon-button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  background: transparent;
  border-radius: 8px;
}
.memory-icon-button:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.memory-tabs {
  display: flex;
  gap: 3px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
}
.memory-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 11px 9px;
  color: var(--text-secondary);
  background: transparent;
  font-size: 12px;
}
.memory-tab::after {
  content: "";
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  background: transparent;
  border-radius: 2px 2px 0 0;
}
.memory-tab.is-active {
  color: var(--text-primary);
}
.memory-tab.is-active::after {
  background: var(--accent);
}
.memory-tab--review:not(.is-active) {
  color: var(--warning);
}
.memory-tab-count {
  min-width: 18px;
  padding: 1px 5px;
  color: var(--text-tertiary);
  background: var(--bg-elevated);
  border-radius: 99px;
  font:
    10px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}

.memory-center-body {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.memory-filter-rail {
  padding: 15px;
  background: color-mix(in srgb, var(--bg-primary) 35%, transparent);
  border-right: 1px solid var(--border);
}
.memory-search-wrap {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  height: 34px;
  padding: 0 0.5rem;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}
.memory-search-wrap:focus-within {
  background: var(--bg-secondary);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}
.memory-search-wrap:focus-within > svg {
  color: var(--accent);
}
.memory-search {
  min-width: 0;
  width: 100%;
  padding: 0.5rem 0;
  color: var(--text-primary);
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: 12px;
}
.memory-search:focus {
  box-shadow: none;
}
.memory-search::placeholder {
  color: var(--text-secondary);
}
.memory-filter-field {
  display: grid;
  gap: 6px;
  margin-top: 16px;
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.memory-editor input,
.memory-editor textarea {
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
}
.memory-filter-select :deep(.custom-select-trigger),
.memory-editor select {
  width: 100%;
  height: 33px;
  padding: 0 0.5rem;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.memory-filter-select :deep(.custom-select-option) {
  text-transform: none;
  letter-spacing: 0;
}
.memory-filter-select :deep(.custom-select-trigger:hover),
.memory-filter-select :deep(.custom-select-trigger[aria-expanded="true"]),
.memory-editor select:hover {
  background: var(--bg-elevated);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent));
}
.memory-filter-select :deep(.custom-select-trigger:focus-visible),
.memory-editor select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}
.memory-scope-note {
  display: flex;
  gap: 8px;
  margin-top: 22px;
  padding-top: 13px;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border-subtle);
  font-size: 10px;
  line-height: 1.45;
}
.memory-scope-note p {
  margin: 0;
}
.memory-scope-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-top: 4px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 4px var(--accent-muted);
}

.memory-list-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 17px;
  overflow: auto;
}
.memory-list-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  margin: 3px 1px 10px;
}
.memory-list-heading > div {
  display: grid;
  gap: 2px;
}
.memory-list-heading strong {
  font-size: 13px;
}
.memory-eyebrow {
  color: var(--text-tertiary);
  font:
    9px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.memory-list-hint {
  color: var(--text-tertiary);
  font:
    9px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.memory-list {
  display: grid;
  gap: 8px;
}
.memory-row {
  padding: 11px 12px 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    transform 120ms ease;
}
.memory-row:hover {
  border-color: color-mix(in srgb, var(--text-tertiary) 45%, var(--border));
}
.memory-row.is-focused {
  border-color: color-mix(in srgb, var(--accent) 72%, var(--border));
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-surface));
  box-shadow: 0 0 0 2px var(--accent-muted);
}
.memory-row.is-pending {
  border-left: 2px solid var(--warning);
}
.memory-row-topline {
  justify-content: space-between;
  gap: 8px;
}
.memory-chips {
  flex-wrap: wrap;
  gap: 5px;
}
.memory-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  color: var(--text-tertiary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 99px;
  font:
    9px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.memory-chip--category {
  color: var(--accent-hover);
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
}
.memory-chip--pinned {
  color: var(--warning);
}
.memory-chip--pending {
  color: var(--warning);
}
.memory-chip--archived {
  text-decoration: line-through;
}
.memory-row-actions {
  gap: 3px;
  opacity: 0.65;
}
.memory-row:hover .memory-row-actions,
.memory-row.is-focused .memory-row-actions {
  opacity: 1;
}
.memory-row-button {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  background: transparent;
  border-radius: 6px;
}
.memory-row-button:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.memory-content {
  margin: 8px 0 9px;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.memory-row-footer {
  justify-content: space-between;
  gap: 12px;
  color: var(--text-tertiary);
  font:
    9px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.memory-provenance {
  gap: 8px;
}
.memory-source-session {
  padding: 0;
  color: var(--accent-hover);
  background: transparent;
  font: inherit;
}
.memory-source-session:hover {
  text-decoration: underline;
}

.memory-evidence {
  margin: 9px 0;
  padding: 8px 10px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--warning) 5%, var(--bg-primary));
  border: 0;
  border-left: 2px solid color-mix(in srgb, var(--warning) 55%, var(--border));
  font-size: 11px;
  line-height: 1.45;
}
.memory-evidence span {
  display: block;
  margin-bottom: 3px;
  color: var(--warning);
  font:
    8px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.memory-review-actions {
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 9px;
}

.memory-editor {
  margin: 4px 0 11px;
  padding: 11px;
  background: var(--bg-surface);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 10px;
}
.memory-editor-heading {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
}
.memory-editor textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 9px;
  resize: vertical;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
}
.memory-editor textarea:focus,
.memory-editor input:focus,
.memory-editor select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-muted);
}
.memory-editor-grid {
  display: grid;
  grid-template-columns: 130px minmax(130px, 1fr) auto auto;
  gap: 7px;
  align-items: center;
  margin-top: 7px;
}
.memory-editor input {
  box-sizing: border-box;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  font-size: 11px;
}
.memory-editor select {
  box-sizing: border-box;
  min-width: 0;
  height: 32px;
}
.memory-check {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
}
.memory-text-button {
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  font-size: 10px;
}

.memory-tidy-panel {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
  padding: 11px;
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
  border-radius: 10px;
}
.memory-tidy-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}
.memory-tidy-heading p {
  margin: 2px 0 0;
  color: var(--text-tertiary);
  font-size: 10px;
}
.memory-tidy-empty,
.memory-tidy-status {
  color: var(--text-secondary);
  font-size: 11px;
}
.memory-tidy-status {
  padding: 7px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}
.memory-tidy-suggestion {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  font-size: 11px;
}
.memory-tidy-suggestion input {
  flex: 0 0 auto;
  margin-top: 3px;
}
.memory-tidy-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.memory-tidy-copy del {
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}
.memory-tidy-copy strong {
  color: var(--text-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.memory-tidy-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}

.memory-notice {
  margin-bottom: 9px;
  padding: 8px 10px;
  color: var(--warning);
  background: var(--warning-muted);
  border: 1px solid color-mix(in srgb, var(--warning) 24%, var(--border));
  border-radius: 8px;
  font-size: 10px;
}
.memory-warning-heading {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.memory-failed-run {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid color-mix(in srgb, var(--warning) 20%, var(--border));
}
.memory-failed-run-body {
  display: grid;
  gap: 3px;
  min-width: 0;
  color: var(--text-secondary);
}
.memory-failed-run-body span {
  overflow-wrap: anywhere;
}
.memory-failed-run-body small {
  color: var(--text-tertiary);
  font:
    9px ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
.memory-failed-run-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: flex-start;
}
.memory-warning .memory-text-button {
  color: var(--warning);
}
.memory-state {
  min-height: 170px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--text-tertiary);
  text-align: center;
  font-size: 11px;
}
.memory-state strong {
  color: var(--text-secondary);
  font-size: 12px;
}
.memory-error {
  color: var(--danger);
}
.memory-spinner {
  width: 17px;
  height: 17px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: memory-spin 800ms linear infinite;
}
.memory-load-more {
  align-self: center;
  margin-top: 10px;
  padding: 7px 12px;
  color: var(--accent-hover);
  background: transparent;
  border: 1px dashed color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 8px;
  font-size: 10px;
}
.memory-load-more:hover {
  background: var(--accent-muted);
}

.memory-center-enter-active,
.memory-center-leave-active {
  transition: opacity 150ms ease;
}
.memory-center-enter-active .memory-center-dialog,
.memory-center-leave-active .memory-center-dialog {
  transition:
    transform 170ms ease,
    opacity 150ms ease;
}
.memory-center-enter-from,
.memory-center-leave-to {
  opacity: 0;
}
.memory-center-enter-from .memory-center-dialog,
.memory-center-leave-to .memory-center-dialog {
  opacity: 0;
  transform: translateY(8px) scale(0.99);
}

@keyframes memory-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 820px) {
  .memory-center-backdrop {
    padding: 0;
  }
  .memory-center-dialog--responsive {
    width: 100%;
    max-height: none;
    min-height: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }
  .memory-center-header {
    align-items: center;
    padding: 14px;
  }
  .memory-context {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .memory-header-actions {
    flex-wrap: nowrap;
  }
  .memory-header-actions .memory-button span {
    display: none;
  }
  .memory-tabs {
    padding: 0 12px;
  }
  .memory-center-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .memory-filter-rail {
    display: grid;
    grid-template-columns: minmax(130px, 1fr) 130px 120px;
    gap: 7px;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .memory-filter-field {
    gap: 0;
    margin: 0;
  }
  .memory-filter-field > span,
  .memory-scope-note {
    display: none;
  }
  .memory-list-pane {
    padding: 11px 12px 15px;
  }
  .memory-editor-grid {
    grid-template-columns: 1fr 1fr;
  }
  .memory-row-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 520px) {
  .memory-title-line h2 {
    font-size: 15px;
  }
  .memory-context {
    margin-left: 0;
  }
  .memory-title-mark {
    display: none;
  }
  .memory-filter-rail {
    grid-template-columns: 1fr 1fr;
  }
  .memory-search-wrap {
    grid-column: 1 / -1;
  }
  .memory-tab {
    flex: 1;
    justify-content: center;
    padding-inline: 5px;
  }
  .memory-list-hint {
    display: none;
  }
  .memory-editor-grid {
    grid-template-columns: 1fr;
  }
  .memory-header-actions {
    gap: 3px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .memory-center-enter-active,
  .memory-center-leave-active,
  .memory-center-enter-active .memory-center-dialog,
  .memory-center-leave-active .memory-center-dialog,
  .memory-row {
    transition: none;
  }
  .memory-spinner {
    animation-duration: 1.8s;
  }
}
</style>
