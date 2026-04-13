import katex from 'katex';
import { StorageService } from '../services/StorageService';
import { h, removeChildren, clamp, toast } from '../utils/dom';
import {
    convertSelectionToLatexOneLine, balanceReport, excludeTextBlocks, detectOperators,
    normalizeUnicodeOperators, decodeEntities, opOptionsFor, defaultMapFor,
    isLatexWrapped, decompileLatexToPlainText, extractIncisoBlocks, stripDiacritics, DEFAULT_OPTS
} from '../core/LatexEngine';

export const MAX_Z_INDEX = 2147483647;

interface PanelElements {
    host?: HTMLElement; root?: ShadowRoot; panel?: HTMLElement;
    input?: HTMLTextAreaElement; preview?: HTMLTextAreaElement;
    btnCopy?: HTMLButtonElement; btnPaste?: HTMLButtonElement; btnClear?: HTMLButtonElement; btnUndo?: HTMLButtonElement;
    btnClose?: HTMLButtonElement; btnFull?: HTMLButtonElement; parenStatus?: HTMLElement;
    zoomWrapper?: HTMLElement; zoomRange?: HTMLInputElement; zoomLabel?: HTMLElement;
    selFormat?: HTMLSelectElement; inpArrayN?: HTMLInputElement; inpAlign?: HTMLInputElement;
    inpRowSep?: HTMLInputElement; inpColSep?: HTMLInputElement;
    chkPreserveLB?: HTMLInputElement; chkInsertQuad?: HTMLInputElement; chkFrac?: HTMLInputElement;
    inpAtomicLen?: HTMLInputElement; chkAutoLR?: HTMLInputElement; inpLRN?: HTMLInputElement; chkDontRewrap?: HTMLInputElement;
    chkNoAccents?: HTMLInputElement; chkClearOnCopy?: HTMLInputElement;
    katexContainer?: HTMLElement;
    decRadios?: HTMLInputElement[]; wrapRadios?: HTMLInputElement[];
    selNumOpColon?: HTMLSelectElement; selNumOpX?: HTMLSelectElement; opGrid?: HTMLElement;
    tabTextBtn?: HTMLElement; tabVisBtn?: HTMLElement;
    viewText?: HTMLElement; viewVis?: HTMLElement; visualEditor?: HTMLElement;
    btnVisAddRow?: HTMLButtonElement; btnVisRemRow?: HTMLButtonElement;
    btnVisAddCol?: HTMLButtonElement; btnVisRemCol?: HTMLButtonElement;
    btnVisGapRowUp?: HTMLButtonElement; btnVisGapRowDn?: HTMLButtonElement;
    btnVisGapColUp?: HTMLButtonElement; btnVisGapColDn?: HTMLButtonElement;
    btnResetOpts?: HTMLButtonElement;
}

export const state = {
    panelOpen: false,
    compact: false,
    fullscreen: StorageService.loadFullscreen(),
    zoom: StorageService.loadZoom() ?? 1,
    opts: StorageService.loadOpts(),
    elements: {} as PanelElements,
    resizeObserver: null as ResizeObserver | null,
    cleanups: [] as Array<() => void>,
    currentInput: '',
    previousInput: '',
    currentTab: 'text' as 'text' | 'visual',
    isVisualEditing: false
};

export function togglePanel(): void {
    state.panelOpen ? closePanel() : openPanel();
}

export function resetPanelPosition(): void {
    if (!state.elements.host || state.fullscreen) return;
    const el = state.elements.host;
    Object.assign(el.style, { left: 'auto', top: 'auto', right: '30px', bottom: '30px', width: '450px', height: '600px' });
    StorageService.saveGeom(el);
    if (state.elements.root) toast(state.elements.root, 'Posición restaurada');
}

