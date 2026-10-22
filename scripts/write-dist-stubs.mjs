// Each build folder declares its own module kind, so Node treats dist/esm/*.js as ESM and dist/cjs/*.js
// as CommonJS whatever the root package.json says.
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
writeFileSync(new URL('../dist/esm/package.json', import.meta.url), JSON.stringify({ type: 'module' }, null, 2) + '\n');
