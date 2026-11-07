import asyncio
import re
import threading
import time
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, sessionmaker
from starlette.types import Receive, Scope, Send

from app import patients as patients_module
from app.main import GENERAL_MESSAGE, MAX_REQUEST_BYTES, app
from app.models import EmailJob, Patient
from app.patients import DuplicateEmail, create_patient
from app.validation import (
    EMAIL_INVALID,
    EMAIL_TAKEN,
    FIELDS,
    NAME_INVALID,
    NUMBER_INVALID,
    PHOTO_DAMAGED,
    PHOTO_EMPTY,
    PHOTO_EXTENSION,
    PHOTO_NOT_JPEG,
    PHOTO_TOO_LARGE,
    PREFIX_INVALID,
    REQUIRED,
    Registration,
)
from tests import photos

VALID_FIELDS = {
    "full_name": "Ana Pérez",
    "email": "ana.perez@gmail.com",
    "phone_prefix": "+54",
    "phone_number": "1155667788",
}
DEFAULT_PHOTO = ("valid.jpg", photos.valid_jpeg())


def register(
    client: TestClient,
    photo: tuple[str, bytes] | None = DEFAULT_PHOTO,
    **fields: str | None,
) -> httpx.Response:
    data = {k: v for k, v in {**VALID_FIELDS, **fields}.items() if v is not None}
    files = {"photo": (photo[0], photo[1], "image/jpeg")} if photo else None
    return client.post("/patients", data=data, files=files)


def errors_of(response: httpx.Response) -> dict[str, str]:
    assert response.status_code == 422
    body = response.json()
    assert set(body) == {"errors"}
    return {error["field"]: error["message"] for error in body["errors"]}


def counts(session_factory: sessionmaker[Session]) -> tuple[int, int]:
    with session_factory() as session:
        patients = session.scalar(select(func.count()).select_from(Patient))
        jobs = session.scalar(select(func.count()).select_from(EmailJob))
    return patients, jobs


def test_register_returns_created_patient(client: TestClient) -> None:
    response = register(client, full_name="  María José Pérez  ", email=" Maria.Perez@GMAIL.com ")

    assert response.status_code == 201
    body = response.json()
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body.pop("created_at"))
    assert body == {
        "id": 1,
        "full_name": "María José Pérez",
        "email": "maria.perez@gmail.com",
        "phone_prefix": "+54",
        "phone_number": "1155667788",
        "photo_url": "/patients/1/photo",
    }


