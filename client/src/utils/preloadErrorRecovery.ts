export function createPreloadErrorHandler(reload: () => void): (event: Event) => void {
  let reloadStarted = false;

  return (event: Event) => {
    event.preventDefault();
    if (reloadStarted) return;

    reloadStarted = true;
    reload();
  };
}
