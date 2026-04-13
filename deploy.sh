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

echo -e "${YELLOW}[1/4] Construyendo el artefacto final de Tampermonkey...${NC}"
# Esto ejecuta Vite + Monkey Plugin generando el .user.js en dist/
npm run build
echo -e "${GREEN}✓ Build exitoso.${NC}"

echo -e "${YELLOW}[2/4] Agregando cambios al Stage...${NC}"
git add .

# Generación de mensaje de commit dinámico o por parámetro
COMMIT_MSG=$1
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="build: compilar nueva versión del Userscript ($(date +'%Y-%m-%d %H:%M:%S'))"
fi

echo -e "${YELLOW}[3/4] Generando Commit...${NC}"
# Verificar si realmente hay cambios por hacer commit
if git diff-index --cached --quiet HEAD --; then
    echo -e "${YELLOW}ℹ No hay archivos modificados para commitear.${NC}"
else
    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}✓ Commit creado: \"$COMMIT_MSG\"${NC}"
fi

echo -e "${YELLOW}[4/4] Subiendo cambios al repositorio remoto...${NC}"
# Verificar si la rama actual tiene un upstream configurado
if git rev-parse --abbrev-ref @'{u}' > /dev/null 2>&1; then
    git push
else
    echo -e "${YELLOW}ℹ Configurando upstream para la rama actual...${NC}"
    git push -u origin HEAD
fi

echo -e "${GREEN}🚀 ¡Despliegue y subida completados con éxito! El archivo .user.js está listo. ${NC}"