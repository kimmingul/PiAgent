import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('../', import.meta.url));
const components = ['protocol', 'core', 'omp', 'daemon'];

// Copy real directories: release archives must not depend on workspace junctions.
export async function packageCore(destination, { adapters = false } = {}) {
  const output = resolve(destination);
  await mkdir(output); // Refuse to overwrite a previous release or user directory.
  for (const component of components) {
    const source = join(repository, 'packages', `piagent-${component}`);
    const target = join(output, 'node_modules', '@piagent', component);
    await mkdir(target, { recursive: true });
    await cp(join(source, 'package.json'), join(target, 'package.json'));
    await cp(join(source, 'dist'), join(target, 'dist'), { recursive: true });
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
  await writeFile(join(output, 'README.md'), `# PiAgent ${version} runtime\n\n` +
    'Windows x64 / ARM64, Node.js 24.21.0+ (24 LTS). Node runtime is installed separately.\n' +
    'No npm install, TypeScript compiler, native addon or workspace checkout is needed.\n\n' +
    'Start: node core.mjs --pipe piagent-dev\n' +
    'Check: node probe.mjs piagent-dev test-adapter release\n' +
    'Optional OMP: node core.mjs --pipe piagent-dev --omp C:\\path\\omp.exe --cwd C:\\workspace\n' +
    'Stop with Ctrl+C. OMP requires a separately installed executable.\n\n' +
    (adapters ? 'Adapter installers and installation instructions are in adapters/.\n' : '') +
    'This release implements handshake/capability/ping and the OMP process skeleton.\n' +
    'Chat UI and full agent features are outside this vertical slice.\n');
  if (adapters) {
    for (const ide of ['visualstudio', 'radstudio']) {
      const target = join(output, 'adapters', ide);
      await mkdir(target, { recursive: true });
      await cp(join(repository, 'adapters', ide, 'README.md'), join(target, 'README.md'));
    }
    await cp(join(repository, 'adapters/visualstudio/PiAgent.Vsix/bin/Release/net472/PiAgent.Vsix.vsix'),
      join(output, 'adapters/visualstudio/PiAgent.Vsix.vsix'));
    for (const platform of ['Win32', 'Win64']) {
      const source = join(repository, 'adapters/radstudio/bin', platform);
      const packages = (await readdir(source)).filter(name => /^PiAgent\d+\.bpl$/i.test(name));
      if (packages.length !== 1) throw new Error(`Expected one ${platform} PiAgent BPL; rebuild adapters.`);
      const target = join(output, 'adapters/radstudio', platform);
      await mkdir(target);
      await cp(join(source, packages[0]), join(target, packages[0]));
    }
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
    adapterPackages: adapters, sha256: files,
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