export function openPanel(): void {
    if (state.panelOpen) return;
    state.panelOpen = true;

    const host = document.createElement('tm-latex-panel-host');
    Object.assign(host.style, {
        position: 'fixed', left: 'auto', top: 'auto', right: '30px', bottom: '30px',
        width: '450px', height: '600px', minWidth: '320px', minHeight: '300px',
        maxWidth: '95vw', maxHeight: '95vh', zIndex: String(MAX_Z_INDEX), display: 'block'
    });

    const savedGeom = StorageService.loadGeom();
    if (savedGeom && !state.fullscreen) Object.assign(host.style, savedGeom);

    document.documentElement.appendChild(host);
    if (state.fullscreen) applyFullscreenGeom(host);

    const root = host.attachShadow({ mode: 'open' });

    const katexStyle = h('link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css' });
    root.appendChild(katexStyle);

    const style = h('style', {}, `
      * { box-sizing: border-box; }
      :host { display: block; box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; resize: both; overflow: hidden; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); background: #1e1e1e; }
      .panel { display: flex; flex-direction: column; color: #e0e0e0; border: 1px solid #444; border-radius: inherit; width: 100%; height: 100%; overflow: hidden; }
      .header { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #252526; border-bottom: 1px solid #333; cursor: move; user-select: none; }
      .title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .spacer { flex: 1; }
      .btn { border: 1px solid #555; background: #333; color: #eee; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.1s; }
      .btn:hover { background: #444; }
      .btn.primary { background: #0e639c; border-color: #007acc; color: #fff; }
      .btn.primary:hover { background: #1177bb; }
      .btn.warn { background: #8B0000; border-color: #a00; }
      .btn.warn:hover { background: #a00; }
      .scroll-area { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding: 12px; display: flex; flex-direction: column; gap: 16px; }
      .zoom-wrapper { transform-origin: top center; width: 100%; }
      .section { display: flex; flex-direction: column; gap: 6px; }
      .label-head { font-weight: 600; color: #aaa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      .textarea { background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 8px; font-family: 'Consolas', monospace; font-size: 13px; width: 100%; resize: vertical; min-height: 80px; }
      .textarea:focus { border-color: #0e639c; outline: none; }
      .actions { display: flex; gap: 8px; margin-bottom: 4px; }
      .opt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
      label.chk-label { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: #ccc; cursor: pointer; line-height: 1.3; }
      input[type="checkbox"], input[type="radio"] { margin-top: 1px; }
      input[type="number"], input.text-in { background: #222; border: 1px solid #555; color: #eee; padding: 2px 4px; border-radius: 3px; font-size: 12px; }
      select { background: #222; border: 1px solid #555; color: #eee; padding: 2px; border-radius: 3px; max-width: 100%; }
      details { background: #252526; border: 1px solid #333; border-radius: 4px; padding: 4px; }
      summary { padding: 4px; cursor: pointer; font-weight: 600; font-size: 12px; user-select: none; }
      .details-content { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
      .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: #333; border: 1px solid #444; }
      .badge.ok { color: #8f8; border-color: #252; background: #131; }
      .badge.warn { color: #fb8; border-color: #530; background: #310; }
      .note { font-size: 11px; color: #888; margin-top: 4px; }
      .row-flex { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .tabs { display: flex; border-bottom: 1px solid #333; margin-bottom: 10px; margin-top: 4px; }
      .tab { padding: 6px 12px; cursor: pointer; color: #888; border-bottom: 2px solid transparent; font-weight: 600; font-size: 12px; transition: color 0.2s; }
      .tab.active { color: #fff; border-bottom-color: #0e639c; }
      .view { display: none; flex-direction: column; gap: 16px; }
      .view.active { display: flex; }
      .visual-grid { display: grid; gap: 6px; background: #1a1a1a; padding: 12px; border-radius: 6px; border: 1px solid #333; }
      .visual-cell-wrapper { display: flex; align-items: stretch; background: #222; border: 1px dashed #555; border-radius: 4px; transition: border-color 0.2s, background 0.2s; }
      .visual-cell-wrapper.drag-over { border-color: #0e639c; background: #2a2a2a; }
      .visual-drag-handle { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 20px; cursor: grab; color: #666; user-select: none; font-size: 16px; }
      .visual-drag-handle:hover { color: #aaa; }
      .visual-cell { flex: 1; color: #4CAF50; padding: 8px 4px 8px 0; text-align: center; min-height: 36px; font-family: 'Consolas', monospace; outline: none; cursor: text; background: transparent; border: none; }
      .visual-cell:empty::before { content: attr(data-placeholder); color: #666; font-style: italic; pointer-events: none; }
      :host([data-fullscreen="1"]) { resize: none; border-radius: 0; }
      :host([data-fullscreen="1"]) .panel { border: none; }
    `);

    const parenStatus = h('span', { className: 'badge', id: 'parenStatus' }, 'Bal: —');
    const btnCopy = h('button', { className: 'btn primary', title: 'Copiar texto LaTeX (Ctrl+S)' }, 'Copiar Texto');
    const btnClose = h('button', { className: 'btn warn', title: 'Cerrar (Esc)' }, 'X');
    const btnFull = h('button', { className: 'btn', title: 'Fullscreen' }, '⛶');
    const header = h('div', { className: 'header', title: 'Arrastra para mover. Doble clic para restaurar posición.' }, [ h('span', { className: 'title' }, 'LaTeX Converter'), h('span', { className: 'spacer' }), parenStatus, btnCopy, btnFull, btnClose ]);

    const inputTA = h('textarea', { className: 'textarea', placeholder: '1. Pega tu texto aquí...', style: { minHeight: '100px' } });
    inputTA.value = state.currentInput;
    const btnPaste = h('button', { className: 'btn' }, 'Pegar');
    const btnClear = h('button', { className: 'btn' }, 'Limpiar');
    const btnUndo = h('button', { className: 'btn', title: 'Deshacer (Restaurar anterior)' }, '↶');

    const sectionInput = h('div', { className: 'section' }, [ h('div', { className: 'label-head' }, 'ENTRADA'), inputTA, h('div', { className: 'actions' }, [ btnPaste, btnClear, btnUndo ]) ]);

    const previewTA = h('textarea', { className: 'textarea', readOnly: true, placeholder: '2. Resultado LaTeX...', style: { minHeight: '60px', color: '#8f8' } });
    const katexContainer = h('div', { title: 'Haz clic para copiar la imagen (PNG) al portapapeles', style: { minHeight: '40px', padding: '8px', background: '#111', borderRadius: '4px', border: '1px solid #444', overflowX: 'auto', marginTop: '6px', color: '#fff', fontSize: '1.1em', cursor: 'pointer' } });
    
    const btnCopyImg = h('button', { className: 'btn primary', style: { padding: '2px 6px', fontSize: '10px' }, title: 'Copiar imagen al portapapeles' }, 'Copiar Imagen');
    const btnDownloadSVG = h('button', { className: 'btn', style: { padding: '2px 6px', fontSize: '10px' }, title: 'Descargar ecuación como SVG' }, 'SVG ↓');
    const btnDownloadPNG = h('button', { className: 'btn', style: { padding: '2px 6px', fontSize: '10px' }, title: 'Descargar ecuación como PNG' }, 'PNG ↓');
    const katexHeader = h('div', { className: 'row-flex', style: { marginTop: '8px', justifyContent: 'space-between', width: '100%' } }, [
        h('div', { className: 'label-head' }, 'VISTA PREVIA (KATEX)'),
        h('div', { className: 'row-flex', style: { gap: '4px' } }, [btnCopyImg, btnDownloadSVG, btnDownloadPNG])
    ]);
    const sectionOutput = h('div', { className: 'section' }, [ h('div', { className: 'label-head' }, 'SALIDA (LATEX)'), previewTA, katexHeader, katexContainer ]);

    const selFormat = h('select', {}, [ 
        h('option', { value: 'line' }, 'Línea'), 
        h('option', { value: 'array1' }, 'Array 1 Col'), 
        h('option', { value: 'arrayN' }, 'Array N Cols'), 
        h('option', { value: 'gathered' }, 'Gathered'),
        h('option', { value: 'aligned' }, 'Aligned'),
        h('option', { value: 'cases' }, 'Cases'),
        h('option', { value: 'pmatrix' }, 'Matriz ( )'),
        h('option', { value: 'bmatrix' }, 'Matriz [ ]'),
        h('option', { value: 'vmatrix' }, 'Determinante | |')
    ]);
    const inpArrayN = h('input', { type: 'number', min: '1', value: '2', style: { width: '40px' } });
    const inpAlign = h('input', { type: 'text', placeholder: 'll', style: { width: '60px' } });
    const inpRowSep = h('input', { type: 'number', min: '0', max: '100', value: '0', style: { width: '40px' }, title: 'Espaciado vertical en pt' });
    const inpColSep = h('input', { type: 'number', min: '0', max: '100', value: '0', style: { width: '40px' }, title: 'Espaciado horizontal en pt' });
    const detFmt = h('details', { open: true }, [ h('summary', {}, 'Formato'), h('div', { className: 'details-content' }, [ h('div', { className: 'row-flex' }, [ h('span', {}, 'Tipo:'), selFormat ]), h('div', { className: 'row-flex' }, [ h('span', {}, 'Cols:'), inpArrayN, h('span', {}, 'Align:'), inpAlign ]), h('div', { className: 'row-flex' }, [ h('span', {}, 'Gap Filas:'), inpRowSep, h('span', {}, 'Gap Cols:'), inpColSep ]) ]) ]);

    const chkPreserveLB = h('input', { type: 'checkbox' }); const chkInsertQuad = h('input', { type: 'checkbox' });
    const chkFrac = h('input', { type: 'checkbox' }); const chkAutoLR = h('input', { type: 'checkbox' });
    const inpAtomicLen = h('input', { type: 'number', min: '1', max: '10', value: '2', style: { width: '40px' } });
    const inpLRN = h('input', { type: 'number', value: '20', style: { width: '40px' } });
    const chkDontRewrap = h('input', { type: 'checkbox' }); const chkNoAccents = h('input', { type: 'checkbox' }); const chkClearOnCopy = h('input', { type: 'checkbox' });
    const radDecDot = h('input', { type: 'radio', name: 'dec', value: '.' }); const radDecCom = h('input', { type: 'radio', name: 'dec', value: ',' });
    const radWrapIn = h('input', { type: 'radio', name: 'wrap', value: 'inline' }); const radWrapDis = h('input', { type: 'radio', name: 'wrap', value: 'display' });
    const detOpts = h('details', {}, [
        h('summary', { title: 'Configuraciones generales de comportamiento del motor' }, 'Reglas de Parseo'),
        h('div', { className: 'details-content' }, [
            h('div', { className: 'opt-grid' }, [
                h('label', { className: 'chk-label', title: 'Conserva los saltos de línea del texto de entrada usando \\\\' }, [ chkPreserveLB, 'Mantener Saltos (\\\\)' ]),
                h('label', { className: 'chk-label', title: 'Inserta un espacio extenso (\\quad) entre listas u oraciones separadas' }, [ chkInsertQuad, 'Separar bloques (\\quad)' ]),
                h('label', { className: 'chk-label', title: 'Convierte automáticamente cosas como 1/2 en \\frac{1}{2}' }, [ chkFrac, 'Auto-Fracciones' ]),
                h('label', { className: 'chk-label', title: 'Longitud máxima de dígitos numéricos para auto-convertirse en fracción' }, [ h('span', {}, 'Límite Frac:'), inpAtomicLen ]),
                h('label', { className: 'chk-label', title: 'Usa \\left y \\right para ajustar dinámicamente el tamaño de los paréntesis' }, [ chkAutoLR, 'Auto Paréntesis LR' ]),
                h('label', { className: 'chk-label', title: 'Mínimo de caracteres internos para aplicar Paréntesis LR' }, [ h('span', {}, 'Umbral LR:'), inpLRN ]),
                h('label', { className: 'chk-label', title: 'Si el texto ya trae signos de $, no los envolverá doblemente' }, [ chkDontRewrap, 'Ignorar si tiene $' ]),
                h('label', { className: 'chk-label', title: 'Elimina acentos y diacríticos (ej: á → a) para evitar errores en LaTeX' }, [ chkNoAccents, 'Quitar tildes' ]),
                h('label', { className: 'chk-label', title: 'Limpia automáticamente el texto de entrada tras copiar con éxito' }, [ chkClearOnCopy, 'Limpiar tras copiar' ])
            ]),
            h('div', { className: 'row-flex', style: { marginTop: '4px' } }, [
                h('span', { title: 'Símbolo preferido para los decimales' }, 'Decimal:'), h('label', { className: 'chk-label' }, [ radDecDot, 'Punto (.)' ]), h('label', { className: 'chk-label' }, [ radDecCom, 'Coma (,)' ]),
                h('span', { style: { marginLeft: '12px' }, title: 'Forma en la que se envolverá la salida final' }, 'Salida:'), h('label', { className: 'chk-label' }, [ radWrapIn, 'Inline ($)' ]), h('label', { className: 'chk-label' }, [ radWrapDis, 'Bloque ($$)' ])
            ])
        ])
    ]);

    const selNumOpColon = h('select', {}, [ h('option', { value: '\\times' }, 'Multiplicar (\\times)'), h('option', { value: ':' }, 'Literal (:)') ]);
    const selNumOpX = h('select', {}, [ h('option', { value: '\\times' }, 'Multiplicar (\\times)'), h('option', { value: 'x' }, 'Letra (x)') ]);
    const detBetween = h('details', {}, [ h('summary', { title: 'Comportamiento de símbolos rodeados exactamente por dos números (ej: 2x3 o 4:5)' }, 'Símbolos entre Números'), h('div', { className: 'details-content' }, [ h('div', { className: 'note', style: { marginTop: '0', marginBottom: '4px' } }, 'Reglas cuando detecta "2x3" o "4:5":'), h('div', { className: 'row-flex' }, [ h('span', { title: 'Qué hacer con los dos puntos' }, 'Los dos puntos ":":'), selNumOpColon ]), h('div', { className: 'row-flex' }, [ h('span', { title: 'Qué hacer con la equis' }, 'La letra "x":'), selNumOpX ]) ]) ]);

    const opGrid = h('div', { className: 'opt-grid' });
    const detOps = h('details', {}, [ h('summary', { title: 'Traduce caracteres de uso común a su equivalente profesional en LaTeX' }, 'Símbolos Detectados'), h('div', { className: 'details-content' }, [ h('div', { className: 'note', style: { marginTop: '0', marginBottom: '4px' } }, 'Los símbolos usados en la entrada aparecerán aquí:'), opGrid ]) ]);

    const tabTextBtn = h('div', { className: state.currentTab === 'text' ? 'tab active' : 'tab' }, 'Ajustes (Texto)');
    const tabVisBtn = h('div', { className: state.currentTab === 'visual' ? 'tab active' : 'tab' }, 'Editor Visual');
    const tabs = h('div', { className: 'tabs' }, [tabTextBtn, tabVisBtn]);

    const btnResetOpts = h('button', { className: 'btn warn', title: 'Restaura todos los ajustes y mapeos a su valor de fábrica' }, 'Restaurar por defecto');
    const viewText = h('div', { className: state.currentTab === 'text' ? 'view active' : 'view' }, [ detFmt, detOpts, detBetween, detOps, h('div', { className: 'actions', style: { justifyContent: 'flex-end', marginTop: '8px' } }, [ btnResetOpts ]) ]);
    const visualEditor = h('div', { className: 'visual-grid' });
    
    const btnVisAddRow = h('button', { className: 'btn' }, '+ Fila');
    const btnVisRemRow = h('button', { className: 'btn' }, '- Fila');
    const btnVisAddCol = h('button', { className: 'btn' }, '+ Col');
    const btnVisRemCol = h('button', { className: 'btn' }, '- Col');
    const btnVisClear = h('button', { className: 'btn warn', title: 'Vaciar celdas' }, 'Limpiar');
    
    const btnVisGapRowUp = h('button', { className: 'btn', title: 'Aumentar espaciado vertical' }, '+ Gap ↕');
    const btnVisGapRowDn = h('button', { className: 'btn', title: 'Reducir espaciado vertical' }, '- Gap ↕');
    const btnVisGapColUp = h('button', { className: 'btn', title: 'Aumentar espaciado horizontal' }, '+ Gap ↔');
    const btnVisGapColDn = h('button', { className: 'btn', title: 'Reducir espaciado horizontal' }, '- Gap ↔');

    const visToolbar1 = h('div', { className: 'actions', style: { flexWrap: 'wrap' } }, [btnVisAddRow, btnVisRemRow, btnVisAddCol, btnVisRemCol, btnVisClear]);
    const visToolbar2 = h('div', { className: 'actions', style: { marginBottom: '8px', flexWrap: 'wrap' } }, [btnVisGapRowUp, btnVisGapRowDn, btnVisGapColUp, btnVisGapColDn]);
    
    const viewVis = h('div', { className: state.currentTab === 'visual' ? 'view active' : 'view' }, [ h('div', { className: 'note' }, 'Modifica las celdas de la matriz/array directamente:'), visToolbar1, visToolbar2, visualEditor ]);

    const zoomRange = h('input', { type: 'range', min: '70', max: '150', step: '5', style: { width: '80px' } });
    const zoomLabel = h('span', { style: { fontSize: '11px', color: '#888' } }, '100%');
    const footer = h('div', { className: 'row-flex', style: { padding: '8px 12px', borderTop: '1px solid #333', background: '#222' } }, [ h('span', { className: 'label-head' }, 'ZOOM:'), zoomRange, zoomLabel ]);

    const panel = h('div', { className: 'panel' });
    const scrollArea = h('div', { className: 'scroll-area' });
    const zoomWrapper = h('div', { className: 'zoom-wrapper' }, [ sectionInput, sectionOutput, tabs, viewText, viewVis ]);
    scrollArea.appendChild(zoomWrapper);
    panel.appendChild(header); panel.appendChild(scrollArea); panel.appendChild(footer);
    root.appendChild(style); root.appendChild(panel);

    panel.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            const active = root.activeElement;
            if (active && (active === inputTA || active.classList.contains('visual-cell'))) return;
            e.preventDefault();
            btnUndo.click();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            btnCopy.click();
        }
    });

    state.elements = { host, root, panel, input: inputTA, preview: previewTA, btnCopy, btnPaste, btnClear, btnUndo, btnClose, btnFull, parenStatus, zoomWrapper, zoomRange, zoomLabel, selFormat, inpArrayN, inpAlign, inpRowSep, inpColSep, chkPreserveLB, chkInsertQuad, chkFrac, inpAtomicLen, chkAutoLR, inpLRN, chkDontRewrap, chkNoAccents, chkClearOnCopy, decRadios: [radDecDot, radDecCom], wrapRadios: [radWrapIn, radWrapDis], selNumOpColon, selNumOpX, opGrid, tabTextBtn, tabVisBtn, viewText, viewVis, visualEditor, btnVisAddRow, btnVisRemRow, btnVisAddCol, btnVisRemCol, btnVisGapRowUp, btnVisGapRowDn, btnVisGapColUp, btnVisGapColDn, btnResetOpts, katexContainer };

    makeDraggable(host, header);
    state.resizeObserver = new ResizeObserver(() => { if (!state.fullscreen) StorageService.saveGeom(host); });
    state.resizeObserver.observe(host);

    const updateZoom = (val: number) => { state.zoom = val; zoomWrapper.style.transform = `scale(${val})`; zoomWrapper.style.width = `${100/val}%`; zoomLabel.textContent = `${Math.round(val*100)}%`; zoomRange.value = String(Math.round(val*100)); StorageService.saveZoom(val); };
    zoomRange.addEventListener('input', () => updateZoom(parseInt(zoomRange.value, 10)/100));
    panel.addEventListener('wheel', (e) => { if(e.ctrlKey) { e.preventDefault(); updateZoom(clamp(state.zoom + (Math.sign(e.deltaY) * -0.05), 0.7, 1.5)); } });

    tabTextBtn.addEventListener('click', () => {
        tabTextBtn.classList.add('active'); tabVisBtn.classList.remove('active');
        viewText.classList.add('active'); viewVis.classList.remove('active');
        state.currentTab = 'text';
    });

    btnResetOpts.addEventListener('click', () => {
        if (confirm('¿Restaurar todas las opciones por defecto? Se perderán tus mapeos personalizados.')) {
            state.opts = structuredClone(DEFAULT_OPTS);
            StorageService.saveOpts(state.opts);
            loadOptsIntoUI();
            safeApplyPreview();
            toast(root, 'Opciones restauradas');
        }
    });
    tabVisBtn.addEventListener('click', () => {
        tabVisBtn.classList.add('active'); tabTextBtn.classList.remove('active');
        viewVis.classList.add('active'); viewText.classList.remove('active');
        state.currentTab = 'visual';
        updateVisualEditor();
    });

    btnClose.addEventListener('click', closePanel);
    btnFull.addEventListener('click', toggleFullscreen);
    btnCopy.addEventListener('click', copyPreview);

    const getCleanImageUrl = (format: 'svg' | 'png'): string | null => {
        const latex = state.elements.preview?.value.trim();
        if (!latex) return null;
        
        let cleanLatex = latex;
        if (cleanLatex.startsWith('$$') && cleanLatex.endsWith('$$')) cleanLatex = cleanLatex.slice(2, -2);
        else if (cleanLatex.startsWith('\\[') && cleanLatex.endsWith('\\]')) cleanLatex = cleanLatex.slice(2, -2);
        else if (cleanLatex.startsWith('\\(') && cleanLatex.endsWith('\\)')) cleanLatex = cleanLatex.slice(2, -2);
        else if (cleanLatex.startsWith('$') && cleanLatex.endsWith('$') && cleanLatex !== '$') cleanLatex = cleanLatex.slice(1, -1);
        
        const baseUrl = format === 'svg' ? 'https://latex.codecogs.com/svg.image?\\bg_white&space;' : 'https://latex.codecogs.com/png.image?\\dpi{300}\\bg_white&space;';
        return baseUrl + encodeURIComponent(cleanLatex);
    };

    const downloadImage = async (format: 'svg' | 'png') => {
        const url = getCleanImageUrl(format);
        if (!url) { toast(state.elements.root!, 'No hay ecuación para procesar', true); return; }
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl; a.download = `ecuacion.${format}`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            toast(state.elements.root!, `Descargado como ${format.toUpperCase()}`);
        } catch (err) {
            console.error(`[LaTeX Converter] Error al descargar ${format}:`, err);
            toast(state.elements.root!, 'Error de red al descargar', true);
        }
    };

    const copyImagePreview = async () => {
        const url = getCleanImageUrl('png');
        if (!url) { toast(state.elements.root!, 'No hay ecuación para copiar', true); return; }

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            toast(state.elements.root!, '¡Imagen PNG copiada al portapapeles!');
        } catch (err) {
            console.error('[LaTeX Converter] Error copiando imagen al portapapeles:', err);
            toast(state.elements.root!, 'El navegador bloqueó la copia de la imagen', true);
        }
    };

    btnCopyImg.addEventListener('click', copyImagePreview);
    katexContainer.addEventListener('click', copyImagePreview);

    btnDownloadSVG.addEventListener('click', () => downloadImage('svg'));
    btnDownloadPNG.addEventListener('click', () => downloadImage('png'));

    btnPaste.addEventListener('click', async () => {
        try { 
            let text = await navigator.clipboard.readText();
            if (text) {
                state.previousInput = inputTA.value;
                if (isLatexWrapped(text)) text = decompileLatexToPlainText(text);
                inputTA.value = text;
                safeApplyPreview();
            }
        }
        catch (e) { console.error('[LaTeX Converter] Err clipboard:', e); toast(root, 'Error portapapeles', true); }
    });
    btnClear.addEventListener('click', () => { 
        if (inputTA.value) state.previousInput = inputTA.value;
        inputTA.value = ''; 
        safeApplyPreview(); 
    });
    btnUndo.addEventListener('click', () => {
        const temp = inputTA.value;
        inputTA.value = state.previousInput;
        state.previousInput = temp;
        safeApplyPreview();
        inputTA.style.borderColor = '#4CAF50';
        setTimeout(() => { if (inputTA) inputTA.style.borderColor = ''; }, 400);
    });

    const modifyGrid = (action: string) => {
        if (action.startsWith('gap-')) {
            if (action === 'gap-row-up') state.opts.arrayRowSep += 2;
            else if (action === 'gap-row-dn') state.opts.arrayRowSep = Math.max(0, state.opts.arrayRowSep - 2);
            else if (action === 'gap-col-up') state.opts.arrayColSep += 2;
            else if (action === 'gap-col-dn') state.opts.arrayColSep = Math.max(0, state.opts.arrayColSep - 2);
            
            if (inpRowSep) inpRowSep.value = String(state.opts.arrayRowSep);
            if (inpColSep) inpColSep.value = String(state.opts.arrayColSep);
            
            StorageService.saveOpts(state.opts);
            safeApplyPreview();
            return;
        }

        const raw = inputTA.value || '';
        if (isLatexWrapped(raw)) { toast(root, 'Descompila el LaTeX primero', true); return; }
        
        state.previousInput = raw;
        
        let s = decodeEntities(raw);
        s = normalizeUnicodeOperators(s);
        if (state.opts.removeDiacritics) s = stripDiacritics(s);
        let blocks = extractIncisoBlocks(s, state.opts);
        
        let cols = Math.max(1, state.opts.arrayN || 2);
        let rows = Math.ceil(blocks.length / cols);
        if (blocks.length === 0) { blocks = Array(cols).fill(''); rows = 1; }

        if (action === 'add-row') { for(let i=0; i<cols; i++) blocks.push(''); }
        else if (action === 'rem-row' && rows > 1) { blocks.splice(-cols, cols); }
        else if (action === 'add-col') {
            const newBlocks = [];
            for(let r=0; r<rows; r++) { newBlocks.push(...blocks.slice(r*cols, r*cols+cols)); newBlocks.push(''); }
            blocks = newBlocks; cols++;
        }
        else if (action === 'rem-col' && cols > 1) {
            const newBlocks = [];
            const overflow = [];
            for(let r=0; r<rows; r++) { 
                newBlocks.push(...blocks.slice(r*cols, r*cols+cols-1)); 
                const last = blocks[r*cols+cols-1];
                if (last !== undefined && last.trim() !== '') overflow.push(last);
            }
            blocks = [...newBlocks, ...overflow]; 
            cols--;
        }
        else if (action === 'clear') {
            blocks = Array(rows * cols).fill('');
        }

        state.opts.arrayN = cols;
        let currentAlign = (state.opts.arrayAlign || '').replace(/\s+/g, '');
        if (currentAlign.length < cols) currentAlign += 'l'.repeat(cols - currentAlign.length);
        else if (currentAlign.length > cols) currentAlign = currentAlign.slice(0, cols);
        state.opts.arrayAlign = currentAlign;
        
        if (inpArrayN) inpArrayN.value = String(cols);
        if (inpAlign) inpAlign.value = state.opts.arrayAlign;
        StorageService.saveOpts(state.opts);
        inputTA.value = blocks.join('\n');
        safeApplyPreview();
    };

    btnVisAddRow.addEventListener('click', () => modifyGrid('add-row'));
    btnVisRemRow.addEventListener('click', () => modifyGrid('rem-row'));
    btnVisAddCol.addEventListener('click', () => modifyGrid('add-col'));
    btnVisRemCol.addEventListener('click', () => modifyGrid('rem-col'));
    btnVisClear.addEventListener('click', () => modifyGrid('clear'));
    btnVisGapRowUp.addEventListener('click', () => modifyGrid('gap-row-up'));
    btnVisGapRowDn.addEventListener('click', () => modifyGrid('gap-row-dn'));
    btnVisGapColUp.addEventListener('click', () => modifyGrid('gap-col-up'));
    btnVisGapColDn.addEventListener('click', () => modifyGrid('gap-col-dn'));

    let inputTimeout: ReturnType<typeof setTimeout>;
    inputTA.addEventListener('input', () => {
        clearTimeout(inputTimeout);
        inputTimeout = setTimeout(() => {
            if (isLatexWrapped(inputTA.value)) {
                const envMatch = inputTA.value.match(/\\begin\{(pmatrix|bmatrix|vmatrix|Bmatrix|Vmatrix|cases|aligned|gathered|array)\}/);
                if (envMatch && state.elements.selFormat) {
                    let fmt = envMatch[1];
                    if (fmt === 'array') fmt = 'arrayN';
                    state.elements.selFormat.value = fmt;
                    state.opts.format = fmt;
                    StorageService.saveOpts(state.opts);
                }

                state.previousInput = inputTA.value;
                inputTA.value = decompileLatexToPlainText(inputTA.value);
                inputTA.style.borderColor = '#2196F3';
                setTimeout(() => { if (inputTA) inputTA.style.borderColor = ''; }, 400);
            }
            safeApplyPreview();
        }, 150);
    });

    loadOptsIntoUI(); updateZoom(state.zoom); refreshDetectedOperators(); safeApplyPreview();

    const handleOptsChange = (e: Event) => {
        const t = e.target as HTMLElement;
        if (!t || t === inputTA || t.tagName === 'BUTTON') return;
        const isTextOrNum = t.tagName === 'INPUT' && ['text', 'number'].includes((t as HTMLInputElement).type);
        
        if (e.type === 'input' && isTextOrNum) { saveOptsFromUI(); safeApplyPreview(); }
        if (e.type === 'change' && !isTextOrNum) { saveOptsFromUI(); safeApplyPreview(); }
    };
    zoomWrapper.addEventListener('change', handleOptsChange);
    zoomWrapper.addEventListener('input', handleOptsChange);
}

