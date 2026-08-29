// client/src/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import { createPreloadErrorHandler } from './utils/preloadErrorRecovery';
import './styles/main.css';

window.addEventListener('vite:preloadError', createPreloadErrorHandler(() => {
  if (window.confirm(i18n.global.t('app.newVersionAvailable'))) window.location.reload();
}));

const app = createApp(App);
app.use(router);
app.use(i18n);
app.mount('#app');
