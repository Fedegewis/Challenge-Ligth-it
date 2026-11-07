import json
import os
import socket
import threading
import time
import urllib.parse
import urllib.request
import uuid
from collections.abc import Iterator
from datetime import timedelta
from email.message import EmailMessage
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from app.emails import SUBJECT, SmtpSender
from app.models import EmailJob
from app.patients import create_patient
from app.validation import Registration
from app.worker import MAX_ATTEMPTS, process_next_job, retry_delay, run, run_once
from tests import photos

MAILHOG_API = os.environ.get("MAILHOG_API_URL", "http://mailhog:8025")


class FakeSender:
    def __init__(self, failures: int = 0, delay: float = 0) -> None:
        self.failures = failures
        self.delay = delay
        self.messages: list[EmailMessage] = []
        self.lock = threading.Lock()

    def __call__(self, message: EmailMessage) -> None:
        time.sleep(self.delay)
        with self.lock:
            if self.failures:
                self.failures -= 1
                raise ConnectionRefusedError("SMTP unavailable")
            self.messages.append(message)


class AlwaysFails:
    def __call__(self, message: EmailMessage) -> None:
        raise ConnectionRefusedError("SMTP unavailable")


def new_email() -> str:
    return f"worker.{uuid.uuid4().hex[:12]}@gmail.com"


def add_job(session_factory: sessionmaker[Session], email: str | None = None) -> int:
    with session_factory() as session:
        patient = create_patient(
            session,
            Registration(
                full_name="Ana Pérez",
                email=email or new_email(),
                phone_prefix="+54",
                phone_number="1155667788",
                photo=photos.valid_jpeg(),
            ),
        )
        return session.scalars(select(EmailJob.id).where(EmailJob.patient_id == patient.id)).one()


def job_state(session_factory: sessionmaker[Session], job_id: int) -> dict[str, Any]:
    with session_factory() as session:
        row = session.execute(
            text(
                "SELECT status, attempts, last_error, sent_at,"
                " extract(epoch FROM next_attempt_at - clock_timestamp()) AS wait_seconds"
                " FROM email_jobs WHERE id = :id"
            ),
            {"id": job_id},
        ).one()
    return row._asdict()


def make_due(session_factory: sessionmaker[Session], job_id: int) -> None:
    with session_factory() as session, session.begin():
        session.execute(
            text("UPDATE email_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = :id"),
            {"id": job_id},
        )


def test_due_job_is_sent_and_marked_sent(session_factory: sessionmaker[Session]) -> None:
    email = new_email()
    job_id = add_job(session_factory, email)
    sender = FakeSender()

    assert process_next_job(session_factory, sender) is True

    state = job_state(session_factory, job_id)
    assert state["status"] == "sent"
    assert state["attempts"] == 0
    assert state["sent_at"] is not None

    (message,) = sender.messages
    assert message["To"] == email
    assert message["Subject"] == SUBJECT
    assert message["Message-ID"] == f"<registration-{job_id}@patients.local>"
    assert "Ana Pérez" in message.get_body(("plain",)).get_content()
    assert "Ana Pérez" in message.get_body(("html",)).get_content()
    assert list(message.iter_attachments()) == []
    assert all(part.get_content_maintype() != "image" for part in message.walk())


def test_sent_job_is_not_selected_again(session_factory: sessionmaker[Session]) -> None:
    job_id = add_job(session_factory)
    sender = FakeSender()
    assert process_next_job(session_factory, sender) is True

    make_due(session_factory, job_id)

    assert process_next_job(session_factory, sender) is False
    assert run_once(session_factory, sender) == 0
    assert len(sender.messages) == 1


def test_job_not_yet_due_is_skipped(session_factory: sessionmaker[Session]) -> None:
    job_id = add_job(session_factory)
    with session_factory() as session, session.begin():
        session.execute(
            text("UPDATE email_jobs SET next_attempt_at = now() + interval '1 minute' WHERE id = :id"),
            {"id": job_id},
        )

    assert process_next_job(session_factory, FakeSender()) is False
    assert job_state(session_factory, job_id)["status"] == "pending"


