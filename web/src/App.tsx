import { useEffect, useState } from 'react';
import { fetchPatients, type Patient } from './api';
import { Modal } from './components/Modal';
import { PatientCard } from './components/PatientCard';
import { PatientFormModal } from './components/PatientFormModal';

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; patients: Patient[] };

type ListRequest = { id: number; showLoading: boolean };

type Result = { kind: 'success'; fullName: string } | { kind: 'error' };

export default function App() {
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [request, setRequest] = useState<ListRequest>({
    id: 0,
    showLoading: true,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (request.showLoading) setState({ status: 'loading' });
    fetchPatients(controller.signal)
      .then((patients) => setState({ status: 'ready', patients }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [request]);

  const reload = (showLoading: boolean) =>
    setRequest((current) => ({ id: current.id + 1, showLoading }));

  const closeResult = () => setResult(null);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Patients</h1>
        <button
          type="button"
          className="button button--primary"
          onClick={() => setFormOpen(true)}
        >
          Add Patient
        </button>
      </header>
      <PatientListContent state={state} onRetry={() => reload(true)} />

      {formOpen && (
        <PatientFormModal
          onClose={() => setFormOpen(false)}
          onCreated={(fullName) => {
            setFormOpen(false);
            setResult({ kind: 'success', fullName });
            reload(false);
          }}
          onFailed={() => setResult({ kind: 'error' })}
        />
      )}

      {result?.kind === 'success' && (
        <Modal
          title="Patient registered"
          variant="success"
          closeOnBackdrop
          onClose={closeResult}
        >
          <p className="modal__text">
            {result.fullName} was added to the list. A confirmation email is on
            its way.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={closeResult}
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {result?.kind === 'error' && (
        <Modal
          title="Something went wrong"
          variant="error"
          role="alertdialog"
          closeOnBackdrop
          onClose={closeResult}
        >
          <p className="modal__text">
            The patient could not be registered. Your data is still in the form,
            so you can try again.
          </p>
          <div className="modal__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={closeResult}
            >
              Back to form
            </button>
          </div>
        </Modal>
      )}
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
