#!/usr/bin/env node
/** PL-08#AC1: no debug or test functions may ship (`netlify/functions/(debug|test)_*`). */
import { readdirSync } from 'node:fs';

const DIR = 'netlify/functions';
const bad = readdirSync(DIR).filter((name) => /^(debug|test)[_-]/i.test(name));
if (bad.length) {
  console.error(`check-function-names: remove debug/test functions from ${DIR}: ${bad.join(', ')}`);
  process.exit(1);
}
console.log('check-function-names: ok');
