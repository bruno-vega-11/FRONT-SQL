from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess, json, os

# ── Ajusta estos paths ─────────────────────────────────────────────────
PARSER_DIR  = r"C:\Users\Usuario\Desktop\bd2\Proyecto\cmake-build-debug"
PARSER_EXE  = os.path.join(PARSER_DIR, "Proyecto.exe")   # nombre exacto de tu .exe
INPUT_FILE  = os.path.join(PARSER_DIR, "input1.txt")
AST_FILE    = os.path.join(PARSER_DIR, "ast.dot")
TOKENS_FILE = os.path.join(PARSER_DIR, "input1_tokens.txt")
# ───────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        query = self.rfile.read(int(self.headers["Content-Length"])).decode()
        result = {"tokens": "", "ast": "", "error": None}

        try:
            # 1. Escribe la query en input1.txt
            with open(INPUT_FILE, "w", encoding="utf-8") as f:
                f.write(query)

            # 2. Ejecuta el parser desde su carpeta
            proc = subprocess.run(
                [PARSER_EXE, INPUT_FILE],
                capture_output=True,
                text=True,
                cwd=PARSER_DIR
            )

            print(f"  returncode: {proc.returncode}")
            print(f"  stdout: {repr(proc.stdout)}")
            print(f"  stderr: {repr(proc.stderr)}")
            print(f"  exe existe: {os.path.exists(PARSER_EXE)}")
            print(f"  input existe: {os.path.exists(INPUT_FILE)}")

            # 3. Lee el archivo de tokens
            if os.path.exists(TOKENS_FILE):
                with open(TOKENS_FILE, "r", encoding="utf-8") as f:
                    result["tokens"] = f.read()
            else:
                result["tokens"] = proc.stdout  # fallback

            # 4. Lee el ast.dot
            if os.path.exists(AST_FILE):
                with open(AST_FILE, "r", encoding="utf-8") as f:
                    result["ast"] = f.read()

            # 5. Captura errores del parser
            if proc.returncode != 0:
                result["error"] = proc.stderr or "El parser terminó con error"

        except FileNotFoundError:
            result["error"] = f"No se encontró el ejecutable: {PARSER_EXE}"
        except Exception as e:
            result["error"] = str(e)

        body = json.dumps(result).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"  → {args[0]}")

print("✓ Servidor corriendo en http://localhost:3000")
print(f"  exe:    {PARSER_EXE}")
print(f"  input:  {INPUT_FILE}")
print(f"  tokens: {TOKENS_FILE}")
print(f"  ast:    {AST_FILE}")
HTTPServer(("localhost", 3000), Handler).serve_forever()