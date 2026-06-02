#!/usr/bin/env node
var x=Object.defineProperty;var c=(e,a)=>x(e,"name",{value:a,configurable:!0});import b from"node:fs/promises";import{pathToFileURL as E,fileURLToPath as T}from"node:url";import{p as $,E as B,M as F}from"./parse-markdown-wnFVEAED.mjs";import{GenMapping as P,toEncodedMap as W,addSegment as U}from"@jridgewell/gen-mapping";import"micromark";const M=10,v=13,N=c(e=>e===9||e===M||e===11||e===12||e===v||e===32,"isWhitespaceCode"),j=c(e=>e>=48&&e<=57||e>=65&&e<=90||e===95||e>=97&&e<=122||e===36,"isIdentifierCode"),A=c((e,a)=>{const h=E(e).href,p=new P({file:e}),s=[];let i="";const o=[];for(let n=a.indexOf(`
`);n!==-1;n=a.indexOf(`
`,n+1))o.push(n);const y=c(n=>{let t=0,r=o.length;for(;t<r;){const f=Math.floor((t+r)/2);o[f]<n?t=f+1:r=f}const d=t>0?o[t-1]:-1;return{line:t,column:n-d-1}},"positionFromOffset"),u=c(n=>{i+=n},"appendLineChunk"),S=c(()=>{s.push(i),i=""},"flushLine"),O=c((n,t)=>{const r=y(t);let d=r.line,f=r.column,L=!1,R=!1,m=0;const w=c(l=>i.length+l-m,"generatedColumn");for(let l=0;l<n.length;l+=1){const g=n.codePointAt(l),C=N(g),I=j(g);!C&&(l===0||R||!L||!I)&&U(p,s.length,w(l),h,d,f),g===M?(d+=1,f=0):f+=1,L=I,R=C,g===M&&(u(n.slice(m,l)),S(),m=l+1)}m<n.length&&u(n.slice(m))},"appendSourceText"),k=c(n=>{let t=0;for(let r=n.indexOf(`
`);r!==-1;r=n.indexOf(`
`,t))u(n.slice(t,r)),S(),t=r+1;t<n.length&&u(n.slice(t))},"appendSyntheticText");return{appendSource(n,t){O(n,t)},appendSynthetic(n){k(n)},toModuleSource:c(()=>{const t=`${(i===""?s:[...s,i]).join(`
`)}
`,r=W(p),d=`//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(r)).toString("base64")}`;return`${t}${d}
`},"toModuleSource")}},"createSourceBuilder"),X=c((e,a,h,p)=>{const s=A(a,e);for(const o of h)s.appendSource(o.content,o.contentStart),o.content.endsWith(`
`)||s.appendSynthetic(`
`);const i=new Map;for(const o of p)i.has(o.expression)||i.set(o.expression,{index:i.size,marker:o});for(const[o,{index:y,marker:u}]of i){const S=`export const ${B}${y} = `;s.appendSynthetic(S),s.appendSource(o,u.start+F.length),s.appendSynthetic(`;
`)}return s.toModuleSource()},"generateModule"),_=c(async(e,a,h)=>{if(!e.endsWith(".md"))return h(e,a);const p=T(e),s=await b.readFile(p,"utf8"),{scriptBlocks:i,markers:o}=$(s);return i.length===0&&o.length===0?{format:"module",source:"",shortCircuit:!0}:{format:"module",source:X(s,p,i,o),shortCircuit:!0}},"load");export{_ as load};
