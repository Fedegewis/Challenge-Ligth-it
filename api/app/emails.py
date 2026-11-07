import html
import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

FROM_ADDRESS = os.environ.get("SMTP_FROM", "Patient Registration <no-reply@patients.local>")
SUBJECT = "Your patient registration is confirmed"


def build_confirmation(*, job_id: int, to: str, full_name: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = FROM_ADDRESS
    message["To"] = to
    message["Subject"] = SUBJECT
    message["Message-ID"] = f"<registration-{job_id}@patients.local>"
    message.set_content(
        f"Hello {full_name},\n\nYour patient registration was completed successfully.\n"
    )
    message.add_alternative(
        f"<p>Hello {html.escape(full_name)},</p>"
        "<p>Your patient registration was completed successfully.</p>",
        subtype="html",
    )
    return message


@dataclass(frozen=True)
class SmtpSender:
    host: str
    port: int
    timeout: float

    def __call__(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as smtp:
            smtp.send_message(message)
