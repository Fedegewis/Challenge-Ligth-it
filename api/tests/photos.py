"""Synthetic test photos. Run `python -m tests.photos` to write the fixture files."""

import io
import random
import sys
from collections.abc import Callable
from functools import cache
from pathlib import Path

from PIL import Image


def _noise(width: int, height: int) -> Image.Image:
    rng = random.Random(width * height)
    return Image.frombytes("RGB", (width, height), rng.randbytes(width * height * 3))


def _encode(image: Image.Image, fmt: str, **options: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, fmt, **options)
    return buffer.getvalue()


@cache
def valid_jpeg() -> bytes:
    return _encode(_noise(320, 240), "JPEG", quality=85)


@cache
def png() -> bytes:
    return _encode(_noise(64, 64), "PNG")


def truncated_jpeg() -> bytes:
    data = valid_jpeg()
    return data[: len(data) // 2]


def fake_header_jpeg() -> bytes:
    return b"\xff\xd8\xff" + random.Random(1).randbytes(4096)


@cache
def big_jpeg() -> bytes:
    return _encode(_noise(1800, 1600), "JPEG", quality=100)


@cache
def huge_resolution_jpeg() -> bytes:
    return _encode(Image.new("L", (8000, 6000), 128), "JPEG", quality=50)


def param_id(value: object) -> str | None:
    return f"{len(value)}B" if isinstance(value, bytes) else None


FIXTURES: dict[str, Callable[[], bytes]] = {
    "valid.jpg": valid_jpeg,
    "valid.jpeg": valid_jpeg,
    "renamed.jpg": png,
    "truncated.jpg": truncated_jpeg,
    "fake-header.jpg": fake_header_jpeg,
    "empty.jpg": lambda: b"",
}

if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "fixtures"
    target.mkdir(parents=True, exist_ok=True)
    for name, build in FIXTURES.items():
        data = build()
        (target / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")
