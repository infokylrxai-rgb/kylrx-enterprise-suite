import fs from 'fs';
import vm from 'vm';

const allHtmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));

console.log('Validating all', allHtmlFiles.length, 'HTML pages in root...');

const brokenHrefs = [];
const scriptErrors = [];

for (const file of allHtmlFiles) {
  const content = fs.readFileSync(file, 'utf8');

  // Check hrefs
  const matches = content.matchAll(/href=["']([^"']+)["']/g);
  for (const m of matches) {
    const href = m[1];
    if (href.startsWith('#') || href.startsWith('http') || href.startsWith('data:') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
    if (href.includes('${') || href.includes('$1')) continue;
    const base = href.split('#')[0].split('?')[0];
    if (base && !fs.existsSync(base)) {
      brokenHrefs.push({ file, href, base });
    }
  }

  // Check inline scripts
  const scripts = content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  let idx = 0;
  for (const sm of scripts) {
    idx++;
    const code = sm[1].trim();
    if (!code) continue;
    const isModule = sm[0].includes('type="module"') || sm[0].includes("type='module'");
    try {
      if (isModule) {
        new vm.SourceTextModule(code, { identifier: `${file}-s${idx}` });
      } else {
        new vm.Script(code, { filename: `${file}-s${idx}` });
      }
    } catch (err) {
      scriptErrors.push({ file, idx, message: err.message });
    }
  }
}

console.log('Broken hrefs (' + brokenHrefs.length + '):');
brokenHrefs.forEach(b => console.log(`  ${b.file} -> ${b.href}`));

console.log('\nScript syntax errors (' + scriptErrors.length + '):');
scriptErrors.forEach(s => console.log(`  ${s.file} (script #${s.idx}): ${s.message}`));
