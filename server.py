
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json
import os
import re


# ── Paths ──────────────────────────────────────────────────────────────
BASE_DIR = r"C:\Users\USUARIO\CLionProjects\proy_bd2_final"
PARSER_EXE = os.path.join(BASE_DIR, "cmake-build-debug", "ProyectoCompleto.exe")

INPUT_DIR = os.path.join(BASE_DIR, "input")
INPUT_FILE = os.path.join(INPUT_DIR, "input.txt")

TOKENS_FILE = os.path.join(BASE_DIR, "outputs", "tokens.txt")
AST_FILE = os.path.join(BASE_DIR, "outputs", "ast.dot")
OUTPUT_FILE = os.path.join(BASE_DIR, "outputs", "output.txt")
ARCHIVOS_DIR = os.path.join(BASE_DIR, "archivos")
# ───────────────────────────────────────────────────────────────────────


def detectar_operacion(query):
    q = query.strip().upper()

    # Primero detectamos RTree, porque NO queremos romper esa parte
    if "SELECT" in q and "POINT" in q and re.search(r"\bK\b", q):
        return "SELECT_KNN"

    if "SELECT" in q and "POINT" in q and re.search(r"\bRADIUS\b", q):
        return "SELECT_RANGE"

    # Si el bloque tiene SELECT normal, priorizamos mostrar tabla
    if "SELECT" in q:
        if "BETWEEN" in q:
            return "SELECT_BETWEEN"
        if " WHERE " in q:
            return "SELECT_WHERE"
        return "SELECT"

    # Luego el resto de operaciones normales
    if "CREATE INDEX" in q:
        if re.search(r"\bRTREE\b", q):
            return "CREATE_INDEX_RTREE"
        if re.search(r"\bBTREE\b", q):
            return "CREATE_INDEX_BTREE"
        if re.search(r"\bEHASH\b", q):
            return "CREATE_INDEX_EHASH"
        return "CREATE_INDEX"

    if "CREATE TABLE" in q:
        return "CREATE_TABLE"

    if "INSERT" in q:
        return "INSERT"

    if "DELETE" in q:
        return "DELETE"

    return "UNKNOWN"

def parse_execution_time(output):
    match = re.search(r"Tiempo de ejecución:\s*(\d+)\s*ns", output)
    if not match:
        return None
    return int(match.group(1))


def parse_total(output):
    match = re.search(r"Total:\s*(\d+)\s*registros", output)
    if not match:
        return None
    return int(match.group(1))


def parse_point(value):
    match = re.search(r"POINT\(([-\d.]+);([-\d.]+)\)", value)
    if not match:
        return None

    return {
        "x": float(match.group(1)),
        "y": float(match.group(2))
    }


def parse_table_output(output):
    lines = [line.rstrip() for line in output.splitlines() if line.strip()]

    header_index = None

    for i, line in enumerate(lines):
        clean = line.strip()

        if clean.startswith("-"):
            continue

        if clean.startswith("[Metodo:"):
            continue

        if clean.startswith("SequentialFile"):
            continue

        if clean.startswith("Tiempo de ejecución:"):
            continue

        if clean.startswith("Tabla "):
            continue

        if clean.startswith("[CREATE INDEX"):
            continue

        if clean.startswith("Total:"):
            continue

        # Cabecera tipo: id \t nombre \t rating
        if "\t" in clean:
            columns_candidate = [c.strip() for c in clean.split("\t") if c.strip()]

            # Evita confundir filas de datos con cabecera.
            # Una cabecera normalmente tiene nombres, no empieza con número.
            if columns_candidate and not columns_candidate[0].replace(".", "", 1).isdigit():
                header_index = i
                break

    if header_index is None:
        return None

    columns = [c.strip() for c in lines[header_index].split("\t") if c.strip()]
    rows = []

    for line in lines[header_index + 1:]:
        clean = line.strip()

        if not clean:
            continue

        if clean.startswith("-"):
            continue

        if clean.startswith("[Metodo:"):
            continue

        if clean.startswith("Total:"):
            break

        if clean.startswith("Tiempo de ejecución:"):
            break

        if clean.startswith("Tabla "):
            continue

        if clean.startswith("[CREATE INDEX"):
            continue

        values = [v.strip() for v in clean.split("\t") if v.strip() != ""]

        if len(values) != len(columns):
            continue

        row = {}

        for col, val in zip(columns, values):
            point = parse_point(val)

            if point is not None:
                row[col] = {
                    "raw": val,
                    "type": "POINT",
                    "x": point["x"],
                    "y": point["y"]
                }
            else:
                row[col] = val

        rows.append(row)

    return {
        "columns": columns,
        "rows": rows,
        "total": parse_total(output) if parse_total(output) is not None else len(rows),
        "executionTimeNs": parse_execution_time(output)
    }

