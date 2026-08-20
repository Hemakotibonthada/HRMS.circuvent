const fs = require('fs');
const path = require('path');
const dir = 'src/db/schema';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
let total = 0;
const byFile = {};
const allTables = [];
for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  const re = /export const (\w+) = (hrms|identity)\.table\(\s*\n?\s*["']([a-z_0-9]+)["']/g;
  let m;
  let count = 0;
  while ((m = re.exec(content)) !== null) {
    count++;
    allTables.push({file: f, varName: m[1], schema: m[2], tableName: m[3]});
  }
  byFile[f] = count;
  total += count;
}
console.log('Per file:', JSON.stringify(byFile, null, 2));
console.log('TOTAL:', total);
console.log('---');
allTables.forEach(t => console.log(t.schema + '.' + t.tableName + '  (' + t.varName + ')  [' + t.file + ']'));
