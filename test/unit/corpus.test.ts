import { expect } from 'vitest';

import { testCommand } from './run.js';

// The CLI exits zero when it finds no corpus case, so its summary must show that cases were parsed.
testCommand('parses the corpus in test/corpus as expected', ['script/tree-sitter', 'test'], 300_000, {
  check: (output) => expect(output).toMatch(/Total parses: [1-9]/),
});
