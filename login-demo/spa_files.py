from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse

FRONTEND_MISSING = ("<!doctype html><meta charset='utf-8'><title>Trade AI</title>"
    "<p>前端尚未构建。请在 login-demo/web 目录运行 <code>npm ci</code> 和 <code>npm run build:export</code>，"
    "或使用开发模式 http://127.0.0.1:3000 。</p>")


def mount_spa(app: FastAPI, web_dir: Path) -> None:
    root = Path(web_dir)

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(full_path: str):
        path = full_path.strip("/")
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        base = root.resolve()
        if not (base / "index.html").is_file():
            return HTMLResponse(FRONTEND_MISSING, status_code=503)
        for candidate in ([path, f"{path}.html", f"{path}/index.html"] if path else ["index.html"]):
            target = (base / candidate).resolve()
            if target.is_file() and target.is_relative_to(base):
                status_code = 200
                if target.suffix == ".html":
                    headers = {"Cache-Control": "no-store"}
                    # Next exports notFound() pages as HTML; retain their HTTP status.
                    if b"NEXT_HTTP_ERROR_FALLBACK;404" in target.read_bytes():
                        status_code = 404
                elif "/_next/static/" in target.as_posix():
                    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
                else:
                    headers = {}
                return FileResponse(target, headers=headers, status_code=status_code)
        missing = base / "404.html"
        if missing.is_file():
            return FileResponse(missing, status_code=404)
        return PlainTextResponse("Not Found", 404)
