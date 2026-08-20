const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'db', 'schema');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts');

const results = {};

for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  // Match: export const camelName = schemaObj.table("snake_name", {
  //   ...fields...
  // }, ...
  const tableRegex = /export const (\w+) = (\w+)\.table\(\s*["'`]([\w]+)["'`]\s*,\s*\{([\s\S]*?)\n\}\s*(?:,|\))/g;
  let match;
  const tables = [];
  while ((match = tableRegex.exec(content)) !== null) {
    const [, camelName, schemaObj, snakeName, fieldsBlock] = match;
    // extract field names: identifier at start of line followed by colon
    const fieldRegex = /^\s*(\w+):\s*(\w+)\(/gm;
    const fields = [];
    let fm;
    while ((fm = fieldRegex.exec(fieldsBlock)) !== null) {
      fields.push({ name: fm[1], type: fm[2] });
    }
    tables.push({ camelName, schemaObj, snakeName, fields });
  }
  results[file] = tables;
}

let totalTables = 0;
for (const file of files) {
  console.log(`\n=== ${file} (${results[file].length} tables) ===`);
  for (const t of results[file]) {
    totalTables++;
    const fieldStr = t.fields.map(f => `${f.name}:${f.type}`).join(', ');
    console.log(`  ${t.schemaObj}.${t.snakeName} [${t.camelName}] -> ${fieldStr}`);
  }
}
console.log(`\nTOTAL: ${totalTables}`);
