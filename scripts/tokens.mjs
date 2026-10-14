// Generates src/styles/tokens.css from replica/design/tokens.json
import { readFileSync, writeFileSync } from 'node:fs';
const t = JSON.parse(readFileSync(new URL('../replica/design/tokens.json', import.meta.url)));
const lines = [':root {'];
for (const [k, v] of Object.entries(t.color)) lines.push(`  --c-${k}: ${v};`);
lines.push(`  --font-sans: ${t.font.sans};`, `  --font-mono: ${t.font.mono};`);
for (const [k, v] of Object.entries(t.type)) lines.push(`  --fs-${k}: ${v.size}px;`, `  --lh-${k}: ${v.line}px;`, `  --fw-${k}: ${v.weight};`);
t.space.forEach((v, i) => lines.push(`  --sp-${i}: ${v}px;`));
for (const [k, v] of Object.entries(t.radius)) lines.push(`  --r-${k}: ${v}px;`);
for (const [k, v] of Object.entries(t.shadow)) lines.push(`  --sh-${k}: ${v};`);
for (const [k, v] of Object.entries(t.motion)) lines.push(`  --m-${k}: ${v};`);
for (const [k, v] of Object.entries(t.layout)) lines.push(`  --l-${k}: ${v}px;`);
lines.push('}');
writeFileSync(new URL('../src/styles/tokens.css', import.meta.url), lines.join('\n') + '\n');
console.log('tokens.css written');
