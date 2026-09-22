import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
];
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
]);

function posix(value) {
  return value.split(path.sep).join('/');
}

function fingerprint(rule, file, detail) {
  return createHash('sha256')
    .update(`${rule}\0${file}\0${detail}`)
    .digest('hex')
    .slice(0, 16);
}

async function walk(directory, files) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      await walk(path.join(directory, entry.name), files);
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.includes(path.extname(entry.name))
    ) {
      files.push(path.join(directory, entry.name));
    }
  }
}

function validatePolicy(raw, cwd) {
  if (raw?.version !== 1 || !Array.isArray(raw.modules)) {
    throw new Error(
      'architecture-policy.json must contain version 1 and a modules array',
    );
  }

  const ids = new Set();
  const modules = raw.modules.map((module) => {
    if (!module?.id || ids.has(module.id))
      throw new Error(`Invalid or duplicate module id: ${module?.id ?? ''}`);
    if (!Array.isArray(module.roots) || module.roots.length === 0)
      throw new Error(`Module ${module.id} must declare roots`);
    ids.add(module.id);
    return {
      id: module.id,
      roots: module.roots.map((root) => path.resolve(cwd, root)),
      managed: module.managed !== false,
      requires: [...new Set(module.requires ?? [])],
      publicEntrypoints: (module.publicEntrypoints ?? []).map((entry) =>
        posix(entry),
      ),
      owner: module.owner ?? null,
    };
  });

  for (const module of modules) {
    for (const dependency of module.requires) {
      if (!ids.has(dependency))
        throw new Error(
          `Module ${module.id} requires unknown module ${dependency}`,
        );
    }
  }

  return {
    modules,
    global: {
      aliases: raw.global?.aliases ?? {},
      forbidCycles: raw.global?.forbidCycles === true,
      forbidDeepImports: raw.global?.forbidDeepImports === true,
    },
  };
}

export async function loadPolicy(cwd = process.cwd()) {
  const filename = path.join(cwd, 'architecture-policy.json');
  return validatePolicy(JSON.parse(await fs.readFile(filename, 'utf8')), cwd);
}

export function extractImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function moduleForFile(file, modules) {
  return (
    modules
      .filter((module) =>
        module.roots.some(
          (root) => file === root || file.startsWith(`${root}${path.sep}`),
        ),
      )
      .sort(
        (left, right) =>
          Math.max(...right.roots.map((root) => root.length)) -
          Math.max(...left.roots.map((root) => root.length)),
      )[0] ?? null
  );
}

async function resolveImport(from, specifier, policy, knownFiles, cwd) {
  let base;
  if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(from), specifier);
  } else {
    const alias = Object.keys(policy.global.aliases)
      .sort((left, right) => right.length - left.length)
      .find((prefix) => specifier.startsWith(prefix));
    if (!alias) return null;
    base = path.resolve(
      cwd,
      policy.global.aliases[alias],
      specifier.slice(alias.length),
    );
  }

  const candidates = [base];
  const extension = path.extname(base);
  const extensionlessBase = ['.js', '.jsx', '.mjs', '.cjs'].includes(extension)
    ? base.slice(0, -extension.length)
    : base;
  for (const sourceExtension of SOURCE_EXTENSIONS)
    candidates.push(`${extensionlessBase}${sourceExtension}`);
  for (const sourceExtension of SOURCE_EXTENSIONS)
    candidates.push(path.join(extensionlessBase, `index${sourceExtension}`));
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

function publicEntrypointMatches(target, module, cwd) {
  const relative = posix(path.relative(cwd, target));
  return module.publicEntrypoints.includes(relative);
}

function findModuleCycles(edges) {
  const state = new Map();
  const stack = [];
  const cycles = new Map();

  function visit(moduleId) {
    state.set(moduleId, 1);
    stack.push(moduleId);
    for (const dependency of edges.get(moduleId) ?? []) {
      if (state.get(dependency) === 1) {
        const cycle = stack.slice(stack.indexOf(dependency)).concat(dependency);
        const key = [...new Set(cycle)].sort().join(' -> ');
        cycles.set(key, cycle);
      } else if (!state.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(moduleId, 2);
  }

  for (const moduleId of edges.keys())
    if (!state.has(moduleId)) visit(moduleId);
  return [...cycles.values()];
}

async function readBaseline(cwd) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(cwd, '.architecture-baseline.json'), 'utf8'),
    );
  } catch {
    return { version: 1, violations: [] };
  }
}

