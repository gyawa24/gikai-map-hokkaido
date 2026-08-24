#!/usr/bin/env node

// 互換runtime JSONはagenda-onlyになったため、品質gateは厳密全文索引を正とする。
await import("./check-search-bigram-quality.mjs");
