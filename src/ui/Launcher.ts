import { h } from '../utils/dom';
import { togglePanel, closePanel, resetPanelPosition, state } from './Panel';

const EDGE_ID = 'tm-latex-launcher-btn';
let bootTimer: ReturnType<typeof setInterval> | null = null;
let triedBoots = 0;
const MAX_BOOT_TRIES = 60;

export function startBootLoop(): void {
    if (bootTimer) return;
    bootTimer = setInterval(() => {
        triedBoots++;
        try { ensureEdgeButton(); }
        catch (err) { console.error('[LaTeX Converter] Error during boot:', err); }
        
        if (document.readyState === 'complete' || triedBoots >= MAX_BOOT_TRIES) {
            if (bootTimer) clearInterval(bootTimer);
            bootTimer = null;
        }
    }, 500);

    // Suscribir eventos globales necesarios
    window.addEventListener('popstate', ensureEdgeButton, true);
    document.addEventListener('keydown', handleKeydown, true);
    const mo = new MutationObserver(() => {
        if (!document.getElementById(EDGE_ID)) setTimeout(ensureEdgeButton, 100);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
}

function handleKeydown(ev: KeyboardEvent): void {
    if (ev.altKey && (ev.key === 'l' || ev.key === 'L')) {
        ev.preventDefault();
        togglePanel();
    }
    if (state.panelOpen && ev.key === 'Escape') {
        ev.stopPropagation();
        closePanel();
    }
}

function ensureEdgeButton(): void {
    if (!document.body || document.getElementById(EDGE_ID)) return;

    if (!document.getElementById('tm-latex-print-style')) {
        document.head.appendChild(h('style', { id: 'tm-latex-print-style' }, `@media print { #${EDGE_ID}, tm-latex-panel-host { display: none !important; } }`));
    }
    const edgeBtn = h('button', { 
        id: EDGE_ID, 
        title: 'Abrir LaTeX Converter (Alt+L) | Clic derecho para reiniciar posición', 
        style: { 
            position: 'fixed', bottom: '24px', right: '24px', zIndex: '999999', 
            padding: '12px 20px', backgroundColor: '#FF5722', color: 'white', border: 'none', 
            cursor: 'pointer', borderRadius: '30px', fontWeight: '600', 
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'all 0.2s ease', 
            opacity: '0.6', userSelect: 'none' 
        } 
    }, 'LaTeX ⧉');
    edgeBtn.addEventListener('mouseenter', () => { Object.assign(edgeBtn.style, { transform: 'translateY(-2px)', opacity: '1', backgroundColor: '#E64A19', boxShadow: '0 6px 16px rgba(0,0,0,0.4)' }); });
    edgeBtn.addEventListener('mouseleave', () => { Object.assign(edgeBtn.style, { transform: 'translateY(0)', opacity: '0.6', backgroundColor: '#FF5722', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }); });
    edgeBtn.addEventListener('click', togglePanel);
    edgeBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); resetPanelPosition(); });
    document.body.appendChild(edgeBtn);
}