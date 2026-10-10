// Dev check: confirm every named import in js/ resolves to a real export.
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('js').filter((f) => f.endsWith('.js'));
const exp = {};

for (const f of files) {
  const src = fs.readFileSync('js/' + f, 'utf8');
  const names = new Set();
  const decl = /^export\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var)\s+([A-Za-z0-9_$]+)/gm;
  for (const m of src.matchAll(decl)) names.add(m[1]);
  const braced = /^export\s*\{([^}]*)\}/gm;
  for (const m of src.matchAll(braced)) {
    m[1].split(',').forEach((s) => {
      const n = s.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    });
  }
  exp[f] = names;
}

let bad = 0;
const impRe = /import\s*\{([^}]*)\}\s*from\s*['"](\.\/[^'"]+)['"]/g;
for (const f of files) {
  const src = fs.readFileSync('js/' + f, 'utf8');
  for (const m of src.matchAll(impRe)) {
    const target = path.basename(m[2]);
    if (!exp[target]) { console.log('MISSING FILE   ' + f + ' -> ' + target); bad++; continue; }
    const want = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    for (const w of want) {
      if (!exp[target].has(w)) { console.log('MISSING EXPORT ' + f + ' imports {' + w + '} from ' + target); bad++; }
    }
  }
}
console.log(bad ? '\n' + bad + ' problem(s)' : 'All imports resolve OK');
