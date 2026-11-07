import { useEffect, useState } from 'react';
import { fetchPatients, type Patient } from './api';
import { PatientCard } from './components/PatientCard';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; patients: Patient[] };

type AppProps = {
  onAddPatient?: () => void;
};

export default function App({ onAddPatient }: AppProps) {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchPatients(controller.signal)
      .then((patients) => setState({ status: 'ready', patients }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = () => setAttempt((value) => value + 1);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Patients</h1>
        <button
          type="button"
          className="button button--primary"
          onClick={onAddPatient}
          disabled={!onAddPatient}
        >
          Add Patient
        </button>
      </header>
      <PatientListContent state={state} onRetry={retry} />
    </main>
  );
}

function PatientListContent({
  state,
  onRetry,
}: {
  state: ListState;
  onRetry: () => void;
}) {
  switch (state.status) {
    case 'loading':
      return (
        <p className="state state--loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading patients…
        </p>
      );
    case 'error':
      return (
        <div className="state state--error" role="alert">
          <p>Could not load patients.</p>
          <button type="button" className="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      );
    case 'ready':
      if (state.patients.length === 0) {
        return (
          <div className="state state--empty">
            <p className="state__title">No patients yet</p>
            <p>Registered patients will appear here.</p>
          </div>
        );
      }
      return (
        <ul className="patient-list" aria-label="Patients">
          {state.patients.map((patient) => (
            <PatientCard key={patient.id} patient={patient} />
          ))}
        </ul>
      );
  }
}
