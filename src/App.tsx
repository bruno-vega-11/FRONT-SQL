import { useState, useRef, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ParsedPoint {
  raw: string;
  type: "POINT";
  x: number;
  y: number;
}

type ParsedCell = string | ParsedPoint;

interface ParsedTable {
  columns: string[];
  rows: Record<string, ParsedCell>[];
  total: number | null;
  executionTimeNs: number | null;
}

interface ParsedResponse {
  operation: string;
  raw: string;
  executionTimeNs: number | null;
  total: number | null;
  table: ParsedTable | null;
  rtreeViz: RTreeVizResponse | null;
}

interface ParserResult {
  query?: string;
  ok?: boolean;
  returncode?: number | null;
  stdout?: string;
  stderr?: string;
  tokens: string;
  ast: string;
  output: string;
  error: string | null;
  parsed?: ParsedResponse;
}
interface ParsedTokenRow {
  type: string;
  value: string;
}
interface CsvFile {
  name: string;
  rows: string[][];
  headers: string[];
}

interface RidValue {
  page: number;
  slot: number;
}

interface RTreePoint {
  rid: RidValue;
  ridPacked: number;
  x: number;
  y: number;
  selected: boolean;
  distance: number;
  rank: number | null;
  row?: Record<string, ParsedCell>;
}

interface RTreeVizResponse {
  type: "rangeSearch" | "kNN";
  query: {
    x: number;
    y: number;
    radio: number | null;
    k: number | null;
  };
  resultRids?: Array<{
    page: number;
    slot: number;
    ridPacked: number;
  }>;
  resultIds?: number[];
  io?: {
    reads: number;
    writes: number;
  };
  points: RTreePoint[];
}

// ── Token parsing ─────────────────────────────────────────────────────────────
function parseTokens(raw: string): ParsedTokenRow[] {
  const regex = /TOKEN\(([^,)]+)(?:,\s*"([^"]*)")?\)/g;
  const rows: ParsedTokenRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(raw)) !== null) {
    rows.push({ type: m[1].trim(), value: m[2] ?? "" });
  }
  return rows;
}

// ── CSV parsing ───────────────────────────────────────────────────────────────
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (l: string) => l.split(",").map((v) => v.trim());
  const headers = split(lines[0]);
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map(split);
  return { headers, rows };
}

function extraerJsonBalanceado(
  texto: string,
  inicioBusqueda: number,
): string | null {
  const inicio = texto.indexOf("{", inicioBusqueda);
  if (inicio === -1) return null;

  let profundidad = 0;
  let enString = false;
  let escape = false;

  for (let i = inicio; i < texto.length; i++) {
    const ch = texto[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      enString = !enString;
      continue;
    }

    if (enString) continue;

    if (ch === "{") profundidad++;
    if (ch === "}") profundidad--;

    if (profundidad === 0) {
      return texto.slice(inicio, i + 1);
    }
  }

  return null;
}

function esRespuestaRTree(data: any): data is RTreeVizResponse {
  return (
    data &&
    (data.type === "rangeSearch" || data.type === "kNN") &&
    data.query &&
    typeof data.query.x === "number" &&
    typeof data.query.y === "number" &&
    Array.isArray(data.points)
  );
}

function parseRTreeVizFromOutput(output: string): RTreeVizResponse | null {
  const limpio = output.trim();

  try {
    const directo = JSON.parse(limpio);
    if (esRespuestaRTree(directo)) return directo;
  } catch {
    // El output puede venir con texto antes del JSON.
  }

  const markers = [
    "JSON RangeSearch para frontend:",
    "JSON kNN para frontend:",
  ];

  const posiciones = markers
    .map((marker) => ({
      marker,
      index: output.lastIndexOf(marker),
    }))
    .filter((item) => item.index !== -1)
    .sort((a, b) => b.index - a.index);

  for (const item of posiciones) {
    const jsonTexto = extraerJsonBalanceado(
      output,
      item.index + item.marker.length,
    );

    if (!jsonTexto) continue;

    try {
      const data = JSON.parse(jsonTexto);
      if (esRespuestaRTree(data)) return data;
    } catch {
      // Sigue intentando con otro marcador.
    }
  }

  return null;
}

