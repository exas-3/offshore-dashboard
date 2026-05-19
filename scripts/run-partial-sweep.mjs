// Force one or more passes of the partial-sweep job. Useful after deploying
// classifier changes that should now resolve previously-stuck PARTIAL rows.
import { syncPartialSweep } from '../server/syncs/partial-sweep.js';

const passes = Number(process.argv[2] ?? 6);
for (let i = 1; i <= passes; i++) {
  console.log(`\n── pass ${i}/${passes} ──`);
  await syncPartialSweep();
}
process.exit(0);
