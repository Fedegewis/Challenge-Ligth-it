from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Response, UploadFile
from pydantic import BaseModel, field_serializer
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import EMAIL_UNIQUE_INDEX, EmailJob, Patient
from app.validation import EMAIL_TAKEN, InvalidRegistration, Registration, validate_registration

BIGINT_MAX = 2**63 - 1

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]


class PatientOut(BaseModel):
    id: int
    full_name: str
    email: str
    phone_prefix: str
    phone_number: str
    photo_url: str
    created_at: datetime

    @field_serializer("created_at")
    def _as_utc(self, value: datetime) -> str:
        return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    @classmethod
    def from_patient(cls, patient: Patient) -> "PatientOut":
        return cls(
            id=patient.id,
            full_name=patient.full_name,
            email=patient.email,
            phone_prefix=patient.phone_prefix,
            phone_number=patient.phone_number,
            photo_url=f"/patients/{patient.id}/photo",
            created_at=patient.created_at,
        )


class DuplicateEmail(Exception):
    pass


def new_email_job(patient_id: int) -> EmailJob:
    return EmailJob(
        patient_id=patient_id, status="pending", attempts=0, next_attempt_at=func.now()
    )


def create_patient(session: Session, registration: Registration) -> Patient:
    patient = Patient(
        full_name=registration.full_name,
        email=registration.email,
        phone_prefix=registration.phone_prefix,
        phone_number=registration.phone_number,
        photo=registration.photo,
    )
    session.add(patient)
    try:
        session.flush()
        session.add(new_email_job(patient.id))
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        diag = getattr(exc.orig, "diag", None)
        if getattr(diag, "constraint_name", None) == EMAIL_UNIQUE_INDEX:
            raise DuplicateEmail from exc
        raise
    return patient


@router.post("/patients", status_code=201, response_model=PatientOut)
def register_patient(
    session: SessionDep,
    full_name: Annotated[str | None, Form()] = None,
    email: Annotated[str | None, Form()] = None,
    phone_prefix: Annotated[str | None, Form()] = None,
    phone_number: Annotated[str | None, Form()] = None,
    photo: Annotated[UploadFile | None, File()] = None,
) -> PatientOut:
    registration = validate_registration(
        full_name,
        email,
        phone_prefix,
        phone_number,
        photo.filename if photo else None,
        photo.file if photo else None,
    )
    try:
        patient = create_patient(session, registration)
    except DuplicateEmail:
        raise InvalidRegistration({"email": EMAIL_TAKEN}) from None
    return PatientOut.from_patient(patient)


@router.get("/patients", response_model=list[PatientOut])
def list_patients(session: SessionDep) -> list[PatientOut]:
    patients = session.scalars(
        select(Patient).order_by(Patient.created_at.desc(), Patient.id.desc())
    )
    return [PatientOut.from_patient(patient) for patient in patients]


@router.get(
    "/patients/{patient_id}/photo",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
)
def get_patient_photo(
    session: SessionDep, patient_id: Annotated[int, Path(ge=1, le=BIGINT_MAX)]
) -> Response:
    photo = session.scalar(select(Patient.photo).where(Patient.id == patient_id))
    if photo is None:
        raise HTTPException(status_code=404, detail="Patient not found.")
    return Response(content=photo, media_type="image/jpeg")
