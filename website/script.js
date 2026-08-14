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
