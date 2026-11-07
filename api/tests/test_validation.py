import io
import re

import pytest

from app.validation import (
    EMAIL_INVALID,
    MAX_PHOTO_BYTES,
    NAME_INVALID,
    NAME_TOO_LONG,
    NUMBER_INVALID,
    PHOTO_DAMAGED,
    PHOTO_EMPTY,
    PHOTO_EXTENSION,
    PHOTO_NOT_JPEG,
    PHOTO_TOO_LARGE,
    PHOTO_TOO_MANY_PIXELS,
    PREFIX_INVALID,
    READ_CHUNK_BYTES,
    REQUIRED,
    FieldError,
    clean_email,
    clean_full_name,
    clean_phone_number,
    clean_phone_prefix,
    read_photo,
)
from tests import photos


def raises(message: str):
    return pytest.raises(FieldError, match=f"^{re.escape(message)}$")


@pytest.mark.parametrize(
    ("raw", "stored"),
    [
        ("María", "María"),
        ("  María José Pérez  ", "María José Pérez"),
        ("Zoë Ñúñez", "Zoë Ñúñez"),
        ("José", "José"),
        ("李小龙", "李小龙"),
        ("a" * 100, "a" * 100),
    ],
)
def test_valid_full_names(raw: str, stored: str) -> None:
    assert clean_full_name(raw) == stored


@pytest.mark.parametrize(
    ("raw", "error"),
    [
        ("", REQUIRED),
        ("   ", REQUIRED),
        ("Ana  María", NAME_INVALID),
        ("Ana\tMaría", NAME_INVALID),
        ("O'Brien", NAME_INVALID),
        ("García-López", NAME_INVALID),
        ("John3", NAME_INVALID),
        ("Dr. Smith", NAME_INVALID),
        ("a" * 101, NAME_TOO_LONG),
    ],
)
def test_invalid_full_names(raw: str, error: str) -> None:
    with raises(error):
        clean_full_name(raw)


@pytest.mark.parametrize(
    ("raw", "stored"),
    [
        ("ana.perez@gmail.com", "ana.perez@gmail.com"),
        ("  Ana.Perez@GMAIL.com ", "ana.perez@gmail.com"),
        ("ana+clinic@gmail.com", "ana+clinic@gmail.com"),
    ],
)
def test_valid_emails(raw: str, stored: str) -> None:
    assert clean_email(raw) == stored


@pytest.mark.parametrize(
    "raw",
    [
        "ana@googlemail.com",
        "ana@mail.gmail.com",
        "ana@gmail.co",
        ".ana@gmail.com",
        "ana.@gmail.com",
        "ana..p@gmail.com",
        "@gmail.com",
        "ana",
        "ana@b@gmail.com",
        "añá@gmail.com",
        "a" * 245 + "@gmail.com",
    ],
)
def test_invalid_emails(raw: str) -> None:
    with raises(EMAIL_INVALID):
        clean_email(raw)


def test_email_required() -> None:
    with raises(REQUIRED):
        clean_email("  ")


@pytest.mark.parametrize("raw", ["+54", "+1", "+1234", " +54 "])
def test_valid_phone_prefixes(raw: str) -> None:
    assert clean_phone_prefix(raw) == raw.strip()


@pytest.mark.parametrize("raw", ["54", "+054", "+12345", "+", "+5a", "+٥٤"])
def test_invalid_phone_prefixes(raw: str) -> None:
    with raises(PREFIX_INVALID):
        clean_phone_prefix(raw)


@pytest.mark.parametrize("raw", ["1155667788", "123456", "123456789012345"])
def test_valid_phone_numbers(raw: str) -> None:
    assert clean_phone_number(raw) == raw


@pytest.mark.parametrize(
    "raw", ["11 5566", "12345", "1234567890123456", "11-55667788", "(11)556677", "١٢٣٤٥٦"]
)
def test_invalid_phone_numbers(raw: str) -> None:
    with raises(NUMBER_INVALID):
        clean_phone_number(raw)


@pytest.mark.parametrize("filename", ["valid.jpg", "VALID.JPG"])
def test_valid_photo(filename: str) -> None:
    data = photos.valid_jpeg()
    assert read_photo(filename, io.BytesIO(data)) == data


@pytest.mark.parametrize(
    ("filename", "data", "errors"),
    [
        (None, photos.valid_jpeg(), {REQUIRED}),
        ("", b"", {REQUIRED}),
        ("valid.jpeg", photos.valid_jpeg(), {PHOTO_EXTENSION}),
        ("photo", photos.valid_jpeg(), {PHOTO_EXTENSION}),
        ("renamed.jpg", photos.png(), {PHOTO_NOT_JPEG}),
        ("truncated.jpg", photos.truncated_jpeg(), {PHOTO_DAMAGED}),
        ("fake-header.jpg", photos.fake_header_jpeg(), {PHOTO_NOT_JPEG, PHOTO_DAMAGED}),
        ("empty.jpg", b"", {PHOTO_EMPTY}),
        ("big.jpg", photos.big_jpeg(), {PHOTO_TOO_LARGE}),
        ("limit.jpg", b"\xff" * MAX_PHOTO_BYTES, {PHOTO_NOT_JPEG}),
        ("over.jpg", b"\xff" * (MAX_PHOTO_BYTES + 1), {PHOTO_TOO_LARGE}),
        ("huge.jpg", photos.huge_resolution_jpeg(), {PHOTO_TOO_MANY_PIXELS}),
    ],
    ids=photos.param_id,
)
def test_invalid_photos(filename: str | None, data: bytes, errors: set[str]) -> None:
    with pytest.raises(FieldError) as exc_info:
        read_photo(filename, io.BytesIO(data))
    assert str(exc_info.value) in errors


def test_photo_fixture_shapes() -> None:
    assert photos.valid_jpeg().startswith(b"\xff\xd8\xff")
    assert photos.truncated_jpeg().startswith(b"\xff\xd8\xff")
    assert len(photos.big_jpeg()) > MAX_PHOTO_BYTES


class EndlessStream:
    def __init__(self) -> None:
        self.bytes_read = 0

    def read(self, size: int) -> bytes:
        self.bytes_read += size
        return b"\xff" * size


def test_photo_reader_stops_at_limit() -> None:
    stream = EndlessStream()
    with raises(PHOTO_TOO_LARGE):
        read_photo("endless.jpg", stream)  # type: ignore[arg-type]
    assert stream.bytes_read <= MAX_PHOTO_BYTES + READ_CHUNK_BYTES
