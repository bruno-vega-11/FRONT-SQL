import { useState, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Token {
  type: string;
  value: string;
}
interface ParserResult {
  tokens: string;       // raw stdout de ejecutar_scanner
  ast: string;          // contenido de ast.dot
  error: string | null;
}
interface ParsedTokenRow {
  type: string;
  value: string;
}

// ── Token parsing ─────────────────────────────────────────────────────────────
// Formato: TOKEN(SELECT, "select") TOKEN(*, "*") TOKEN(END)
function parseTokens(raw: string): ParsedTokenRow[] {
  const regex = /TOKEN\(([^,)]+)(?:,\s*"([^"]*)")?\)/g;
  const rows: ParsedTokenRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(raw)) !== null) {
    rows.push({ type: m[1].trim(), value: m[2] ?? "" });
  }
  return rows;
}

// ── SQL syntax highlight ──────────────────────────────────────────────────────
const KEYWORDS = new Set([
  "SELECT","FROM","WHERE","INSERT","INTO","VALUES","UPDATE","SET",
  "DELETE","CREATE","TABLE","DROP","ALTER","ADD","INDEX","JOIN",
  "LEFT","RIGHT","INNER","OUTER","ON","AS","AND","OR","NOT","IN",
  "IS","NULL","LIKE","BETWEEN","ORDER","BY","GROUP","HAVING","LIMIT",
  "OFFSET","DISTINCT","ALL","UNION","EXISTS","CASE","WHEN","THEN","ELSE","END",
  "PRIMARY","KEY","FOREIGN","REFERENCES","UNIQUE","DEFAULT","CONSTRAINT",
  "DATABASE","USE","SHOW","DESCRIBE","TRUNCATE","BEGIN","COMMIT","ROLLBACK",
]);

function highlightSQL(code: string): React.ReactNode[] {
  const tokenRe = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]\w*|\d+(?:\.\d+)?|[^\s\w])/g;
  const parts: React.ReactNode[] = [];
  let last = 0, key = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(code)) !== null) {
    if (m.index > last) parts.push(code.slice(last, m.index));
    const tok = m[0];
    let cls = "";
    if (tok.startsWith("'") || tok.startsWith('"')) cls = "hl-string";
    else if (tok.startsWith("--") || tok.startsWith("/*")) cls = "hl-comment";
    else if (/^\d/.test(tok)) cls = "hl-number";
    else if (KEYWORDS.has(tok.toUpperCase())) cls = "hl-keyword";
    else if (/^[A-Za-z_]\w*$/.test(tok)) cls = "hl-ident";
    else if (/^[(),;*=<>!+\-/%]/.test(tok)) cls = "hl-punct";
    parts.push(cls ? <span key={key++} className={cls}>{tok}</span> : tok);
    last = m.index + tok.length;
  }
  if (last < code.length) parts.push(code.slice(last));
  return parts;
}

// ── Token type color map ──────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  SELECT:"#7C6FFF", FROM:"#7C6FFF", WHERE:"#7C6FFF", INSERT:"#7C6FFF",
  INTO:"#7C6FFF", VALUES:"#7C6FFF", UPDATE:"#7C6FFF", DELETE:"#7C6FFF",
  CREATE:"#7C6FFF", TABLE:"#7C6FFF", DROP:"#7C6FFF",
  ID:"#38BDF8", STRING:"#4ADE80", NUMBER:"#FB923C",
  PCOMA:"#94A3B8", COMA:"#94A3B8", LPAREN:"#94A3B8", RPAREN:"#94A3B8",
  END:"#475569",
};
function tokenColor(type: string) {
  return TYPE_COLORS[type] ?? "#E2E8F0";
}