export function closePanel(): void {
    if (state.elements.input) state.currentInput = state.elements.input.value;
    state.panelOpen = false;
    if (state.elements.host) state.elements.host.remove();
    if (state.resizeObserver) { state.resizeObserver.disconnect(); state.resizeObserver = null; }
    state.cleanups.forEach(cleanupFn => cleanupFn());
    state.cleanups = [];
    state.elements = {};
}

function safeApplyPreview() {
    if(!state.elements.input || !state.elements.preview || !state.elements.parenStatus || !state.elements.root) return;
    try {
        const raw = state.elements.input.value || '';
        const latex = convertSelectionToLatexOneLine(raw, state.opts);
        state.elements.preview.value = latex;
        const bal = balanceReport(excludeTextBlocks(latex));
        state.elements.parenStatus.textContent = `Bal: ${bal.ok ? 'OK' : 'ERR'}`;
        state.elements.parenStatus.className = bal.ok ? 'badge ok' : 'badge warn';
        state.elements.parenStatus.title = bal.msg;
        
        state.elements.preview.style.borderColor = bal.ok ? '' : '#ef5350';
        state.elements.preview.style.boxShadow = bal.ok ? '' : '0 0 6px rgba(239, 83, 80, 0.4)';
        
        refreshDetectedOperators();

        if (state.elements.katexContainer) {
            if (!latex.trim()) {
                state.elements.katexContainer.innerHTML = '';
            } else {
                try {
                    let katexExpr = latex.trim();
                    if (katexExpr.startsWith('$$') && katexExpr.endsWith('$$')) {
                        katexExpr = katexExpr.slice(2, -2);
                    } else if (katexExpr.startsWith('\\[') && katexExpr.endsWith('\\]')) {
                        katexExpr = katexExpr.slice(2, -2);
                    } else if (katexExpr.startsWith('\\(') && katexExpr.endsWith('\\)')) {
                        katexExpr = katexExpr.slice(2, -2);
                    } else if (katexExpr.startsWith('$') && katexExpr.endsWith('$') && katexExpr !== '$') {
                        katexExpr = katexExpr.slice(1, -1);
                    }

                    katex.render(katexExpr, state.elements.katexContainer, {
                        displayMode: state.opts.wrapMode === 'display',
                        throwOnError: false,
                        errorColor: '#ef5350'
                    });
                } catch (err) {
                    console.error('[LaTeX Converter] KaTeX error:', err);
                    state.elements.katexContainer.textContent = 'Error visual';
                }
            }
        }

        if (state.currentTab === 'visual' && !state.isVisualEditing) updateVisualEditor();
    } catch(e) { console.error("[LaTeX Converter] Err:", e); toast(state.elements.root, 'Error conversión', true); }
}

