import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { resolveApiUrl } from './api';

const PATIENTS = [
  {
    id: 7,
    full_name: 'Bruno Díaz',
    email: 'bruno.diaz@gmail.com',
    phone_prefix: '+598',
    phone_number: '99123456',
    photo_url: '/patients/7/photo',
    created_at: '2026-11-07T21:00:00Z',
  },
  {
    id: 3,
    full_name: 'Ana Pérez',
    email: 'ana.perez@gmail.com',
    phone_prefix: '+54',
    phone_number: '1155667788',
    photo_url: '/patients/3/photo',
    created_at: '2026-11-07T20:00:00Z',
  },
];

type FetchOutcome = Response | Error | 'pending';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(...outcomes: FetchOutcome[]) {
  const fetchMock = vi.fn();
  for (const outcome of outcomes) {
    if (outcome === 'pending') {
      fetchMock.mockReturnValueOnce(new Promise(() => {}));
    } else if (outcome instanceof Error) {
      fetchMock.mockRejectedValueOnce(outcome);
    } else {
      fetchMock.mockResolvedValueOnce(outcome);
    }
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const addPatientButton = () =>
  screen.getByRole('button', { name: 'Add Patient' });
const cardToggle = (name: string) => screen.getByRole('button', { name });

describe('patient list states', () => {
  it('shows a loading indicator while the request is pending', () => {
    const fetchMock = mockFetch('pending');

    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading patients');
    expect(screen.queryByText('No patients yet')).not.toBeInTheDocument();
    expect(addPatientButton()).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(resolveApiUrl('/patients'), {
      signal: expect.any(AbortSignal),
    });
  });

  it('shows the empty state when there are no patients', async () => {
    mockFetch(jsonResponse([]));

    render(<App />);

    expect(await screen.findByText('No patients yet')).toBeVisible();
    expect(addPatientButton()).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders one card per patient in API order', async () => {
    mockFetch(jsonResponse(PATIENTS));

    render(<App />);

    const list = await screen.findByRole('list', { name: 'Patients' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.textContent)).toEqual([
      'Bruno Díaz',
      'Ana Pérez',
    ]);
    expect(addPatientButton()).toBeVisible();
  });

  it('shows only name and photo on a closed card', async () => {
    mockFetch(jsonResponse(PATIENTS));
    render(<App />);

    const toggle = await screen.findByRole('button', { name: 'Bruno Díaz' });
    const card = toggle.closest('li')!;

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(card.querySelector('img')).toHaveAttribute(
      'src',
      resolveApiUrl('/patients/7/photo'),
    );
    expect(screen.queryByText('bruno.diaz@gmail.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/99123456/)).not.toBeInTheDocument();
    expect(screen.queryByText('ana.perez@gmail.com')).not.toBeInTheDocument();
  });

  it.each([
    ['a network error', new TypeError('Failed to fetch')],
    ['a server error', jsonResponse({ message: 'Something went wrong.' }, 500)],
  ])('shows an error with Retry after %s', async (_, outcome) => {
    mockFetch(outcome);

    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load patients.');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(addPatientButton()).toBeVisible();
  });

  it('retries the request and shows the list', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(
      new TypeError('Failed to fetch'),
      jsonResponse(PATIENTS),
    );
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the loading indicator again while retrying', async () => {
    const user = userEvent.setup();
    mockFetch(new TypeError('Failed to fetch'), 'pending');
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading patients');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(addPatientButton()).toBeVisible();
  });

  it('keeps Add Patient disabled until a handler is connected', async () => {
    const user = userEvent.setup();
    mockFetch(jsonResponse([]), jsonResponse([]));

    const { unmount } = render(<App />);
    expect(addPatientButton()).toBeDisabled();
    unmount();

    const onAddPatient = vi.fn();
    render(<App onAddPatient={onAddPatient} />);
    await user.click(addPatientButton());
    expect(onAddPatient).toHaveBeenCalledOnce();
  });
});

describe('patient card', () => {
  it('expands and collapses independently with the mouse', async () => {
    const user = userEvent.setup();
    mockFetch(jsonResponse(PATIENTS));
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Bruno Díaz' }));

    expect(cardToggle('Bruno Díaz')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('bruno.diaz@gmail.com')).toBeVisible();
    expect(screen.getByText('+598 99123456')).toBeVisible();
    expect(cardToggle('Ana Pérez')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ana.perez@gmail.com')).not.toBeInTheDocument();

    await user.click(cardToggle('Ana Pérez'));
    expect(screen.getByText('ana.perez@gmail.com')).toBeVisible();
    expect(screen.getByText('bruno.diaz@gmail.com')).toBeVisible();

    await user.click(cardToggle('Bruno Díaz'));
    expect(cardToggle('Bruno Díaz')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('bruno.diaz@gmail.com')).not.toBeInTheDocument();
    expect(screen.queryByText('+598 99123456')).not.toBeInTheDocument();
    expect(screen.getByText('ana.perez@gmail.com')).toBeVisible();
  });

  it('toggles with Enter and Space from the keyboard', async () => {
    const user = userEvent.setup();
    mockFetch(jsonResponse(PATIENTS));
    render(<App />);
    await screen.findByRole('list', { name: 'Patients' });

    await user.tab();
    expect(cardToggle('Bruno Díaz')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(cardToggle('Bruno Díaz')).toHaveAttribute('aria-expanded', 'true');

    await user.tab();
    expect(cardToggle('Ana Pérez')).toHaveFocus();
    await user.keyboard(' ');
    expect(cardToggle('Ana Pérez')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('+54 1155667788')).toBeVisible();

    await user.keyboard(' ');
    expect(cardToggle('Ana Pérez')).toHaveAttribute('aria-expanded', 'false');
    expect(cardToggle('Bruno Díaz')).toHaveAttribute('aria-expanded', 'true');
  });

  it('points aria-controls at the details region', async () => {
    mockFetch(jsonResponse(PATIENTS));
    render(<App />);

    const toggle = await screen.findByRole('button', { name: 'Bruno Díaz' });
    const regionId = toggle.getAttribute('aria-controls');

    expect(regionId).toBeTruthy();
    expect(document.getElementById(regionId!)).toBeInTheDocument();
  });
});