def parse_rtree_query(query):
    q = query.strip()

    match_knn = re.search(
        r"WHERE\s+(\w+)\s+IN\s*\(\s*POINT\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)\s*,\s*K\s+(\d+)\s*\)",
        q,
        re.IGNORECASE
    )

    if match_knn:
        return {
            "type": "kNN",
            "field": match_knn.group(1),
            "x": float(match_knn.group(2)),
            "y": float(match_knn.group(3)),
            "k": int(match_knn.group(4)),
            "radio": None
        }

    match_radius = re.search(
        r"WHERE\s+(\w+)\s+IN\s*\(\s*POINT\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)\s*,\s*RADIUS\s+([-\d.]+)\s*\)",
        q,
        re.IGNORECASE
    )

    if match_radius:
        return {
            "type": "rangeSearch",
            "field": match_radius.group(1),
            "x": float(match_radius.group(2)),
            "y": float(match_radius.group(3)),
            "k": None,
            "radio": float(match_radius.group(4))
        }

    return None


def build_rtree_viz(query, table_data):
    rtree_query = parse_rtree_query(query)

    if not rtree_query or not table_data:
        return None

    points = []

    for index, row in enumerate(table_data["rows"]):
        point_value = row.get(rtree_query["field"])

        if not isinstance(point_value, dict) or point_value.get("type") != "POINT":
            continue

        x = point_value["x"]
        y = point_value["y"]

        dx = x - rtree_query["x"]
        dy = y - rtree_query["y"]
        distance = (dx * dx + dy * dy) ** 0.5

        points.append({
            "rid": {
                "page": 0,
                "slot": index
            },
            "ridPacked": index,
            "x": x,
            "y": y,
            "selected": False,
            "distance": distance,
            "rank": None,
            "row": row
        })

    if rtree_query["type"] == "kNN":
        ordered = sorted(points, key=lambda p: p["distance"])

        for rank, point in enumerate(ordered[:rtree_query["k"]], start=1):
            point["selected"] = True
            point["rank"] = rank

    elif rtree_query["type"] == "rangeSearch":
        radio = rtree_query["radio"]

        for point in points:
            point["selected"] = point["distance"] <= radio
            point["rank"] = None

    result_rids = [
        {
            "page": p["rid"]["page"],
            "slot": p["rid"]["slot"],
            "ridPacked": p["ridPacked"]
        }
        for p in points
        if p["selected"]
    ]

    return {
        "type": rtree_query["type"],
        "query": {
            "x": rtree_query["x"],
            "y": rtree_query["y"],
            "radio": rtree_query["radio"],
            "k": rtree_query["k"]
        },
        "resultRids": result_rids,
        "io": {
            "reads": 0,
            "writes": 0
        },
        "points": points
    }


def parse_output_to_json(output, query=""):
    operation = detectar_operacion(query)
    table_data = parse_table_output(output)

    parsed = {
        "operation": operation,
        "raw": output,
        "executionTimeNs": parse_execution_time(output),
        "total": parse_total(output),
        "table": table_data,
        "rtreeViz": None
    }

    if operation in ["SELECT_KNN", "SELECT_RANGE"]:
        parsed["rtreeViz"] = build_rtree_viz(query, table_data)

    return parsed


