import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { FIELDS, resolveApiUrl } from './api';
import {
  EMAIL_INVALID,
  NAME_INVALID,
  PHOTO_EXTENSION,
  REQUIRED,
} from './validation';

const EMAIL_TAKEN = 'A patient with this email already exists.';

const CREATED = {
  id: 1,
  full_name: 'Ana Pérez',
  email: 'ana.perez@gmail.com',
  phone_prefix: '+54',
  phone_number: '1155667788',
  photo_url: '/patients/1/photo',
  created_at: '2026-11-07T21:00:00Z',
};

type CreateOutcome = () => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const respond =
  (body: unknown, status: number): CreateOutcome =>
  () =>
    Promise.resolve(jsonResponse(body, status));
const never: CreateOutcome = () => new Promise(() => {});
const networkError: CreateOutcome = () =>
  Promise.reject(new TypeError('Failed to fetch'));

function mockApi({
  lists = [[]],
  creates = [],
}: {
  lists?: unknown[][];
  creates?: CreateOutcome[];
}) {
  const listQueue = [...lists];
  const createQueue = [...creates];
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const next = createQueue.shift();
      if (!next) throw new Error('unexpected POST');
      return next();
    }
    const list = listQueue.length > 1 ? listQueue.shift() : listQueue[0];
    return Promise.resolve(jsonResponse(list));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function postsOf(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
}

function getsOf(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST');
}

function jpg(name = 'valid.jpg', size = 2048): File {
  return new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
}

const field = (label: string) => screen.getByLabelText(label);
const formDialog = () => screen.queryByRole('dialog', { name: 'Add patient' });
const submitButton = () =>
  screen.getByRole('button', { name: /Register patient|Registering/ });

async function openForm(user: UserEvent) {
  render(<App />);
  await screen.findByText('No patients yet');
  await user.click(screen.getByRole('button', { name: 'Add Patient' }));
  return screen.getByRole('dialog', { name: 'Add patient' });
}

async function fillValid(user: UserEvent, photo: File = jpg()) {
  await user.type(field('Full name'), 'Ana Pérez');
  await user.type(field('Email'), 'ana.perez@gmail.com');
  await user.type(field('Phone prefix'), '+54');
  await user.type(field('Phone number'), '1155667788');
  await user.upload(field('Photo'), photo);
}

describe('registration form', () => {
  it('opens a modal with the five fields and closes with Escape', async () => {
    const user = userEvent.setup();
    mockApi({});
    const dialog = await openForm(user);

    for (const label of [
      'Full name',
      'Email',
      'Phone prefix',
      'Phone number',
      'Photo',
    ]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(field('Full name')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(formDialog()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Patient' })).toHaveFocus();
  });

  it('keeps Tab focus inside the modal', async () => {
    const user = userEvent.setup();
    mockApi({});
    await openForm(user);

    await user.tab({ shift: true });
    expect(submitButton()).toHaveFocus();
    await user.tab();
    expect(field('Full name')).toHaveFocus();
  });

  it('shows errors only after the first submit and updates them live', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({});
    await openForm(user);

    await user.type(field('Full name'), 'John3');
    expect(screen.queryByText(NAME_INVALID)).not.toBeInTheDocument();
    expect(field('Full name')).toHaveAttribute('aria-invalid', 'false');

    await user.click(submitButton());

    expect(field('Full name')).toHaveAccessibleDescription(NAME_INVALID);
    expect(field('Email')).toHaveAccessibleDescription(REQUIRED);
    expect(field('Phone prefix')).toHaveAccessibleDescription(REQUIRED);
    expect(field('Phone number')).toHaveAccessibleDescription(REQUIRED);
    expect(field('Photo')).toHaveAccessibleDescription(
      expect.stringContaining(REQUIRED),
    );
    expect(field('Full name')).toHaveFocus();
    expect(postsOf(fetchMock)).toHaveLength(0);

    await user.clear(field('Full name'));
    await user.type(field('Full name'), 'John');
    expect(field('Full name')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(NAME_INVALID)).not.toBeInTheDocument();

    await user.type(field('Full name'), '3');
    expect(field('Full name')).toHaveAccessibleDescription(NAME_INVALID);
  });

  it('does not send a request while any field is invalid', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({});
    await openForm(user);
    await fillValid(user);
    await user.clear(field('Email'));
    await user.type(field('Email'), 'ana@googlemail.com');

    await user.click(submitButton());

    expect(field('Email')).toHaveAccessibleDescription(EMAIL_INVALID);
    expect(postsOf(fetchMock)).toHaveLength(0);
  });
});

describe('photo field', () => {
  it('selects and replaces a .jpg from the file dialog', async () => {
    const user = userEvent.setup();
    mockApi({});
    await openForm(user);

    await user.upload(field('Photo'), jpg('first.jpg'));
    expect(screen.getByText('first.jpg')).toBeVisible();

    await user.upload(field('Photo'), jpg('second.jpg'));
    expect(screen.getByText('second.jpg')).toBeVisible();
    expect(screen.queryByText('first.jpg')).not.toBeInTheDocument();
  });

  it('accepts a dropped .jpg and highlights the zone while dragging', async () => {
    const user = userEvent.setup();
    mockApi({});
    await openForm(user);
    const zone = screen.getByTestId('photo-drop');

    fireEvent.dragEnter(zone);
    expect(zone).toHaveClass('photo-drop--dragging');
    fireEvent.drop(zone, { dataTransfer: { files: [jpg('dropped.jpg')] } });

    expect(zone).not.toHaveClass('photo-drop--dragging');
    expect(screen.getByText('dropped.jpg')).toBeVisible();
  });

  it('rejects a dropped non-.jpg file after submit', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({});
    await openForm(user);
    await fillValid(user);

    const png = new File([new Uint8Array(10)], 'photo.png', {
      type: 'image/png',
    });
    fireEvent.drop(screen.getByTestId('photo-drop'), {
      dataTransfer: { files: [png] },
    });
    expect(screen.getByText('photo.png')).toBeVisible();

    await user.click(submitButton());

    expect(field('Photo')).toHaveAccessibleDescription(
      expect.stringContaining(PHOTO_EXTENSION),
    );
    expect(postsOf(fetchMock)).toHaveLength(0);
  });

  it('is reachable with the keyboard', async () => {
    const user = userEvent.setup();
    mockApi({});
    await openForm(user);

    for (let i = 0; i < 4; i += 1) await user.tab();

    expect(field('Photo')).toHaveFocus();
    expect(field('Photo')).toHaveAttribute('type', 'file');
  });
});

