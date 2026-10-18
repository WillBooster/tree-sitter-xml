import { expect } from 'vitest';

import { testCommand } from './run.js';

// The package ships a Wasm build, which another compiler builds than the native one. The first run downloads the WASI
// SDK. The CLI exits zero when it finds no corpus case, so its summary must show that cases were parsed.
testCommand(
  'parses the corpus in test/corpus as expected with the Wasm build',
  ['script/tree-sitter', 'test', '--wasm'],
  900_000,
  { check: (output) => expect(output).toMatch(/Total parses: [1-9]/) }
);
