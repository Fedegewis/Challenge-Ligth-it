export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export const FIELDS = [
  'full_name',
  'email',
  'phone_prefix',
  'phone_number',
  'photo',
] as const;

export type FieldName = (typeof FIELDS)[number];
export type TextFieldName = Exclude<FieldName, 'photo'>;
export type FieldErrors = Partial<Record<FieldName, string>>;

export type NewPatient = Record<TextFieldName, string> & { photo: File };

export type CreatePatientResult =
  | { kind: 'created'; patient: Patient }
  | { kind: 'invalid'; errors: FieldErrors }
  | { kind: 'failed' };

export type Patient = {
  id: number;
  fullName: string;
  email: string;
  phonePrefix: string;
  phoneNumber: string;
  photoUrl: string;
  createdAt: string;
};

type PatientResponse = {
  id: number;
  full_name: string;
  email: string;
  phone_prefix: string;
  phone_number: string;
  photo_url: string;
  created_at: string;
};

export function resolveApiUrl(path: string, base: string = API_URL): string {
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), baseWithSlash).toString();
}

export async function fetchPatients(signal?: AbortSignal): Promise<Patient[]> {
  const response = await fetch(resolveApiUrl('/patients'), { signal });
  if (!response.ok) {
    throw new Error(`GET /patients failed with ${response.status}`);
  }
  const body = (await response.json()) as PatientResponse[];
  return body.map(toPatient);
}

function toPatient(patient: PatientResponse): Patient {
  return {
    id: patient.id,
    fullName: patient.full_name,
    email: patient.email,
    phonePrefix: patient.phone_prefix,
    phoneNumber: patient.phone_number,
    photoUrl: resolveApiUrl(patient.photo_url),
    createdAt: patient.created_at,
  };
}

const PATIENT_TEXT_KEYS = [
  'full_name',
  'email',
  'phone_prefix',
  'phone_number',
  'photo_url',
  'created_at',
] as const;

export function isPatientResponse(value: unknown): value is PatientResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(record.id) &&
    (record.id as number) > 0 &&
    PATIENT_TEXT_KEYS.every(
      (key) => typeof record[key] === 'string' && record[key] !== '',
    ) &&
    !Number.isNaN(Date.parse(record.created_at as string))
  );
}

export async function createPatient(
  input: NewPatient,
): Promise<CreatePatientResult> {
  const body = new FormData();
  body.append('full_name', input.full_name);
  body.append('email', input.email);
  body.append('phone_prefix', input.phone_prefix);
  body.append('phone_number', input.phone_number);
  body.append('photo', input.photo, input.photo.name);

  let response: Response;
  try {
    response = await fetch(resolveApiUrl('/patients'), {
      method: 'POST',
      body,
    });
  } catch {
    return { kind: 'failed' };
  }

  if (response.status === 201) {
    const created: unknown = await response.json().catch(() => null);
    return isPatientResponse(created)
      ? { kind: 'created', patient: toPatient(created) }
      : { kind: 'failed' };
  }
  if (response.status === 422) {
    const errors = parseFieldErrors(await response.json().catch(() => null));
    if (errors) return { kind: 'invalid', errors };
  }
  return { kind: 'failed' };
}

function isFieldName(value: unknown): value is FieldName {
  return FIELDS.includes(value as FieldName);
}

function parseFieldErrors(body: unknown): FieldErrors | null {
  const items = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(items) || items.length === 0) return null;
  const errors: FieldErrors = {};
  for (const item of items) {
    const { field, message } = (item ?? {}) as {
      field?: unknown;
      message?: unknown;
    };
    if (!isFieldName(field) || typeof message !== 'string') return null;
    errors[field] ??= message;
  }
  return errors;
}