// ── Main component ────────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery]       = useState("SELECT * FROM employees;\n");
  const [result, setResult]     = useState<ParserResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [activeTab, setTab]     = useState<"tokens"|"ast">("tokens");
  const [error, setError]       = useState<string | null>(null);
  const textareaRef             = useRef<HTMLTextAreaElement>(null);
  const highlightRef            = useRef<HTMLDivElement>(null);

  // sync scroll between textarea and highlight layer
  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop  = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const s = el.selectionStart, en = el.selectionEnd;
    const next = query.slice(0, s) + "    " + query.slice(en);
    setQuery(next);
    requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
  };

  const runParser = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:3000", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ParserResult = await res.json();
      setResult(data);
      if (data.error) setError(data.error);
    } catch (e: any) {
      setError(e.message ?? "Error al conectar con el servidor");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const tokens = result ? parseTokens(result.tokens) : [];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=DM+Sans:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0B0F19; font-family: 'DM Sans', sans-serif; color: #E2E8F0; min-height: 100vh; }

        .app { display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; max-width: 1100px; margin: 0 auto; padding: 24px 20px 32px; gap: 20px; }

        /* ── header ── */
        .header { display: flex; align-items: center; justify-content: space-between; }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo-dot { width: 10px; height: 10px; border-radius: 50%; background: #7C6FFF; box-shadow: 0 0 10px #7C6FFF88; }
        .logo-text { font-family: 'JetBrains Mono', monospace; font-size: 15px; font-weight: 600; color: #CBD5E1; letter-spacing: 0.04em; }
        .logo-sub { font-size: 11px; color: #475569; margin-top: 1px; font-family: 'JetBrains Mono', monospace; }
        .run-btn {
          display: flex; align-items: center; gap: 8px;
          background: #7C6FFF; color: #fff; border: none; border-radius: 8px;
          padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer;
          font-family: 'DM Sans', sans-serif; letter-spacing: 0.02em;
          transition: background 0.15s, transform 0.1s, opacity 0.15s;
        }
        .run-btn:hover:not(:disabled) { background: #6A5FEE; }
        .run-btn:active:not(:disabled) { transform: scale(0.97); }
        .run-btn:disabled { opacity: 0.5; cursor: default; }
        .run-icon { width: 14px; height: 14px; }

        /* ── editor ── */
        .editor-wrap {
          background: #111827; border: 1px solid #1E293B; border-radius: 12px;
          overflow: hidden; display: flex; flex-direction: column;
        }
        .editor-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 16px; border-bottom: 1px solid #1E293B;
        }
        .editor-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; }
        .dots { display: flex; gap: 6px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; }
        .dot-r { background: #EF4444; opacity: 0.6; }
        .dot-y { background: #F59E0B; opacity: 0.6; }
        .dot-g { background: #10B981; opacity: 0.6; }

        .editor-body { position: relative; height: 200px; overflow: hidden; }
        .hl-layer, .editor-ta {
          position: absolute; inset: 0; padding: 14px 16px;
          font-family: 'JetBrains Mono', monospace; font-size: 14px;
          line-height: 1.7; white-space: pre-wrap; word-break: break-all;
          tab-size: 4; overflow: auto;
        }
        .hl-layer {
          color: #E2E8F0; pointer-events: none; z-index: 1;
          background: transparent;
        }
        .editor-ta {
          background: transparent; color: transparent; caret-color: #E2E8F0;
          border: none; outline: none; resize: none; z-index: 2;
          -webkit-text-fill-color: transparent;
        }
        .hl-keyword { color: #7C6FFF; font-weight: 600; }
        .hl-string  { color: #4ADE80; }
        .hl-number  { color: #FB923C; }
        .hl-comment { color: #475569; font-style: italic; }
        .hl-ident   { color: #38BDF8; }
        .hl-punct   { color: #94A3B8; }

        /* ── error banner ── */
        .error-banner {
          background: #1E0A0A; border: 1px solid #7F1D1D; border-radius: 8px;
          padding: 10px 14px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: #FCA5A5; display: flex; gap: 8px; align-items: flex-start;
        }
        .error-icon { flex-shrink: 0; color: #EF4444; margin-top: 1px; }

        /* ── results ── */
        .results { display: flex; flex-direction: column; gap: 0; background: #111827; border: 1px solid #1E293B; border-radius: 12px; overflow: hidden; }
        .tabs { display: flex; border-bottom: 1px solid #1E293B; }
        .tab-btn {
          padding: 10px 18px; font-size: 13px; font-weight: 500; cursor: pointer;
          border: none; background: transparent; color: #475569;
          font-family: 'DM Sans', sans-serif; border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s; margin-bottom: -1px;
        }
        .tab-btn.active { color: #7C6FFF; border-bottom-color: #7C6FFF; }
        .tab-btn:hover:not(.active) { color: #94A3B8; }
        .tab-count { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; background: #1E293B; font-size: 10px; margin-left: 6px; color: #7C6FFF; }

        .tab-pane { padding: 16px; min-height: 180px; }

        /* ── token table ── */
        .token-table { width: 100%; border-collapse: collapse; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
        .token-table th { text-align: left; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 12px 10px; font-weight: 500; }
        .token-table td { padding: 7px 12px; border-top: 1px solid #1E293B; vertical-align: middle; }
        .token-table tr:hover td { background: #161D2E; }
        .token-row-num { color: #334155; user-select: none; width: 32px; }
        .type-badge {
          display: inline-block; padding: 2px 8px; border-radius: 4px;
          font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
          background: #1E293B;
        }
        .token-value { color: #94A3B8; }
        .token-value code { background: #1E293B; padding: 1px 6px; border-radius: 4px; color: #CBD5E1; }

        /* ── ast ── */
        .ast-wrap { background: #0B0F19; border-radius: 8px; border: 1px solid #1E293B; overflow: auto; max-height: 320px; }
        .ast-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #64748B; padding: 14px 16px; white-space: pre; line-height: 1.7; }
        .ast-code .dot-kw  { color: #7C6FFF; }
        .ast-code .dot-str { color: #4ADE80; }
        .ast-code .dot-num { color: #38BDF8; }

        /* ── empty state ── */
        .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 140px; color: #334155; }
        .empty-icon { font-size: 28px; opacity: 0.4; }
        .empty-text { font-size: 13px; }

        /* ── loader ── */
        .spinner { width: 14px; height: 14px; border: 2px solid #ffffff44; border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="app">
        {/* Header */}
        <header className="header">
          <div className="logo">
            <div className="logo-dot" />
            <div>
              <div className="logo-text">sql_parser</div>
              <div className="logo-sub">editor + visualizador</div>
            </div>
          </div>
          <button className="run-btn" onClick={runParser} disabled={loading}>
            {loading
              ? <><div className="spinner" /> Ejecutando…</>
              : <><svg className="run-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5l10 5.5-10 5.5V2.5z"/></svg>Ejecutar</>
            }
          </button>
        </header>

        {/* Editor */}
        <div className="editor-wrap">
          <div className="editor-bar">
            <div className="dots">
              <div className="dot dot-r"/><div className="dot dot-y"/><div className="dot dot-g"/>
            </div>
            <span className="editor-label">query.sql</span>
          </div>
          <div className="editor-body">
            <div className="hl-layer" ref={highlightRef} aria-hidden="true">
              {highlightSQL(query)}
            </div>
            <textarea
              ref={textareaRef}
              className="editor-ta"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onScroll={syncScroll}
              onKeyDown={handleTab}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="Escribe tu query SQL aquí…"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="error-banner">
            <span className="error-icon">✖</span>
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        <div className="results">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === "tokens" ? "active" : ""}`}
              onClick={() => setTab("tokens")}
            >
              Tokens
              {tokens.length > 0 && <span className="tab-count">{tokens.length}</span>}
            </button>
            <button
              className={`tab-btn ${activeTab === "ast" ? "active" : ""}`}
              onClick={() => setTab("ast")}
            >
              AST <span style={{fontSize:10, color:"#334155", marginLeft:4}}>.dot</span>
            </button>
          </div>

          <div className="tab-pane">
            {activeTab === "tokens" && (
              tokens.length === 0
                ? <div className="empty">
                    <div className="empty-icon">◈</div>
                    <div className="empty-text">Ejecuta una query para ver los tokens</div>
                  </div>
                : <table className="token-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Tipo</th>
                        <th>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.map((tok, i) => (
                        <tr key={i}>
                          <td className="token-row-num">{i + 1}</td>
                          <td>
                            <span
                              className="type-badge"
                              style={{ color: tokenColor(tok.type) }}
                            >
                              {tok.type}
                            </span>
                          </td>
                          <td className="token-value">
                            {tok.value ? <code>{tok.value}</code> : <span style={{color:"#334155"}}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
            )}

            {activeTab === "ast" && (
              !result?.ast
                ? <div className="empty">
                    <div className="empty-icon">◈</div>
                    <div className="empty-text">Ejecuta una query para ver el AST</div>
                  </div>
                : <div className="ast-wrap">
                    <pre className="ast-code">{result.ast}</pre>
                  </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}