describe('submission', () => {
  it('sends the contract fields as FormData without a manual content type', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      lists: [[], [CREATED]],
      creates: [respond(CREATED, 201)],
    });
    await openForm(user);
    const photo = jpg();
    await fillValid(user, photo);

    await user.click(submitButton());
    await screen.findByRole('dialog', { name: 'Patient registered' });

    const [[url, init]] = postsOf(fetchMock);
    expect(url).toBe(resolveApiUrl('/patients'));
    expect(init?.headers).toBeUndefined();
    const body = init?.body as FormData;
    expect([...body.keys()]).toEqual([...FIELDS]);
    expect(body.get('full_name')).toBe('Ana Pérez');
    expect(body.get('email')).toBe('ana.perez@gmail.com');
    expect(body.get('phone_prefix')).toBe('+54');
    expect(body.get('phone_number')).toBe('1155667788');
    expect((body.get('photo') as File).name).toBe('valid.jpg');
    expect((body.get('photo') as File).size).toBe(photo.size);
  });

  it('blocks duplicate submits while the request is pending', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ creates: [never] });
    await openForm(user);
    await fillValid(user);

    await user.click(submitButton());
    expect(submitButton()).toHaveTextContent('Registering…');
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    expect(formDialog()?.querySelector('form')).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await user.click(submitButton());
    await user.type(field('Email'), '{Enter}');
    await user.keyboard('{Escape}');

    expect(postsOf(fetchMock)).toHaveLength(1);
    expect(formDialog()).toBeInTheDocument();
  });
});