function updateVisualEditor() {
    const el = state.elements;
    if (!el.visualEditor || !el.input) return;

    removeChildren(el.visualEditor);
    const raw = el.input.value || '';

    if (isLatexWrapped(raw)) {
        el.visualEditor.appendChild(h('div', { className: 'note', style: { color: '#fb8' } }, '⚠️ El editor visual interactivo requiere texto plano. Descompila la matriz pegándola o editándola brevemente en la Entrada.'));
        return;
    }

    let s = decodeEntities(raw);
    s = normalizeUnicodeOperators(s);
    if (state.opts.removeDiacritics) s = stripDiacritics(s);
    let blocks = extractIncisoBlocks(s, state.opts);
    
    if (blocks.length === 0) {
        el.visualEditor.appendChild(h('div', { className: 'note' }, 'No hay datos para visualizar.'));
        return;
    }

    let cols = Math.max(1, state.opts.arrayN || 2);
    el.visualEditor.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    el.visualEditor.style.rowGap = `calc(6px + ${state.opts.arrayRowSep || 0}pt)`;
    el.visualEditor.style.columnGap = `calc(6px + ${state.opts.arrayColSep || 0}pt)`;
    updateVisTooltips();

    const validateCell = (wrapper: HTMLElement, text: string) => {
        try {
            const latex = convertSelectionToLatexOneLine(text, state.opts);
            const bal = balanceReport(excludeTextBlocks(latex));
            wrapper.style.borderColor = bal.ok ? '' : '#ef5350';
            wrapper.style.backgroundColor = bal.ok ? '' : 'rgba(239, 83, 80, 0.15)';
            wrapper.title = bal.ok ? '' : `Error: Desbalanceo detectado (${bal.msg})`;
        } catch (e) {
            wrapper.style.borderColor = '#ef5350';
            wrapper.style.backgroundColor = 'rgba(239, 83, 80, 0.15)';
        }
    };

    const moveFocus = (currentIdx: number, step: number) => {
        const cells = el.visualEditor!.querySelectorAll<HTMLElement>('.visual-cell');
        const target = cells[currentIdx + step];
        if (target) {
            target.focus();
            const sel = window.getSelection();
            if (sel) { sel.selectAllChildren(target); sel.collapseToEnd(); }
        }
    };

    let draggedIdx: number | null = null;

    blocks.forEach((blk, idx) => {
        const wrapper = h('div', { className: 'visual-cell-wrapper' });
        const handle = h('div', { className: 'visual-drag-handle', title: 'Arrastrar' }, '⠿');
        const cell = h('div', { className: 'visual-cell', contentEditable: 'true', dataset: { placeholder: '↵ (Vacío)' } });
        
        cell.textContent = blk;
        validateCell(wrapper, blk);

        wrapper.appendChild(handle);
        wrapper.appendChild(cell);

        cell.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(idx, -cols); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(idx, cols); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); moveFocus(idx, 1); }
            else if (e.key === 'Tab') { e.preventDefault(); moveFocus(idx, e.shiftKey ? -1 : 1); }
        });

        cell.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData?.getData('text/plain') || '';
            if (!text) return;

            const pastedRows = text.split(/\r?\n/).filter(r => r.trim() !== '');
            const matrix = pastedRows.map(r => r.split('\t'));

            if (matrix.length === 1 && matrix[0].length === 1) {
                document.execCommand('insertText', false, text);
                return;
            }

            state.previousInput = el.input!.value;
            let rows = Math.ceil(blocks.length / cols);
            const startRow = Math.floor(idx / cols);
            const startCol = idx % cols;

            const reqCols = startCol + matrix[0].length;
            if (reqCols > cols) {
                const newBlocks = [];
                for (let r = 0; r < rows; r++) {
                    newBlocks.push(...blocks.slice(r * cols, r * cols + cols));
                    for (let c = 0; c < (reqCols - cols); c++) newBlocks.push('');
                }
                blocks = newBlocks;
                cols = reqCols;
                state.opts.arrayN = cols;
                
                let currentAlign = (state.opts.arrayAlign || '').replace(/\s+/g, '');
                if (currentAlign.length < cols) currentAlign += 'l'.repeat(cols - currentAlign.length);
                else if (currentAlign.length > cols) currentAlign = currentAlign.slice(0, cols);
                state.opts.arrayAlign = currentAlign;
                
                if (el.inpArrayN) el.inpArrayN.value = String(cols);
                if (el.inpAlign) el.inpAlign.value = state.opts.arrayAlign;
                StorageService.saveOpts(state.opts);
            }

            const reqRows = startRow + matrix.length;
            if (reqRows > rows) {
                const newRows = reqRows - rows;
                for (let r = 0; r < newRows; r++) {
                    for (let c = 0; c < cols; c++) blocks.push('');
                }
            }

            for (let r = 0; r < matrix.length; r++) {
                for (let c = 0; c < matrix[r].length; c++) {
                    const targetIdx = (startRow + r) * cols + (startCol + c);
                    blocks[targetIdx] = matrix[r][c].trim();
                }
            }

            el.input!.value = blocks.join('\n');
            safeApplyPreview();
        });

        handle.addEventListener('mousedown', () => wrapper.setAttribute('draggable', 'true'));
        handle.addEventListener('mouseup', () => wrapper.removeAttribute('draggable'));
        handle.addEventListener('mouseleave', () => wrapper.removeAttribute('draggable'));

        cell.addEventListener('input', () => {
            state.isVisualEditing = true;
            const newText = cell.textContent || '';
            blocks[idx] = newText;
            validateCell(wrapper, newText);
            el.input!.value = blocks.join('\n');
            safeApplyPreview();
            state.isVisualEditing = false;
        });

        wrapper.addEventListener('dragstart', (e) => {
            draggedIdx = idx;
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => wrapper.style.opacity = '0.4', 0);
        });
        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            wrapper.classList.add('drag-over');
        });
        wrapper.addEventListener('dragleave', () => {
            wrapper.classList.remove('drag-over');
            validateCell(wrapper, blocks[idx]);
        });
        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            wrapper.classList.remove('drag-over');
            if (draggedIdx !== null && draggedIdx !== idx) {
                state.previousInput = el.input!.value;
                const item = blocks.splice(draggedIdx, 1)[0];
                blocks.splice(idx, 0, item);
                el.input!.value = blocks.join('\n');
                safeApplyPreview();
            } else {
                validateCell(wrapper, blocks[idx]);
            }
        });
        wrapper.addEventListener('dragend', () => {
            wrapper.style.opacity = '1';
            wrapper.removeAttribute('draggable');
            draggedIdx = null;
        });

        el.visualEditor!.appendChild(wrapper);
    });
}

