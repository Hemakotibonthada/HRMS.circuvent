const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'db', 'schema');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts');

let total = 0;
for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const tableRegex = /export const (\w+) = (\w+)\.table\(\s*\n?\s*["'`]([\w]+)["'`]/g;
  let match;
  const names = [];
  while ((match = tableRegex.exec(content)) !== null) {
    names.push(`${match[2]}.${match[3]} [${match[1]}]`);
  }
  total += names.length;
  console.log(`=== ${file} (${names.length}) ===`);
  for (const n of names) console.log(`  ${n}`);
}
console.log(`TOTAL: ${total}`);
