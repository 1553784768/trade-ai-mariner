from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class ApiException(Exception):
    def __init__(self, status, code, message, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details


def error_response(status, code, message, details=None):
    error = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse({"error": error}, status_code=status)


def register_errors(app):
    @app.exception_handler(ApiException)
    async def api_error(request: Request, exc: ApiException):
        from mariner.localization import translate
        message = translate(exc.message) if request.query_params.get("lang") == "en" else exc.message
        details = exc.details
        if request.query_params.get("lang") == "en" and isinstance(details, list):
            details = [{**d, "message": translate(d["message"])} if isinstance(d, dict) and "message" in d else d for d in details]
        return error_response(exc.status, exc.code, message, details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return error_response(400, "BAD_REQUEST", "Invalid request parameters" if request.query_params.get("lang") == "en" else "请求参数不合法")

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        from mariner.localization import translate
        message = "登录已过期，请重新登录。" if exc.status_code == 401 else str(exc.detail)
        if request.query_params.get("lang") == "en":
            message = translate(message)
        return error_response(exc.status_code, {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT"}.get(exc.status_code, "BAD_REQUEST"), message)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        return error_response(500, "INTERNAL", "Internal server error" if request.query_params.get("lang") == "en" else "服务器内部错误")
