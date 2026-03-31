#!/usr/bin/env node
var p=Object.defineProperty;var i=(r,o)=>p(r,"name",{value:o,configurable:!0});import c from"node:fs/promises";import{fileURLToPath as m}from"node:url";import{p as f,b as u,E as d}from"./parse-markdown-ChGEvmW3.mjs";import"md4x";const l=i((r,o)=>{const t=r.join(`
`),s=u(o);if(s.size===0)return t;const e=[...s].map(([n,a])=>`export const ${d}${a} = ${n};`);return`${t}
${e.join(`
`)}`},"generateModule"),$=i(async(r,o,t)=>{if(!r.endsWith(".md"))return t(r,o);const s=await c.readFile(m(r),"utf8"),{scriptBlocks:e,markers:n}=f(s);return e.length===0&&n.length===0?t(r,o):{format:"module",source:l(e,n),shortCircuit:!0}},"load");export{$ as load};
