import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './api';

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
