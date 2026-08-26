export const Uri = { file: (path: string) => ({ path }) };
export const KeyMod = { CtrlCmd: 2048 };
export const KeyCode = { KeyS: 49 };

const languageDefaults = { setDiagnosticsOptions: () => undefined };
export const typescript = {
  typescriptDefaults: languageDefaults,
  javascriptDefaults: languageDefaults,
};
export const json = { jsonDefaults: languageDefaults };

export const editor = {
  create: () => ({
    addCommand: () => undefined,
    setModel: () => undefined,
    getValue: () => '',
    dispose: () => undefined,
  }),
  createModel: () => ({
    onDidChangeContent: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }),
};