function updateVisTooltips() {
    const el = state.elements;
    if (!el.btnVisAddRow || !el.input) return;
    const raw = el.input.value || '';
    let s = decodeEntities(raw);
    s = normalizeUnicodeOperators(s);
    if (state.opts.removeDiacritics) s = stripDiacritics(s);
    const blocks = extractIncisoBlocks(s, state.opts);
    const cols = Math.max(1, state.opts.arrayN || 2);
    const rows = Math.max(1, Math.ceil(blocks.length / cols));
    const rowSep = state.opts.arrayRowSep || 0;
    const colSep = state.opts.arrayColSep || 0;

    el.btnVisAddRow.title = `Añadir fila (Actual: ${rows})`;
    el.btnVisRemRow!.title = `Eliminar fila (Actual: ${rows})`;
    el.btnVisAddCol!.title = `Añadir columna (Actual: ${cols})`;
    el.btnVisRemCol!.title = `Eliminar columna (Actual: ${cols})`;
    el.btnVisGapRowUp!.title = `Aumentar espaciado vertical (Actual: ${rowSep}pt)`;
    el.btnVisGapRowDn!.title = `Reducir espaciado vertical (Actual: ${rowSep}pt)`;
    el.btnVisGapColUp!.title = `Aumentar espaciado horizontal (Actual: ${colSep}pt)`;
    el.btnVisGapColDn!.title = `Reducir espaciado horizontal (Actual: ${colSep}pt)`;
}

