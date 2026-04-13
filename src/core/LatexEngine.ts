export interface LatexOptions {
    decimal: string;
    wrapMode: string;
    preserveLineBreaks: boolean;
    insertQuadBetweenBlocks: boolean;
    fracAtomic: boolean;
    atomicMaxLen: number;
    autoLeftRight: boolean;
    autoLeftRightThreshold: number;
    dontRewrapIfHasDollar: boolean;
    format: string;
    arrayN: number;
    arrayAlign: string;
    arrayRowSep: number;
    arrayColSep: number;
    opMap: Record<string, string>;
    numOpNumOverride: Record<string, string>;
    removeDiacritics: boolean;
}

export interface Token {
    type: 'SPACE' | 'NL' | 'NUMBER' | 'WORD' | 'OP' | 'PUNCT' | 'OTHER' | 'INCISO' | 'FRAC';
    v: string | number;
    num?: Token;
    den?: Token;
}

export const DEFAULT_OPTS: LatexOptions = {
    decimal: '.', wrapMode: 'display', preserveLineBreaks: true,
    insertQuadBetweenBlocks: true, fracAtomic: true, atomicMaxLen: 2,
    autoLeftRight: true, autoLeftRightThreshold: 20, dontRewrapIfHasDollar: true,
    format: 'line', arrayN: 2, arrayAlign: 'll', arrayRowSep: 0, arrayColSep: 0,
    opMap: { '*':'\\times','/':'\\div','x':'\\times','÷':'\\div','·':'\\cdot',':':'\\times','+':'+','-':'-','^':'^','=':'=','<':'<','>':'>','≤':'\\leq','≥':'\\geq','≠':'\\neq','≈':'\\approx' },
    numOpNumOverride: { ':':'\\times','x':'\\times' },
    removeDiacritics: true
};

// =================================================================================
// --- CORE ENGINE ---
// =================================================================================

