import io
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from typing import BinaryIO

from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = False

FIELDS = ("full_name", "email", "phone_prefix", "phone_number", "photo")
MAX_NAME_LENGTH = 100
MAX_EMAIL_LENGTH = 254
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_PHOTO_PIXELS = 40_000_000
READ_CHUNK_BYTES = 64 * 1024
JPEG_SOI = b"\xff\xd8\xff"

REQUIRED = "Required."
INVALID_VALUE = "Invalid value."
NAME_INVALID = "Use letters and single spaces only."
NAME_TOO_LONG = f"Use at most {MAX_NAME_LENGTH} characters."
EMAIL_INVALID = "Enter a valid Gmail address (@gmail.com)."
EMAIL_TAKEN = "A patient with this email already exists."
PREFIX_INVALID = "Use + followed by 1 to 4 digits, not starting with 0."
NUMBER_INVALID = "Use 6 to 15 digits only."
PHOTO_EXTENSION = "Photo must be a .jpg file."
PHOTO_EMPTY = "Photo file is empty."
PHOTO_TOO_LARGE = "Photo must be 5 MB or smaller."
PHOTO_NOT_JPEG = "Photo must be a JPEG image."
PHOTO_TOO_MANY_PIXELS = "Photo resolution is too large."
PHOTO_DAMAGED = "Photo is damaged or incomplete."

_EMAIL_LOCAL = re.compile(r"[a-z0-9_+-]+(?:\.[a-z0-9_+-]+)*")
_PHONE_PREFIX = re.compile(r"\+[1-9][0-9]{0,3}")
_PHONE_NUMBER = re.compile(r"[0-9]{6,15}")


class FieldError(ValueError):
    pass


class InvalidRegistration(Exception):
    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__(errors)
        self.errors = errors


@dataclass(frozen=True)
class Registration:
    full_name: str
    email: str
    phone_prefix: str
    phone_number: str
    photo: bytes


def clean_full_name(raw: str | None) -> str:
    value = unicodedata.normalize("NFC", raw or "").strip()
    if not value:
        raise FieldError(REQUIRED)
    if not all(word.isalpha() for word in value.split(" ")):
        raise FieldError(NAME_INVALID)
    if len(value) > MAX_NAME_LENGTH:
        raise FieldError(NAME_TOO_LONG)
    return value


def clean_email(raw: str | None) -> str:
    value = (raw or "").strip().lower()
    if not value:
        raise FieldError(REQUIRED)
    local, at, domain = value.rpartition("@")
    if (
        not at
        or domain != "gmail.com"
        or len(value) > MAX_EMAIL_LENGTH
        or not _EMAIL_LOCAL.fullmatch(local)
    ):
        raise FieldError(EMAIL_INVALID)
    return value


def _clean_pattern(raw: str | None, pattern: re.Pattern[str], message: str) -> str:
    value = (raw or "").strip()
    if not value:
        raise FieldError(REQUIRED)
    if not pattern.fullmatch(value):
        raise FieldError(message)
    return value


def clean_phone_prefix(raw: str | None) -> str:
    return _clean_pattern(raw, _PHONE_PREFIX, PREFIX_INVALID)


def clean_phone_number(raw: str | None) -> str:
    return _clean_pattern(raw, _PHONE_NUMBER, NUMBER_INVALID)


def read_photo(filename: str | None, stream: BinaryIO | None) -> bytes:
    if stream is None or not filename:
        raise FieldError(REQUIRED)
    if not filename.lower().endswith(".jpg"):
        raise FieldError(PHOTO_EXTENSION)
    data = _read_limited(stream)
    _check_jpeg(data)
    return data


def _read_limited(stream: BinaryIO) -> bytes:
    buffer = bytearray()
    while chunk := stream.read(READ_CHUNK_BYTES):
        buffer += chunk
        if len(buffer) > MAX_PHOTO_BYTES:
            raise FieldError(PHOTO_TOO_LARGE)
    if not buffer:
        raise FieldError(PHOTO_EMPTY)
    return bytes(buffer)


def _check_jpeg(data: bytes) -> None:
    if not data.startswith(JPEG_SOI):
        raise FieldError(PHOTO_NOT_JPEG)
    try:
        image = Image.open(io.BytesIO(data))
    except Image.DecompressionBombError as exc:
        raise FieldError(PHOTO_TOO_MANY_PIXELS) from exc
    except Exception as exc:
        raise FieldError(PHOTO_NOT_JPEG) from exc
    with image:
        if image.format != "JPEG":
            raise FieldError(PHOTO_NOT_JPEG)
        if image.width * image.height > MAX_PHOTO_PIXELS:
            raise FieldError(PHOTO_TOO_MANY_PIXELS)
        try:
            image.load()
        except Exception as exc:
            raise FieldError(PHOTO_DAMAGED) from exc


def validate_registration(
    full_name: str | None,
    email: str | None,
    phone_prefix: str | None,
    phone_number: str | None,
    photo_filename: str | None,
    photo_stream: BinaryIO | None,
) -> Registration:
    checks: dict[str, Callable[[], str | bytes]] = {
        "full_name": lambda: clean_full_name(full_name),
        "email": lambda: clean_email(email),
        "phone_prefix": lambda: clean_phone_prefix(phone_prefix),
        "phone_number": lambda: clean_phone_number(phone_number),
        "photo": lambda: read_photo(photo_filename, photo_stream),
    }
    values: dict[str, str | bytes] = {}
    errors: dict[str, str] = {}
    for field, check in checks.items():
        try:
            values[field] = check()
        except FieldError as exc:
            errors[field] = str(exc)
    if errors:
        raise InvalidRegistration(errors)
    return Registration(**values)  # type: ignore[arg-type]
