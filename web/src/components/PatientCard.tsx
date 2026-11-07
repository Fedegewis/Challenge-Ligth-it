import { useId, useState } from 'react';
import type { Patient } from '../api';

type PatientCardProps = {
  patient: Patient;
};

export function PatientCard({ patient }: PatientCardProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  return (
    <li className="patient-card" data-expanded={expanded}>
      <button
        type="button"
        className="patient-card__toggle"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <img
          className="patient-card__photo"
          src={patient.photoUrl}
          alt=""
          width={56}
          height={56}
          loading="lazy"
        />
        <span className="patient-card__name">{patient.fullName}</span>
        <span className="patient-card__chevron" aria-hidden="true" />
      </button>
      <div id={detailsId} className="patient-card__details">
        {expanded && (
          <dl>
            <div>
              <dt>Email</dt>
              <dd>{patient.email}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>
                {patient.phonePrefix} {patient.phoneNumber}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </li>
  );
}