function copyPreview() {
    if(!state.elements.preview || !state.elements.root) return;
    const txt = state.elements.preview.value;
    if(!txt) return;

    const handleAutoClear = () => {
        if (state.opts.clearOnCopy && state.elements.input) {
            if (state.elements.input.value) state.previousInput = state.elements.input.value;
            state.elements.input.value = '';
            safeApplyPreview();
        }
    };

    const fallbackCopy = () => {
        try {
            state.elements.preview!.select();
            const successful = document.execCommand('copy');
            if (successful) {
                toast(state.elements.root!, 'Copiado! (Fallback)');
                handleAutoClear();
            } else {
                toast(state.elements.root!, 'Error al copiar', true);
            }
        } catch (err) {
            console.error('[LaTeX Converter] Fallback copy failed:', err);
            toast(state.elements.root!, 'Error crítico al copiar', true);
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt)
            .then(() => {
                toast(state.elements.root!, 'Copiado!');
                handleAutoClear();
            })
            .catch(err => {
                console.warn('[LaTeX Converter] Clipboard API failed, trying fallback:', err);
                fallbackCopy();
            });
    } else {
        fallbackCopy();
    }
}

function makeDraggable(el: HTMLElement, handle: HTMLElement) {
    let isDragging = false, startX = 0, startY = 0, initLeft = 0, initTop = 0;
    const onMouseDown = (e: MouseEvent) => {
        if(state.fullscreen) return;
        isDragging = true; startX = e.clientX; startY = e.clientY;
        const r = el.getBoundingClientRect();
        initLeft = r.left; initTop = r.top;
        el.style.right = 'auto'; el.style.bottom = 'auto';
        el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
    };
    const onMouseMove = (e: MouseEvent) => {
        if(!isDragging) return;
        let newLeft = initLeft + (e.clientX - startX);
        let newTop = initTop + (e.clientY - startY);
        
        const minLeft = -el.offsetWidth + 50;
        const maxLeft = window.innerWidth - 50;
        const minTop = 0;
        const maxTop = window.innerHeight - 30;
        
        el.style.left = clamp(newLeft, minLeft, maxLeft) + 'px';
        el.style.top = clamp(newTop, minTop, maxTop) + 'px';
    };
    const onMouseUp = () => { if(isDragging) StorageService.saveGeom(el); isDragging = false; };

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('dblclick', resetPanelPosition);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    
    state.cleanups.push(() => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    });
}

