import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('../', import.meta.url));
const components = ['protocol', 'core', 'omp', 'daemon'];

// Copy real directories: release archives must not depend on workspace junctions.
export async function packageCore(destination, { adapters = false, radPlatforms = ['Win64'] } = {}) {
  if (!Array.isArray(radPlatforms) || radPlatforms.length === 0 || new Set(radPlatforms).size !== radPlatforms.length || radPlatforms.some(p => !['Win32','Win64'].includes(p))) throw new Error('Invalid RAD platforms');
  const output = resolve(destination);
  await mkdir(output); // Refuse to overwrite a previous release or user directory.
  const hostTarget = join(output, 'transport/PiAgent.PipeHost/bin/Release/net8.0-windows');
  await mkdir(hostTarget, { recursive: true });
  for (const suffix of ['dll', 'deps.json', 'runtimeconfig.json'])
    await cp(join(repository, 'transport/PiAgent.PipeHost/bin/Release/net8.0-windows', `PiAgent.PipeHost.${suffix}`), join(hostTarget, `PiAgent.PipeHost.${suffix}`));
  for (const component of components) {
    const source = join(repository, 'packages', `piagent-${component}`);
    const target = join(output, 'node_modules', '@piagent', component);
    await mkdir(target, { recursive: true });
    await cp(join(source, 'package.json'), join(target, 'package.json'));
    await cp(join(source, 'dist'), join(target, 'dist'), { recursive: true });
    if (component === 'core') await cp(join(source, 'harness'), join(target, 'harness'), {recursive:true});
  }
  const { version, engines } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  await writeFile(join(output, 'package.json'), JSON.stringify({
    name: 'piagent-runtime', version, private: true, type: 'module', engines,
    scripts: { start: 'node core.mjs', probe: 'node probe.mjs' },
  }, null, 2) + '\n');
  await writeFile(join(output, 'core.mjs'), "import './node_modules/@piagent/daemon/dist/cli.js';\n");
  await writeFile(join(output, 'probe.mjs'), "import './node_modules/@piagent/daemon/dist/adapter-probe.js';\n");
  for (const document of ['ARCHITECTURE.md', 'PROTOCOL.md'])
    await cp(join(repository, document), join(output, document));
  await mkdir(join(output, 'docs'));
  await mkdir(join(output, 'scripts'));
  for(const name of ['install-core.ps1','start-core.ps1','uninstall-core.ps1']) await cp(join(repository,'scripts',name),join(output,'scripts',name));
  await cp(join(repository, 'docs/VALIDATION.md'), join(output, 'docs/VALIDATION.md'));
  await cp(join(repository, 'docs/SELECTION-CONTEXT.md'), join(output, 'docs/SELECTION-CONTEXT.md'));
  await cp(join(repository, 'docs/WORKSPACE-TOOLS.md'), join(output, 'docs/WORKSPACE-TOOLS.md'));
  await cp(join(repository, 'docs/SECURITY.md'), join(output, 'docs/SECURITY.md'));
  await cp(join(repository, 'docs/APPROVED-CHANGES.md'), join(output, 'docs/APPROVED-CHANGES.md'));
  for(const document of ['SESSIONS-USAGE.md','INSTALLATION.md','OMP-DESIGNERS.md','GUI-HARNESS.md','CHAT-UI-IMPLEMENTATION.md']) await cp(join(repository,'docs',document),join(output,'docs',document));
  await writeFile(join(output, 'README.md'), `# PiAgent ${version} runtime\n\n` +
    'Windows x64 / ARM64, Node.js 24.21.0+ (24 LTS). Node runtime is installed separately.\n' +
    'Secure transport also requires .NET 8+ runtime; no npm install, TypeScript compiler or native Node addon is needed.\n\n' +
    'Start: node core.mjs --pipe piagent-dev\n' +
    'Check: node probe.mjs piagent-dev test-adapter release\n' +
    'Optional OMP: node core.mjs --pipe piagent-dev --omp C:\\path\\omp.exe --cwd C:\\workspace\n' +
    'Stop with Ctrl+C. OMP requires a separately installed executable.\n\n' +
    'The default CLI uses a local-only, current-user pipe and mutual HMAC authentication. See docs/SECURITY.md.\n' +
    (adapters ? 'Adapter installers and installation instructions are in adapters/.\n' : '') +
    'This release implements VS/RAD WebView chat, durable OMP sessions, usage and opt-in approved file changes. See docs/INSTALLATION.md.\n' +
    'Add --workspace C:\\project to enable bounded file reading/search. See docs/WORKSPACE-TOOLS.md.\n' +
    'Add --allow-writes for single/multi-file diff approval and checkpoint restore. Git is required; see docs/APPROVED-CHANGES.md.\n' +
    'For VS Chat: Tools > PiAgent: Open Chat (connects automatically). For RAD: View > PiAgent or Tools > PiAgent.\n' +
    'Select code in the editor, capture it in Chat, inspect the attachment and send your question. See docs/SELECTION-CONTEXT.md.\n' +
    'Both adapters use an installed WebView2 Runtime. File creation/deletion/rename remain a future scope.\n');
  if (adapters) {
    for (const ide of ['visualstudio', 'radstudio']) {
      const target = join(output, 'adapters', ide);
      await mkdir(target, { recursive: true });
      await cp(join(repository, 'adapters', ide, 'README.md'), join(target, 'README.md'));
    }
    // Inspect the built manifest before packaging; VSSDK incremental caches can be stale.
    const manifest = await readFile(join(repository, 'adapters/visualstudio/PiAgent.Vsix/obj/Release/net472/extension.vsixmanifest'), 'utf8');
    // Adapter-only patches can retain the compatible Core/RAD release version.
    const sourceManifest = await readFile(join(repository, 'adapters/visualstudio/PiAgent.Vsix/source.extension.vsixmanifest'), 'utf8');
    const identityVersion = xml => /<Identity\b[^>]*\bVersion="([^"]+)"/.exec(xml)?.[1];
    if (!identityVersion(sourceManifest) || identityVersion(manifest) !== identityVersion(sourceManifest))
      throw new Error('VSIX version is stale; rebuild adapters.');
    await cp(join(repository, 'adapters/visualstudio/PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix'),
      join(output, 'adapters/visualstudio/PiAgent.Vsix.vsix'));
    for (const platform of radPlatforms) {
      const source = join(repository, 'adapters/radstudio/bin', platform, version);
      const packages = (await readdir(source)).filter(name => /^PiAgent\d+\.bpl$/i.test(name));
      if (packages.length !== 1) throw new Error(`Expected one ${platform} PiAgent BPL; rebuild adapters.`);
      const target = join(output, 'adapters/radstudio', platform);
      await mkdir(target);
      await cp(join(source, packages[0]), join(target, packages[0]));
      await cp(join(source,'WebView2Loader.dll'),join(target,'WebView2Loader.dll'));
      await cp(join(source,'ui'),join(target,'ui'),{recursive:true});
    }
    for(const name of ['THIRD-PARTY-NOTICES.txt','WEBVIEW2-LICENSE.txt']) await cp(join(repository,'adapters/visualstudio',name),join(output,'adapters/radstudio',name));
  }
  const files = {};
  async function hashes(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await hashes(path);
      else files[relative(output, path).replaceAll('\\', '/')] =
        createHash('sha256').update(await readFile(path)).digest('hex');
    }
  }
  await hashes(output);
  await writeFile(join(output, 'release-manifest.json'), JSON.stringify({
    version, platforms: ['win32-x64', 'win32-arm64'], node: engines.node,
    adapterPackages: adapters, radPlatforms: adapters ? radPlatforms : [], sha256: files,
  }, null, 2) + '\n');
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--adapters')) throw new Error('Usage: package-core.mjs [--adapters]');
    const artifacts = join(repository, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    console.log(await packageCore(join(artifacts, `piagent-${timestamp}`), { adapters: args.includes('--adapters') }));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
