#!/usr/bin/env node
import{register as r}from"node:module";import{block as o}from"./runtime.mjs";import{$ as e}from"zx";Object.assign(globalThis,{block:o,$:e}),process.setSourceMapsEnabled(!0),r("#md-loader",import.meta.url);