def test_smtp_failure_records_error_and_schedules_first_retry(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = add_job(session_factory)

    assert process_next_job(session_factory, AlwaysFails()) is True

    state = job_state(session_factory, job_id)
    assert state["status"] == "pending"
    assert state["attempts"] == 1
    assert state["last_error"] == "ConnectionRefusedError: SMTP unavailable"
    assert state["sent_at"] is None
    assert 29 < state["wait_seconds"] <= 30
    assert process_next_job(session_factory, AlwaysFails()) is False


def test_backoff_sequence_then_fifth_failure_marks_failed(
    session_factory: sessionmaker[Session],
) -> None:
    job_id = add_job(session_factory)
    waits = []

    for _ in range(MAX_ATTEMPTS - 1):
        make_due(session_factory, job_id)
        process_next_job(session_factory, AlwaysFails())
        state = job_state(session_factory, job_id)
        assert state["status"] == "pending"
        waits.append(round(float(state["wait_seconds"])))

    assert waits == [30, 60, 120, 240]

    make_due(session_factory, job_id)
    assert process_next_job(session_factory, AlwaysFails()) is True
    state = job_state(session_factory, job_id)
    assert state["status"] == "failed"
    assert state["attempts"] == MAX_ATTEMPTS
    assert state["sent_at"] is None

    sender = FakeSender()
    assert process_next_job(session_factory, sender) is False
    assert sender.messages == []


def test_job_recovers_after_smtp_failure(session_factory: sessionmaker[Session]) -> None:
    job_id = add_job(session_factory)
    sender = FakeSender(failures=1)

    process_next_job(session_factory, sender)
    assert job_state(session_factory, job_id)["status"] == "pending"

    make_due(session_factory, job_id)
    process_next_job(session_factory, sender)

    state = job_state(session_factory, job_id)
    assert state["status"] == "sent"
    assert state["attempts"] == 1
    assert len(sender.messages) == 1


def test_locked_job_is_skipped_without_waiting(session_factory: sessionmaker[Session]) -> None:
    locked_id = add_job(session_factory)
    free_email = new_email()
    free_id = add_job(session_factory, free_email)
    sender = FakeSender()

    with session_factory() as holder, holder.begin():
        holder.execute(
            text("SELECT id FROM email_jobs WHERE id = :id FOR UPDATE"), {"id": locked_id}
        )
        competitor = threading.Thread(target=process_next_job, args=(session_factory, sender))
        competitor.start()
        competitor.join(timeout=2)
        blocked = competitor.is_alive()

    competitor.join(timeout=5)
    assert not blocked, "worker waited on a row locked by another worker"
    assert [m["To"] for m in sender.messages] == [free_email]
    assert job_state(session_factory, locked_id)["status"] == "pending"
    assert job_state(session_factory, free_id)["status"] == "sent"


def test_concurrent_workers_send_each_job_exactly_once(
    session_factory: sessionmaker[Session],
) -> None:
    job_ids = [add_job(session_factory) for _ in range(20)]
    sender = FakeSender(delay=0.02)
    barrier = threading.Barrier(4)

    def worker() -> None:
        barrier.wait()
        run_once(session_factory, sender, batch_size=len(job_ids))

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    sent_ids = sorted(m["Message-ID"] for m in sender.messages)
    assert sent_ids == sorted(f"<registration-{i}@patients.local>" for i in job_ids)
    assert len(set(sent_ids)) == len(job_ids)


def test_run_stops_promptly_when_signalled(session_factory: sessionmaker[Session]) -> None:
    stop = threading.Event()
    thread = threading.Thread(target=run, args=(stop, session_factory, FakeSender(), 60))
    thread.start()
    time.sleep(0.3)

    started = time.monotonic()
    stop.set()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert time.monotonic() - started < 1


def mailhog_messages(recipient: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"kind": "to", "query": recipient})
    with urllib.request.urlopen(f"{MAILHOG_API}/api/v2/search?{query}", timeout=5) as response:
        return json.load(response)["items"]


def test_smtp_sender_delivers_confirmation_to_mailhog(
    session_factory: sessionmaker[Session],
) -> None:
    email = new_email()
    job_id = add_job(session_factory, email)

    process_next_job(session_factory, SmtpSender("mailhog", 1025, timeout=5))

    assert job_state(session_factory, job_id)["status"] == "sent"
    (item,) = mailhog_messages(email)
    headers = item["Content"]["Headers"]
    assert headers["Subject"] == [SUBJECT]
    assert headers["Message-ID"] == [f"<registration-{job_id}@patients.local>"]
    content_types = [
        part["Headers"]["Content-Type"][0].split(";")[0]
        for part in item["MIME"]["Parts"]
        if part["Headers"]
    ]
    assert content_types == ["text/plain", "text/html"]
    assert "Ana Pérez" in item["MIME"]["Parts"][0]["Body"]


def test_smtp_connection_refused_is_recorded(session_factory: sessionmaker[Session]) -> None:
    job_id = add_job(session_factory)

    process_next_job(session_factory, SmtpSender("mailhog", 1, timeout=2))

    state = job_state(session_factory, job_id)
    assert (state["status"], state["attempts"]) == ("pending", 1)
    assert state["last_error"].startswith("ConnectionRefusedError")


@pytest.fixture
def silent_smtp_server() -> Iterator[int]:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()
    accepted: list[socket.socket] = []
    thread = threading.Thread(target=lambda: accepted.append(server.accept()[0]), daemon=True)
    thread.start()
    yield server.getsockname()[1]
    for conn in accepted:
        conn.close()
    server.close()


def test_smtp_timeout_is_recorded(
    session_factory: sessionmaker[Session], silent_smtp_server: int
) -> None:
    job_id = add_job(session_factory)

    started = time.monotonic()
    process_next_job(session_factory, SmtpSender("127.0.0.1", silent_smtp_server, timeout=0.5))
    elapsed = time.monotonic() - started

    state = job_state(session_factory, job_id)
    assert (state["status"], state["attempts"]) == ("pending", 1)
    assert "timed out" in state["last_error"]
    assert 0.4 < elapsed < 3


def test_retry_delay_values() -> None:
    assert [retry_delay(n) for n in range(1, 5)] == [
        timedelta(seconds=30),
        timedelta(seconds=60),
        timedelta(seconds=120),
        timedelta(seconds=240),
    ]