describe('results', () => {
  it('closes the form, shows the success modal and refreshes the list', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      lists: [[], [CREATED]],
      creates: [respond(CREATED, 201)],
    });
    await openForm(user);
    await fillValid(user);

    await user.click(submitButton());

    const success = await screen.findByRole('dialog', {
      name: 'Patient registered',
    });
    expect(success).toHaveTextContent('Ana Pérez was added to the list.');
    expect(formDialog()).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Ana Pérez' }),
    ).toBeInTheDocument();
    expect(getsOf(fetchMock)).toHaveLength(2);

    const close = within(success).getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    await user.click(close);
    expect(
      screen.queryByRole('dialog', { name: 'Patient registered' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Patient' })).toHaveFocus();
  });

  it('shows 422 errors under their fields, including a duplicate email', async () => {
    const user = userEvent.setup();
    mockApi({
      creates: [
        respond(
          {
            errors: [
              { field: 'email', message: EMAIL_TAKEN },
              { field: 'photo', message: 'Photo must be a JPEG image.' },
            ],
          },
          422,
        ),
      ],
    });
    await openForm(user);
    await fillValid(user);

    await user.click(submitButton());

    expect(await screen.findByText(EMAIL_TAKEN)).toBeVisible();
    expect(formDialog()).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(field('Email')).toHaveAccessibleDescription(EMAIL_TAKEN);
    expect(field('Email')).toHaveFocus();
    expect(field('Photo')).toHaveAccessibleDescription(
      expect.stringContaining('Photo must be a JPEG image.'),
    );

    await user.clear(field('Email'));
    await user.type(field('Email'), 'ana.otra@gmail.com');
    expect(screen.queryByText(EMAIL_TAKEN)).not.toBeInTheDocument();
    expect(field('Email')).toHaveAttribute('aria-invalid', 'false');

    await user.upload(field('Photo'), jpg('other.jpg'));
    expect(
      screen.queryByText('Photo must be a JPEG image.'),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['a network error', networkError],
    ['a 500', respond({ message: 'Something went wrong.' }, 500)],
    [
      'a 422 with an unknown field',
      respond({ errors: [{ field: 'id', message: 'x' }] }, 422),
    ],
    [
      'a 422 without a JSON body',
      () => Promise.resolve(new Response('oops', { status: 422 })),
    ],
    ['an unexpected 200', respond({}, 200)],
  ])(
    'shows the error modal after %s and keeps the data',
    async (_, outcome) => {
      const user = userEvent.setup();
      mockApi({ creates: [outcome] });
      await openForm(user);
      await fillValid(user);

      await user.click(submitButton());

      const alert = await screen.findByRole('alertdialog', {
        name: 'Something went wrong',
      });
      expect(alert).toHaveTextContent('Your data is still in the form');
      expect(formDialog()).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(formDialog()).toBeInTheDocument();
      expect(submitButton()).toHaveFocus();
      expect(field('Full name')).toHaveValue('Ana Pérez');
      expect(field('Email')).toHaveValue('ana.perez@gmail.com');
      expect(field('Phone prefix')).toHaveValue('+54');
      expect(field('Phone number')).toHaveValue('1155667788');
      expect(screen.getByText('valid.jpg')).toBeVisible();
    },
  );

  it.each([
    [
      'an empty body',
      () => Promise.resolve(new Response(null, { status: 201 })),
    ],
    [
      'a non-JSON body',
      () => Promise.resolve(new Response('created', { status: 201 })),
    ],
    ['a JSON array', respond([CREATED], 201)],
    ['a missing photo_url', respond({ ...CREATED, photo_url: undefined }, 201)],
    ['a string id', respond({ ...CREATED, id: '1' }, 201)],
    ['an empty full_name', respond({ ...CREATED, full_name: '' }, 201)],
    ['an invalid created_at', respond({ ...CREATED, created_at: 'soon' }, 201)],
  ])(
    'treats a 201 with %s as a general failure and keeps the form',
    async (_, outcome) => {
      const user = userEvent.setup();
      const fetchMock = mockApi({ creates: [outcome] });
      await openForm(user);
      await fillValid(user);

      await user.click(submitButton());

      const alert = await screen.findByRole('alertdialog', {
        name: 'Something went wrong',
      });
      expect(
        screen.queryByRole('dialog', { name: 'Patient registered' }),
      ).not.toBeInTheDocument();

      await user.click(
        within(alert).getByRole('button', { name: 'Back to form' }),
      );

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(formDialog()).toBeInTheDocument();
      expect(field('Full name')).toHaveValue('Ana Pérez');
      expect(field('Email')).toHaveValue('ana.perez@gmail.com');
      expect(field('Phone prefix')).toHaveValue('+54');
      expect(field('Phone number')).toHaveValue('1155667788');
      expect(screen.getByText('valid.jpg')).toBeVisible();
      expect(getsOf(fetchMock)).toHaveLength(1);
    },
  );

  it('lets the user retry with the same data and photo after a failure', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      lists: [[], [CREATED]],
      creates: [networkError, respond(CREATED, 201)],
    });
    await openForm(user);
    const photo = jpg();
    await fillValid(user, photo);

    await user.click(submitButton());
    const alert = await screen.findByRole('alertdialog');
    await user.click(
      within(alert).getByRole('button', { name: 'Back to form' }),
    );
    await user.click(submitButton());

    expect(
      await screen.findByRole('dialog', { name: 'Patient registered' }),
    ).toBeVisible();
    const posts = postsOf(fetchMock);
    expect(posts).toHaveLength(2);
    const retried = posts[1][1]?.body as FormData;
    expect(retried.get('full_name')).toBe('Ana Pérez');
    expect((retried.get('photo') as File).name).toBe(photo.name);
    expect((retried.get('photo') as File).size).toBe(photo.size);
  });
});