def test_register_stores_patient_photo_and_pending_job(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    patient_id = register(client).json()["id"]

    with session_factory() as session:
        stored_photo = session.scalar(select(Patient.photo).where(Patient.id == patient_id))
        job = session.execute(
            text(
                "SELECT patient_id, status, attempts, last_error, sent_at,"
                " next_attempt_at <= now() AS due FROM email_jobs"
            )
        ).one()
    assert stored_photo == photos.valid_jpeg()
    assert job._asdict() == {
        "patient_id": patient_id,
        "status": "pending",
        "attempts": 0,
        "last_error": None,
        "sent_at": None,
        "due": True,
    }


def test_empty_request_reports_every_field_as_required(client: TestClient) -> None:
    response = client.post("/patients")
    assert errors_of(response) == dict.fromkeys(FIELDS, REQUIRED)


@pytest.mark.parametrize("missing", FIELDS)
def test_each_missing_field_is_reported(
    client: TestClient, session_factory: sessionmaker[Session], missing: str
) -> None:
    if missing == "photo":
        response = register(client, photo=None)
    else:
        response = register(client, **{missing: None})
    assert errors_of(response) == {missing: REQUIRED}
    assert counts(session_factory) == (0, 0)


def test_invalid_fields_return_one_error_per_field_in_order(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    response = register(
        client,
        photo=("renamed.jpg", photos.png()),
        full_name="O'Brien",
        email="ana@googlemail.com",
        phone_prefix="54",
        phone_number="12345",
    )
    assert response.json()["errors"] == [
        {"field": "full_name", "message": NAME_INVALID},
        {"field": "email", "message": EMAIL_INVALID},
        {"field": "phone_prefix", "message": PREFIX_INVALID},
        {"field": "phone_number", "message": NUMBER_INVALID},
        {"field": "photo", "message": PHOTO_NOT_JPEG},
    ]
    assert counts(session_factory) == (0, 0)


def test_non_file_photo_part_is_a_photo_error(client: TestClient) -> None:
    response = client.post("/patients", data={**VALID_FIELDS, "photo": "not a file"})
    assert set(errors_of(response)) == {"photo"}


@pytest.mark.parametrize("filename", ["valid.jpg", "VALID.JPG"])
def test_valid_jpg_is_accepted(client: TestClient, filename: str) -> None:
    assert register(client, photo=(filename, photos.valid_jpeg())).status_code == 201


@pytest.mark.parametrize(
    ("filename", "data", "message"),
    [
        ("valid.jpeg", photos.valid_jpeg(), PHOTO_EXTENSION),
        ("renamed.jpg", photos.png(), PHOTO_NOT_JPEG),
        ("truncated.jpg", photos.truncated_jpeg(), PHOTO_DAMAGED),
        ("fake-header.jpg", photos.fake_header_jpeg(), PHOTO_NOT_JPEG),
        ("empty.jpg", b"", PHOTO_EMPTY),
        ("big.jpg", photos.big_jpeg(), PHOTO_TOO_LARGE),
        ("over.jpg", b"\xff" * (5 * 1024 * 1024 + 1), PHOTO_TOO_LARGE),
    ],
    ids=photos.param_id,
)
def test_invalid_photo_is_rejected_and_nothing_is_stored(
    client: TestClient,
    session_factory: sessionmaker[Session],
    filename: str,
    data: bytes,
    message: str,
) -> None:
    response = register(client, photo=(filename, data))
    assert errors_of(response) == {"photo": message}
    assert counts(session_factory) == (0, 0)


def test_oversized_request_is_rejected_before_parsing(
    client: TestClient, session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_if_called(*_: object) -> None:
        raise AssertionError("endpoint must not run")

    monkeypatch.setattr(patients_module, "validate_registration", fail_if_called)

    response = register(client, photo=("big.jpg", b"\xff" * (MAX_REQUEST_BYTES + 1)))

    assert errors_of(response) == {"photo": PHOTO_TOO_LARGE}
    assert counts(session_factory) == (0, 0)


BOUNDARY = "test-boundary"
CHUNK_BYTES = 64 * 1024


def multipart_body(photo: bytes) -> bytes:
    parts = [
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in VALID_FIELDS.items()
    ]
    parts.append(
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="photo"; filename="photo.jpg"\r\n'
        "Content-Type: image/jpeg\r\n\r\n".encode()
        + photo
        + b"\r\n"
    )
    parts.append(f"--{BOUNDARY}--\r\n".encode())
    return b"".join(parts)


@dataclass
class ChunkedPost:
    response: httpx.Response
    headers: dict[bytes, bytes]
    body_bytes: int
    bytes_sent: int


def post_chunked(body: bytes) -> ChunkedPost:
    headers_seen: dict[bytes, bytes] = {}
    sent = 0

    async def chunks() -> AsyncIterator[bytes]:
        nonlocal sent
        for start in range(0, len(body), CHUNK_BYTES):
            chunk = body[start : start + CHUNK_BYTES]
            sent += len(chunk)
            yield chunk

    async def recording_app(scope: Scope, receive: Receive, send: Send) -> None:
        headers_seen.update(scope["headers"])
        await app(scope, receive, send)

    async def run() -> httpx.Response:
        transport = httpx.ASGITransport(app=recording_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(
                "/patients",
                content=chunks(),
                headers={"content-type": f"multipart/form-data; boundary={BOUNDARY}"},
            )

    response = asyncio.run(run())
    return ChunkedPost(response, headers_seen, len(body), sent)


def test_chunked_request_without_content_length_is_cut_at_body_limit(
    client: TestClient, session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_if_called(*_: object) -> None:
        raise AssertionError("endpoint must not run")

    monkeypatch.setattr(patients_module, "validate_registration", fail_if_called)

    result = post_chunked(multipart_body(b"\xff" * (3 * MAX_REQUEST_BYTES)))

    assert b"content-length" not in result.headers
    assert result.headers[b"transfer-encoding"] == b"chunked"
    assert errors_of(result.response) == {"photo": PHOTO_TOO_LARGE}
    assert MAX_REQUEST_BYTES < result.bytes_sent <= MAX_REQUEST_BYTES + CHUNK_BYTES
    assert result.bytes_sent < result.body_bytes
    assert counts(session_factory) == (0, 0)


def test_chunked_request_within_limit_is_processed(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    result = post_chunked(multipart_body(photos.valid_jpeg()))

    assert b"content-length" not in result.headers
    assert result.response.status_code == 201
    assert result.bytes_sent == result.body_bytes
    assert counts(session_factory) == (1, 1)


def test_chunked_photo_over_file_limit_but_under_body_limit_is_rejected(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    result = post_chunked(multipart_body(b"\xff" * (5 * 1024 * 1024 + 1)))

    assert result.body_bytes < MAX_REQUEST_BYTES
    assert errors_of(result.response) == {"photo": PHOTO_TOO_LARGE}
    assert result.bytes_sent == result.body_bytes
    assert counts(session_factory) == (0, 0)


def test_duplicate_email_with_different_case_is_rejected(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    assert register(client, email="ana.perez@gmail.com").status_code == 201

    response = register(client, email="  ANA.Perez@Gmail.COM ", full_name="Otra Persona")

    assert errors_of(response) == {"email": EMAIL_TAKEN}
    assert counts(session_factory) == (1, 1)


def test_concurrent_registrations_with_same_email_create_one_patient(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    emails = ["ana.perez@gmail.com", "ANA.PEREZ@gmail.com", "Ana.Perez@GMAIL.com"] * 3
    barrier = threading.Barrier(len(emails))

    def attempt(email: str) -> httpx.Response:
        barrier.wait()
        return register(client, email=email)

    with ThreadPoolExecutor(max_workers=len(emails)) as pool:
        responses = list(pool.map(attempt, emails))

    statuses = sorted(response.status_code for response in responses)
    assert statuses == [201] + [422] * (len(emails) - 1)
    for response in responses:
        if response.status_code == 422:
            assert errors_of(response) == {"email": EMAIL_TAKEN}
    assert counts(session_factory) == (1, 1)


def test_second_transaction_waits_on_email_index_then_fails(
    session_factory: sessionmaker[Session],
) -> None:
    holder = session_factory()
    holder.add(
        Patient(
            full_name="Ana Pérez",
            email="ana.perez@gmail.com",
            phone_prefix="+54",
            phone_number="1155667788",
            photo=photos.valid_jpeg(),
        )
    )
    holder.flush()

    outcome: dict[str, str] = {}

    def competitor() -> None:
        with session_factory() as session:
            try:
                create_patient(
                    session,
                    Registration(photo=photos.valid_jpeg(), **VALID_FIELDS),
                )
                outcome["result"] = "created"
            except DuplicateEmail:
                outcome["result"] = "duplicate"

    thread = threading.Thread(target=competitor)
    thread.start()
    time.sleep(1)

    with session_factory() as observer:
        waiting = observer.scalar(
            text(
                "SELECT count(*) FROM pg_stat_activity"
                " WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
        )
    assert thread.is_alive()
    assert waiting == 1

    holder.commit()
    holder.close()
    thread.join(timeout=5)

    assert outcome == {"result": "duplicate"}
    assert counts(session_factory) == (1, 0)


def test_failed_job_insert_rolls_back_patient(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        patients_module,
        "new_email_job",
        lambda patient_id: EmailJob(patient_id=patient_id, status="queued", attempts=0),
    )

    response = register(client)

    assert response.status_code == 500
    assert response.json() == {"message": GENERAL_MESSAGE}
    assert counts(session_factory) == (0, 0)

    monkeypatch.undo()
    retry = register(client)
    assert retry.status_code == 201
    assert retry.json()["id"] == 2


def test_list_is_empty_without_patients(client: TestClient) -> None:
    response = client.get("/patients")
    assert response.status_code == 200
    assert response.json() == []


def test_list_returns_newest_first_with_photo_url(client: TestClient) -> None:
    for name, email in [("Ana", "ana@gmail.com"), ("Bruno", "bruno@gmail.com"), ("Carla", "carla@gmail.com")]:
        assert register(client, full_name=name, email=email).status_code == 201

    body = client.get("/patients").json()

    assert [item["full_name"] for item in body] == ["Carla", "Bruno", "Ana"]
    assert [item["photo_url"] for item in body] == [f"/patients/{i}/photo" for i in (3, 2, 1)]
    assert all("photo" not in item for item in body)


def test_list_breaks_created_at_ties_by_id(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    same_moment = datetime(2026, 1, 1, tzinfo=UTC)
    with session_factory() as session:
        for name in ("Ana", "Bruno"):
            session.add(
                Patient(
                    full_name=name,
                    email=f"{name.lower()}@gmail.com",
                    phone_prefix="+54",
                    phone_number="1155667788",
                    photo=b"x",
                    created_at=same_moment,
                )
            )
        session.commit()

    assert [item["full_name"] for item in client.get("/patients").json()] == ["Bruno", "Ana"]


def test_photo_returns_original_bytes(client: TestClient) -> None:
    photo_url = register(client).json()["photo_url"]

    response = client.get(photo_url)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == photos.valid_jpeg()


@pytest.mark.parametrize("patient_id", ["999", "0", "abc", "99999999999999999999"])
def test_photo_of_unknown_patient_is_404(client: TestClient, patient_id: str) -> None:
    response = client.get(f"/patients/{patient_id}/photo")
    assert response.status_code == 404
    assert set(response.json()) == {"message"}


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
