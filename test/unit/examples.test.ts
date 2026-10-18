import { testCommand } from './run.js';

// Clones real-world XML and DTD files into examples/ on the first run, which takes a few minutes.
testCommand(
  'fails to parse exactly the real-world XML and DTD files in script/known-failures.txt',
  ['script/parse-examples', '--check'],
  1_800_000
);