// ── SQL syntax highlight ──────────────────────────────────────────────────────
const KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "DROP",
  "ALTER",
  "ADD",
  "INDEX",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "BETWEEN",
  "ORDER",
  "BY",
  "GROUP",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "DISTINCT",
  "ALL",
  "UNION",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "UNIQUE",
  "DEFAULT",
  "CONSTRAINT",
  "DATABASE",
  "USE",
  "SHOW",
  "DESCRIBE",
  "TRUNCATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "INCREMENTAL",
  "INT",
  "CHAR",
  "FLOAT",
  "EHASH",
  "BTREE",
  "RTREE",
  "POINT",
  "RADIUS",
  "K",
  "STRING",
  "AUTOINCREMENTAL",
]);

function highlightSQL(code: string): React.ReactNode[] {
  const tokenRe =
    /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]\w*|\d+(?:\.\d+)?|[^\s\w])/g;
  const parts: React.ReactNode[] = [];
  let last = 0,
    key = 0;
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
    parts.push(
      cls ? (
        <span key={key++} className={cls}>
          {tok}
        </span>
      ) : (
        tok
      ),
    );
    last = m.index + tok.length;
  }
  if (last < code.length) parts.push(code.slice(last));
  return parts;
}

// ── Token color map ───────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  SELECT: "#7C6FFF",
  FROM: "#7C6FFF",
  WHERE: "#7C6FFF",
  INSERT: "#7C6FFF",
  INTO: "#7C6FFF",
  VALUES: "#7C6FFF",
  UPDATE: "#7C6FFF",
  DELETE: "#7C6FFF",
  CREATE: "#7C6FFF",
  TABLE: "#7C6FFF",
  DROP: "#7C6FFF",
  ID: "#38BDF8",
  STRING: "#4ADE80",
  NUMBER: "#FB923C",
  PCOMA: "#94A3B8",
  COMA: "#94A3B8",
  LPAREN: "#94A3B8",
  RPAREN: "#94A3B8",
  END: "#475569",
  SET: "#7C6FFF",
  BETWEEN: "#7C6FFF",
  AND: "#7C6FFF",
  IN: "#7C6FFF",
  POINT: "#7C6FFF",
  RADIUS: "#7C6FFF",
  K: "#7C6FFF",
  INDEX: "#7C6FFF",
  EHASH: "#7C6FFF",
  BTREE: "#7C6FFF",
  RTREE: "#7C6FFF",
  INT: "#4ADE80",
  FLOAT: "#4ADE80",
  AUTOINCREMENTAL: "#4ADE80",
};
const tokenColor = (t: string) => TYPE_COLORS[t] ?? "#E2E8F0";

type Tab = "output" | "tokens" | "ast";

function renderParsedCell(value: ParsedCell): string {
  if (value && typeof value === "object" && value.type === "POINT") {
    return value.raw;
  }

  return String(value ?? "");
}

