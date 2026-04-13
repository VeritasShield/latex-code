#!/bin/bash

# Detener la ejecución inmediatamente si algún comando falla (Circuit Breaker)
set -e

# Definición de colores para logs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar dependencias (Autocorrección de entorno)
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}ℹ Directorio node_modules no encontrado. Instalando dependencias...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencias instaladas.${NC}"
fi

echo -e "${YELLOW}🚀 Iniciando servidor de desarrollo interactivo (Vite + Monkey Plugin)...${NC}"
echo -e "${GREEN}ℹ Abre Google Docs en tu navegador con Tampermonkey activado para ver los cambios en tiempo real.${NC}"

# Iniciar entorno de desarrollo (HMR)
npm run dev