export async function checkArchitecture({
  cwd = process.cwd(),
  changedFiles = null,
} = {}) {
  const policy = await loadPolicy(cwd);
  const files = [];
  for (const module of policy.modules) {
    for (const root of module.roots) await walk(root, files);
  }
  const uniqueFiles = [...new Set(files)].sort();
  const knownFiles = new Set(uniqueFiles);
  const violations = [];
  const moduleEdges = new Map(
    policy.modules.map((module) => [module.id, new Set()]),
  );

  for (const file of uniqueFiles) {
    const sourceModule = moduleForFile(file, policy.modules);
    if (!sourceModule?.managed) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of extractImportSpecifiers(source)) {
      const target = await resolveImport(
        file,
        specifier,
        policy,
        knownFiles,
        cwd,
      );
      if (!target) continue;
      const targetModule = moduleForFile(target, policy.modules);
      if (!targetModule || targetModule.id === sourceModule.id) continue;
      moduleEdges.get(sourceModule.id).add(targetModule.id);

      const relativeFile = posix(path.relative(cwd, file));
      if (!sourceModule.requires.includes(targetModule.id)) {
        violations.push({
          rule: 'module-dependency',
          file: relativeFile,
          module: sourceModule.id,
          detail: targetModule.id,
          message: `${sourceModule.id} imports ${targetModule.id} without declaring it in requires`,
        });
      }
      if (
        policy.global.forbidDeepImports &&
        targetModule.publicEntrypoints.length > 0 &&
        !publicEntrypointMatches(target, targetModule, cwd)
      ) {
        violations.push({
          rule: 'deep-import',
          file: relativeFile,
          module: sourceModule.id,
          detail: posix(path.relative(cwd, target)),
          message: `${sourceModule.id} must import ${targetModule.id} through a public entrypoint`,
        });
      }
    }
  }

  if (policy.global.forbidCycles) {
    for (const cycle of findModuleCycles(moduleEdges)) {
      violations.push({
        rule: 'cycle',
        file: 'architecture-policy.json',
        module: cycle[0],
        detail: cycle.join(' -> '),
        message: `Module dependency cycle: ${cycle.join(' -> ')}`,
      });
    }
  }

  for (const item of violations)
    item.fingerprint = fingerprint(item.rule, item.file, item.detail);
  const baseline = await readBaseline(cwd);
  const baselineFingerprints = new Set(
    (baseline.violations ?? []).map((item) => item.fingerprint),
  );
  const changed = changedFiles
    ? new Set(changedFiles.map((file) => posix(file)))
    : null;
  const policyChanged = changed?.has('architecture-policy.json');
  const scoped =
    changed && !policyChanged
      ? violations.filter(
          (item) =>
            item.file === 'architecture-policy.json' || changed.has(item.file),
        )
      : violations;
  const baselineViolations = scoped.filter((item) =>
    baselineFingerprints.has(item.fingerprint),
  );
  const newViolations = scoped.filter(
    (item) => !baselineFingerprints.has(item.fingerprint),
  );

  return {
    violations: scoped,
    baselineViolations,
    newViolations,
    modules: policy.modules.map((module) => ({
      id: module.id,
      managed: module.managed,
      owner: module.owner,
      dependencies: [...moduleEdges.get(module.id)].sort(),
    })),
  };
}

export async function changedFilesFromGit(cwd = process.cwd()) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const [{ stdout: modified }, { stdout: untracked }] = await Promise.all([
    run('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd }),
    run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd }),
  ]);
  return [
    ...new Set(
      `${modified}${untracked}`.split('\0').filter(Boolean).map(posix),
    ),
  ];
}

export async function updateBaseline(cwd, violations) {
  const entries = [...violations].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
  await fs.writeFile(
    path.join(cwd, '.architecture-baseline.json'),
    `${JSON.stringify({ version: 1, violations: entries }, null, 2)}\n`,
  );
}

export function formatReport(result) {
  const lines = [
    `architecture: ${result.newViolations.length === 0 ? 'OK' : 'VIOLATIONS FOUND'}`,
    `violations: ${result.violations.length}`,
    `baseline: ${result.baselineViolations.length}`,
    `new: ${result.newViolations.length}`,
  ];
  for (const item of result.newViolations)
    lines.push(`- ${item.rule} ${item.file}: ${item.message}`);
  return lines.join('\n');
}

export async function generateContext(cwd, moduleId) {
  const policy = await loadPolicy(cwd);
  const module = policy.modules.find((candidate) => candidate.id === moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const roots = module.roots.map((root) => posix(path.relative(cwd, root)));
  const entrypoints =
    module.publicEntrypoints.length > 0
      ? module.publicEntrypoints
      : ['none declared'];
  return [
    `# Architecture context: ${module.id}`,
    '',
    `owner: ${module.owner ?? 'unassigned'}`,
    `managed: ${module.managed}`,
    `roots: ${roots.join(', ')}`,
    `requires: ${module.requires.join(', ') || 'none'}`,
    `public entrypoints: ${entrypoints.join(', ')}`,
    '',
    'Read the relevant files, tests, and contracts under these roots before editing.',
  ].join('\n');
}