function ParsedResultTable({ table }: { table: ParsedTable }) {
  return (
    <div className="parsed-table-wrap">
      <table className="parsed-table">
        <thead>
          <tr>
            {table.columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {table.columns.map((col) => (
                <td key={col}>{renderParsedCell(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="parsed-summary">
        <span>
          Filas mostradas: <b>{table.rows.length}</b>
        </span>

        {table.total != null && (
          <span>
            Total: <b>{table.total}</b>
          </span>
        )}

        {table.executionTimeNs != null && (
          <span>
            Tiempo: <b>{table.executionTimeNs} ns</b>
          </span>
        )}
      </div>
    </div>
  );
}

function SpatialPlane({ data }: { data: RTreeVizResponse }) {
  const width = 720;
  const height = 440;
  const padding = 54;

  const puntos = data.points;
  const query = data.query;

  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);

  xs.push(query.x);
  ys.push(query.y);

  if (data.type === "rangeSearch" && query.radio != null) {
    xs.push(query.x - query.radio, query.x + query.radio);
    ys.push(query.y - query.radio, query.y + query.radio);
  }

  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1;
  const maxY = Math.max(...ys) + 1;

  const rangoX = Math.max(maxX - minX, 1);
  const rangoY = Math.max(maxY - minY, 1);

  const scale = Math.min(
    (width - 2 * padding) / rangoX,
    (height - 2 * padding) / rangoY,
  );

  const dibujoAncho = rangoX * scale;
  const dibujoAlto = rangoY * scale;

  const offsetX = (width - dibujoAncho) / 2;
  const offsetY = (height - dibujoAlto) / 2;

  const sx = (x: number) => offsetX + (x - minX) * scale;
  const sy = (y: number) => height - offsetY - (y - minY) * scale;

  const querySvgX = sx(query.x);
  const querySvgY = sy(query.y);

  const resultadoTexto =
    data.resultRids?.map((r) => `(${r.page},${r.slot})`).join(", ") ??
    data.resultIds?.join(", ") ??
    "—";

  return (
    <div className="spatial-card">
      <div className="spatial-head">
        <div>
          <div className="spatial-title">Visualización gráfica en el plano</div>
          <div className="spatial-sub">
            {data.type === "rangeSearch"
              ? `Range Search: centro (${query.x}, ${query.y}), radio ${query.radio}`
              : `kNN: punto (${query.x}, ${query.y}), k = ${query.k}`}
          </div>
        </div>

        <div className="spatial-io">
          <span>Reads: {data.io?.reads ?? 0}</span>
          <span>Writes: {data.io?.writes ?? 0}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="spatial-svg"
        role="img"
        aria-label="Plano de resultados RTree"
      >
        {/* Fondo */}
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="12"
          className="plane-bg"
        />

        {/* Ejes */}
        <line
          x1={offsetX}
          y1={height - offsetY}
          x2={width - offsetX}
          y2={height - offsetY}
          className="axis-line"
        />
        <line
          x1={offsetX}
          y1={offsetY}
          x2={offsetX}
          y2={height - offsetY}
          className="axis-line"
        />

        <text
          x={width - offsetX + 8}
          y={height - offsetY + 4}
          className="axis-label"
        >
          x
        </text>
        <text x={offsetX - 12} y={offsetY - 8} className="axis-label">
          y
        </text>

        {/* Círculo de radio para Range Search */}
        {data.type === "rangeSearch" && query.radio != null && (
          <circle
            cx={querySvgX}
            cy={querySvgY}
            r={query.radio * scale}
            className="range-circle"
          />
        )}

        {/* Líneas para kNN */}
        {data.type === "kNN" &&
          puntos
            .filter((p) => p.selected)
            .map((p) => (
              <line
                key={`line-${p.ridPacked}`}
                x1={querySvgX}
                y1={querySvgY}
                x2={sx(p.x)}
                y2={sy(p.y)}
                className="knn-line"
              />
            ))}

        {/* Puntos */}
        {puntos.map((p) => {
          const px = sx(p.x);
          const py = sy(p.y);

          return (
            <g key={p.ridPacked}>
              <circle
                cx={px}
                cy={py}
                r={p.selected ? 7 : 5}
                className={p.selected ? "point-selected" : "point-normal"}
              />

              <text x={px + 10} y={py - 10} className="point-label">
                RID({p.rid.page},{p.rid.slot})
                {p.rank != null ? ` #${p.rank}` : ""}
              </text>

              <text x={px + 10} y={py + 8} className="point-coord">
                ({p.x}, {p.y}) d={p.distance.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Punto de consulta */}
        <circle cx={querySvgX} cy={querySvgY} r="9" className="query-point" />

        <text x={querySvgX + 12} y={querySvgY + 4} className="query-label">
          Query ({query.x}, {query.y})
        </text>
      </svg>

      <div className="spatial-footer">
        <span className="legend-item">
          <span className="legend-dot selected" /> Resultado
        </span>
        <span className="legend-item">
          <span className="legend-dot normal" /> No seleccionado
        </span>
        <span className="legend-item">
          <span className="legend-dot query" /> Punto de consulta
        </span>
        <span className="spatial-results">RIDs: {resultadoTexto}</span>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState(
    `CREATE TABLE hola FROM ("data.csv") (
    id INT PRIMARY KEY,
    dni INT,
    nombre STRING,
    edad INT,
    genero STRING,
    altura FLOAT
);`,
  );
  const [result, setResult] = useState<ParserResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setTab] = useState<Tab>("output");
  const [error, setError] = useState<string | null>(null);
  const [csvFiles, setCsvFiles] = useState<CsvFile[]>([]);
  const [activeCsv, setActiveCsv] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [rtreeViz, setRtreeViz] = useState<RTreeVizResponse | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const s = el.selectionStart,
      en = el.selectionEnd;
    const next = query.slice(0, s) + "    " + query.slice(en);
    setQuery(next);
    requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
  };

  // ── Upload CSV ──────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg(null);

    const formData = new FormData();
    const newCsvs: CsvFile[] = [];

    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".csv")) continue;
      formData.append("file", file, file.name);
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      newCsvs.push({ name: file.name, headers, rows });
    }

    try {
      const res = await fetch("http://localhost:3000/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        setCsvFiles((prev) => {
          const names = new Set(prev.map((c) => c.name));
          return [...prev, ...newCsvs.filter((c) => !names.has(c.name))];
        });
        if (newCsvs.length > 0) setActiveCsv(newCsvs[0].name);
        setUploadMsg(`✓ ${data.files.join(", ")} guardado en archivos/`);
      } else {
        setUploadMsg(`✗ ${data.error}`);
      }
    } catch {
      setUploadMsg("✗ Error al conectar con el servidor");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Run parser ──────────────────────────────────────────────────────────────
  const runParser = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:3000/", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ParserResult = await res.json();
      setResult(data);

      const viz = data.parsed?.rtreeViz ?? parseRTreeVizFromOutput(data.output);
      setRtreeViz(viz);

      if (data.error) setError(data.error);
      setTab("output");
    } catch (e: any) {
      setError(e.message ?? "Error al conectar con el servidor");
      setResult(null);
      setRtreeViz(null);
    } finally {
      setLoading(false);
    }
  };

  const tokens = result ? parseTokens(result.tokens) : [];
  const activeCsvData = csvFiles.find((c) => c.name === activeCsv);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=DM+Sans:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0B0F19; font-family: 'DM Sans', sans-serif; color: #E2E8F0; min-height: 100vh; }
        .app { max-width: 1100px; margin: 0 auto; padding: 24px 20px 48px; display: flex; flex-direction: column; gap: 20px; }

        /* header */
        .header { display: flex; align-items: center; justify-content: space-between; }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo-dot { width: 10px; height: 10px; border-radius: 50%; background: #7C6FFF; box-shadow: 0 0 10px #7C6FFF88; }
        .logo-text { font-family: 'JetBrains Mono', monospace; font-size: 15px; font-weight: 600; color: #CBD5E1; letter-spacing: 0.04em; }
        .logo-sub { font-size: 11px; color: #475569; margin-top: 1px; font-family: 'JetBrains Mono', monospace; }
        .run-btn { display: flex; align-items: center; gap: 8px; background: #7C6FFF; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background 0.15s, transform 0.1s; }
        .run-btn:hover:not(:disabled) { background: #6A5FEE; }
        .run-btn:active:not(:disabled) { transform: scale(0.97); }
        .run-btn:disabled { opacity: 0.5; cursor: default; }

        /* csv */
        .csv-section { background: #111827; border: 1px solid #1E293B; border-radius: 12px; overflow: hidden; }
        .csv-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #1E293B; }
        .csv-title { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; }
        .csv-actions { display: flex; align-items: center; gap: 10px; }
        .upload-btn { display: flex; align-items: center; gap: 6px; background: #1E293B; color: #94A3B8; border: 1px solid #334155; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: background 0.15s, color 0.15s; }
        .upload-btn:hover:not(:disabled) { background: #263344; color: #CBD5E1; }
        .upload-btn:disabled { opacity: 0.5; cursor: default; }
        .upload-msg { font-size: 11px; font-family: 'JetBrains Mono', monospace; }
        .upload-msg.ok  { color: #4ADE80; }
        .upload-msg.err { color: #F87171; }
        .csv-tabs { display: flex; gap: 4px; padding: 8px 16px; border-bottom: 1px solid #1E293B; flex-wrap: wrap; }
        .csv-tab { padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; border: 1px solid transparent; font-family: 'JetBrains Mono', monospace; background: transparent; color: #475569; transition: all 0.15s; }
        .csv-tab.active { background: #1E293B; color: #38BDF8; border-color: #334155; }
        .csv-tab:hover:not(.active) { color: #94A3B8; }
        .csv-body { overflow: auto; max-height: 220px; }
        .csv-empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 32px; color: #334155; font-size: 13px; }
        .csv-badge { display: inline-block; background: #0F172A; border: 1px solid #1E293B; border-radius: 4px; padding: 1px 6px; color: #64748B; font-size: 10px; margin-left: 6px; }
        .csv-table { width: 100%; border-collapse: collapse; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
        .csv-table th { position: sticky; top: 0; background: #0F172A; color: #7C6FFF; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 12px; text-align: left; border-bottom: 1px solid #1E293B; font-weight: 600; }
        .csv-table td { padding: 6px 12px; border-bottom: 1px solid #0F172A; color: #94A3B8; }
        .csv-table tr:hover td { background: #161D2E; }
        .csv-row-num { color: #334155 !important; user-select: none; width: 32px; }

        /* editor */
        .editor-wrap { background: #111827; border: 1px solid #1E293B; border-radius: 12px; overflow: hidden; }
        .editor-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #1E293B; }
        .editor-label { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; }
        .dots { display: flex; gap: 6px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; }
        .dot-r { background: #EF4444; opacity: 0.6; }
        .dot-y { background: #F59E0B; opacity: 0.6; }
        .dot-g { background: #10B981; opacity: 0.6; }
        .editor-body { position: relative; height: 200px; overflow: hidden; }
        .hl-layer, .editor-ta { position: absolute; inset: 0; padding: 14px 16px; font-family: 'JetBrains Mono', monospace; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; tab-size: 4; overflow: auto; }
        .hl-layer { color: #E2E8F0; pointer-events: none; z-index: 1; background: transparent; }
        .editor-ta { background: transparent; color: transparent; caret-color: #E2E8F0; border: none; outline: none; resize: none; z-index: 2; -webkit-text-fill-color: transparent; }
        .hl-keyword { color: #7C6FFF; font-weight: 600; }
        .hl-string  { color: #4ADE80; }
        .hl-number  { color: #FB923C; }
        .hl-comment { color: #475569; font-style: italic; }
        .hl-ident   { color: #38BDF8; }
        .hl-punct   { color: #94A3B8; }

        /* error */
        .error-banner { background: #1E0A0A; border: 1px solid #7F1D1D; border-radius: 8px; padding: 10px 14px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #FCA5A5; display: flex; gap: 8px; }

        /* results */
        .results { background: #111827; border: 1px solid #1E293B; border-radius: 12px; overflow: hidden; }
        .tabs { display: flex; border-bottom: 1px solid #1E293B; }
        .tab-btn { padding: 10px 18px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; background: transparent; color: #475569; font-family: 'DM Sans', sans-serif; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; margin-bottom: -1px; }
        .tab-btn.active { color: #7C6FFF; border-bottom-color: #7C6FFF; }
        .tab-btn:hover:not(.active) { color: #94A3B8; }
        .tab-count { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; background: #1E293B; font-size: 10px; margin-left: 6px; color: #7C6FFF; }
        .tab-pane { padding: 16px; min-height: 180px; }

        /* output */
        .output-wrap { background: #0B0F19; border-radius: 8px; border: 1px solid #1E293B; overflow: auto; max-height: 360px; }
        .output-code { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #94A3B8; padding: 14px 16px; white-space: pre; line-height: 1.8; }
        .out-ok   { color: #4ADE80; }
        .out-err  { color: #F87171; }
        .out-info { color: #38BDF8; }
        .out-time { color: #FB923C; }


        .parsed-table-wrap {
  background: #0B0F19;
  border: 1px solid #1E293B;
  border-radius: 8px;
  overflow: auto;
  max-height: 360px;
}

.parsed-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.parsed-table th {
  position: sticky;
  top: 0;
  background: #0F172A;
  color: #7C6FFF;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid #1E293B;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.parsed-table td {
  padding: 7px 12px;
  border-bottom: 1px solid #1E293B;
  color: #CBD5E1;
  white-space: nowrap;
}

.parsed-table tr:hover td {
  background: #161D2E;
}

.parsed-summary {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-top: 1px solid #1E293B;
  color: #64748B;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}

.parsed-summary b {
  color: #E2E8F0;
}

        /* token table */
        .token-table { width: 100%; border-collapse: collapse; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
        .token-table th { text-align: left; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 12px 10px; font-weight: 500; }
        .token-table td { padding: 7px 12px; border-top: 1px solid #1E293B; vertical-align: middle; }
        .token-table tr:hover td { background: #161D2E; }
        .token-row-num { color: #334155; user-select: none; width: 32px; }
        .type-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; background: #1E293B; }
        .token-value code { background: #1E293B; padding: 1px 6px; border-radius: 4px; color: #CBD5E1; }

        /* ast */
        .ast-wrap { background: #0B0F19; border-radius: 8px; border: 1px solid #1E293B; overflow: auto; max-height: 320px; }
        .ast-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #64748B; padding: 14px 16px; white-space: pre; line-height: 1.7; }

        /* empty */
        .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 140px; color: #334155; }
        .empty-icon { font-size: 28px; opacity: 0.4; }
        .empty-text { font-size: 13px; }

        /* spatial plane */
.spatial-card {
  margin-top: 14px;
  background: #0B0F19;
  border: 1px solid #1E293B;
  border-radius: 12px;
  padding: 14px;
}

.spatial-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.spatial-title {
  font-size: 14px;
  font-weight: 700;
  color: #E2E8F0;
}

.spatial-sub {
  margin-top: 3px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #64748B;
}

.spatial-io {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #94A3B8;
}

.spatial-io span {
  background: #111827;
  border: 1px solid #1E293B;
  border-radius: 6px;
  padding: 4px 8px;
}

.spatial-svg {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 12px;
  border: 1px solid #1E293B;
}

.plane-bg {
  fill: #020617;
}

.axis-line {
  stroke: #334155;
  stroke-width: 1.2;
}

.axis-label {
  fill: #64748B;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}

.range-circle {
  fill: rgba(124, 111, 255, 0.08);
  stroke: #7C6FFF;
  stroke-width: 2;
  stroke-dasharray: 6 5;
}

.knn-line {
  stroke: #38BDF8;
  stroke-width: 1.5;
  stroke-dasharray: 5 5;
  opacity: 0.75;
}

.point-selected {
  fill: #38BDF8;
  stroke: #E0F2FE;
  stroke-width: 2;
}

.point-normal {
  fill: #475569;
  stroke: #94A3B8;
  stroke-width: 1.5;
  opacity: 0.8;
}

.query-point {
  fill: #FB923C;
  stroke: #FED7AA;
  stroke-width: 2;
}

.point-label {
  fill: #E2E8F0;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}

.point-coord {
  fill: #64748B;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
}

.query-label {
  fill: #FED7AA;
  font-size: 11px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
}

.spatial-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #94A3B8;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  display: inline-block;
}

.legend-dot.selected {
  background: #38BDF8;
}

.legend-dot.normal {
  background: #475569;
}

.legend-dot.query {
  background: #FB923C;
}

.spatial-results {
  margin-left: auto;
  color: #CBD5E1;
}

@media (max-width: 640px) {
  .spatial-head {
    flex-direction: column;
  }

  .spatial-results {
    margin-left: 0;
    width: 100%;
  }
}

        /* spinner */
        .spinner { width: 14px; height: 14px; border: 2px solid #ffffff44; border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="app">
        {/* ── Header ── */}
        <header className="header">
          <div className="logo">
            <div className="logo-dot" />
            <div>
              <div className="logo-text">sql_parser</div>
              <div className="logo-sub">editor + visualizador</div>
            </div>
          </div>
          <button className="run-btn" onClick={runParser} disabled={loading}>
            {loading ? (
              <>
                <div className="spinner" /> Ejecutando…
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
                </svg>
                Ejecutar
              </>
            )}
          </button>
        </header>

        {/* ── CSV Upload ── */}
        <div className="csv-section">
          <div className="csv-header">
            <span className="csv-title">
              archivos CSV
              {csvFiles.length > 0 && (
                <span className="csv-badge">{csvFiles.length}</span>
              )}
            </span>
            <div className="csv-actions">
              {uploadMsg && (
                <span
                  className={`upload-msg ${uploadMsg.startsWith("✓") ? "ok" : "err"}`}
                >
                  {uploadMsg}
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                multiple
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <button
                className="upload-btn"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <div
                      className="spinner"
                      style={{ borderTopColor: "#94A3B8" }}
                    />{" "}
                    Subiendo…
                  </>
                ) : (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 1v9M4 5l4-4 4 4M2 13v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
                    </svg>
                    Subir CSV
                  </>
                )}
              </button>
            </div>
          </div>

          {csvFiles.length > 0 && (
            <div className="csv-tabs">
              {csvFiles.map((f) => (
                <button
                  key={f.name}
                  className={`csv-tab ${activeCsv === f.name ? "active" : ""}`}
                  onClick={() => setActiveCsv(f.name)}
                >
                  {f.name}
                  <span
                    style={{ color: "#334155", marginLeft: 4, fontSize: 10 }}
                  >
                    {f.rows.length} filas
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="csv-body">
            {!activeCsvData ? (
              <div className="csv-empty">
                <span style={{ fontSize: 20, opacity: 0.4 }}>⬆</span>
                <span>Sube un CSV para usarlo en tus queries</span>
              </div>
            ) : (
              <table className="csv-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {activeCsvData.headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeCsvData.rows.slice(0, 100).map((row, i) => (
                    <tr key={i}>
                      <td className="csv-row-num">{i + 1}</td>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                  {activeCsvData.rows.length > 100 && (
                    <tr>
                      <td
                        colSpan={activeCsvData.headers.length + 1}
                        style={{
                          textAlign: "center",
                          color: "#334155",
                          padding: "8px",
                          fontSize: 11,
                        }}
                      >
                        … {activeCsvData.rows.length - 100} filas más
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Editor SQL ── */}
        <div className="editor-wrap">
          <div className="editor-bar">
            <div className="dots">
              <div className="dot dot-r" />
              <div className="dot dot-y" />
              <div className="dot dot-g" />
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
              onChange={(e) => setQuery(e.target.value)}
              onScroll={syncScroll}
              onKeyDown={handleTab}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="Escribe tu query SQL aquí…"
            />
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="error-banner">
            <span style={{ color: "#EF4444", flexShrink: 0 }}>✖</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Results ── */}
        <div className="results">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === "output" ? "active" : ""}`}
              onClick={() => setTab("output")}
            >
              Resultado
            </button>
            <button
              className={`tab-btn ${activeTab === "tokens" ? "active" : ""}`}
              onClick={() => setTab("tokens")}
            >
              Tokens
              {tokens.length > 0 && (
                <span className="tab-count">{tokens.length}</span>
              )}
            </button>
            <button
              className={`tab-btn ${activeTab === "ast" ? "active" : ""}`}
              onClick={() => setTab("ast")}
            >
              AST{" "}
              <span style={{ fontSize: 10, color: "#334155", marginLeft: 4 }}>
                .dot
              </span>
            </button>
          </div>

          <div className="tab-pane">
            {/* Tokens */}
            {activeTab === "output" &&
              (!result ? (
                <div className="empty">
                  <div className="empty-icon">◈</div>
                  <div className="empty-text">
                    Ejecuta una query para ver el resultado
                  </div>
                </div>
              ) : (
                <>
                  {result.parsed?.table ? (
                    <ParsedResultTable table={result.parsed.table} />
                  ) : result.output ? (
                    <div className="output-wrap">
                      <pre className="output-code">
                        {result.output.split("\n").map((line, i) => {
                          const l = line.toLowerCase();
                          let cls = "";

                          if (l.includes("error") || l.includes("no se pudo"))
                            cls = "out-err";
                          else if (
                            l.includes("creada") ||
                            l.includes("insertado") ||
                            l.includes("eliminado") ||
                            l.includes("exitoso")
                          )
                            cls = "out-ok";
                          else if (
                            l.includes("btree") ||
                            l.includes("rtree") ||
                            l.includes("sequential") ||
                            l.includes("scan") ||
                            l.includes("search") ||
                            l.includes("total")
                          )
                            cls = "out-info";
                          else if (
                            l.includes("tiempo") ||
                            l.includes(" ns") ||
                            l.includes(" ms")
                          )
                            cls = "out-time";

                          return (
                            <span key={i} className={cls}>
                              {line}
                              {"\n"}
                            </span>
                          );
                        })}
                      </pre>
                    </div>
                  ) : (
                    <div className="empty">
                      <div className="empty-icon">◈</div>
                      <div className="empty-text">
                        No hay salida para mostrar
                      </div>
                    </div>
                  )}

                  {rtreeViz && <SpatialPlane data={rtreeViz} />}
                </>
              ))}

            {/* AST */}
            {activeTab === "ast" &&
              (!result?.ast ? (
                <div className="empty">
                  <div className="empty-icon">◈</div>
                  <div className="empty-text">
                    Ejecuta una query para ver el AST
                  </div>
                </div>
              ) : (
                <div className="ast-wrap">
                  <pre className="ast-code">{result.ast}</pre>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
