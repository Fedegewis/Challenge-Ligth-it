export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

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
  return body.map((patient) => ({
    id: patient.id,
    fullName: patient.full_name,
    email: patient.email,
    phonePrefix: patient.phone_prefix,
    phoneNumber: patient.phone_number,
    photoUrl: resolveApiUrl(patient.photo_url),
    createdAt: patient.created_at,
  }));
}
