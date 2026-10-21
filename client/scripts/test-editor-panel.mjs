#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const __dirname = import.meta.dirname;
const source = readFileSync(resolve(__dirname, '../src/components/EditorPanel.vue'), 'utf8');
const treeNodeSource = readFileSync(resolve(__dirname, '../src/components/FileTreeNode.vue'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  }
}

assert(/cwd:\s*string/.test(source), 'EditorPanel accepts the active project cwd as a prop');
assert(/watch\(\s*\(\)\s*=>\s*props\.cwd/.test(source), 'EditorPanel reloads when cwd changes');
assert(!/\/api\/files\/tree\?path=\.(&|['"])/.test(source), 'EditorPanel does not hard-code the server cwd as the file tree root');
assert(/loadFileTree\([^)]*node\.path/.test(source), 'Directory clicks request that directory path for expansion');
assert(/TreeNode\s+[^>]*:node=/.test(source), 'File tree renders recursively through a TreeNode component');
assert(!/getWorkerUrl\(/.test(source), 'Monaco worker configuration does not call undefined getWorkerUrl');
assert(/editor\.worker\?worker/.test(source), 'Monaco editor worker is imported through Vite ?worker');
const tabInterface = source.match(/^interface Tab \{[\s\S]*?^\}/m)?.[0];
assert(tabInterface && !/\bmodel\s*:\s*monaco\.editor\.ITextModel/.test(tabInterface), 'Reactive tab state does not contain Monaco model objects');
assert(/new Map<string, monaco\.editor\.ITextModel>/.test(source), 'Monaco models are stored outside Vue reactive tab state');
assert(/\.tree-node\s*\{[\s\S]*cursor:\s*pointer/.test(treeNodeSource), 'File tree rows show pointer cursor on hover/click');
assert(/@click="saveFile"/.test(source), 'Editor header exposes a Save button');
assert(/dirtyPaths/.test(source), 'Editor tracks dirty file paths outside Monaco models');
assert(/onDidChangeContent/.test(source), 'Editor marks files dirty when Monaco content changes');
assert(/KeyMod\.(CtrlCmd|WinCtrl)\s*\+\s*(monaco\.)?KeyCode\.KeyS/.test(source), 'Editor registers Ctrl/Cmd+S save shortcut');
assert(/statusMessage/.test(source), 'Editor displays save status feedback');
const closeTabSource = source.match(/^async function closeTab\([\s\S]*?^\}/m)?.[0] || '';
assert(/dirtyPaths\.value\.has\(filePath\)/.test(closeTabSource) && /await requestConfirm\(/.test(closeTabSource) && /if \(!confirmed\) return/.test(closeTabSource), 'Closing a dirty tab asks for confirmation');
assert(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*statusMessage\.value\s*=\s*''/.test(source), 'Saved status auto-clears after a short delay');
assert(/clearTimeout\(statusClearTimer/.test(source), 'Status clear timer is cleaned up before reset/unmount');

if (!process.exitCode) {
  console.log('PASS: editor panel cwd and expansion regression checks');
}
