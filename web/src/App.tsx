import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

type ApiStatus = 'checking' | 'ok' | 'unreachable';

export default function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_URL}/health`);
        const body = (await response.json()) as { status?: string };
        setApiStatus(
          response.ok && body.status === 'ok' ? 'ok' : 'unreachable',
        );
      } catch {
        setApiStatus('unreachable');
      }
    };
    void checkHealth();
  }, []);

  return (
    <main className="app">
      <h1>Patient Registration</h1>
      <p>
        API status: <strong data-testid="api-status">{apiStatus}</strong>
      </p>
    </main>
  );
}
