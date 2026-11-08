import type { FieldErrors, TextFieldName } from './api';

export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const REQUIRED = 'Required.';
export const NAME_INVALID = 'Use letters and single spaces only.';
export const NAME_TOO_LONG = `Use at most ${MAX_NAME_LENGTH} characters.`;
export const EMAIL_INVALID = 'Enter a valid Gmail address (@gmail.com).';
export const PREFIX_INVALID =
  'Use + followed by 1 to 4 digits, not starting with 0.';
export const NUMBER_INVALID = 'Use 6 to 15 digits only.';
export const PHOTO_EXTENSION = 'Photo must be a .jpg file.';
export const PHOTO_EMPTY = 'Photo file is empty.';
export const PHOTO_TOO_LARGE = 'Photo must be 5 MB or smaller.';
export const PHOTO_NOT_JPEG = 'Photo must be a JPEG image.';

const NAME = /^\p{L}+(?: \p{L}+)*$/u;
const EMAIL_LOCAL = /^[a-z0-9_+-]+(?:\.[a-z0-9_+-]+)*$/;
const PHONE_PREFIX = /^\+[1-9][0-9]{0,3}$/;
const PHONE_NUMBER = /^[0-9]{6,15}$/;

export type FormValues = Record<TextFieldName, string>;

export function normalizeFullName(raw: string): string {
  return raw.normalize('NFC').trim();
}

export function validateFullName(raw: string): string | null {
  const value = normalizeFullName(raw);
  if (!value) return REQUIRED;
  if (!NAME.test(value)) return NAME_INVALID;
  if ([...value].length > MAX_NAME_LENGTH) return NAME_TOO_LONG;
  return null;
}

export function validateEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return REQUIRED;
  const at = value.lastIndexOf('@');
  const local = value.slice(0, Math.max(at, 0));
  const domain = value.slice(at + 1);
  if (
    at < 0 ||
    domain !== 'gmail.com' ||
    value.length > MAX_EMAIL_LENGTH ||
    !EMAIL_LOCAL.test(local)
  ) {
    return EMAIL_INVALID;
  }
  return null;
}

function validatePattern(
  raw: string,
  pattern: RegExp,
  message: string,
): string | null {
  const value = raw.trim();
  if (!value) return REQUIRED;
  return pattern.test(value) ? null : message;
}

export function validatePhonePrefix(raw: string): string | null {
  return validatePattern(raw, PHONE_PREFIX, PREFIX_INVALID);
}

export function validatePhoneNumber(raw: string): string | null {
  return validatePattern(raw, PHONE_NUMBER, NUMBER_INVALID);
}

export function validatePhoto(file: File | null): string | null {
  if (!file) return REQUIRED;
  if (!file.name.toLowerCase().endsWith('.jpg')) return PHOTO_EXTENSION;
  if (file.size === 0) return PHOTO_EMPTY;
  if (file.size > MAX_PHOTO_BYTES) return PHOTO_TOO_LARGE;
  if (file.type && file.type !== 'image/jpeg') return PHOTO_NOT_JPEG;
  return null;
}

export function validateForm(
  values: FormValues,
  photo: File | null,
): FieldErrors {
  const checks = {
    full_name: validateFullName(values.full_name),
    email: validateEmail(values.email),
    phone_prefix: validatePhonePrefix(values.phone_prefix),
    phone_number: validatePhoneNumber(values.phone_number),
    photo: validatePhoto(photo),
  };
  const errors: FieldErrors = {};
  for (const [field, message] of Object.entries(checks)) {
    if (message) errors[field as keyof FieldErrors] = message;
  }
  return errors;
}