class Handler(BaseHTTPRequestHandler):

    def ejecutar_query_cpp(self, query):
        for path in [TOKENS_FILE, AST_FILE, OUTPUT_FILE]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass

        result = {
            "query": query,
            "ok": False,
            "returncode": None,
            "stdout": "",
            "stderr": "",
            "tokens": "",
            "ast": "",
            "output": "",
            "error": None,
            "parsed": None
        }

        try:
            os.makedirs(INPUT_DIR, exist_ok=True)

            with open(INPUT_FILE, "w", encoding="utf-8") as f:
                f.write(query)

            proc = subprocess.run(
                [PARSER_EXE],
                capture_output=True,
                text=True,
                cwd=os.path.join(BASE_DIR, "cmake-build-debug")
            )

            result["returncode"] = proc.returncode
            result["stdout"] = proc.stdout
            result["stderr"] = proc.stderr

            if os.path.exists(TOKENS_FILE):
                with open(TOKENS_FILE, "r", encoding="utf-8") as f:
                    result["tokens"] = f.read()

            if os.path.exists(AST_FILE):
                with open(AST_FILE, "r", encoding="utf-8") as f:
                    result["ast"] = f.read()

            if os.path.exists(OUTPUT_FILE):
                with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                    result["output"] = f.read()

            if proc.returncode != 0:
                result["error"] = proc.stderr or "El parser terminó con error"

            result["parsed"] = parse_output_to_json(result["output"], query)
            result["ok"] = proc.returncode == 0 and result["error"] is None

        except FileNotFoundError:
            result["error"] = f"No se encontró el ejecutable: {PARSER_EXE}"
            result["parsed"] = parse_output_to_json("", query)

        except Exception as e:
            result["error"] = str(e)
            result["parsed"] = parse_output_to_json("", query)

        return result

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path == "/upload":
            self.handle_upload()
            return

        if self.path == "/test-grammar":
            self.handle_test_grammar()
            return

        if self.path == "/" or self.path == "":
            self.handle_query()
            return

        self._json({"ok": False, "error": "Ruta no encontrada"}, 404)

    def handle_upload(self):
        content_type = self.headers.get("Content-Type", "")

        if "multipart/form-data" not in content_type:
            self._json({"ok": False, "error": "Se esperaba multipart/form-data"}, 400)
            return

        length = int(self.headers["Content-Length"])
        body = self.rfile.read(length)

        boundary = content_type.split("boundary=")[-1].strip().encode()
        parts = body.split(b"--" + boundary)

        saved = []

        for part in parts:
            if b"Content-Disposition" not in part:
                continue

            header_end = part.find(b"\r\n\r\n")
            if header_end == -1:
                continue

            headers_raw = part[:header_end].decode(errors="ignore")
            content = part[header_end + 4:]

            if content.endswith(b"\r\n"):
                content = content[:-2]

            filename = ""

            for h in headers_raw.split("\r\n"):
                if "filename=" in h:
                    filename = h.split("filename=")[-1].strip().strip('"')

            if filename.endswith(".csv") and content:
                os.makedirs(ARCHIVOS_DIR, exist_ok=True)
                dest = os.path.join(ARCHIVOS_DIR, filename)

                with open(dest, "wb") as f:
                    f.write(content)

                saved.append(filename)
                print(f"  CSV guardado: {dest}")

        if saved:
            self._json({
                "ok": True,
                "files": saved,
                "csvDir": ARCHIVOS_DIR
            })
        else:
            self._json({"ok": False, "error": "No se encontró ningún CSV válido"}, 400)

    def handle_test_grammar(self):
        tests = [
            {
                "name": "CREATE TABLE lugares",
                "query": 'CREATE TABLE lugares FROM ("data.csv")(id INT PRIMARY KEY INCREMENTAL,nombre CHAR(20),rating FLOAT,ubicacion POINT);'
            },
            {
                "name": "CREATE INDEX RTREE",
                "query": "CREATE INDEX RTREE ubicacion ON lugares;"
            },
            {
                "name": "SELECT completo",
                "query": "SELECT * FROM lugares;"
            },
            {
                "name": "SELECT kNN",
                "query": "SELECT * FROM lugares WHERE ubicacion IN (POINT(10.0,20.0), K 3);"
            },
            {
                "name": "SELECT RangeSearch",
                "query": "SELECT * FROM lugares WHERE ubicacion IN (POINT(10.0,20.0), RADIUS 5.0);"
            }
        ]

        resultados = []

        for test in tests:
            print(f"\n========== TEST: {test['name']} ==========")
            print(test["query"])

            result = self.ejecutar_query_cpp(test["query"])
            result["name"] = test["name"]

            print(f"returncode: {result['returncode']}")
            print(f"stdout: {repr(result['stdout'])}")
            print(f"stderr: {repr(result['stderr'])}")
            print(f"output: {repr(result['output'])}")

            resultados.append(result)

        self._json({
            "ok": True,
            "total": len(resultados),
            "tests": resultados
        })

    def handle_query(self):
        query = self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8")

        result = self.ejecutar_query_cpp(query)

        print(f"  returncode: {result['returncode']}")
        print(f"  stdout: {repr(result['stdout'])}")
        print(f"  stderr: {repr(result['stderr'])}")
        print(f"  output: {repr(result['output'])}")

        self._json(result)

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()

        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"  → {self.path} {args[0]}")


print("✓ Servidor corriendo en http://localhost:3000")
print(f"  exe:     {PARSER_EXE}")
print(f"  input:   {INPUT_FILE}")
print(f"  tokens:  {TOKENS_FILE}")
print(f"  output:  {OUTPUT_FILE}")
print(f"  ast:     {AST_FILE}")
print(f"  csv dir: {ARCHIVOS_DIR}")

HTTPServer(("localhost", 3000), Handler).serve_forever()