#!/usr/bin/env node
/** Waits until a URL answers (any HTTP status), up to 5 minutes. Used by playwright.config.ts to order servers. */
const url = process.argv[2];
const deadline = Date.now() + 5 * 60_000;
for (;;) {
  try {
    await fetch(url);
    process.exit(0);
  } catch {
    if (Date.now() > deadline) {
      console.error(`wait-for: ${url} did not answer`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
