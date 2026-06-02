#!/usr/bin/env node
import{register as r}from"node:module";import{block as m}from"./runtime.mjs";import{$ as o}from"zx";Object.assign(globalThis,{block:m,$:o}),r(new URL(import.meta.url.endsWith(".ts")?"md-loader.ts":"md-loader.mjs",import.meta.url));