export function isLatexWrapped(raw: string): boolean {
    if (!raw) return false;
    const trimmed = raw.trim();
    return (trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
           (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed !== '$') ||
           (trimmed.startsWith('\\begin{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) ||
           (trimmed.startsWith('\\(') && trimmed.endsWith('\\)'));
}

export function decompileLatexToPlainText(latex: string): string {
    let s = latex.trim();
    
    // 1. Remover wrappers principales
    s = s.replace(/^\s*\$\$(.*?)\$\$\s*$/s, '$1');
    s = s.replace(/^\s*\$(.*?)\$\s*$/s, '$1');
    s = s.replace(/^\s*\\\[(.*?)\\\]\s*$/s, '$1');
    s = s.replace(/^\s*\\\((.*?)\\\)\s*$/s, '$1');

    // 2. Remover delimitadores de entornos (ej. \begin{array}{ll})
    s = s.replace(/\\begin{[a-zA-Z*]+}(?:{[^}]*})?/g, '');
    s = s.replace(/\\end{[a-zA-Z*]+}/g, '');

    // 3. Traducir separadores de tablas y saltos de línea a texto plano (\n)
    s = s.replace(/\\\\\[\d+pt\]/g, '\n');
    s = s.replace(/\\\\/g, '\n');
    s = s.replace(/&/g, '\t');
    s = s.replace(/\\hspace\{\d+pt\}/g, '');

    // 4. Extraer el interior de macros comunes y sub/superíndices (soporte recursivo anidado)
    let prev;
    let iter = 0;
    do {
        prev = s;
        s = s.replace(/\\frac{([^{}]*)}{([^{}]*)}/g, '($1)/($2)');
        s = s.replace(/\\text{([^{}]*)}/g, '$1');
        s = s.replace(/\^{([^{}]*)}/g, '^$1');
        s = s.replace(/_{([^{}]*)}/g, '_$1');
        iter++;
    } while (s !== prev && iter < 15);

    // Simplificar paréntesis redundantes generados por el anidamiento y fracciones atómicas puras
    s = s.replace(/\(\(([^()]+)\)\)/g, '($1)');
    s = s.replace(/\(([a-zA-Z0-9.,]+)\)\/\(([a-zA-Z0-9.,]+)\)/g, '$1/$2');

    // 5. Revertir operadores a símbolos legibles
    s = s.replace(/\\times/g, 'x').replace(/\\div/g, '/').replace(/\\quad/g, ' ');
    s = s.replace(/\\circ/g, '°').replace(/\\leq/g, '≤').replace(/\\geq/g, '≥');
    s = s.replace(/\\neq/g, '≠').replace(/\\approx/g, '≈').replace(/\\cdot/g, '·');

    // 6. Remover comandos de auto-balanceo y caracteres de escape
    s = s.replace(/\\left([()[\]{}|])/g, '$1').replace(/\\right([()[\]{}|])/g, '$1');
    s = s.replace(/\\([%&_$#{}])/g, '$1').replace(/\\textbackslash\s*/g, '\\');

    // 7. Limpiar espacios múltiples y alinear columnas tabuladas
    return s.split('\n')
        .map(line => line.trim().replace(/ {2,}/g, ' ').replace(/\t/g, '  '))
        .filter(line => line.length > 0)
        .join('\n');
}

export function convertSelectionToLatexOneLine(raw: string, opts: LatexOptions): string {
    if (!raw) return (opts.wrapMode === 'inline') ? `$  $` : `$$  $$`;
    let s = decodeEntities(raw);

    if (isLatexWrapped(s)) return s.trim();

    s = normalizeUnicodeOperators(s);
    if (opts.removeDiacritics) s = stripDiacritics(s);

    const blocks = extractIncisoBlocks(s, opts);

    let body = '';
    const rowSep = opts.arrayRowSep > 0 ? ` \\\\[${opts.arrayRowSep}pt] ` : ` \\\\ `;

    switch (opts.format) {
        case 'array1':
        case 'array2':
        case 'arrayN': {
            const n = (opts.format === 'array1') ? 1 : (opts.format === 'array2') ? 2 : Math.max(1, opts.arrayN || 2);
            const align = normalizeAlignSpec(opts.arrayAlign, n);
            const items = blocks.map(b => lineForBlock(b, opts));
            const rows: string[] = [];
            for (let i = 0; i < items.length; i += n) {
                const cols = items.slice(i, i + n);
                while (cols.length < n) cols.push('');
                if (opts.arrayColSep > 0) {
                    for (let c = 0; c < cols.length - 1; c++) {
                        cols[c] = cols[c] ? `${cols[c]}\\hspace{${opts.arrayColSep}pt}` : `\\hspace{${opts.arrayColSep}pt}`;
                    }
                }
                rows.push(cols.join(' & '));
            }
            body = `\\begin{array}{${align}} ` + rows.join(rowSep) + ` \\end{array}`;
            break;
        }
        case 'gathered': {
            const items = blocks.map(b => lineForBlock(b, opts));
            body = `\\begin{gathered} ${items.join(rowSep)} \\end{gathered}`;
            break;
        }
        case 'aligned': {
            const items = blocks.map(b => makeAlignedRow(lineForBlock(b, opts)));
            body = `\\begin{aligned} ${items.join(rowSep)} \\end{aligned}`;
            break;
        }
        case 'cases': {
            const items = blocks.map(b => `${lineForBlock(b, opts)} &`);
            body = `\\begin{cases} ${items.join(rowSep)} \\end{cases}`;
            break;
        }
        case 'pmatrix':
        case 'bmatrix': {
            const n = Math.max(1, opts.arrayN || 2);
            const items = blocks.map(b => lineForBlock(b, opts));
            const rows: string[] = [];
            for (let i = 0; i < items.length; i += n) {
                const cols = items.slice(i, i + n);
                while (cols.length < n) cols.push('');
                if (opts.arrayColSep > 0) {
                    for (let c = 0; c < cols.length - 1; c++) {
                        cols[c] = cols[c] ? `${cols[c]}\\hspace{${opts.arrayColSep}pt}` : `\\hspace{${opts.arrayColSep}pt}`;
                    }
                }
                rows.push(cols.join(' & '));
            }
            body = `\\begin{${opts.format}} ${rows.join(rowSep)} \\end{${opts.format}}`;
            break;
        }
        case 'line':
        default: {
            const parts = blocks.map(b => lineForBlock(b, opts));
            body = parts.join(opts.insertQuadBetweenBlocks ? ' \\quad ' : ' ');
            break;
        }
    }

    const hasDollar = /\$/.test(body) || /\$/.test(s);
    let finalStr = body.trim();
    if (!(opts.dontRewrapIfHasDollar && hasDollar)) {
      finalStr = (opts.wrapMode === 'inline') ? `$ ${finalStr} $` : `$$ ${finalStr} $$`;
    }
    return joinSingleLine(finalStr);
}

function makeAlignedRow(str: string): string {
    const r = /(\\leq|\\geq|\\neq|\\approx|=|≤|≥|≠|≈|<|>)/;
    const m = str.match(r);
    if (m) return str.replace(r, ' &$1& ');
    return `& ${str}`;
}

function lineForBlock(text: string, opts: LatexOptions): string {
    const s = (text || '').trim();
    const tokens = tokenize(s);
    const tokensWithIncisos = combineIncisos(tokens);
    const tokensFrac = opts.fracAtomic ? combineAtomicFractions(tokensWithIncisos, opts) : tokensWithIncisos;
    const out = emitLatex(tokensFrac, opts);
    const final = opts.autoLeftRight ? applyLeftRight(out, opts.autoLeftRightThreshold) : out;
    return joinSingleLine(final);
}

const REGEX_DIGIT = /[0-9]/;
const REGEX_LETTER = /[A-Za-zÁÉÍÓÚÜáéíóúÑñ]/;
const REGEX_NUMBER_PART = /[0-9.,]/;
const REGEX_PUNCT = /[.,;:!?]/;
const OPS_SET = new Set(['+','-','*','/','x','÷',':','·','^','=','<','>','≤','≥','≠','≈','(',')','[',']','{','}','|','%','&']);

function tokenize(str: string): Token[] {
    if (!str || typeof str !== 'string') return [];

    const tks: Token[] = [];
    let i = 0;
    const len = str.length;

    while (i < len) {
      const c = str[i];
      if (c === ' ' || c === '\t') {
          let j = i + 1;
          while (j < len && (str[j] === ' ' || str[j] === '\t')) j++;
          tks.push({ type: 'SPACE', v: str.slice(i, j) });
          i = j;
          continue;
      }

      if (c === '\n' || c === '\r') {
          let j = i;
          let nls = 0;
          while (j < len && (str[j] === '\n' || str[j] === '\r')) {
              if (str[j] === '\n') nls++;
              j++;
          }
          tks.push({ type: 'NL', v: nls || 1 });
          i = j; continue;
      }

      if (REGEX_DIGIT.test(c)) {
          let j = i + 1;
          while (j < len && REGEX_NUMBER_PART.test(str[j])) j++;
          tks.push({ type: 'NUMBER', v: str.slice(i, j) });
          i = j;
          continue;
      }
      if (REGEX_LETTER.test(c)){
          let j = i + 1;
          while (j < len && REGEX_LETTER.test(str[j])) j++;
          tks.push({ type: 'WORD', v: str.slice(i, j) });
          i = j;
          continue;
      }
      if (OPS_SET.has(c)) { tks.push({ type: 'OP', v: c }); i++; continue; }
      if (REGEX_PUNCT.test(c)) { tks.push({ type: 'PUNCT', v: c }); i++; continue; }
      
      const codePoint = str.codePointAt(i);
      if (codePoint && codePoint > 0xFFFF) {
          tks.push({ type: 'OTHER', v: str.slice(i, i + 2) });
          i += 2;
      } else {
          tks.push({ type: 'OTHER', v: c });
          i++;
      }
    }
    return tks;
}

function combineIncisos(tokens: Token[]): Token[] {
    const out: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const prev = out.length ? out[out.length - 1] : null;
      const t = tokens[i];
      const nxt = tokens[i + 1];
      const prevSpaceOrStart = (!prev) || prev.type === 'SPACE' || prev.type === 'NL';
      if (prevSpaceOrStart && t && t.type === 'WORD' && String(t.v).length === 1 && /^[a-zA-Z]$/.test(String(t.v)) && nxt && ((nxt.type === 'OP' && nxt.v === ')') || (nxt.type === 'PUNCT' && nxt.v === ')'))) {
        out.push({ type: 'INCISO', v: String(t.v).toLowerCase() + ')' }); i++; continue;
      }
      out.push(t);
    }
    return out;
}

function combineAtomicFractions(tokens: Token[], opts: LatexOptions): Token[] {
    const out: Token[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (isAtomic(tokens[i], opts)) {
        const j1 = skipSpaces(tokens, i + 1);
        if (j1 < tokens.length && tokens[j1].type === 'OP' && tokens[j1].v === '/') {
          const j2 = skipSpaces(tokens, j1 + 1);
          if (j2 < tokens.length && isAtomic(tokens[j2], opts)) {
            out.push({ type: 'FRAC', v: '', num: tokens[i], den: tokens[j2] });
            i = j2; continue;
          }
        }
      }
      out.push(tokens[i]);
    }
    return out;
}

function isAtomic(token: Token | null | undefined, opts: LatexOptions): boolean {
    if (!token) return false;
    if (token.type === 'NUMBER') { const num = String(token.v).replace(/[.,]/g, ''); return num.length <= opts.atomicMaxLen; }
    if (token.type === 'WORD') return String(token.v).length <= opts.atomicMaxLen;
    return false;
}

function skipSpaces(tokens: Token[], idx: number): number { let j = idx; while (j < tokens.length && (tokens[j].type === 'SPACE' || tokens[j].type === 'NL')) j++; return j; }
function peekNextNonSpace(tokens: Token[], idx: number): { j: number, t: Token | null } { let j = idx; while (j < tokens.length && (tokens[j].type === 'SPACE' || tokens[j].type === 'NL')) j++; return { j, t: tokens[j] || null }; }

function emitLatex(tokens: Token[], opts: LatexOptions): string {
    const parts: string[] = [];
    let i = 0, expDepth = 0;
    let textBuf = '';
    const appendText = (s: string | number) => { textBuf += String(s); };

    const flushText = () => {
      if (textBuf.length > 0) {
        const esc = escapeLatexInText(textBuf);
        parts.push(`\\text{${esc}}`);
      }
      textBuf = '';
    };
    const pushMath = (m: string) => { if (m) parts.push(m); };

    while (i < tokens.length) {
      const t = tokens[i];

      switch (t.type) {
          case 'SPACE': {
              const spaceStr = String(t.v);
              if (spaceStr.length > 1) {
                  flushText();
                  pushMath('\\ '.repeat(spaceStr.length));
              } else {
                  appendText(spaceStr);
              }
              i++;
              break;
          }
          case 'NL':
              flushText();
              if (opts.preserveLineBreaks) {
                  const breaks = Array(Number(t.v)).fill('\\\\').join(' ');
                  pushMath(' ' + breaks + ' ');
              } else {
                  appendText(' ');
              }
              i++;
              break;
          case 'INCISO':
          case 'PUNCT':
          case 'OTHER':
              appendText(t.v);
              i++;
              break;
          case 'WORD': {
              const w = String(t.v || '').toLowerCase();
              if (['sin', 'cos', 'tan', 'log'].includes(w)) { flushText(); pushMath('\\' + w); }
              else { appendText(t.v); }
              i++;
              break;
          }
          case 'FRAC': {
              flushText();
              const num = emitAtomic(t.num, opts), den = emitAtomic(t.den, opts);
              pushMath(`\\frac{${num}}{${den}}`);
              i++;
              break;
          }
          case 'NUMBER': {
              flushText();
              const norm = normalizeNumber(String(t.v), opts.decimal);
              pushMath(escapeMath(norm));
              const { j, t: nt } = peekNextNonSpace(tokens, i + 1);
              if (nt && nt.type === 'OTHER' && (nt.v === '°' || nt.v === 'º')) { pushMath('^\\circ'); i = j + 1; }
              else { i++; }
              break;
          }
          case 'OP': {
              flushText();
              const next = tokens[i + 1];
              const v = String(t.v);
              
              if (v === '<' && next && next.type === 'OP' && next.v === '=') { pushMath('\\leq'); i += 2; break; }
              if (v === '>' && next && next.type === 'OP' && next.v === '=') { pushMath('\\geq'); i += 2; break; }
              if (v === '%') { pushMath('\\%'); i++; break; }

              if (v === '^') {
                  const { j, t: nt } = peekNextNonSpace(tokens, i + 1);
                  if (nt && nt.type === 'OP' && nt.v === '(') { pushMath('^{('); expDepth = 1; i = j + 1; break; }
                  if (nt) {
                      const emitted = emitAtomic(nt, opts);
                      const needBraces = (emitted.length > 1);
                      pushMath(needBraces ? `^{${emitted}}` : `^${emitted}`); i = j + 1; break;
                  } else { pushMath('^'); i++; break; }
              }

              if (v === '(') { if (expDepth > 0) expDepth++; pushMath('('); i++; break; }
              if (v === ')') {
                  if (expDepth > 0) { expDepth--; if (expDepth === 0) { pushMath(')}'); i++; break; } }
                  pushMath(')'); i++; break;
              }

              if (['≤','≥','≠','≈','<','>','='].includes(v)) { pushMath(opts.opMap[v] || defaultMapFor(v)); i++; break; }

              const prev = tokens[findPrevNonSpaceIndex(tokens, i)];
              const nxt = tokens[skipSpaces(tokens, i + 1)];
              const betweenNumbers = isNumberLike(prev) && isNumberLike(nxt);

              if (v === 'x' && betweenNumbers) { pushMath(opts.numOpNumOverride['x'] ?? '\\times'); i++; break; }
              if (v === ':' && betweenNumbers) { pushMath(opts.numOpNumOverride[':'] != null ? opts.numOpNumOverride[':'] : (opts.opMap[':'] || ':')); i++; break; }

              if (['*','/','x','÷','·',':','+','-','^'].includes(v)) { const mapped = opts.opMap[v] || defaultMapFor(v); pushMath(mapped === '^' ? '^' : mapped); i++; break; }
              if (['<','>','=','(',')','[',']','{','}','|'].includes(v)) { pushMath(v); i++; break; }
              if (v === '&') { pushMath('\\&'); i++; break; }

              pushMath(v); i++;
              break;
          }
          default:
              appendText(String(t.v || ''));
              i++;
              break;
      }
    }
    flushText();

    return parts.join('').trim();
}

function emitAtomic(token: Token | null | undefined, opts: LatexOptions): string {
    if (!token) return '';
    if (token.type === 'NUMBER') return escapeMath(normalizeNumber(String(token.v), opts.decimal));
    if (token.type === 'WORD') return escapeMathWord(String(token.v));
    if (token.type === 'FRAC') { const num = emitAtomic(token.num, opts), den = emitAtomic(token.den, opts); return `\\frac{${num}}{${den}}`; }
    return escapeMath((token.v || '').toString());
}
function isNumberLike(t: Token | null | undefined): boolean {
    if (!t) return false;
    if (t.type === 'NUMBER' || t.type === 'FRAC') return true;
    if (t.type === 'OP' && (t.v === ')' || t.v === '(')) return true;
    if (t.type === 'WORD' && String(t.v).length <= 2) return true;
    return false;
}
function findPrevNonSpaceIndex(tokens: Token[], idx: number): number { let j = idx - 1; while (j >= 0 && (tokens[j].type === 'SPACE' || tokens[j].type === 'NL')) j--; return j; }

const ENTITY_MAP: Record<string, string> = { nbsp:' ', amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", le:'≤', ge:'≥', ne:'≠', times:'×', divide:'÷', middot:'·', ndash:'–', mdash:'—', hellip:'…', laquo:'«', raquo:'»', deg:'°' };
const ENTITY_REGEX = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));?/g;

export function decodeEntities(str: string): string {
    if (!str) return '';
    return String(str).replace(ENTITY_REGEX, (match, dec, hex, named) => {
        if (dec) { const cp = parseInt(dec, 10); return Number.isFinite(cp) ? String.fromCodePoint(cp) : match; }
        if (hex) { const cp = parseInt(hex, 16); return Number.isFinite(cp) ? String.fromCodePoint(cp) : match; }
        if (named) return ENTITY_MAP[named] ?? match;
        return match;
    }).replace(/\u00A0/g, ' ');
}

export function normalizeUnicodeOperators(s: string): string {
    if (!s) return '';
    return s.replace(/\u2212/g, '-').replace(/\u00d7/g, 'x').replace(/\u22c5/g, '·').replace(/\u2264/g, '≤')
            .replace(/\u2265/g, '≥').replace(/\u2260/g, '≠').replace(/\u2248/g, '≈').replace(/\u00f7/g, '÷');
}

export function detectOperators(s: string): Set<string> {
    const set = new Set<string>();
    const allow = '*/x÷:·+-^=<>≤≥≠≈';
    for (const ch of s) if (allow.includes(ch)) set.add(ch);
    if (s.includes('<=')) set.add('<');
    if (s.includes('>=')) set.add('>');
    return set;
}

function normalizeNumber(numStr: string, prefer: string): string {
    let s = (numStr || '').trim();
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let dec: string | null = null;
    if (lastDot !== -1 || lastComma !== -1) dec = (lastDot > lastComma) ? '.' : ',';
    if (dec) {
      const parts = s.split(dec); const decimals = parts.pop();
      const int = parts.join('').replace(/[.,]/g, '');
      s = int + (decimals !== undefined ? dec + decimals : '');
    }
    if (!dec) { if (s.includes('.')) dec = '.'; else if (s.includes(',')) dec = ','; }
    if (prefer && dec && prefer !== dec) s = s.replace(dec, prefer);
    if (prefer === '.') s = s.replace(/,/g, '');
    if (prefer === ',') s = s.replace(/\./g, '');
    return s;
}

function escapeLatexInText(s: string): string { return (s || '').replace(/\\/g, '\\textbackslash ').replace(/([{}$#%&_^~])/g, '\\$1'); }
function escapeMath(s: string): string { return (s || '').replace(/&/g, '\\&').replace(/%/g, '\\%'); }
function escapeMathWord(s: string): string { return (s || '').replace(/([&#%])/g, '\\$1').replace(/_/g, '\\_'); }

function joinSingleLine(s: string): string { return (s || '').replace(/(\r?\n)+/g, ' ').trim(); }

export function stripDiacritics(s: string): string {
    try { return (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    catch(err) { console.warn('[LaTeX Converter] Error stripping diacritics:', err); return s; }
}

const INCISO_REGEX = /(^|\s)([a-zA-Z]\))\s*/g;
const SPLIT_LINE_REGEX = /;+/;
const SPLIT_MULTILINE_REGEX = /\r?\n|;+/;
const SPLIT_ANY_REGEX = /[\r\n]+|;+/;
const TRAILING_NL_REGEX = /[\r\n\s]+$/;

export function extractIncisoBlocks(s: string, opts: LatexOptions): string[] {
    const pos: number[] = []; let m;
    INCISO_REGEX.lastIndex = 0;
    while ((m = INCISO_REGEX.exec(s)) !== null) pos.push(m.index + (m[1] ? m[1].length : 0));

    if (pos.length === 0) {
        if (opts && opts.preserveLineBreaks) {
            if (opts.format === 'line') {
                const parts = s.split(SPLIT_LINE_REGEX).map(x => x.trim()).filter(Boolean);
                return parts.length ? parts : [s.trim()];
            } else {
                const parts = s.split(SPLIT_MULTILINE_REGEX).map(x => x.trim());
                while(parts.length && parts[0] === '') parts.shift();
                while(parts.length && parts[parts.length-1] === '') parts.pop();
                return parts.length ? parts : [s.trim()];
            }
        } else {
            const parts = s.split(SPLIT_ANY_REGEX).map(x => x.trim()).filter(Boolean);
            return parts.length ? parts : [s.trim()];
        }
    }

    const blocks: string[] = [];
    for (let i = 0; i < pos.length; i++) {
        const start = pos[i];
        const end = (i + 1 < pos.length) ? pos[i + 1] : s.length;

        const rawBlock = s.slice(start, end);
        blocks.push(rawBlock.trim());

        if (opts && opts.preserveLineBreaks && i + 1 < pos.length) {
            const trailingMatch = rawBlock.match(TRAILING_NL_REGEX);
            if (trailingMatch) {
                const nls = (trailingMatch[0].match(/\n/g) || []).length;
                for (let k = 1; k < nls; k++) {
                    blocks.push('');
                }
            }
        }
    }
    return blocks;
}

function findTextRanges(latex: string): [number, number][] {
    const ranges: [number, number][] = [];
    const re = /\\text\{/g; let m;
    while ((m = re.exec(latex)) !== null) {
      let depth = 1; let i = m.index + 6;
      while (i < latex.length && depth > 0) { if (latex[i] === '{') depth++; else if (latex[i] === '}') depth--; i++; }
      ranges.push([m.index, i - 1]);
    }
    return ranges;
}
function indexInRanges(i: number, ranges: [number, number][]): boolean { for (const [a,b] of ranges) if (i>=a && i<=b) return true; return false; }

export function excludeTextBlocks(latex: string): string {
    const ranges = findTextRanges(latex);
    if (!ranges.length) return latex;
    let out = '', i = 0;
    for (const [a, b] of ranges) { out += latex.slice(i, a) + ' '.repeat(b - a + 1); i = b + 1; }
    out += latex.slice(i);
    return out;
}

function applyLeftRight(src: string, N: number): string {
    if (!src || N <= 0) return src;
    if (!/[([\])]/.test(src) && !/\\\{|\\\}/.test(src)) return src;

    const ranges = findTextRanges(src);
    const stack: { index: number, char: string }[] = [];
    const pairs: { open: number, close: number, char: string }[] = [];
    const isPrefixed = (s: string, i: number, tag: string) => s.slice(Math.max(0, i - tag.length), i) === tag;

    for (let i = 0; i < src.length; i++) {
      if (indexInRanges(i, ranges)) continue;
      const ch = src[i];
      
      if (ch === '(' || ch === '[') {
        if (!isPrefixed(src, i, '\\left')) stack.push({ index: i, char: ch });
      } else if (ch === '{' && i > 0 && src[i - 1] === '\\') {
        if (!isPrefixed(src, i, '\\left\\')) stack.push({ index: i, char: '{' });
      } else if (ch === ')' || ch === ']') {
        if (isPrefixed(src, i, '\\right')) continue;
        const openChar = ch === ')' ? '(' : '[';
        if (stack.length > 0 && stack[stack.length - 1].char === openChar) {
          const openNode = stack.pop()!;
          const inner = src.slice(openNode.index + 1, i).replace(/\s+/g, '');
          if (inner.length >= N) pairs.push({ open: openNode.index, close: i, char: ch });
        } else stack.pop();
      } else if (ch === '}' && i > 0 && src[i - 1] === '\\') {
        if (isPrefixed(src, i, '\\right\\')) continue;
        if (stack.length > 0 && stack[stack.length - 1].char === '{') {
          const openNode = stack.pop()!;
          const inner = src.slice(openNode.index + 1, i - 1).replace(/\s+/g, '');
          if (inner.length >= N) pairs.push({ open: openNode.index, close: i, char: '}' });
        } else stack.pop();
      }
    }
    if (!pairs.length) return src;

    const openSet = new Set(pairs.map(p => p.open));
    const closeSet = new Set(pairs.map(p => p.close));

    let out = '';
    for (let i = 0; i < src.length; i++) {
      if (indexInRanges(i, ranges)) { out += src[i]; continue; }
      const ch = src[i];
      if ((ch === '(' || ch === '[') && openSet.has(i)) out += (isPrefixed(src, i, '\\left') ? ch : `\\left${ch}`);
      else if ((ch === ')' || ch === ']') && closeSet.has(i)) out += (isPrefixed(src, i, '\\right') ? ch : `\\right${ch}`);
      else if (ch === '{' && i > 0 && src[i - 1] === '\\' && openSet.has(i)) {
          out = out.slice(0, -1) + (isPrefixed(src, i, '\\left\\') ? '\\{' : '\\left\\{');
      } else if (ch === '}' && i > 0 && src[i - 1] === '\\' && closeSet.has(i)) {
          out = out.slice(0, -1) + (isPrefixed(src, i, '\\right\\') ? '\\}' : '\\right\\}');
      } else out += ch;
    }
    return out;
}

export function balanceReport(s: string): { ok: boolean, msg: string } {
    const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
    let ok = true; const msgParts: string[] = [];
    for (const [o, c] of pairs) {
      const open = (s.match(new RegExp(`\\${o}`, 'g')) || []).length;
      const close = (s.match(new RegExp(`\\${c}`, 'g')) || []).length;
      const bal = open - close;
      if (bal !== 0) ok = false;
      msgParts.push(`${o}${c}:${bal === 0 ? '0' : bal > 0 ? '+' + bal : bal}`);
    }
    return { ok, msg: msgParts.join(' ') };
}

function normalizeAlignSpec(spec: string, n: number): string {
    let s = (spec || '').replace(/\s+/g, '').trim();
    if (!s) s = 'l'.repeat(n);
    if (s.length < n) s = s + s[s.length - 1].repeat(n - s.length);
    else if (s.length > n) s = s.slice(0, n);
    s = s.replace(/[^lcr]/g, 'l');
    return s;
}

export function opOptionsFor(op: string): [string, string][] {
    if(['*','/','x','÷','·',':'].includes(op)) return [['\\times','multiplicar → \\times'], ['\\div','dividir → \\div'], ['\\cdot','punto medio → \\cdot'], [op, `dejar "${op}"`]];
    if(op === '<') return [['<','menor que → <'], ['\\lt','\\lt (equivalente)']];
    if(op === '>') return [['>','mayor que → >'], ['\\gt','\\gt (equivalente)']];
    if(op === '≤') return [['\\leq','≤ como \\leq'], ['≤','dejar ≤']];
    if(op === '≥') return [['\\geq','≥ como \\geq'], ['≥','dejar ≥']];
    if(op === '≠') return [['\\neq','≠ como \\neq'], ['≠','dejar ≠']];
    if(op === '≈') return [['\\approx','≈ como \\approx'], ['≈','dejar ≈']];
    return [[op, `dejar "${op}"`]];
}

export function defaultMapFor(op: string): string {
    switch (op) {
      case '*': case 'x': case ':': return '\\times';
      case '/': case '÷': return '\\div';
      case '·': return '\\cdot';
      case '≤': return '\\leq';
      case '≥': return '\\geq';
      case '≠': return '\\neq';
      case '≈': return '\\approx';
      default: return op;
    }
}

export function deepMerge(base: any, extra: any): any {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k in extra) {
        if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) {
            out[k] = deepMerge(base[k] || {}, extra[k]);
        } else {
            out[k] = extra[k];
        }
    }
    return out;
}