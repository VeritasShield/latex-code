# Contexto del Proyecto: LaTeX Docs Converter (Userscript)

## 1. Descripción General
Es un Userscript (Tampermonkey) inyectado en Google Docs (`https://docs.google.com/document/*`) que permite convertir selecciones de texto plano o expresiones matemáticas a código LaTeX formateado de manera profesional. Cuenta con una interfaz gráfica flotante (Shadow DOM) estructurada en pestañas, destacando un **Editor Visual Bidireccional** interactivo para matrices y un motor algorítmico de **decompilación inversa** que transforma código LaTeX complejo de vuelta a texto plano editable.
**Versión actual**: 1.9.5.

## 2. Stack Tecnológico
- **Lenguaje**: TypeScript (Estricto).
- **Bundler**: Vite.
- **Plugins**: `vite-plugin-monkey` (compilación directa a formato Userscript con metadatos integrados, inyección `document-end`).
- **Entorno**: Navegador (DOM, Shadow DOM, LocalStorage, Portapapeles asíncrono, Drag & Drop nativo, ResizeObserver).
- **DX / DevOps**: Scripts en Bash (`deploy.sh`, `debug.sh`) para automatización de compilación, HMR (Hot-Module Replacement), commits semánticos y subida a Git.

## 3. Arquitectura de Directorios (Domain-Driven)
El código está estrictamente modularizado en `src/` aplicando el principio de Segregación de Responsabilidades:

- **`src/main.ts`**: Punto de entrada (Bootstrap). Protege la ejecución con un `try/catch` global e invoca el inyector.
- **`src/core/LatexEngine.ts`**: Motor algorítmico puro. Agnóstico al DOM. Realiza tokenización avanzada (AST), combinaciones atómicas (fracciones limitadas por longitud), extracción de incisos, auto-balanceo N-dimensional de delimitadores, control de espaciado (`rowSep`, `colSep`) y *Decompilación Recursiva*.
- **`src/services/StorageService.ts`**: Capa de persistencia unificada. Interacciona con `localStorage` usando una clave única (`tmLatexStateV2`) con un mecanismo interno de *Debounce* (250ms) para evitar picos de I/O. Incluye migración transparente (Graceful Degradation) desde el estado V1.
- **`src/ui/Launcher.ts`**: Gestor de inyección. Usa `setInterval` para esperar la carga del DOM, inyecta un botón anclado (con menú contextual para resetear su posición) y escucha atajos de teclado (`Alt+L`, `Esc`).
- **`src/ui/Panel.ts`**: Interfaz de Usuario. Usa Shadow DOM y un sistema de pestañas (Ajustes vs Editor Visual). Maneja reactividad local, un historial de Deshacer (`previousInput`), Drag & Drop para celdas de matrices, y parsing de tablas pegadas desde Excel.
- **`src/utils/dom.ts`**: Funciones auxiliares. Incluye `h` (Hyperscript-like) para crear árboles DOM tipados de forma segura (prevención XSS usando `textContent`), eliminación de nodos hijos y sistema de "Toasts" flotantes.

## 4. Casos de Uso y Lógica del Motor (LatexEngine)
- **Decompilación Inversa**: Transforma código estructurado (ej. `\begin{pmatrix}...`) a texto plano tabulado, aplanando macros, fracciones anidadas y comandos de espaciado, permitiendo edición WYSIWYG bidireccional.
- **Tokenización y Fracciones**: Identifica números, palabras y operadores. Combina valores atómicos (longitud configurable, ej. $\le 2$) en fracciones `\frac{num}{den}` automáticamente.
- **Limpieza y Normalización**: Normaliza coma/punto decimal, elimina tildes opcionalmente y convierte entidades HTML o caracteres Unicode (ej. `×`, `÷`, `≤`) a equivalentes LaTeX.
- **Protección de Literales**: Excluye bloques incisos (`a) `) y texto envuelto en `\text{}` para que no sufran transformaciones matemáticas.
- **Auto-Left/Right**: Analiza el AST para envolver paréntesis grandes basados en un umbral de caracteres internos (N).
- **Modos de Salida y Geometría**: `line` (Línea simple), matrices (N-columnas adaptativas con auto-alineación), `gathered`, `aligned`, `cases`, `pmatrix/bmatrix`. Aplica espacios explícitos (`\\[Xpt]`, `\hspace{Xpt}`).
- **Auditoría**: Reporta desbalanceo de delimitadores `()`, `[]`, `{}` (`balanceReport`).

## 5. UI y User Experience (UX)
- **Editor Visual Interactivo**: Grid CSS dinámico que permite añadir/quitar filas, columnas y ajustar Gaps al vuelo. Permite arrastrar (Drag & Drop) celdas, valida la sintaxis por celda (resaltando errores en rojo) y acepta pegado directo desde Excel o Google Sheets expandiendo la matriz automáticamente.
- **Atajos Universales**: `Alt+L` (Panel), `Esc` (Cerrar), `Ctrl+Z` (Deshacer local, no interrumpe el del navegador), `Ctrl+S` (Copia rápida al portapapeles), `Ctrl + Scroll` (Zoom UI).
- **Rescate de Geometría**: Bounding Box restrictivo que impide arrastrar la ventana fuera de la pantalla. Doble clic en la cabecera o clic derecho en el Launcher para restaurar la posición.
- **Protección contra Pérdida de Datos**: Mantenimiento en memoria (`currentInput`) si se cierra el panel. Modo *Overflow* que conserva las celdas recortadas al eliminar columnas enviándolas al final del arreglo.

## 6. Reglas Estrictas de Desarrollo (Pilares LLM)
Para futuras interacciones, debes basarte SIEMPRE en estos 7 principios:

1. **Arquitectura y Errores**: Mantener rigurosa separación (Single Source of Truth). NUNCA mezclar manipulación DOM en `LatexEngine`. Prohibidos los `empty catches` (usar `console.trace` para debug interno). Manejar siempre rechazos de Promesas.
2. **Tipado Estricto**: Evitar a toda costa `any`. Usar y respetar interfaces definidas (`LatexOptions`, `Token`, `PanelElements`). Utilizar el operador `!` solo si el flujo síncrono garantiza la pre-existencia del nodo.
3. **UI/UX y Edge Cases**: El panel debe soportar redimensionamiento agresivo. Validar nulos antes de acceder a propiedades del DOM. Informar siempre visualmente al usuario (Toasts o Tooltips) en lugar de silenciar acciones.
4. **Clean Code**: Código autodocumentado. Variables semánticas. No ensuciar con comentarios obvios. Simplificar la complejidad ciclomática (`switch` en lugar de cadenas de `if`).
5. **Seguridad y Rendimiento**: Usar patrón Debounce para I/O (`localStorage`) y re-renderizados continuos. Usar delegación de eventos en bucles masivos. Continuar usando `h()` (prevención XSS vía `textContent`).
6. **Observabilidad**: Todo `console.warn`, `console.error` o `console.info` debe llevar obligatoriamente el prefijo `[LaTeX Converter]`.
7. **Dependencias**: Código *Vanilla TypeScript* sin frameworks pesados para garantizar un payload minúsculo (.user.js) ultrarrápido al inyectarse en Google Docs.