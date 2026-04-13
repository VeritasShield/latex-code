import { LatexOptions, DEFAULT_OPTS, deepMerge } from '../core/LatexEngine';

const LS_STATE_V2 = 'tmLatexStateV2';

// Claves legacy para migración (Backwards Compatibility)
const LS_KEY_V1 = 'tmLatexOptsV1';
const LS_GEOM_V1 = 'tmLatexGeomV1';
const LS_ZOOM_V1 = 'tmLatexZoomV1';
const LS_FULLSCREEN_V1 = 'tmLatexFullscreenV1';

interface AppState {
    geom: Partial<CSSStyleDeclaration> | null;
    opts: LatexOptions;
    zoom: number;
    fullscreen: boolean;
}

class StorageManager {
    private state: AppState;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.state = this.loadState();
    }

    private loadState(): AppState {
        try {
            const raw = localStorage.getItem(LS_STATE_V2);
            if (raw) {
                const parsed = JSON.parse(raw);
                return {
                    geom: parsed.geom ?? null,
                    opts: parsed.opts ? deepMerge(structuredClone(DEFAULT_OPTS), parsed.opts) : structuredClone(DEFAULT_OPTS),
                    zoom: typeof parsed.zoom === 'number' && !Number.isNaN(parsed.zoom) ? parsed.zoom : 1,
                    fullscreen: !!parsed.fullscreen
                };
            }
        } catch (err) {
            console.warn('[LaTeX Converter] No se pudo cargar el estado V2, intentando migrar:', err);
        }
        
        // Migración transparente desde V1
        const legacyState: AppState = { geom: null, opts: structuredClone(DEFAULT_OPTS), zoom: 1, fullscreen: false };
        try { legacyState.geom = JSON.parse(localStorage.getItem(LS_GEOM_V1) || 'null'); } catch (e) { console.trace('[LaTeX Converter] Sin geometría legacy'); }
        try { const o = JSON.parse(localStorage.getItem(LS_KEY_V1) || 'null'); if (o) legacyState.opts = deepMerge(legacyState.opts, o); } catch (e) { console.trace('[LaTeX Converter] Sin opciones legacy'); }
        try { const z = parseFloat(localStorage.getItem(LS_ZOOM_V1) || ''); legacyState.zoom = Number.isNaN(z) ? 1 : z; } catch (e) { console.trace('[LaTeX Converter] Sin zoom legacy'); }
        legacyState.fullscreen = localStorage.getItem(LS_FULLSCREEN_V1) === '1';
        return legacyState;
    }

    private persist(): void {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            try {
                localStorage.setItem(LS_STATE_V2, JSON.stringify(this.state));
            } catch (err) {
                console.error('[LaTeX Converter] Quota exceeded o error guardando estado:', err);
            }
        }, 250);
    }

    loadGeom(): Partial<CSSStyleDeclaration> | null { return this.state.geom; }
    saveGeom(el: HTMLElement): void {
        const r = el.getBoundingClientRect();
        this.state.geom = { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' };
        this.persist();
    }
    loadOpts(): LatexOptions { return this.state.opts; }
    saveOpts(opts: LatexOptions): void { this.state.opts = opts; this.persist(); }
    loadZoom(): number { return this.state.zoom; }
    saveZoom(val: number): void { this.state.zoom = val; this.persist(); }
    loadFullscreen(): boolean { return this.state.fullscreen; }
    saveFullscreen(val: boolean): void { this.state.fullscreen = val; this.persist(); }
}

export const StorageService = new StorageManager();