function setRadio(list: HTMLInputElement[], val: string) { list.forEach(r => r.checked = (r.value === val)); }
function getRadio(list: HTMLInputElement[]): string | null { const f = list.find(r => r.checked); return f ? f.value : null; }

function loadOptsIntoUI() {
    try {
        const o = state.opts; const el = state.elements;
        if(!el.selFormat || !el.decRadios || !el.wrapRadios) return;
        el.selFormat.value = o.format || 'line'; 
        if (el.inpArrayN) el.inpArrayN.value = String(o.arrayN); 
        if (el.inpAlign) el.inpAlign.value = o.arrayAlign || 'll';
        if (el.inpRowSep) el.inpRowSep.value = String(o.arrayRowSep || 0); 
        if (el.inpColSep) el.inpColSep.value = String(o.arrayColSep || 0);
        if (el.chkPreserveLB) el.chkPreserveLB.checked = !!o.preserveLineBreaks; 
        if (el.chkInsertQuad) el.chkInsertQuad.checked = !!o.insertQuadBetweenBlocks;
        if (el.chkFrac) el.chkFrac.checked = !!o.fracAtomic; 
        if (el.inpAtomicLen) el.inpAtomicLen.value = String(o.atomicMaxLen || 2); 
        if (el.chkAutoLR) el.chkAutoLR.checked = !!o.autoLeftRight; 
        if (el.inpLRN) el.inpLRN.value = String(o.autoLeftRightThreshold || 20);
        if (el.chkDontRewrap) el.chkDontRewrap.checked = !!o.dontRewrapIfHasDollar; 
        if (el.chkNoAccents) el.chkNoAccents.checked = !!o.removeDiacritics;
        if (el.chkClearOnCopy) el.chkClearOnCopy.checked = !!o.clearOnCopy;
        setRadio(el.decRadios, o.decimal); setRadio(el.wrapRadios, o.wrapMode);
        if (el.selNumOpColon) el.selNumOpColon.value = o.numOpNumOverride[':'] || '\\times'; 
        if (el.selNumOpX) el.selNumOpX.value = o.numOpNumOverride['x'] || '\\times';
    } catch (e) {
        console.error('[LaTeX Converter] Error sincronizando UI desde opciones:', e);
    }
}

