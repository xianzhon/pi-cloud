const root = document.documentElement;
const themeToggle = document.querySelector('.theme-toggle');
const themeColor = document.querySelector('meta[name="theme-color"]');

function updateThemeControls() {
  const isDark = root.dataset.theme === 'dark';
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  themeToggle?.setAttribute('aria-label', label);
  themeToggle?.setAttribute('title', label);
  themeColor?.setAttribute('content', isDark ? '#050506' : '#f5f5f7');
}

themeToggle?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('pi-webui-theme', root.dataset.theme);
  } catch {
    // The active theme still works when storage is unavailable.
  }
  updateThemeControls();
});

updateThemeControls();

const siteHeader = document.querySelector('.site-header');
function updateHeader() {
  siteHeader?.classList.toggle('is-scrolled', window.scrollY > 12);
}
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

const revealElements = document.querySelectorAll('.section-heading, .feature-card, .screenshot-card, .start-section');
if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
  revealElements.forEach((element) => element.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  revealElements.forEach((element) => {
    element.classList.add('reveal');
    revealObserver.observe(element);
  });
}

const copyButton = document.querySelector('[data-copy]');
const copyStatus = document.querySelector('.copy-status');

async function copyInstallCommand() {
  const command = copyButton?.dataset.copy;
  if (!command) return;

  try {
    await navigator.clipboard.writeText(command);
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = command;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.append(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  }

  copyButton.textContent = 'Copied';
  copyStatus.textContent = 'Install command copied to clipboard.';
  window.setTimeout(() => {
    copyButton.textContent = 'Copy';
    copyStatus.textContent = '';
  }, 2000);
}

copyButton?.addEventListener('click', copyInstallCommand);

const lightbox = document.querySelector('.lightbox');
const lightboxImage = lightbox?.querySelector('img');
const lightboxCaption = lightbox?.querySelector('p');
const lightboxClose = lightbox?.querySelector('.lightbox-close');

function closeLightbox() {
  if (lightbox?.open) lightbox.close();
}

function openLightbox(button) {
  if (!lightbox || !lightboxImage || !lightboxCaption) return;

  lightboxImage.src = button.dataset.lightbox;
  lightboxImage.alt = button.querySelector('img')?.alt ?? '';
  lightboxCaption.textContent = button.dataset.caption ?? '';
  lightbox.showModal();
}

document.querySelectorAll('[data-lightbox]').forEach((button) => {
  button.addEventListener('click', () => openLightbox(button));
});

lightboxClose?.addEventListener('click', closeLightbox);
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
