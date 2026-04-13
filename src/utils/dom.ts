/**
 * Crea y tipa estrictamente elementos del DOM (Prevención XSS por defecto)
 */
export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, any> = {},
    children: (HTMLElement | string | null)[] | HTMLElement | string | null = []
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const k in props) {
        if (k === 'style') Object.assign(el.style, props[k]);
        else if (k === 'className') el.className = props[k];
        else if (k === 'dataset') Object.assign(el.dataset, props[k]);
        else if (k.startsWith('on') && typeof props[k] === 'function') {
            el.addEventListener(k.slice(2).toLowerCase(), props[k]);
        }
        else el.setAttribute(k, props[k]);
    }
    const childArray = Array.isArray(children) ? children : [children];
    childArray.forEach(ch => {
        if (ch == null) return;
        if (typeof ch === 'string') el.appendChild(document.createTextNode(ch));
        else el.appendChild(ch);
    });
    return el;
}

export function removeChildren(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

export function clamp(n: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, n));
}

export function toast(root: ShadowRoot | HTMLElement, msg: string, isErr: boolean = false): void {
    const t = h('div', {
        style: {
            position: 'absolute', bottom: '50px', right: '20px',
            background: isErr ? '#822' : '#262', color: '#fff', padding: '6px 12px',
            borderRadius: '4px', boxShadow: '0 2px 10px #000', fontSize: '12px', zIndex: '9999'
        }
    }, msg);
    root.appendChild(t);
    setTimeout(() => t.remove(), 2000);
}