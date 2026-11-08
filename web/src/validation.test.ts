import { describe, expect, it } from 'vitest';
import {
  EMAIL_INVALID,
  MAX_PHOTO_BYTES,
  NAME_INVALID,
  NAME_TOO_LONG,
  NUMBER_INVALID,
  PHOTO_EMPTY,
  PHOTO_EXTENSION,
  PHOTO_NOT_JPEG,
  PHOTO_TOO_LARGE,
  PREFIX_INVALID,
  REQUIRED,
  normalizeFullName,
  validateEmail,
  validateFullName,
  validatePhoneNumber,
  validatePhonePrefix,
  validatePhoto,
} from './validation';

describe('full name (D-01 shared examples)', () => {
  it.each([
    ['María', 'María'],
    ['  María José Pérez  ', 'María José Pérez'],
    ['Zoë Ñúñez', 'Zoë Ñúñez'],
    ['José', 'José'],
    ['李小龙', '李小龙'],
    ['a'.repeat(100), 'a'.repeat(100)],
  ])('accepts %j', (raw, stored) => {
    expect(validateFullName(raw)).toBeNull();
    expect(normalizeFullName(raw)).toBe(stored);
  });

  it.each([
    ['', REQUIRED],
    ['   ', REQUIRED],
    ['Ana  María', NAME_INVALID],
    ['Ana\tMaría', NAME_INVALID],
    ["O'Brien", NAME_INVALID],
    ['García-López', NAME_INVALID],
    ['John3', NAME_INVALID],
    ['Dr. Smith', NAME_INVALID],
    ['a'.repeat(101), NAME_TOO_LONG],
  ])('rejects %j', (raw, message) => {
    expect(validateFullName(raw)).toBe(message);
  });
});

describe('email (D-02)', () => {
  it.each([
    'ana.perez@gmail.com',
    '  Ana.Perez@GMAIL.com ',
    'ana+clinic@gmail.com',
  ])('accepts %j', (raw) => {
    expect(validateEmail(raw)).toBeNull();
  });

  it.each([
    'ana@googlemail.com',
    'ana@mail.gmail.com',
    'ana@gmail.co',
    '.ana@gmail.com',
    'ana.@gmail.com',
    'ana..p@gmail.com',
    '@gmail.com',
    'ana',
    'ana@b@gmail.com',
    'añá@gmail.com',
    `${'a'.repeat(245)}@gmail.com`,
  ])('rejects %j', (raw) => {
    expect(validateEmail(raw)).toBe(EMAIL_INVALID);
  });

  it('requires a value', () => {
    expect(validateEmail('  ')).toBe(REQUIRED);
  });
});

describe('phone (D-04)', () => {
  it.each(['+54', '+1', '+1234', ' +54 '])('accepts prefix %j', (raw) => {
    expect(validatePhonePrefix(raw)).toBeNull();
  });

  it.each(['54', '+054', '+12345', '+', '+5a', '+٥٤'])(
    'rejects prefix %j',
    (raw) => {
      expect(validatePhonePrefix(raw)).toBe(PREFIX_INVALID);
    },
  );

  it.each(['1155667788', '123456', '123456789012345'])(
    'accepts number %j',
    (raw) => {
      expect(validatePhoneNumber(raw)).toBeNull();
    },
  );

  it.each([
    '11 5566',
    '12345',
    '1234567890123456',
    '11-55667788',
    '(11)556677',
    '١٢٣٤٥٦',
  ])('rejects number %j', (raw) => {
    expect(validatePhoneNumber(raw)).toBe(NUMBER_INVALID);
  });

  it('requires both parts', () => {
    expect(validatePhonePrefix('')).toBe(REQUIRED);
    expect(validatePhoneNumber(' ')).toBe(REQUIRED);
  });
});

function fileOf(name: string, size: number, type = 'image/jpeg'): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('photo (D-05, D-06 client checks)', () => {
  it.each([
    fileOf('valid.jpg', 1024),
    fileOf('VALID.JPG', 1024),
    fileOf('limit.jpg', MAX_PHOTO_BYTES),
    fileOf('no-type.jpg', 1024, ''),
  ])('accepts $name', (file) => {
    expect(validatePhoto(file)).toBeNull();
  });

  it.each([
    [null, REQUIRED],
    [fileOf('valid.jpeg', 1024), PHOTO_EXTENSION],
    [fileOf('photo.png', 1024, 'image/png'), PHOTO_EXTENSION],
    [fileOf('photo', 1024), PHOTO_EXTENSION],
    [fileOf('empty.jpg', 0), PHOTO_EMPTY],
    [fileOf('big.jpg', MAX_PHOTO_BYTES + 1), PHOTO_TOO_LARGE],
    [fileOf('renamed.jpg', 1024, 'image/png'), PHOTO_NOT_JPEG],
  ])('rejects %#', (file, message) => {
    expect(validatePhoto(file)).toBe(message);
  });
});
