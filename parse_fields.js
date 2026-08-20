const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'db', 'schema');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts');

function extractFieldsBlock(content, startIdx) {
  // startIdx points at the '{' that opens the fields object
  let depth = 0;
  let i = startIdx;
  for (; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(startIdx + 1, i);
    }
  }
  return '';
}

let grandTotal = 0;
const summaryLines = [];

for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const tableDeclRegex = /export const (\w+) = (\w+)\.table\(\s*\n?\s*["'`](\w+)["'`]\s*,\s*\{/g;
  let match;
  const tables = [];
  while ((match = tableDeclRegex.exec(content)) !== null) {
    const [full, camelName, schemaObj, snakeName] = match;
    const braceStart = match.index + full.length - 1; // position of the '{'
    const fieldsBlock = extractFieldsBlock(content, braceStart);
    // top-level field lines: identifier: type(...) at start of a line (allow leading spaces only, i.e. depth 1)
    const lines = fieldsBlock.split('\n');
    const fields = [];
    let localDepth = 0;
    for (const line of lines) {
      const opens = (line.match(/\(/g) || []).length;
      const closes = (line.match(/\)/g) || []).length;
      const trimmed = line.trim();
      if (localDepth === 0) {
        const fm = trimmed.match(/^(\w+):\s*([\w.]+)\(/);
        if (fm) {
          // capture a short annotation: primaryKey / notNull / references / default
          const isPK = /\.primaryKey\(/.test(line);
          const flags = [];
          if (isPK) flags.push('PK');
          if (/\.references\(/.test(line)) flags.push('FK');
          if (/uniqueIndex|\.unique\(/.test(line)) flags.push('UK');
          fields.push(`${fm[1]}:${fm[2]}${flags.length ? '[' + flags.join(',') + ']' : ''}`);
        }
      }
      localDepth += opens - closes;
      if (localDepth < 0) localDepth = 0;
    }
    tables.push({ camelName, schemaObj, snakeName, fields });
  }
  grandTotal += tables.length;
  summaryLines.push(`=== ${file} (${tables.length} tables) ===`);
  for (const t of tables) {
    summaryLines.push(`${t.schemaObj}.${t.snakeName} [${t.camelName}]: ${t.fields.join(', ')}`);
  }
}
summaryLines.push(`GRAND TOTAL: ${grandTotal}`);
fs.writeFileSync(path.join(__dirname, 'schema_fields.txt'), summaryLines.join('\n'));
console.log('done, tables=', grandTotal);
