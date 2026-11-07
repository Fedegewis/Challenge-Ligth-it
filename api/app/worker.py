import logging
import os
import signal
import threading
from collections.abc import Callable
from datetime import timedelta
from email.message import EmailMessage

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import SessionLocal
from app.emails import SmtpSender, build_confirmation
from app.models import EmailJob, Patient

log = logging.getLogger("worker")

MAX_ATTEMPTS = 5
BASE_RETRY_SECONDS = 30
BATCH_SIZE = 10
MAX_ERROR_LENGTH = 500

Send = Callable[[EmailMessage], None]


def retry_delay(attempts: int) -> timedelta:
    return timedelta(seconds=BASE_RETRY_SECONDS * 2 ** (attempts - 1))


def process_next_job(session_factory: sessionmaker[Session], send: Send) -> bool:
    with session_factory() as session, session.begin():
        job = session.scalars(
            select(EmailJob)
            .where(EmailJob.status == "pending", EmailJob.next_attempt_at <= func.now())
            .order_by(EmailJob.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        ).first()
        if job is None:
            return False

        patient = session.get_one(Patient, job.patient_id)
        message = build_confirmation(job_id=job.id, to=patient.email, full_name=patient.full_name)
        try:
            send(message)
        except Exception as exc:
            job.attempts += 1
            job.last_error = f"{type(exc).__name__}: {exc}"[:MAX_ERROR_LENGTH]
            if job.attempts >= MAX_ATTEMPTS:
                job.status = "failed"
                log.error("job %s failed permanently: %s", job.id, job.last_error)
            else:
                job.next_attempt_at = func.clock_timestamp() + retry_delay(job.attempts)
                log.warning("job %s attempt %s failed: %s", job.id, job.attempts, job.last_error)
        else:
            job.status = "sent"
            job.sent_at = func.clock_timestamp()
            log.info("job %s sent to patient %s", job.id, patient.id)
    return True


def run_once(
    session_factory: sessionmaker[Session],
    send: Send,
    stop: threading.Event | None = None,
    batch_size: int = BATCH_SIZE,
) -> int:
    processed = 0
    while processed < batch_size and not (stop and stop.is_set()):
        if not process_next_job(session_factory, send):
            break
        processed += 1
    return processed


def run(
    stop: threading.Event,
    session_factory: sessionmaker[Session],
    send: Send,
    poll_interval: float,
) -> None:
    log.info("worker started")
    while not stop.is_set():
        try:
            processed = run_once(session_factory, send, stop)
        except Exception:
            log.exception("polling failed")
            processed = 0
        if processed < BATCH_SIZE:
            stop.wait(poll_interval)
    log.info("worker stopped")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())

    sender = SmtpSender(
        host=os.environ.get("SMTP_HOST", "mailhog"),
        port=int(os.environ.get("SMTP_PORT", "1025")),
        timeout=float(os.environ.get("SMTP_TIMEOUT_SECONDS", "10")),
    )
    run(stop, SessionLocal, sender, float(os.environ.get("POLL_INTERVAL_SECONDS", "2")))


if __name__ == "__main__":
    main()
