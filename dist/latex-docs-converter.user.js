// ==UserScript==
// @name         Google Docs → LaTeX 1 línea (TM)
// @namespace    https://tampermonkey.net/
// @version      1.9.4
// @description  Motor de conversión restaurado. Respeta saltos de línea múltiples.
// @license      MIT
// @match        https://docs.google.com/document/*
// @grant        none
// @inject-into  page
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const k in props) {
      if (k === "style") Object.assign(el.style, props[k]);
      else if (k === "className") el.className = props[k];
      else if (k === "dataset") Object.assign(el.dataset, props[k]);
      else if (k.startsWith("on") && typeof props[k] === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), props[k]);
      } else el.setAttribute(k, props[k]);
    }
    const childArray = Array.isArray(children) ? children : [children];
    childArray.forEach((ch) => {
      if (ch == null) return;
      if (typeof ch === "string") el.appendChild(document.createTextNode(ch));
      else el.appendChild(ch);
    });
    return el;
  }
  function removeChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function toast(root, msg, isErr = false) {
    const t = h("div", {
      style: {
        position: "absolute",
        bottom: "50px",
        right: "20px",
        background: isErr ? "#822" : "#262",
        color: "#fff",
        padding: "6px 12px",
        borderRadius: "4px",
        boxShadow: "0 2px 10px #000",
        fontSize: "12px",
        zIndex: "9999"
      }
    }, msg);
    root.appendChild(t);
    setTimeout(() => t.remove(), 2e3);
  }
  const DEFAULT_OPTS = {
    decimal: ".",
    wrapMode: "display",
    preserveLineBreaks: true,
    insertQuadBetweenBlocks: true,
    fracAtomic: true,
    atomicMaxLen: 2,
    autoLeftRight: true,
    autoLeftRightThreshold: 20,
    dontRewrapIfHasDollar: true,
    format: "line",
    arrayN: 2,
    arrayAlign: "ll",
    arrayRowSep: 0,
    arrayColSep: 0,
    opMap: { "*": "\\times", "/": "\\div", "x": "\\times", "÷": "\\div", "·": "\\cdot", ":": "\\times", "+": "+", "-": "-", "^": "^", "=": "=", "<": "<", ">": ">", "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx" },
    numOpNumOverride: { ":": "\\times", "x": "\\times" },
    removeDiacritics: true
  };
  function isLatexWrapped(raw) {
    if (!raw) return false;
    const trimmed = raw.trim();
    return trimmed.startsWith("$$") && trimmed.endsWith("$$") || trimmed.startsWith("$") && trimmed.endsWith("$") && trimmed !== "$" || trimmed.startsWith("\\begin{") && trimmed.endsWith("}") || trimmed.startsWith("\\[") && trimmed.endsWith("\\]") || trimmed.startsWith("\\(") && trimmed.endsWith("\\)");
  }
  function decompileLatexToPlainText(latex) {
    let s = latex.trim();
    s = s.replace(/^\s*\$\$(.*?)\$\$\s*$/s, "$1");
    s = s.replace(/^\s*\$(.*?)\$\s*$/s, "$1");
    s = s.replace(/^\s*\\\[(.*?)\\\]\s*$/s, "$1");
    s = s.replace(/^\s*\\\((.*?)\\\)\s*$/s, "$1");
    s = s.replace(/\\begin{[a-zA-Z*]+}(?:{[^}]*})?/g, "");
    s = s.replace(/\\end{[a-zA-Z*]+}/g, "");
    s = s.replace(/\\\\\[\d+pt\]/g, "\n");
    s = s.replace(/\\\\/g, "\n");
    s = s.replace(/&/g, "	");
    s = s.replace(/\\hspace\{\d+pt\}/g, "");
    let prev;
    let iter = 0;
    do {
      prev = s;
      s = s.replace(/\\frac{([^{}]*)}{([^{}]*)}/g, "($1)/($2)");
      s = s.replace(/\\text{([^{}]*)}/g, "$1");
      s = s.replace(/\^{([^{}]*)}/g, "^$1");
      s = s.replace(/_{([^{}]*)}/g, "_$1");
      iter++;
    } while (s !== prev && iter < 15);
    s = s.replace(/\(\(([^()]+)\)\)/g, "($1)");
    s = s.replace(/\(([a-zA-Z0-9.,]+)\)\/\(([a-zA-Z0-9.,]+)\)/g, "$1/$2");
    s = s.replace(/\\times/g, "x").replace(/\\div/g, "/").replace(/\\quad/g, " ");
    s = s.replace(/\\circ/g, "°").replace(/\\leq/g, "≤").replace(/\\geq/g, "≥");
    s = s.replace(/\\neq/g, "≠").replace(/\\approx/g, "≈").replace(/\\cdot/g, "·");
    s = s.replace(/\\left([()[\]{}|])/g, "$1").replace(/\\right([()[\]{}|])/g, "$1");
    s = s.replace(/\\([%&_$#{}])/g, "$1").replace(/\\textbackslash\s*/g, "\\");
    return s.split("\n").map((line) => line.trim().replace(/ {2,}/g, " ").replace(/\t/g, "  ")).filter((line) => line.length > 0).join("\n");
  }
  function convertSelectionToLatexOneLine(raw, opts) {
    if (!raw) return opts.wrapMode === "inline" ? `$  $` : `$$  $$`;
    let s = decodeEntities(raw);
    if (isLatexWrapped(s)) return s.trim();
    s = normalizeUnicodeOperators(s);
    if (opts.removeDiacritics) s = stripDiacritics(s);
    const blocks = extractIncisoBlocks(s, opts);
    let body = "";
    const rowSep = opts.arrayRowSep > 0 ? ` \\\\[${opts.arrayRowSep}pt] ` : ` \\\\ `;
    switch (opts.format) {
      case "array1":
      case "array2":
      case "arrayN": {
        const n = opts.format === "array1" ? 1 : opts.format === "array2" ? 2 : Math.max(1, opts.arrayN || 2);
        const align = normalizeAlignSpec(opts.arrayAlign, n);
        const items = blocks.map((b) => lineForBlock(b, opts));
        const rows = [];
        for (let i = 0; i < items.length; i += n) {
          const cols = items.slice(i, i + n);
          while (cols.length < n) cols.push("");
          if (opts.arrayColSep > 0) {
            for (let c = 0; c < cols.length - 1; c++) {
              cols[c] = cols[c] ? `${cols[c]}\\hspace{${opts.arrayColSep}pt}` : `\\hspace{${opts.arrayColSep}pt}`;
            }
          }
          rows.push(cols.join(" & "));
        }
        body = `\\begin{array}{${align}} ` + rows.join(rowSep) + ` \\end{array}`;
        break;
      }
      case "gathered": {
        const items = blocks.map((b) => lineForBlock(b, opts));
        body = `\\begin{gathered} ${items.join(rowSep)} \\end{gathered}`;
        break;
      }
      case "aligned": {
        const items = blocks.map((b) => makeAlignedRow(lineForBlock(b, opts)));
        body = `\\begin{aligned} ${items.join(rowSep)} \\end{aligned}`;
        break;
      }
      case "cases": {
        const items = blocks.map((b) => `${lineForBlock(b, opts)} &`);
        body = `\\begin{cases} ${items.join(rowSep)} \\end{cases}`;
        break;
      }
      case "pmatrix":
      case "bmatrix": {
        const n = Math.max(1, opts.arrayN || 2);
        const items = blocks.map((b) => lineForBlock(b, opts));
        const rows = [];
        for (let i = 0; i < items.length; i += n) {
          const cols = items.slice(i, i + n);
          while (cols.length < n) cols.push("");
          if (opts.arrayColSep > 0) {
            for (let c = 0; c < cols.length - 1; c++) {
              cols[c] = cols[c] ? `${cols[c]}\\hspace{${opts.arrayColSep}pt}` : `\\hspace{${opts.arrayColSep}pt}`;
            }
          }
          rows.push(cols.join(" & "));
        }
        body = `\\begin{${opts.format}} ${rows.join(rowSep)} \\end{${opts.format}}`;
        break;
      }
      case "line":
      default: {
        const parts = blocks.map((b) => lineForBlock(b, opts));
        body = parts.join(opts.insertQuadBetweenBlocks ? " \\quad " : " ");
        break;
      }
    }
    const hasDollar = /\$/.test(body) || /\$/.test(s);
    let finalStr = body.trim();
    if (!(opts.dontRewrapIfHasDollar && hasDollar)) {
      finalStr = opts.wrapMode === "inline" ? `$ ${finalStr} $` : `$$ ${finalStr} $$`;
    }
    return joinSingleLine(finalStr);
  }
  function makeAlignedRow(str) {
    const r = /(\\leq|\\geq|\\neq|\\approx|=|≤|≥|≠|≈|<|>)/;
    const m = str.match(r);
    if (m) return str.replace(r, " &$1& ");
    return `& ${str}`;
  }
  function lineForBlock(text, opts) {
    const s = (text || "").trim();
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
  const OPS_SET = new Set(["+", "-", "*", "/", "x", "÷", ":", "·", "^", "=", "<", ">", "≤", "≥", "≠", "≈", "(", ")", "[", "]", "{", "}", "|", "%", "&"]);
  function tokenize(str) {
    if (!str || typeof str !== "string") return [];
    const tks = [];
    let i = 0;
    const len = str.length;
    while (i < len) {
      const c = str[i];
      if (c === " " || c === "	") {
        let j = i + 1;
        while (j < len && (str[j] === " " || str[j] === "	")) j++;
        tks.push({ type: "SPACE", v: str.slice(i, j) });
        i = j;
        continue;
      }
      if (c === "\n" || c === "\r") {
        let j = i;
        let nls = 0;
        while (j < len && (str[j] === "\n" || str[j] === "\r")) {
          if (str[j] === "\n") nls++;
          j++;
        }
        tks.push({ type: "NL", v: nls || 1 });
        i = j;
        continue;
      }
      if (REGEX_DIGIT.test(c)) {
        let j = i + 1;
        while (j < len && REGEX_NUMBER_PART.test(str[j])) j++;
        tks.push({ type: "NUMBER", v: str.slice(i, j) });
        i = j;
        continue;
      }
      if (REGEX_LETTER.test(c)) {
        let j = i + 1;
        while (j < len && REGEX_LETTER.test(str[j])) j++;
        tks.push({ type: "WORD", v: str.slice(i, j) });
        i = j;
        continue;
      }
      if (OPS_SET.has(c)) {
        tks.push({ type: "OP", v: c });
        i++;
        continue;
      }
      if (REGEX_PUNCT.test(c)) {
        tks.push({ type: "PUNCT", v: c });
        i++;
        continue;
      }
      const codePoint = str.codePointAt(i);
      if (codePoint && codePoint > 65535) {
        tks.push({ type: "OTHER", v: str.slice(i, i + 2) });
        i += 2;
      } else {
        tks.push({ type: "OTHER", v: c });
        i++;
      }
    }
    return tks;
  }
  function combineIncisos(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const prev = out.length ? out[out.length - 1] : null;
      const t = tokens[i];
      const nxt = tokens[i + 1];
      const prevSpaceOrStart = !prev || prev.type === "SPACE" || prev.type === "NL";
      if (prevSpaceOrStart && t && t.type === "WORD" && String(t.v).length === 1 && /^[a-zA-Z]$/.test(String(t.v)) && nxt && (nxt.type === "OP" && nxt.v === ")" || nxt.type === "PUNCT" && nxt.v === ")")) {
        out.push({ type: "INCISO", v: String(t.v).toLowerCase() + ")" });
        i++;
        continue;
      }
      out.push(t);
    }
    return out;
  }
  function combineAtomicFractions(tokens, opts) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      if (isAtomic(tokens[i], opts)) {
        const j1 = skipSpaces(tokens, i + 1);
        if (j1 < tokens.length && tokens[j1].type === "OP" && tokens[j1].v === "/") {
          const j2 = skipSpaces(tokens, j1 + 1);
          if (j2 < tokens.length && isAtomic(tokens[j2], opts)) {
            out.push({ type: "FRAC", v: "", num: tokens[i], den: tokens[j2] });
            i = j2;
            continue;
          }
        }
      }
      out.push(tokens[i]);
    }
    return out;
  }
  function isAtomic(token, opts) {
    if (!token) return false;
    if (token.type === "NUMBER") {
      const num = String(token.v).replace(/[.,]/g, "");
      return num.length <= opts.atomicMaxLen;
    }
    if (token.type === "WORD") return String(token.v).length <= opts.atomicMaxLen;
    return false;
  }
  function skipSpaces(tokens, idx) {
    let j = idx;
    while (j < tokens.length && (tokens[j].type === "SPACE" || tokens[j].type === "NL")) j++;
    return j;
  }
  function peekNextNonSpace(tokens, idx) {
    let j = idx;
    while (j < tokens.length && (tokens[j].type === "SPACE" || tokens[j].type === "NL")) j++;
    return { j, t: tokens[j] || null };
  }
  function emitLatex(tokens, opts) {
    const parts = [];
    let i = 0, expDepth = 0;
    let textBuf = "";
    const appendText = (s) => {
      textBuf += String(s);
    };
    const flushText = () => {
      if (textBuf.length > 0) {
        const esc = escapeLatexInText(textBuf);
        parts.push(`\\text{${esc}}`);
      }
      textBuf = "";
    };
    const pushMath = (m) => {
      if (m) parts.push(m);
    };
    while (i < tokens.length) {
      const t = tokens[i];
      switch (t.type) {
        case "SPACE": {
          const spaceStr = String(t.v);
          if (spaceStr.length > 1) {
            flushText();
            pushMath("\\ ".repeat(spaceStr.length));
          } else {
            appendText(spaceStr);
          }
          i++;
          break;
        }
        case "NL":
          flushText();
          if (opts.preserveLineBreaks) {
            const breaks = Array(Number(t.v)).fill("\\\\").join(" ");
            pushMath(" " + breaks + " ");
          } else {
            appendText(" ");
          }
          i++;
          break;
        case "INCISO":
        case "PUNCT":
        case "OTHER":
          appendText(t.v);
          i++;
          break;
        case "WORD": {
          const w = String(t.v || "").toLowerCase();
          if (["sin", "cos", "tan", "log"].includes(w)) {
            flushText();
            pushMath("\\" + w);
          } else {
            appendText(t.v);
          }
          i++;
          break;
        }
        case "FRAC": {
          flushText();
          const num = emitAtomic(t.num, opts), den = emitAtomic(t.den, opts);
          pushMath(`\\frac{${num}}{${den}}`);
          i++;
          break;
        }
        case "NUMBER": {
          flushText();
          const norm = normalizeNumber(String(t.v), opts.decimal);
          pushMath(escapeMath(norm));
          const { j, t: nt } = peekNextNonSpace(tokens, i + 1);
          if (nt && nt.type === "OTHER" && (nt.v === "°" || nt.v === "º")) {
            pushMath("^\\circ");
            i = j + 1;
          } else {
            i++;
          }
          break;
        }
        case "OP": {
          flushText();
          const next = tokens[i + 1];
          const v = String(t.v);
          if (v === "<" && next && next.type === "OP" && next.v === "=") {
            pushMath("\\leq");
            i += 2;
            break;
          }
          if (v === ">" && next && next.type === "OP" && next.v === "=") {
            pushMath("\\geq");
            i += 2;
            break;
          }
          if (v === "%") {
            pushMath("\\%");
            i++;
            break;
          }
          if (v === "^") {
            const { j, t: nt } = peekNextNonSpace(tokens, i + 1);
            if (nt && nt.type === "OP" && nt.v === "(") {
              pushMath("^{(");
              expDepth = 1;
              i = j + 1;
              break;
            }
            if (nt) {
              const emitted = emitAtomic(nt, opts);
              const needBraces = emitted.length > 1;
              pushMath(needBraces ? `^{${emitted}}` : `^${emitted}`);
              i = j + 1;
              break;
            } else {
              pushMath("^");
              i++;
              break;
            }
          }
          if (v === "(") {
            if (expDepth > 0) expDepth++;
            pushMath("(");
            i++;
            break;
          }
          if (v === ")") {
            if (expDepth > 0) {
              expDepth--;
              if (expDepth === 0) {
                pushMath(")}");
                i++;
                break;
              }
            }
            pushMath(")");
            i++;
            break;
          }
          if (["≤", "≥", "≠", "≈", "<", ">", "="].includes(v)) {
            pushMath(opts.opMap[v] || defaultMapFor(v));
            i++;
            break;
          }
          const prev = tokens[findPrevNonSpaceIndex(tokens, i)];
          const nxt = tokens[skipSpaces(tokens, i + 1)];
          const betweenNumbers = isNumberLike(prev) && isNumberLike(nxt);
          if (v === "x" && betweenNumbers) {
            pushMath(opts.numOpNumOverride["x"] ?? "\\times");
            i++;
            break;
          }
          if (v === ":" && betweenNumbers) {
            pushMath(opts.numOpNumOverride[":"] != null ? opts.numOpNumOverride[":"] : opts.opMap[":"] || ":");
            i++;
            break;
          }
          if (["*", "/", "x", "÷", "·", ":", "+", "-", "^"].includes(v)) {
            const mapped = opts.opMap[v] || defaultMapFor(v);
            pushMath(mapped === "^" ? "^" : mapped);
            i++;
            break;
          }
          if (["<", ">", "=", "(", ")", "[", "]", "{", "}", "|"].includes(v)) {
            pushMath(v);
            i++;
            break;
          }
          if (v === "&") {
            pushMath("\\&");
            i++;
            break;
          }
          pushMath(v);
          i++;
          break;
        }
        default:
          appendText(String(t.v || ""));
          i++;
          break;
      }
    }
    flushText();
    return parts.join("").trim();
  }
  function emitAtomic(token, opts) {
    if (!token) return "";
    if (token.type === "NUMBER") return escapeMath(normalizeNumber(String(token.v), opts.decimal));
    if (token.type === "WORD") return escapeMathWord(String(token.v));
    if (token.type === "FRAC") {
      const num = emitAtomic(token.num, opts), den = emitAtomic(token.den, opts);
      return `\\frac{${num}}{${den}}`;
    }
    return escapeMath((token.v || "").toString());
  }
  function isNumberLike(t) {
    if (!t) return false;
    if (t.type === "NUMBER" || t.type === "FRAC") return true;
    if (t.type === "OP" && (t.v === ")" || t.v === "(")) return true;
    if (t.type === "WORD" && String(t.v).length <= 2) return true;
    return false;
  }
  function findPrevNonSpaceIndex(tokens, idx) {
    let j = idx - 1;
    while (j >= 0 && (tokens[j].type === "SPACE" || tokens[j].type === "NL")) j--;
    return j;
  }
  const ENTITY_MAP = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", le: "≤", ge: "≥", ne: "≠", times: "×", divide: "÷", middot: "·", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", deg: "°" };
  const ENTITY_REGEX = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));?/g;
  function decodeEntities(str) {
    if (!str) return "";
    return String(str).replace(ENTITY_REGEX, (match, dec, hex, named) => {
      if (dec) {
        const cp = parseInt(dec, 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
      }
      if (hex) {
        const cp = parseInt(hex, 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
      }
      if (named) return ENTITY_MAP[named] ?? match;
      return match;
    }).replace(/\u00A0/g, " ");
  }
  function normalizeUnicodeOperators(s) {
    if (!s) return "";
    return s.replace(/\u2212/g, "-").replace(/\u00d7/g, "x").replace(/\u22c5/g, "·").replace(/\u2264/g, "≤").replace(/\u2265/g, "≥").replace(/\u2260/g, "≠").replace(/\u2248/g, "≈").replace(/\u00f7/g, "÷");
  }
  function detectOperators(s) {
    const set = new Set();
    const allow = "*/x÷:·+-^=<>≤≥≠≈";
    for (const ch of s) if (allow.includes(ch)) set.add(ch);
    if (s.includes("<=")) set.add("<");
    if (s.includes(">=")) set.add(">");
    return set;
  }
  function normalizeNumber(numStr, prefer) {
    let s = (numStr || "").trim();
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let dec = null;
    if (lastDot !== -1 || lastComma !== -1) dec = lastDot > lastComma ? "." : ",";
    if (dec) {
      const parts = s.split(dec);
      const decimals = parts.pop();
      const int = parts.join("").replace(/[.,]/g, "");
      s = int + (decimals !== void 0 ? dec + decimals : "");
    }
    if (!dec) {
      if (s.includes(".")) dec = ".";
      else if (s.includes(",")) dec = ",";
    }
    if (prefer && dec && prefer !== dec) s = s.replace(dec, prefer);
    if (prefer === ".") s = s.replace(/,/g, "");
    if (prefer === ",") s = s.replace(/\./g, "");
    return s;
  }
  function escapeLatexInText(s) {
    return (s || "").replace(/\\/g, "\\textbackslash ").replace(/([{}$#%&_^~])/g, "\\$1");
  }
  function escapeMath(s) {
    return (s || "").replace(/&/g, "\\&").replace(/%/g, "\\%");
  }
  function escapeMathWord(s) {
    return (s || "").replace(/([&#%])/g, "\\$1").replace(/_/g, "\\_");
  }
  function joinSingleLine(s) {
    return (s || "").replace(/(\r?\n)+/g, " ").trim();
  }
  function stripDiacritics(s) {
    try {
      return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (err) {
      console.warn("[LaTeX Converter] Error stripping diacritics:", err);
      return s;
    }
  }
  const INCISO_REGEX = /(^|\s)([a-zA-Z]\))\s*/g;
  const SPLIT_LINE_REGEX = /;+/;
  const SPLIT_MULTILINE_REGEX = /\r?\n|;+/;
  const SPLIT_ANY_REGEX = /[\r\n]+|;+/;
  const TRAILING_NL_REGEX = /[\r\n\s]+$/;
  function extractIncisoBlocks(s, opts) {
    const pos = [];
    let m;
    INCISO_REGEX.lastIndex = 0;
    while ((m = INCISO_REGEX.exec(s)) !== null) pos.push(m.index + (m[1] ? m[1].length : 0));
    if (pos.length === 0) {
      if (opts && opts.preserveLineBreaks) {
        if (opts.format === "line") {
          const parts = s.split(SPLIT_LINE_REGEX).map((x) => x.trim()).filter(Boolean);
          return parts.length ? parts : [s.trim()];
        } else {
          const parts = s.split(SPLIT_MULTILINE_REGEX).map((x) => x.trim());
          while (parts.length && parts[0] === "") parts.shift();
          while (parts.length && parts[parts.length - 1] === "") parts.pop();
          return parts.length ? parts : [s.trim()];
        }
      } else {
        const parts = s.split(SPLIT_ANY_REGEX).map((x) => x.trim()).filter(Boolean);
        return parts.length ? parts : [s.trim()];
      }
    }
    const blocks = [];
    for (let i = 0; i < pos.length; i++) {
      const start = pos[i];
      const end = i + 1 < pos.length ? pos[i + 1] : s.length;
      const rawBlock = s.slice(start, end);
      blocks.push(rawBlock.trim());
      if (opts && opts.preserveLineBreaks && i + 1 < pos.length) {
        const trailingMatch = rawBlock.match(TRAILING_NL_REGEX);
        if (trailingMatch) {
          const nls = (trailingMatch[0].match(/\n/g) || []).length;
          for (let k = 1; k < nls; k++) {
            blocks.push("");
          }
        }
      }
    }
    return blocks;
  }
  function findTextRanges(latex) {
    const ranges = [];
    const re = /\\text\{/g;
    let m;
    while ((m = re.exec(latex)) !== null) {
      let depth = 1;
      let i = m.index + 6;
      while (i < latex.length && depth > 0) {
        if (latex[i] === "{") depth++;
        else if (latex[i] === "}") depth--;
        i++;
      }
      ranges.push([m.index, i - 1]);
    }
    return ranges;
  }
  function indexInRanges(i, ranges) {
    for (const [a, b] of ranges) if (i >= a && i <= b) return true;
    return false;
  }
  function excludeTextBlocks(latex) {
    const ranges = findTextRanges(latex);
    if (!ranges.length) return latex;
    let out = "", i = 0;
    for (const [a, b] of ranges) {
      out += latex.slice(i, a) + " ".repeat(b - a + 1);
      i = b + 1;
    }
    out += latex.slice(i);
    return out;
  }
  function applyLeftRight(src, N) {
    if (!src || N <= 0) return src;
    if (!/[([\])]/.test(src) && !/\\\{|\\\}/.test(src)) return src;
    const ranges = findTextRanges(src);
    const stack = [];
    const pairs = [];
    const isPrefixed = (s, i, tag) => s.slice(Math.max(0, i - tag.length), i) === tag;
    for (let i = 0; i < src.length; i++) {
      if (indexInRanges(i, ranges)) continue;
      const ch = src[i];
      if (ch === "(" || ch === "[") {
        if (!isPrefixed(src, i, "\\left")) stack.push({ index: i, char: ch });
      } else if (ch === "{" && i > 0 && src[i - 1] === "\\") {
        if (!isPrefixed(src, i, "\\left\\")) stack.push({ index: i, char: "{" });
      } else if (ch === ")" || ch === "]") {
        if (isPrefixed(src, i, "\\right")) continue;
        const openChar = ch === ")" ? "(" : "[";
        if (stack.length > 0 && stack[stack.length - 1].char === openChar) {
          const openNode = stack.pop();
          const inner = src.slice(openNode.index + 1, i).replace(/\s+/g, "");
          if (inner.length >= N) pairs.push({ open: openNode.index, close: i, char: ch });
        } else stack.pop();
      } else if (ch === "}" && i > 0 && src[i - 1] === "\\") {
        if (isPrefixed(src, i, "\\right\\")) continue;
        if (stack.length > 0 && stack[stack.length - 1].char === "{") {
          const openNode = stack.pop();
          const inner = src.slice(openNode.index + 1, i - 1).replace(/\s+/g, "");
          if (inner.length >= N) pairs.push({ open: openNode.index, close: i, char: "}" });
        } else stack.pop();
      }
    }
    if (!pairs.length) return src;
    const openSet = new Set(pairs.map((p) => p.open));
    const closeSet = new Set(pairs.map((p) => p.close));
    let out = "";
    for (let i = 0; i < src.length; i++) {
      if (indexInRanges(i, ranges)) {
        out += src[i];
        continue;
      }
      const ch = src[i];
      if ((ch === "(" || ch === "[") && openSet.has(i)) out += isPrefixed(src, i, "\\left") ? ch : `\\left${ch}`;
      else if ((ch === ")" || ch === "]") && closeSet.has(i)) out += isPrefixed(src, i, "\\right") ? ch : `\\right${ch}`;
      else if (ch === "{" && i > 0 && src[i - 1] === "\\" && openSet.has(i)) {
        out = out.slice(0, -1) + (isPrefixed(src, i, "\\left\\") ? "\\{" : "\\left\\{");
      } else if (ch === "}" && i > 0 && src[i - 1] === "\\" && closeSet.has(i)) {
        out = out.slice(0, -1) + (isPrefixed(src, i, "\\right\\") ? "\\}" : "\\right\\}");
      } else out += ch;
    }
    return out;
  }
  function balanceReport(s) {
    const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
    let ok = true;
    const msgParts = [];
    for (const [o, c] of pairs) {
      const open = (s.match(new RegExp(`\\${o}`, "g")) || []).length;
      const close = (s.match(new RegExp(`\\${c}`, "g")) || []).length;
      const bal = open - close;
      if (bal !== 0) ok = false;
      msgParts.push(`${o}${c}:${bal === 0 ? "0" : bal > 0 ? "+" + bal : bal}`);
    }
    return { ok, msg: msgParts.join(" ") };
  }
  function normalizeAlignSpec(spec, n) {
    let s = (spec || "").replace(/\s+/g, "").trim();
    if (!s) s = "l".repeat(n);
    if (s.length < n) s = s + s[s.length - 1].repeat(n - s.length);
    else if (s.length > n) s = s.slice(0, n);
    s = s.replace(/[^lcr]/g, "l");
    return s;
  }
  function opOptionsFor(op) {
    if (["*", "/", "x", "÷", "·", ":"].includes(op)) return [["\\times", "multiplicar → \\times"], ["\\div", "dividir → \\div"], ["\\cdot", "punto medio → \\cdot"], [op, `dejar "${op}"`]];
    if (op === "<") return [["<", "menor que → <"], ["\\lt", "\\lt (equivalente)"]];
    if (op === ">") return [[">", "mayor que → >"], ["\\gt", "\\gt (equivalente)"]];
    if (op === "≤") return [["\\leq", "≤ como \\leq"], ["≤", "dejar ≤"]];
    if (op === "≥") return [["\\geq", "≥ como \\geq"], ["≥", "dejar ≥"]];
    if (op === "≠") return [["\\neq", "≠ como \\neq"], ["≠", "dejar ≠"]];
    if (op === "≈") return [["\\approx", "≈ como \\approx"], ["≈", "dejar ≈"]];
    return [[op, `dejar "${op}"`]];
  }
  function defaultMapFor(op) {
    switch (op) {
      case "*":
      case "x":
      case ":":
        return "\\times";
      case "/":
      case "÷":
        return "\\div";
      case "·":
        return "\\cdot";
      case "≤":
        return "\\leq";
      case "≥":
        return "\\geq";
      case "≠":
        return "\\neq";
      case "≈":
        return "\\approx";
      default:
        return op;
    }
  }
  function deepMerge(base, extra) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k in extra) {
      if (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k])) {
        out[k] = deepMerge(base[k] || {}, extra[k]);
      } else {
        out[k] = extra[k];
      }
    }
    return out;
  }
  const LS_STATE_V2 = "tmLatexStateV2";
  const LS_KEY_V1 = "tmLatexOptsV1";
  const LS_GEOM_V1 = "tmLatexGeomV1";
  const LS_ZOOM_V1 = "tmLatexZoomV1";
  const LS_FULLSCREEN_V1 = "tmLatexFullscreenV1";
  class StorageManager {
    state;
    persistTimer = null;
    constructor() {
      this.state = this.loadState();
    }
    loadState() {
      try {
        const raw = localStorage.getItem(LS_STATE_V2);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            geom: parsed.geom ?? null,
            opts: parsed.opts ? deepMerge(structuredClone(DEFAULT_OPTS), parsed.opts) : structuredClone(DEFAULT_OPTS),
            zoom: typeof parsed.zoom === "number" && !Number.isNaN(parsed.zoom) ? parsed.zoom : 1,
            fullscreen: !!parsed.fullscreen
          };
        }
      } catch (err) {
        console.warn("[LaTeX Converter] No se pudo cargar el estado V2, intentando migrar:", err);
      }
      const legacyState = { geom: null, opts: structuredClone(DEFAULT_OPTS), zoom: 1, fullscreen: false };
      try {
        legacyState.geom = JSON.parse(localStorage.getItem(LS_GEOM_V1) || "null");
      } catch (e) {
        console.trace("[LaTeX Converter] Sin geometría legacy");
      }
      try {
        const o = JSON.parse(localStorage.getItem(LS_KEY_V1) || "null");
        if (o) legacyState.opts = deepMerge(legacyState.opts, o);
      } catch (e) {
        console.trace("[LaTeX Converter] Sin opciones legacy");
      }
      try {
        const z = parseFloat(localStorage.getItem(LS_ZOOM_V1) || "");
        legacyState.zoom = Number.isNaN(z) ? 1 : z;
      } catch (e) {
        console.trace("[LaTeX Converter] Sin zoom legacy");
      }
      legacyState.fullscreen = localStorage.getItem(LS_FULLSCREEN_V1) === "1";
      return legacyState;
    }
    persist() {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => {
        try {
          localStorage.setItem(LS_STATE_V2, JSON.stringify(this.state));
        } catch (err) {
          console.error("[LaTeX Converter] Quota exceeded o error guardando estado:", err);
        }
      }, 250);
    }
    loadGeom() {
      return this.state.geom;
    }
    saveGeom(el) {
      const r = el.getBoundingClientRect();
      this.state.geom = { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" };
      this.persist();
    }
    loadOpts() {
      return this.state.opts;
    }
    saveOpts(opts) {
      this.state.opts = opts;
      this.persist();
    }
    loadZoom() {
      return this.state.zoom;
    }
    saveZoom(val) {
      this.state.zoom = val;
      this.persist();
    }
    loadFullscreen() {
      return this.state.fullscreen;
    }
    saveFullscreen(val) {
      this.state.fullscreen = val;
      this.persist();
    }
  }
  const StorageService = new StorageManager();
  const MAX_Z_INDEX = 2147483647;
  const state = {
    panelOpen: false,
    compact: false,
    fullscreen: StorageService.loadFullscreen(),
    zoom: StorageService.loadZoom() ?? 1,
    opts: StorageService.loadOpts(),
    elements: {},
    resizeObserver: null,
    cleanups: [],
    currentInput: "",
    previousInput: "",
    currentTab: "text",
    isVisualEditing: false
  };
  function togglePanel() {
    state.panelOpen ? closePanel() : openPanel();
  }
  function resetPanelPosition() {
    if (!state.elements.host || state.fullscreen) return;
    const el = state.elements.host;
    Object.assign(el.style, { left: "auto", top: "auto", right: "30px", bottom: "30px", width: "450px", height: "600px" });
    StorageService.saveGeom(el);
    if (state.elements.root) toast(state.elements.root, "Posición restaurada");
  }
  function openPanel() {
    if (state.panelOpen) return;
    state.panelOpen = true;
    const host = document.createElement("tm-latex-panel-host");
    Object.assign(host.style, {
      position: "fixed",
      left: "auto",
      top: "auto",
      right: "30px",
      bottom: "30px",
      width: "450px",
      height: "600px",
      minWidth: "320px",
      minHeight: "300px",
      maxWidth: "95vw",
      maxHeight: "95vh",
      zIndex: String(MAX_Z_INDEX),
      display: "block"
    });
    const savedGeom = StorageService.loadGeom();
    if (savedGeom && !state.fullscreen) Object.assign(host.style, savedGeom);
    document.documentElement.appendChild(host);
    if (state.fullscreen) applyFullscreenGeom(host);
    const root = host.attachShadow({ mode: "open" });
    const style = h("style", {}, `
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
    const parenStatus = h("span", { className: "badge", id: "parenStatus" }, "Bal: —");
    const btnCopy = h("button", { className: "btn primary", title: "Copiar (Ctrl+C)" }, "Copiar");
    const btnClose = h("button", { className: "btn warn", title: "Cerrar (Esc)" }, "X");
    const btnFull = h("button", { className: "btn", title: "Fullscreen" }, "⛶");
    const header = h("div", { className: "header", title: "Arrastra para mover. Doble clic para restaurar posición." }, [h("span", { className: "title" }, "LaTeX Converter"), h("span", { className: "spacer" }), parenStatus, btnCopy, btnFull, btnClose]);
    const inputTA = h("textarea", { className: "textarea", placeholder: "1. Pega tu texto aquí...", style: { minHeight: "100px" } });
    inputTA.value = state.currentInput;
    const btnPaste = h("button", { className: "btn" }, "Pegar");
    const btnClear = h("button", { className: "btn" }, "Limpiar");
    const btnUndo = h("button", { className: "btn", title: "Deshacer (Restaurar anterior)" }, "↶");
    const sectionInput = h("div", { className: "section" }, [h("div", { className: "label-head" }, "ENTRADA"), inputTA, h("div", { className: "actions" }, [btnPaste, btnClear, btnUndo])]);
    const previewTA = h("textarea", { className: "textarea", readOnly: true, placeholder: "2. Resultado LaTeX...", style: { minHeight: "60px", color: "#8f8" } });
    const sectionOutput = h("div", { className: "section" }, [h("div", { className: "label-head" }, "SALIDA"), previewTA]);
    const selFormat = h("select", {}, [h("option", { value: "line" }, "Línea"), h("option", { value: "array1" }, "Array 1 Col"), h("option", { value: "arrayN" }, "Array N Cols"), h("option", { value: "gathered" }, "Gathered")]);
    const inpArrayN = h("input", { type: "number", min: "1", value: "2", style: { width: "40px" } });
    const inpAlign = h("input", { type: "text", placeholder: "ll", style: { width: "60px" } });
    const inpRowSep = h("input", { type: "number", min: "0", max: "100", value: "0", style: { width: "40px" }, title: "Espaciado vertical en pt" });
    const inpColSep = h("input", { type: "number", min: "0", max: "100", value: "0", style: { width: "40px" }, title: "Espaciado horizontal en pt" });
    const detFmt = h("details", { open: true }, [h("summary", {}, "Formato"), h("div", { className: "details-content" }, [h("div", { className: "row-flex" }, [h("span", {}, "Tipo:"), selFormat]), h("div", { className: "row-flex" }, [h("span", {}, "Cols:"), inpArrayN, h("span", {}, "Align:"), inpAlign]), h("div", { className: "row-flex" }, [h("span", {}, "Gap Filas:"), inpRowSep, h("span", {}, "Gap Cols:"), inpColSep])])]);
    const chkPreserveLB = h("input", { type: "checkbox" });
    const chkInsertQuad = h("input", { type: "checkbox" });
    const chkFrac = h("input", { type: "checkbox" });
    const chkAutoLR = h("input", { type: "checkbox" });
    const inpAtomicLen = h("input", { type: "number", min: "1", max: "10", value: "2", style: { width: "40px" } });
    const inpLRN = h("input", { type: "number", value: "20", style: { width: "40px" } });
    const chkDontRewrap = h("input", { type: "checkbox" });
    const chkNoAccents = h("input", { type: "checkbox" });
    const radDecDot = h("input", { type: "radio", name: "dec", value: "." });
    const radDecCom = h("input", { type: "radio", name: "dec", value: "," });
    const radWrapIn = h("input", { type: "radio", name: "wrap", value: "inline" });
    const radWrapDis = h("input", { type: "radio", name: "wrap", value: "display" });
    const detOpts = h("details", {}, [
      h("summary", { title: "Configuraciones generales de comportamiento del motor" }, "Reglas de Parseo"),
      h("div", { className: "details-content" }, [
        h("div", { className: "opt-grid" }, [
          h("label", { className: "chk-label", title: "Conserva los saltos de línea del texto de entrada usando \\\\" }, [chkPreserveLB, "Mantener Saltos (\\\\)"]),
          h("label", { className: "chk-label", title: "Inserta un espacio extenso (\\quad) entre listas u oraciones separadas" }, [chkInsertQuad, "Separar bloques (\\quad)"]),
          h("label", { className: "chk-label", title: "Convierte automáticamente cosas como 1/2 en \\frac{1}{2}" }, [chkFrac, "Auto-Fracciones"]),
          h("label", { className: "chk-label", title: "Longitud máxima de dígitos numéricos para auto-convertirse en fracción" }, [h("span", {}, "Límite Frac:"), inpAtomicLen]),
          h("label", { className: "chk-label", title: "Usa \\left y \\right para ajustar dinámicamente el tamaño de los paréntesis" }, [chkAutoLR, "Auto Paréntesis LR"]),
          h("label", { className: "chk-label", title: "Mínimo de caracteres internos para aplicar Paréntesis LR" }, [h("span", {}, "Umbral LR:"), inpLRN]),
          h("label", { className: "chk-label", title: "Si el texto ya trae signos de $, no los envolverá doblemente" }, [chkDontRewrap, "Ignorar si tiene $"]),
          h("label", { className: "chk-label", title: "Elimina acentos y diacríticos (ej: á → a) para evitar errores en LaTeX" }, [chkNoAccents, "Quitar tildes"])
        ]),
        h("div", { className: "row-flex", style: { marginTop: "4px" } }, [
          h("span", { title: "Símbolo preferido para los decimales" }, "Decimal:"),
          h("label", { className: "chk-label" }, [radDecDot, "Punto (.)"]),
          h("label", { className: "chk-label" }, [radDecCom, "Coma (,)"]),
          h("span", { style: { marginLeft: "12px" }, title: "Forma en la que se envolverá la salida final" }, "Salida:"),
          h("label", { className: "chk-label" }, [radWrapIn, "Inline ($)"]),
          h("label", { className: "chk-label" }, [radWrapDis, "Bloque ($$)"])
        ])
      ])
    ]);
    const selNumOpColon = h("select", {}, [h("option", { value: "\\times" }, "Multiplicar (\\times)"), h("option", { value: ":" }, "Literal (:)")]);
    const selNumOpX = h("select", {}, [h("option", { value: "\\times" }, "Multiplicar (\\times)"), h("option", { value: "x" }, "Letra (x)")]);
    const detBetween = h("details", {}, [h("summary", { title: "Comportamiento de símbolos rodeados exactamente por dos números (ej: 2x3 o 4:5)" }, "Símbolos entre Números"), h("div", { className: "details-content" }, [h("div", { className: "note", style: { marginTop: "0", marginBottom: "4px" } }, 'Reglas cuando detecta "2x3" o "4:5":'), h("div", { className: "row-flex" }, [h("span", { title: "Qué hacer con los dos puntos" }, 'Los dos puntos ":":'), selNumOpColon]), h("div", { className: "row-flex" }, [h("span", { title: "Qué hacer con la equis" }, 'La letra "x":'), selNumOpX])])]);
    const opGrid = h("div", { className: "opt-grid" });
    const detOps = h("details", {}, [h("summary", { title: "Traduce caracteres de uso común a su equivalente profesional en LaTeX" }, "Símbolos Detectados"), h("div", { className: "details-content" }, [h("div", { className: "note", style: { marginTop: "0", marginBottom: "4px" } }, "Los símbolos usados en la entrada aparecerán aquí:"), opGrid])]);
    const tabTextBtn = h("div", { className: state.currentTab === "text" ? "tab active" : "tab" }, "Ajustes (Texto)");
    const tabVisBtn = h("div", { className: state.currentTab === "visual" ? "tab active" : "tab" }, "Editor Visual");
    const tabs = h("div", { className: "tabs" }, [tabTextBtn, tabVisBtn]);
    const btnResetOpts = h("button", { className: "btn warn", title: "Restaura todos los ajustes y mapeos a su valor de fábrica" }, "Restaurar por defecto");
    const viewText = h("div", { className: state.currentTab === "text" ? "view active" : "view" }, [detFmt, detOpts, detBetween, detOps, h("div", { className: "actions", style: { justifyContent: "flex-end", marginTop: "8px" } }, [btnResetOpts])]);
    const visualEditor = h("div", { className: "visual-grid" });
    const btnVisAddRow = h("button", { className: "btn" }, "+ Fila");
    const btnVisRemRow = h("button", { className: "btn" }, "- Fila");
    const btnVisAddCol = h("button", { className: "btn" }, "+ Col");
    const btnVisRemCol = h("button", { className: "btn" }, "- Col");
    const btnVisClear = h("button", { className: "btn warn", title: "Vaciar celdas" }, "Limpiar");
    const btnVisGapRowUp = h("button", { className: "btn", title: "Aumentar espaciado vertical" }, "+ Gap ↕");
    const btnVisGapRowDn = h("button", { className: "btn", title: "Reducir espaciado vertical" }, "- Gap ↕");
    const btnVisGapColUp = h("button", { className: "btn", title: "Aumentar espaciado horizontal" }, "+ Gap ↔");
    const btnVisGapColDn = h("button", { className: "btn", title: "Reducir espaciado horizontal" }, "- Gap ↔");
    const visToolbar1 = h("div", { className: "actions", style: { flexWrap: "wrap" } }, [btnVisAddRow, btnVisRemRow, btnVisAddCol, btnVisRemCol, btnVisClear]);
    const visToolbar2 = h("div", { className: "actions", style: { marginBottom: "8px", flexWrap: "wrap" } }, [btnVisGapRowUp, btnVisGapRowDn, btnVisGapColUp, btnVisGapColDn]);
    const viewVis = h("div", { className: state.currentTab === "visual" ? "view active" : "view" }, [h("div", { className: "note" }, "Modifica las celdas de la matriz/array directamente:"), visToolbar1, visToolbar2, visualEditor]);
    const zoomRange = h("input", { type: "range", min: "70", max: "150", step: "5", style: { width: "80px" } });
    const zoomLabel = h("span", { style: { fontSize: "11px", color: "#888" } }, "100%");
    const footer = h("div", { className: "row-flex", style: { padding: "8px 12px", borderTop: "1px solid #333", background: "#222" } }, [h("span", { className: "label-head" }, "ZOOM:"), zoomRange, zoomLabel]);
    const panel = h("div", { className: "panel" });
    const scrollArea = h("div", { className: "scroll-area" });
    const zoomWrapper = h("div", { className: "zoom-wrapper" }, [sectionInput, sectionOutput, tabs, viewText, viewVis]);
    scrollArea.appendChild(zoomWrapper);
    panel.appendChild(header);
    panel.appendChild(scrollArea);
    panel.appendChild(footer);
    root.appendChild(style);
    root.appendChild(panel);
    panel.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const active = root.activeElement;
        if (active && (active === inputTA || active.classList.contains("visual-cell"))) return;
        e.preventDefault();
        btnUndo.click();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        btnCopy.click();
      }
    });
    state.elements = { host, root, panel, input: inputTA, preview: previewTA, btnCopy, btnPaste, btnClear, btnUndo, btnClose, btnFull, parenStatus, zoomWrapper, zoomRange, zoomLabel, selFormat, inpArrayN, inpAlign, inpRowSep, inpColSep, chkPreserveLB, chkInsertQuad, chkFrac, inpAtomicLen, chkAutoLR, inpLRN, chkDontRewrap, chkNoAccents, decRadios: [radDecDot, radDecCom], wrapRadios: [radWrapIn, radWrapDis], selNumOpColon, selNumOpX, opGrid, tabTextBtn, tabVisBtn, viewText, viewVis, visualEditor, btnVisAddRow, btnVisRemRow, btnVisAddCol, btnVisRemCol, btnVisGapRowUp, btnVisGapRowDn, btnVisGapColUp, btnVisGapColDn, btnResetOpts };
    makeDraggable(host, header);
    state.resizeObserver = new ResizeObserver(() => {
      if (!state.fullscreen) StorageService.saveGeom(host);
    });
    state.resizeObserver.observe(host);
    const updateZoom = (val) => {
      state.zoom = val;
      zoomWrapper.style.transform = `scale(${val})`;
      zoomWrapper.style.width = `${100 / val}%`;
      zoomLabel.textContent = `${Math.round(val * 100)}%`;
      zoomRange.value = String(Math.round(val * 100));
      StorageService.saveZoom(val);
    };
    zoomRange.addEventListener("input", () => updateZoom(parseInt(zoomRange.value, 10) / 100));
    panel.addEventListener("wheel", (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        updateZoom(clamp(state.zoom + Math.sign(e.deltaY) * -0.05, 0.7, 1.5));
      }
    });
    tabTextBtn.addEventListener("click", () => {
      tabTextBtn.classList.add("active");
      tabVisBtn.classList.remove("active");
      viewText.classList.add("active");
      viewVis.classList.remove("active");
      state.currentTab = "text";
    });
    btnResetOpts.addEventListener("click", () => {
      if (confirm("¿Restaurar todas las opciones por defecto? Se perderán tus mapeos personalizados.")) {
        state.opts = structuredClone(DEFAULT_OPTS);
        StorageService.saveOpts(state.opts);
        loadOptsIntoUI();
        safeApplyPreview();
        toast(root, "Opciones restauradas");
      }
    });
    tabVisBtn.addEventListener("click", () => {
      tabVisBtn.classList.add("active");
      tabTextBtn.classList.remove("active");
      viewVis.classList.add("active");
      viewText.classList.remove("active");
      state.currentTab = "visual";
      updateVisualEditor();
    });
    btnClose.addEventListener("click", closePanel);
    btnFull.addEventListener("click", toggleFullscreen);
    btnCopy.addEventListener("click", copyPreview);
    btnPaste.addEventListener("click", async () => {
      try {
        let text = await navigator.clipboard.readText();
        if (text) {
          state.previousInput = inputTA.value;
          if (isLatexWrapped(text)) text = decompileLatexToPlainText(text);
          inputTA.value = text;
          safeApplyPreview();
        }
      } catch (e) {
        console.error("[LaTeX Converter] Err clipboard:", e);
        toast(root, "Error portapapeles", true);
      }
    });
    btnClear.addEventListener("click", () => {
      if (inputTA.value) state.previousInput = inputTA.value;
      inputTA.value = "";
      safeApplyPreview();
    });
    btnUndo.addEventListener("click", () => {
      const temp = inputTA.value;
      inputTA.value = state.previousInput;
      state.previousInput = temp;
      safeApplyPreview();
      inputTA.style.borderColor = "#4CAF50";
      setTimeout(() => {
        if (inputTA) inputTA.style.borderColor = "";
      }, 400);
    });
    const modifyGrid = (action) => {
      if (action.startsWith("gap-")) {
        if (action === "gap-row-up") state.opts.arrayRowSep += 2;
        else if (action === "gap-row-dn") state.opts.arrayRowSep = Math.max(0, state.opts.arrayRowSep - 2);
        else if (action === "gap-col-up") state.opts.arrayColSep += 2;
        else if (action === "gap-col-dn") state.opts.arrayColSep = Math.max(0, state.opts.arrayColSep - 2);
        if (inpRowSep) inpRowSep.value = String(state.opts.arrayRowSep);
        if (inpColSep) inpColSep.value = String(state.opts.arrayColSep);
        StorageService.saveOpts(state.opts);
        safeApplyPreview();
        return;
      }
      const raw = inputTA.value || "";
      if (isLatexWrapped(raw)) {
        toast(root, "Descompila el LaTeX primero", true);
        return;
      }
      state.previousInput = raw;
      let s = decodeEntities(raw);
      s = normalizeUnicodeOperators(s);
      if (state.opts.removeDiacritics) s = stripDiacritics(s);
      let blocks = extractIncisoBlocks(s, state.opts);
      let cols = Math.max(1, state.opts.arrayN || 2);
      let rows = Math.ceil(blocks.length / cols);
      if (blocks.length === 0) {
        blocks = Array(cols).fill("");
        rows = 1;
      }
      if (action === "add-row") {
        for (let i = 0; i < cols; i++) blocks.push("");
      } else if (action === "rem-row" && rows > 1) {
        blocks.splice(-cols, cols);
      } else if (action === "add-col") {
        const newBlocks = [];
        for (let r = 0; r < rows; r++) {
          newBlocks.push(...blocks.slice(r * cols, r * cols + cols));
          newBlocks.push("");
        }
        blocks = newBlocks;
        cols++;
      } else if (action === "rem-col" && cols > 1) {
        const newBlocks = [];
        const overflow = [];
        for (let r = 0; r < rows; r++) {
          newBlocks.push(...blocks.slice(r * cols, r * cols + cols - 1));
          const last = blocks[r * cols + cols - 1];
          if (last !== void 0 && last.trim() !== "") overflow.push(last);
        }
        blocks = [...newBlocks, ...overflow];
        cols--;
      } else if (action === "clear") {
        blocks = Array(rows * cols).fill("");
      }
      state.opts.arrayN = cols;
      let currentAlign = (state.opts.arrayAlign || "").replace(/\s+/g, "");
      if (currentAlign.length < cols) currentAlign += "l".repeat(cols - currentAlign.length);
      else if (currentAlign.length > cols) currentAlign = currentAlign.slice(0, cols);
      state.opts.arrayAlign = currentAlign;
      if (inpArrayN) inpArrayN.value = String(cols);
      if (inpAlign) inpAlign.value = state.opts.arrayAlign;
      StorageService.saveOpts(state.opts);
      inputTA.value = blocks.join("\n");
      safeApplyPreview();
    };
    btnVisAddRow.addEventListener("click", () => modifyGrid("add-row"));
    btnVisRemRow.addEventListener("click", () => modifyGrid("rem-row"));
    btnVisAddCol.addEventListener("click", () => modifyGrid("add-col"));
    btnVisRemCol.addEventListener("click", () => modifyGrid("rem-col"));
    btnVisClear.addEventListener("click", () => modifyGrid("clear"));
    btnVisGapRowUp.addEventListener("click", () => modifyGrid("gap-row-up"));
    btnVisGapRowDn.addEventListener("click", () => modifyGrid("gap-row-dn"));
    btnVisGapColUp.addEventListener("click", () => modifyGrid("gap-col-up"));
    btnVisGapColDn.addEventListener("click", () => modifyGrid("gap-col-dn"));
    let inputTimeout;
    inputTA.addEventListener("input", () => {
      clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        if (isLatexWrapped(inputTA.value)) {
          const envMatch = inputTA.value.match(/\\begin\{(pmatrix|bmatrix|vmatrix|Bmatrix|Vmatrix|cases|aligned|gathered|array)\}/);
          if (envMatch && state.elements.selFormat) {
            let fmt = envMatch[1];
            if (fmt === "array") fmt = "arrayN";
            state.elements.selFormat.value = fmt;
            state.opts.format = fmt;
            StorageService.saveOpts(state.opts);
          }
          state.previousInput = inputTA.value;
          inputTA.value = decompileLatexToPlainText(inputTA.value);
          inputTA.style.borderColor = "#2196F3";
          setTimeout(() => {
            if (inputTA) inputTA.style.borderColor = "";
          }, 400);
        }
        safeApplyPreview();
      }, 150);
    });
    loadOptsIntoUI();
    updateZoom(state.zoom);
    refreshDetectedOperators();
    safeApplyPreview();
    const handleOptsChange = (e) => {
      const t = e.target;
      if (!t || t === inputTA || t.tagName === "BUTTON") return;
      const isTextOrNum = t.tagName === "INPUT" && ["text", "number"].includes(t.type);
      if (e.type === "input" && isTextOrNum) {
        saveOptsFromUI();
        safeApplyPreview();
      }
      if (e.type === "change" && !isTextOrNum) {
        saveOptsFromUI();
        safeApplyPreview();
      }
    };
    zoomWrapper.addEventListener("change", handleOptsChange);
    zoomWrapper.addEventListener("input", handleOptsChange);
  }
  function closePanel() {
    if (state.elements.input) state.currentInput = state.elements.input.value;
    state.panelOpen = false;
    if (state.elements.host) state.elements.host.remove();
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
      state.resizeObserver = null;
    }
    state.cleanups.forEach((cleanupFn) => cleanupFn());
    state.cleanups = [];
    state.elements = {};
  }
  function safeApplyPreview() {
    if (!state.elements.input || !state.elements.preview || !state.elements.parenStatus || !state.elements.root) return;
    try {
      const raw = state.elements.input.value || "";
      const latex = convertSelectionToLatexOneLine(raw, state.opts);
      state.elements.preview.value = latex;
      const bal = balanceReport(excludeTextBlocks(latex));
      state.elements.parenStatus.textContent = `Bal: ${bal.ok ? "OK" : "ERR"}`;
      state.elements.parenStatus.className = bal.ok ? "badge ok" : "badge warn";
      state.elements.parenStatus.title = bal.msg;
      state.elements.preview.style.borderColor = bal.ok ? "" : "#ef5350";
      state.elements.preview.style.boxShadow = bal.ok ? "" : "0 0 6px rgba(239, 83, 80, 0.4)";
      refreshDetectedOperators();
      if (state.currentTab === "visual" && !state.isVisualEditing) updateVisualEditor();
    } catch (e) {
      console.error("[LaTeX Converter] Err:", e);
      toast(state.elements.root, "Error conversión", true);
    }
  }
  function updateVisualEditor() {
    const el = state.elements;
    if (!el.visualEditor || !el.input) return;
    removeChildren(el.visualEditor);
    const raw = el.input.value || "";
    if (isLatexWrapped(raw)) {
      el.visualEditor.appendChild(h("div", { className: "note", style: { color: "#fb8" } }, "⚠️ El editor visual interactivo requiere texto plano. Descompila la matriz pegándola o editándola brevemente en la Entrada."));
      return;
    }
    let s = decodeEntities(raw);
    s = normalizeUnicodeOperators(s);
    if (state.opts.removeDiacritics) s = stripDiacritics(s);
    let blocks = extractIncisoBlocks(s, state.opts);
    if (blocks.length === 0) {
      el.visualEditor.appendChild(h("div", { className: "note" }, "No hay datos para visualizar."));
      return;
    }
    let cols = Math.max(1, state.opts.arrayN || 2);
    el.visualEditor.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    el.visualEditor.style.rowGap = `calc(6px + ${state.opts.arrayRowSep || 0}pt)`;
    el.visualEditor.style.columnGap = `calc(6px + ${state.opts.arrayColSep || 0}pt)`;
    updateVisTooltips();
    const validateCell = (wrapper, text) => {
      try {
        const latex = convertSelectionToLatexOneLine(text, state.opts);
        const bal = balanceReport(excludeTextBlocks(latex));
        wrapper.style.borderColor = bal.ok ? "" : "#ef5350";
        wrapper.style.backgroundColor = bal.ok ? "" : "rgba(239, 83, 80, 0.15)";
        wrapper.title = bal.ok ? "" : `Error: Desbalanceo detectado (${bal.msg})`;
      } catch (e) {
        wrapper.style.borderColor = "#ef5350";
        wrapper.style.backgroundColor = "rgba(239, 83, 80, 0.15)";
      }
    };
    const moveFocus = (currentIdx, step) => {
      const cells = el.visualEditor.querySelectorAll(".visual-cell");
      const target = cells[currentIdx + step];
      if (target) {
        target.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(target);
          sel.collapseToEnd();
        }
      }
    };
    let draggedIdx = null;
    blocks.forEach((blk, idx) => {
      const wrapper = h("div", { className: "visual-cell-wrapper" });
      const handle = h("div", { className: "visual-drag-handle", title: "Arrastrar" }, "⠿");
      const cell = h("div", { className: "visual-cell", contentEditable: "true", dataset: { placeholder: "↵ (Vacío)" } });
      cell.textContent = blk;
      validateCell(wrapper, blk);
      wrapper.appendChild(handle);
      wrapper.appendChild(cell);
      cell.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveFocus(idx, -cols);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          moveFocus(idx, cols);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          moveFocus(idx, 1);
        }
      });
      cell.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") || "";
        if (!text) return;
        const pastedRows = text.split(/\r?\n/).filter((r) => r.trim() !== "");
        const matrix = pastedRows.map((r) => r.split("	"));
        if (matrix.length === 1 && matrix[0].length === 1) {
          document.execCommand("insertText", false, text);
          return;
        }
        state.previousInput = el.input.value;
        let rows = Math.ceil(blocks.length / cols);
        const startRow = Math.floor(idx / cols);
        const startCol = idx % cols;
        const reqCols = startCol + matrix[0].length;
        if (reqCols > cols) {
          const newBlocks = [];
          for (let r = 0; r < rows; r++) {
            newBlocks.push(...blocks.slice(r * cols, r * cols + cols));
            for (let c = 0; c < reqCols - cols; c++) newBlocks.push("");
          }
          blocks = newBlocks;
          cols = reqCols;
          state.opts.arrayN = cols;
          let currentAlign = (state.opts.arrayAlign || "").replace(/\s+/g, "");
          if (currentAlign.length < cols) currentAlign += "l".repeat(cols - currentAlign.length);
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
            for (let c = 0; c < cols; c++) blocks.push("");
          }
        }
        for (let r = 0; r < matrix.length; r++) {
          for (let c = 0; c < matrix[r].length; c++) {
            const targetIdx = (startRow + r) * cols + (startCol + c);
            blocks[targetIdx] = matrix[r][c].trim();
          }
        }
        el.input.value = blocks.join("\n");
        safeApplyPreview();
      });
      handle.addEventListener("mousedown", () => wrapper.setAttribute("draggable", "true"));
      handle.addEventListener("mouseup", () => wrapper.removeAttribute("draggable"));
      handle.addEventListener("mouseleave", () => wrapper.removeAttribute("draggable"));
      cell.addEventListener("input", () => {
        state.isVisualEditing = true;
        const newText = cell.textContent || "";
        blocks[idx] = newText;
        validateCell(wrapper, newText);
        el.input.value = blocks.join("\n");
        safeApplyPreview();
        state.isVisualEditing = false;
      });
      wrapper.addEventListener("dragstart", (e) => {
        draggedIdx = idx;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        setTimeout(() => wrapper.style.opacity = "0.4", 0);
      });
      wrapper.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        wrapper.classList.add("drag-over");
      });
      wrapper.addEventListener("dragleave", () => {
        wrapper.classList.remove("drag-over");
        validateCell(wrapper, blocks[idx]);
      });
      wrapper.addEventListener("drop", (e) => {
        e.preventDefault();
        wrapper.classList.remove("drag-over");
        if (draggedIdx !== null && draggedIdx !== idx) {
          state.previousInput = el.input.value;
          const item = blocks.splice(draggedIdx, 1)[0];
          blocks.splice(idx, 0, item);
          el.input.value = blocks.join("\n");
          safeApplyPreview();
        } else {
          validateCell(wrapper, blocks[idx]);
        }
      });
      wrapper.addEventListener("dragend", () => {
        wrapper.style.opacity = "1";
        wrapper.removeAttribute("draggable");
        draggedIdx = null;
      });
      el.visualEditor.appendChild(wrapper);
    });
  }
  function updateVisTooltips() {
    const el = state.elements;
    if (!el.btnVisAddRow || !el.input) return;
    const raw = el.input.value || "";
    let s = decodeEntities(raw);
    s = normalizeUnicodeOperators(s);
    if (state.opts.removeDiacritics) s = stripDiacritics(s);
    const blocks = extractIncisoBlocks(s, state.opts);
    const cols = Math.max(1, state.opts.arrayN || 2);
    const rows = Math.max(1, Math.ceil(blocks.length / cols));
    const rowSep = state.opts.arrayRowSep || 0;
    const colSep = state.opts.arrayColSep || 0;
    el.btnVisAddRow.title = `Añadir fila (Actual: ${rows})`;
    el.btnVisRemRow.title = `Eliminar fila (Actual: ${rows})`;
    el.btnVisAddCol.title = `Añadir columna (Actual: ${cols})`;
    el.btnVisRemCol.title = `Eliminar columna (Actual: ${cols})`;
    el.btnVisGapRowUp.title = `Aumentar espaciado vertical (Actual: ${rowSep}pt)`;
    el.btnVisGapRowDn.title = `Reducir espaciado vertical (Actual: ${rowSep}pt)`;
    el.btnVisGapColUp.title = `Aumentar espaciado horizontal (Actual: ${colSep}pt)`;
    el.btnVisGapColDn.title = `Reducir espaciado horizontal (Actual: ${colSep}pt)`;
  }
  function copyPreview() {
    if (!state.elements.preview || !state.elements.root) return;
    const txt = state.elements.preview.value;
    if (!txt) return;
    const fallbackCopy = () => {
      try {
        state.elements.preview.select();
        const successful = document.execCommand("copy");
        if (successful) toast(state.elements.root, "Copiado! (Fallback)");
        else toast(state.elements.root, "Error al copiar", true);
      } catch (err) {
        console.error("[LaTeX Converter] Fallback copy failed:", err);
        toast(state.elements.root, "Error crítico al copiar", true);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast(state.elements.root, "Copiado!")).catch((err) => {
        console.warn("[LaTeX Converter] Clipboard API failed, trying fallback:", err);
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }
  }
  function makeDraggable(el, handle) {
    let isDragging = false, startX = 0, startY = 0, initLeft = 0, initTop = 0;
    const onMouseDown = (e) => {
      if (state.fullscreen) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const r = el.getBoundingClientRect();
      initLeft = r.left;
      initTop = r.top;
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      let newLeft = initLeft + (e.clientX - startX);
      let newTop = initTop + (e.clientY - startY);
      const minLeft = -el.offsetWidth + 50;
      const maxLeft = window.innerWidth - 50;
      const minTop = 0;
      const maxTop = window.innerHeight - 30;
      el.style.left = clamp(newLeft, minLeft, maxLeft) + "px";
      el.style.top = clamp(newTop, minTop, maxTop) + "px";
    };
    const onMouseUp = () => {
      if (isDragging) StorageService.saveGeom(el);
      isDragging = false;
    };
    handle.addEventListener("mousedown", onMouseDown);
    handle.addEventListener("dblclick", resetPanelPosition);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    state.cleanups.push(() => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    });
  }
  function setRadio(list, val) {
    list.forEach((r) => r.checked = r.value === val);
  }
  function getRadio(list) {
    const f = list.find((r) => r.checked);
    return f ? f.value : null;
  }
  function loadOptsIntoUI() {
    const o = state.opts;
    const el = state.elements;
    if (!el.selFormat || !el.decRadios || !el.wrapRadios) return;
    el.selFormat.value = o.format || "line";
    el.inpArrayN.value = String(o.arrayN);
    el.inpAlign.value = o.arrayAlign || "ll";
    el.inpRowSep.value = String(o.arrayRowSep || 0);
    el.inpColSep.value = String(o.arrayColSep || 0);
    el.chkPreserveLB.checked = !!o.preserveLineBreaks;
    el.chkInsertQuad.checked = !!o.insertQuadBetweenBlocks;
    el.chkFrac.checked = !!o.fracAtomic;
    el.inpAtomicLen.value = String(o.atomicMaxLen || 2);
    el.chkAutoLR.checked = !!o.autoLeftRight;
    el.inpLRN.value = String(o.autoLeftRightThreshold || 20);
    el.chkDontRewrap.checked = !!o.dontRewrapIfHasDollar;
    el.chkNoAccents.checked = !!o.removeDiacritics;
    setRadio(el.decRadios, o.decimal);
    setRadio(el.wrapRadios, o.wrapMode);
    el.selNumOpColon.value = o.numOpNumOverride[":"] || "\\times";
    el.selNumOpX.value = o.numOpNumOverride["x"] || "\\times";
  }
  function saveOptsFromUI() {
    const el = state.elements;
    const o = state.opts;
    if (!el.selFormat || !el.decRadios || !el.wrapRadios) return;
    o.format = el.selFormat.value || "line";
    o.arrayN = Math.max(1, parseInt(el.inpArrayN.value || "2", 10));
    o.arrayAlign = (el.inpAlign.value || "l".repeat(o.arrayN)).trim();
    o.arrayRowSep = Math.max(0, parseInt(el.inpRowSep.value || "0", 10));
    o.arrayColSep = Math.max(0, parseInt(el.inpColSep.value || "0", 10));
    o.preserveLineBreaks = !!el.chkPreserveLB.checked;
    o.insertQuadBetweenBlocks = !!el.chkInsertQuad.checked;
    o.fracAtomic = !!el.chkFrac.checked;
    o.atomicMaxLen = Math.max(1, parseInt(el.inpAtomicLen.value || "2", 10));
    o.autoLeftRight = !!el.chkAutoLR.checked;
    o.autoLeftRightThreshold = Math.max(1, parseInt(el.inpLRN.value || "20", 10));
    o.dontRewrapIfHasDollar = !!el.chkDontRewrap.checked;
    o.removeDiacritics = !!el.chkNoAccents.checked;
    o.decimal = getRadio(el.decRadios) || ".";
    o.wrapMode = getRadio(el.wrapRadios) || "display";
    o.numOpNumOverride[":"] = el.selNumOpColon.value;
    o.numOpNumOverride["x"] = el.selNumOpX.value;
    el.opGrid.querySelectorAll(".op-sel").forEach((s) => {
      o.opMap[s.dataset.op] = s.value;
    });
    StorageService.saveOpts(o);
  }
  function applyFullscreenGeom(host) {
    Object.assign(host.style, { left: "0", top: "0", width: "100vw", height: "100vh", borderRadius: "0" });
    host.setAttribute("data-fullscreen", "1");
  }
  function toggleFullscreen() {
    state.fullscreen = !state.fullscreen;
    StorageService.saveFullscreen(state.fullscreen);
    closePanel();
    openPanel();
  }
  function refreshDetectedOperators() {
    const el = state.elements;
    if (!el.input || !el.opGrid) return;
    const set = detectOperators(normalizeUnicodeOperators(decodeEntities(el.input.value || "")));
    removeChildren(el.opGrid);
    ["*", "/", "x", "÷", "·", ":", "+", "-", "^", "=", "<", ">", "≤", "≥", "≠", "≈"].forEach((op) => {
      if (!set.has(op)) return;
      const sel = h("select", { className: "op-sel", dataset: { op }, style: { width: "100%" } }, opOptionsFor(op).map(([v, l]) => h("option", { value: v }, l)));
      sel.value = state.opts.opMap[op] || defaultMapFor(op);
      el.opGrid.appendChild(h("div", { style: { display: "flex", flexDirection: "column" } }, [h("span", { style: { fontSize: "10px", color: "#888" } }, `Op "${op}"`), sel]));
    });
  }
  const EDGE_ID = "tm-latex-launcher-btn";
  let bootTimer = null;
  let triedBoots = 0;
  const MAX_BOOT_TRIES = 60;
  function startBootLoop() {
    if (bootTimer) return;
    bootTimer = setInterval(() => {
      triedBoots++;
      try {
        ensureEdgeButton();
      } catch (err) {
        console.error("[LaTeX Converter] Error during boot:", err);
      }
      if (document.readyState === "complete" || triedBoots >= MAX_BOOT_TRIES) {
        if (bootTimer) clearInterval(bootTimer);
        bootTimer = null;
      }
    }, 500);
    window.addEventListener("popstate", ensureEdgeButton, true);
    document.addEventListener("keydown", handleKeydown, true);
    const mo = new MutationObserver(() => {
      if (!document.getElementById(EDGE_ID)) setTimeout(ensureEdgeButton, 100);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  function handleKeydown(ev) {
    if (ev.altKey && (ev.key === "l" || ev.key === "L")) {
      ev.preventDefault();
      togglePanel();
    }
    if (state.panelOpen && ev.key === "Escape") {
      ev.stopPropagation();
      closePanel();
    }
  }
  function ensureEdgeButton() {
    if (!document.body || document.getElementById(EDGE_ID)) return;
    if (!document.getElementById("tm-latex-print-style")) {
      document.head.appendChild(h("style", { id: "tm-latex-print-style" }, `@media print { #${EDGE_ID}, tm-latex-panel-host { display: none !important; } }`));
    }
    const edgeBtn = h("button", {
      id: EDGE_ID,
      title: "Abrir LaTeX Converter (Alt+L) | Clic derecho para reiniciar posición",
      style: {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: "999999",
        padding: "12px 20px",
        backgroundColor: "#FF5722",
        color: "white",
        border: "none",
        cursor: "pointer",
        borderRadius: "30px",
        fontWeight: "600",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        transition: "all 0.2s ease",
        opacity: "0.6",
        userSelect: "none"
      }
    }, "LaTeX ⧉");
    edgeBtn.addEventListener("mouseenter", () => {
      Object.assign(edgeBtn.style, { transform: "translateY(-2px)", opacity: "1", backgroundColor: "#E64A19", boxShadow: "0 6px 16px rgba(0,0,0,0.4)" });
    });
    edgeBtn.addEventListener("mouseleave", () => {
      Object.assign(edgeBtn.style, { transform: "translateY(0)", opacity: "0.6", backgroundColor: "#FF5722", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" });
    });
    edgeBtn.addEventListener("click", togglePanel);
    edgeBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      resetPanelPosition();
    });
    document.body.appendChild(edgeBtn);
  }
  function bootstrap() {
    try {
      console.info("[LaTeX Converter] Inicializando módulos...");
      startBootLoop();
    } catch (error) {
      console.error("[LaTeX Converter] Error crítico durante la inicialización (bootstrap):", error);
    }
  }
  bootstrap();

})();