import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

// Validates an opt-in native harness receipt; it does not execute an IDE or
// establish that a receipt is authentic. Preserve the original receipt/binary.
export function verifyIdeSoak(receipt) {
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  require(receipt?.schemaVersion === 1, 'Unsupported soak receipt');
  require(receipt.requestedMinutes === 240, 'The release gate requires a 240-minute run');
  require(receipt.passed === true && Array.isArray(receipt.errors) && receipt.errors.length === 0,
    'Soak is incomplete or contains errors');
  const start = Date.parse(receipt.startedAt), end = Date.parse(receipt.completedAt);
  require(Number.isFinite(start) && Number.isFinite(end) && end - start >= 14_400_000,
    'Completion timestamps do not cover four hours');
  require(Number.isFinite(receipt.elapsedSeconds) && receipt.elapsedSeconds >= 14_400,
    'Measured elapsed time does not cover four hours');
  require(Number.isInteger(receipt.samples) && receipt.samples >= 2_592,
    'Insufficient native observation coverage; sleep or a busy UI cannot count as a soak');
  require(Number.isInteger(receipt.builds) && receipt.builds >= 24,
    'Insufficient completed native builds');
  require(typeof receipt.implementationVersion === 'string' && receipt.implementationVersion.length > 0 &&
    /^[a-f0-9]{64}$/i.test(receipt.adapterSha256 ?? ''), 'Missing exact adapter provenance');
  for (const label of ['initialResources', 'currentResources']) {
    for (const field of ['privateBytes', 'workingSetBytes', 'handles', 'threads']) {
      require(Number.isSafeInteger(receipt[label]?.[field]) && receipt[label][field] > 0,
        `Missing resource observation: ${label}.${field}`);
    }
  }
  require(Number.isSafeInteger(receipt.peakPrivateBytes) && receipt.peakPrivateBytes >=
    Math.max(receipt.initialResources.privateBytes, receipt.currentResources.privateBytes), 'Invalid peak private memory');
  require(Number.isSafeInteger(receipt.peakHandles) && receipt.peakHandles >=
    Math.max(receipt.initialResources.handles, receipt.currentResources.handles), 'Invalid peak handle count');
  return {
    passed: true, scope: 'Automated native IDE observation and build soak; no human usage/model inference claim',
    implementationVersion: receipt.implementationVersion, adapterSha256: receipt.adapterSha256,
    elapsedSeconds: receipt.elapsedSeconds, samples: receipt.samples, builds: receipt.builds,
    privateBytesChange: receipt.currentResources.privateBytes - receipt.initialResources.privateBytes,
    handleCountChange: receipt.currentResources.handles - receipt.initialResources.handles,
    peakPrivateBytes: receipt.peakPrivateBytes, peakHandles: receipt.peakHandles,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/verify-ide-soak.mjs <receipt.json>');
  console.log(JSON.stringify(verifyIdeSoak(JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''))), null, 2));
}