function saveOptsFromUI() {
    try {
        const el = state.elements; const o = state.opts;
        if(!el.selFormat || !el.decRadios || !el.wrapRadios) return;
        o.format = el.selFormat.value || 'line'; 
        if (el.inpArrayN) o.arrayN = Math.max(1, parseInt(el.inpArrayN.value || '2', 10)); 
        if (el.inpAlign) o.arrayAlign = (el.inpAlign.value || 'l'.repeat(o.arrayN)).trim();
        if (el.inpRowSep) o.arrayRowSep = Math.max(0, parseInt(el.inpRowSep.value || '0', 10));
        if (el.inpColSep) o.arrayColSep = Math.max(0, parseInt(el.inpColSep.value || '0', 10));
        if (el.chkPreserveLB) o.preserveLineBreaks = !!el.chkPreserveLB.checked; 
        if (el.chkInsertQuad) o.insertQuadBetweenBlocks = !!el.chkInsertQuad.checked;
        if (el.chkFrac) o.fracAtomic = !!el.chkFrac.checked; 
        if (el.inpAtomicLen) o.atomicMaxLen = Math.max(1, parseInt(el.inpAtomicLen.value || '2', 10)); 
        if (el.chkAutoLR) o.autoLeftRight = !!el.chkAutoLR.checked; 
        if (el.inpLRN) o.autoLeftRightThreshold = Math.max(1, parseInt(el.inpLRN.value || '20', 10));
        if (el.chkDontRewrap) o.dontRewrapIfHasDollar = !!el.chkDontRewrap.checked; 
        if (el.chkNoAccents) o.removeDiacritics = !!el.chkNoAccents.checked;
        if (el.chkClearOnCopy) o.clearOnCopy = !!el.chkClearOnCopy.checked;
        o.decimal = getRadio(el.decRadios) || '.'; o.wrapMode = getRadio(el.wrapRadios) || 'display';
        if (el.selNumOpColon) o.numOpNumOverride[':'] = el.selNumOpColon.value; 
        if (el.selNumOpX) o.numOpNumOverride['x'] = el.selNumOpX.value;
        if (el.opGrid) el.opGrid.querySelectorAll<HTMLSelectElement>('.op-sel').forEach(s => { o.opMap[s.dataset.op!] = s.value; });
        StorageService.saveOpts(o);
    } catch (e) {
        console.error('[LaTeX Converter] Error guardando opciones desde UI:', e);
    }
}

function applyFullscreenGeom(host: HTMLElement) {
    Object.assign(host.style, { left: '0', top: '0', width: '100vw', height: '100vh', borderRadius: '0' });
    host.setAttribute('data-fullscreen', '1');
}
function toggleFullscreen() {
    state.fullscreen = !state.fullscreen;
    StorageService.saveFullscreen(state.fullscreen);
    closePanel(); openPanel();
}

function refreshDetectedOperators() {
    const el = state.elements;
    if(!el.input || !el.opGrid) return;
    const set = detectOperators(normalizeUnicodeOperators(decodeEntities(el.input.value || '')));
    removeChildren(el.opGrid);
    ['*','/','x','÷','·',':','+','-','^','=','<','>','≤','≥','≠','≈'].forEach(op => {
        if(!set.has(op)) return;
        const sel = h('select', { className:'op-sel', dataset:{op}, style:{width:'100%'} }, opOptionsFor(op).map(([v, l]) => h('option', { value:v }, l)));
        sel.value = state.opts.opMap[op] || defaultMapFor(op);
        el.opGrid!.appendChild(h('div', { style: { display:'flex', flexDirection:'column' } }, [ h('span', { style:{fontSize:'10px', color:'#888'} }, `Op "${op}"`), sel ]));
    });
}