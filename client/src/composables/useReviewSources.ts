import { ref } from 'vue';
import type { ReviewSource } from '../types/reviewSource';
import { createReviewSource, deleteReviewSource, listReviewSources } from '../services/reviewSourceService';

const sources = ref<ReviewSource[]>([]);
const loading = ref(false);
const error = ref('');

export function useReviewSources() {
  async function load() {
    loading.value = true;
    error.value = '';
    try {
      sources.value = await listReviewSources();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load review sources';
    } finally {
      loading.value = false;
    }
  }

  async function add(request: { type: string; label: string; dataPath: string }) {
    const source = await createReviewSource(request);
    sources.value.push(source);
    return source;
  }

  async function remove(id: string) {
    await deleteReviewSource(id);
    sources.value = sources.value.filter((source) => source.id !== id);
  }

  return { sources, loading, error, load, add, remove };
}
