const fs = require('fs');
let newV = '';
function bump(file, regex, replacer) {
  if (!fs.existsSync(file)) return;
  let c = fs.readFileSync(file, 'utf8');
  c = c.replace(regex, (match, major, minor, patch) => {
    if (!newV) newV = `${major}.${minor}.${parseInt(patch) + 1}`;
    return replacer(newV);
  });
  fs.writeFileSync(file, c);
}
bump('vite.config.ts', /version:\s*'(\d+)\.(\d+)\.(\d+)'/, v => `version: '${v}'`);
bump('contexto.md', /\*\*Versión actual\*\*:\s*(\d+)\.(\d+)\.(\d+)/, v => `**Versión actual**: ${v}`);
bump('package.json', /"version":\s*"(\d+)\.(\d+)\.(\d+)"/, v => `"version": "${v}"`);
console.log(newV);
