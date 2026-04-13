#!/bin/bash

# Detener la ejecución inmediatamente si algún comando falla
set -e

# Definición de colores para logs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar si es un repositorio Git
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo -e "${RED}✖ Error: Este directorio no es un repositorio Git.${NC}"
    exit 1
fi

# Verificar dependencias
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}ℹ Instalando dependencias faltantes...${NC}"
    npm install
fi

echo -e "${YELLOW}[1/5] Incrementando la versión del proyecto (Bump)...${NC}"
cat << 'EOF' > bump.cjs
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
EOF

NEW_VERSION=$(node bump.cjs)
rm bump.cjs

if [ -z "$NEW_VERSION" ]; then
    echo -e "${RED}✖ Error: No se pudo detectar o incrementar la versión en vite.config.ts.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Versión actualizada a: v${NEW_VERSION}${NC}"

echo -e "${YELLOW}[2/5] Construyendo el artefacto final de Tampermonkey...${NC}"
# Esto ejecuta Vite + Monkey Plugin generando el .user.js en dist/
npm run build
echo -e "${GREEN}✓ Build exitoso.${NC}"

echo -e "${YELLOW}[3/5] Agregando cambios al Stage...${NC}"
git add .

# Generación de mensaje de commit dinámico o por parámetro
COMMIT_MSG=$1
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="build: bump versión a v${NEW_VERSION} y compilar"
fi

echo -e "${YELLOW}[4/5] Generando Commit...${NC}"
# Verificar si realmente hay cambios por hacer commit
if git diff-index --cached --quiet HEAD --; then
    echo -e "${YELLOW}ℹ No hay archivos modificados para commitear.${NC}"
else
    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}✓ Commit creado: \"$COMMIT_MSG\"${NC}"
fi

echo -e "${YELLOW}[5/5] Subiendo cambios al repositorio remoto...${NC}"
# Verificar si la rama actual tiene un upstream configurado
if git rev-parse --abbrev-ref @'{u}' > /dev/null 2>&1; then
    git push
else
    echo -e "${YELLOW}ℹ Configurando upstream para la rama actual...${NC}"
    git push -u origin HEAD
fi

echo -e "${GREEN}🚀 ¡Despliegue y subida completados con éxito! El archivo .user.js está listo. ${NC}"