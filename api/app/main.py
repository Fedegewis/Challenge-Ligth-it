import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.patients import router as patients_router
from app.validation import (
    FIELDS,
    INVALID_VALUE,
    PHOTO_TOO_LARGE,
    REQUIRED,
    InvalidRegistration,
)

GENERAL_MESSAGE = "Something went wrong. Please try again."
MAX_REQUEST_BYTES = 6 * 1024 * 1024

app = FastAPI(title="Patient Registration API")


def field_errors(errors: dict[str, str]) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"errors": [{"field": f, "message": m} for f, m in errors.items()]},
    )


def message(status_code: int, text: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"message": text})


class BodyTooLarge(Exception):
    pass


class RequestBodyLimit:
    """Caps the request body by Content-Length or, without it, by bytes received."""

    def __init__(self, app: ASGIApp, path: str, max_bytes: int) -> None:
        self.app = app
        self.path = path
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != self.path:
            await self.app(scope, receive, send)
            return

        length = Headers(scope=scope).get("content-length", "")
        if length.isdigit() and int(length) > self.max_bytes:
            await self.reject(scope, receive, send)
            return

        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            event = await receive()
            received += len(event.get("body", b""))
            if received > self.max_bytes:
                exceeded = True
                raise BodyTooLarge
            return event

        async def guarded_send(event: Message) -> None:
            nonlocal response_started
            if exceeded:
                return
            response_started = True
            await send(event)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:
            if not exceeded:
                raise
        if exceeded and not response_started:
            await self.reject(scope, receive, send)

    @staticmethod
    async def reject(scope: Scope, receive: Receive, send: Send) -> None:
        await field_errors({"photo": PHOTO_TOO_LARGE})(scope, receive, send)


app.add_middleware(RequestBodyLimit, path="/patients", max_bytes=MAX_REQUEST_BYTES)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(InvalidRegistration)
async def invalid_registration(_: Request, exc: InvalidRegistration) -> JSONResponse:
    return field_errors(exc.errors)


@app.exception_handler(RequestValidationError)
async def request_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    if any(error["loc"][0] == "path" for error in exc.errors()):
        return message(404, "Not Found")
    errors: dict[str, str] = {}
    for error in exc.errors():
        loc = error["loc"]
        if len(loc) > 1 and loc[1] in FIELDS:
            errors.setdefault(loc[1], REQUIRED if error["type"] == "missing" else INVALID_VALUE)
    return field_errors(errors) if errors else message(422, GENERAL_MESSAGE)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return message(exc.status_code, str(exc.detail))


@app.exception_handler(Exception)
async def unexpected_error(_: Request, __: Exception) -> JSONResponse:
    return message(500, GENERAL_MESSAGE)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(patients_router)
