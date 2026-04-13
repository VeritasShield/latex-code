# Contexto del Proyecto: LaTeX Docs Converter (Userscript)

## 1. Descripción General
Es un Userscript (Tampermonkey) inyectado en Google Docs (`https://docs.google.com/document/*`) que permite convertir selecciones de texto plano o expresiones matemáticas rudimentarias a código LaTeX formateado de manera profesional. Cuenta con una interfaz gráfica flotante y arrastrable (aislada mediante Shadow DOM) para previsualizar conversiones en tiempo real, ajustar configuraciones avanzadas y copiar/pegar el resultado.
**Versión actual**: 1.9.4.

## 2. Stack Tecnológico
- **Lenguaje**: TypeScript (Estricto).
- **Bundler**: Vite.
- **Plugins**: `vite-plugin-monkey` (compilación directa a formato Userscript con metadatos integrados, inyección `document-end`).
- **Entorno**: Navegador (DOM, Shadow DOM, LocalStorage, Portapapeles asíncrono, ResizeObserver, MutationObserver).

## 3. Arquitectura de Directorios (Domain-Driven)
El código está estrictamente modularizado en `src/` aplicando el principio de Segregación de Responsabilidades:

- **`src/main.ts`**: Punto de entrada (Bootstrap). Inicializa el "Boot Loop" protegiendo la ejecución con un bloque `try/catch` global para no romper la página anfitriona.
- **`src/core/LatexEngine.ts`**: Motor de conversión algorítmico puro. Agnóstico del DOM. Realiza tokenización, combinaciones atómicas (fracciones), extracción de incisos (ej. `a)`, `b)`), auto-balanceo N-dimensional de delimitadores (`\left( \right)`) y normalización Unicode.
- **`src/services/StorageService.ts`**: Capa de persistencia estricta. Interacciona con `localStorage` usando claves versionadas (`tmLatexOptsV1`, `tmLatexGeomV1`, `tmLatexZoomV1`, `tmLatexFullscreenV1`) implementando _graceful degradation_ si el JSON está corrupto.
- **`src/ui/Launcher.ts`**: Gestor de inyección y atajos globales. Usa `setInterval` (máx 60 intentos) para esperar a la carga del DOM, inyecta un botón anclado al viewport y escucha atajos de teclado (`Alt+L` abrir, `Esc` cerrar).
- **`src/ui/Panel.ts`**: Interfaz de Usuario completa. Crea un `ShadowRoot` para encapsular estilos. Maneja la reactividad local, drag & drop, zoom (escala CSS por evento de rueda/rango), validación del estado del portapapeles y vinculación bi-direccional con las opciones del motor.
- **`src/utils/dom.ts`**: Funciones auxiliares. Incluye `h` (Hyperscript-like) para crear árboles DOM tipados de forma segura (prevención XSS usando `textContent`), eliminación de nodos hijos y sistema de "Toasts" flotantes.

## 4. Casos de Uso y Lógica del Motor (LatexEngine)
- **Tokenización y Fracciones**: Identifica números, palabras y operadores. Combina valores atómicos (longitud configurable, ej. $\le 2$) en fracciones `\frac{num}{den}` automáticamente.
- **Limpieza y Normalización**: Normaliza coma/punto decimal según preferencia, elimina tildes opcionalmente y convierte entidades HTML o caracteres Unicode (ej. `×`, `÷`, `≤`) a equivalentes LaTeX.
- **Protección de Literales**: Excluye bloques incisos (`a) `) y texto envuelto en `\text{}` para que no sufran transformaciones matemáticas.
- **Auto-Left/Right**: Analiza el AST para envolver paréntesis grandes basados en un umbral de caracteres internos (N).
- **Modos de Salida**: `line` (Línea simple), `array1`, `array2`, `arrayN` (Tablas N-columnas adaptativas con alineación personalizada), `gathered`, `aligned`, `cases`, `pmatrix/bmatrix`.
- **Auditoría**: Reporta desbalanceo de delimitadores `()`, `[]`, `{}` (`balanceReport`).

## 5. UI y User Experience (UX)
- **Atajos**: `Alt+L` despliega/oculta el panel; `Esc` lo cierra. Rueda de ratón (`Ctrl + Scroll`) para hacer Zoom in/out en el UI interior.
- **Estado Resiliente**: Se recuerda la última posición (geometría de ventana flotante), preferencias de mapeo individual de operadores, y modo fullscreen.
- **Portapapeles Seguro**: Integración asíncrona robusta con `navigator.clipboard`, controlando rechazos de permisos con Toasts informativos.

## 6. Reglas Estrictas de Desarrollo (Pilares LLM)
Para futuras interacciones, debes basarte SIEMPRE en estos 7 principios:

1. **Arquitectura y Errores**: Mantener separación (NUNCA mezclar manipulación DOM en `LatexEngine`). Prohibidos los `empty catches`. Manejar siempre rechazos de Promesas.
2. **Tipado Estricto**: Evitar a toda costa `any`. Usar y respetar interfaces definidas (`LatexOptions`, `Token`, `PanelElements`).
3. **UI/UX y Edge Cases**: Proteger la inyección contra múltiples inicializaciones. Validar nulos antes de acceder a `.value` de los elementos del DOM.
4. **Clean Code**: Nada de comentarios obvios. Código autodocumentado. No introducir console.logs excesivos o "log spam".
5. **Seguridad y Rendimiento**: Seguir usando la utilidad `h()` para inyección DOM. No usar `.innerHTML` (prevención XSS). Desuscribir observers/listeners (`ResizeObserver.disconnect()`) al destruir componentes.
6. **Observabilidad**: Todo `console.warn` o `console.error` debe llevar el prefijo `[LaTeX Converter]`.
7. **Dependencias**: Código *Vanilla* en medida de lo posible para minimizar el payload resultante del script Tampermonkey.