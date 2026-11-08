import { describe, expect, it } from 'vitest';
import { isPatientResponse, resolveApiUrl } from './api';

const CREATED = {
  id: 1,
  full_name: 'Ana Pérez',
  email: 'ana.perez@gmail.com',
  phone_prefix: '+54',
  phone_number: '1155667788',
  photo_url: '/patients/1/photo',
  created_at: '2026-11-07T21:00:00Z',
};

describe('isPatientResponse', () => {
  it('accepts the §2.1 create response', () => {
    expect(isPatientResponse(CREATED)).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', [CREATED]],
    ['a string', 'created'],
    ['id 0', { ...CREATED, id: 0 }],
    ['a fractional id', { ...CREATED, id: 1.5 }],
    ['a string id', { ...CREATED, id: '1' }],
    ['a missing email', { ...CREATED, email: undefined }],
    ['a numeric phone_number', { ...CREATED, phone_number: 1155667788 }],
    ['an empty photo_url', { ...CREATED, photo_url: '' }],
    ['an unparseable created_at', { ...CREATED, created_at: 'soon' }],
  ])('rejects %s', (_, value) => {
    expect(isPatientResponse(value)).toBe(false);
  });
});

describe('resolveApiUrl', () => {
  it.each([
    [
      '/patients/1/photo',
      'http://localhost:8000',
      'http://localhost:8000/patients/1/photo',
    ],
    [
      '/patients/1/photo',
      'http://localhost:8000/',
      'http://localhost:8000/patients/1/photo',
    ],
    [
      '/patients/1/photo',
      'http://api.test/v1',
      'http://api.test/v1/patients/1/photo',
    ],
    ['patients', 'http://api.test/v1/', 'http://api.test/v1/patients'],
    [
      'https://cdn.test/photo.jpg',
      'http://api.test/v1',
      'https://cdn.test/photo.jpg',
    ],
  ])('resolves %s against %s', (path, base, expected) => {
    expect(resolveApiUrl(path, base)).toBe(expected);
  });
});
