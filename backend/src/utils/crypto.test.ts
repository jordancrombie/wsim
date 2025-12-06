import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  generateToken,
  generateWalletCardToken,
  parseWalletCardToken,
} from './crypto';

describe('encrypt/decrypt', () => {
  it('should encrypt and decrypt a string correctly', () => {
    const plaintext = 'Hello, World!';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt empty string', () => {
    const plaintext = '';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt special characters', () => {
    const plaintext = '🔐 Ñoño "quotes" <html> & symbols!';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt long text', () => {
    const plaintext = 'A'.repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same input (random IV)', () => {
    const plaintext = 'Same input twice';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same value
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it('should produce ciphertext in correct format (iv:authTag:encrypted)', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');

    expect(parts).toHaveLength(3);
    // IV is 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Encrypted data is hex
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it('should throw on invalid format (missing parts)', () => {
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted text format');
    expect(() => decrypt('part1:part2')).toThrow('Invalid encrypted text format');
    expect(() => decrypt('')).toThrow('Invalid encrypted text format');
  });

  it('should throw on tampered ciphertext', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');

    // Tamper with the encrypted data
    const tamperedData = 'ff'.repeat(parts[2].length / 2);
    const tampered = `${parts[0]}:${parts[1]}:${tamperedData}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it('should throw on tampered auth tag', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');

    // Tamper with the auth tag
    const tamperedTag = 'ff'.repeat(16);
    const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('generateToken', () => {
  it('should generate token of default length (32 bytes = 64 hex chars)', () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('should generate token of specified length', () => {
    const token16 = generateToken(16);
    const token8 = generateToken(8);

    expect(token16).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(token8).toHaveLength(16); // 8 bytes = 16 hex chars
  });

  it('should generate unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateToken());
    }
    expect(tokens.size).toBe(100);
  });

  it('should handle edge case of 0 length', () => {
    const token = generateToken(0);
    expect(token).toBe('');
  });
});

describe('generateWalletCardToken', () => {
  it('should generate token in correct format', () => {
    const token = generateWalletCardToken('bsim');
    expect(token).toMatch(/^wsim_bsim_[0-9a-f]{12}$/);
  });

  it('should include the bsimId in the token', () => {
    const token = generateWalletCardToken('td-bank');
    expect(token).toMatch(/^wsim_td-bank_[0-9a-f]{12}$/);
  });

  it('should generate unique tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateWalletCardToken('bsim'));
    }
    expect(tokens.size).toBe(100);
  });

  it('should handle special characters in bsimId', () => {
    const token = generateWalletCardToken('bank-123');
    expect(token).toMatch(/^wsim_bank-123_[0-9a-f]{12}$/);
  });
});

describe('parseWalletCardToken', () => {
  it('should parse valid token', () => {
    const result = parseWalletCardToken('wsim_bsim_abc123def456');

    expect(result).toEqual({
      bsimId: 'bsim',
      uniqueId: 'abc123def456',
    });
  });

  it('should parse token with hyphenated bsimId', () => {
    const result = parseWalletCardToken('wsim_td-bank_abc123');

    expect(result).toEqual({
      bsimId: 'td-bank',
      uniqueId: 'abc123',
    });
  });

  it('should return null for invalid prefix', () => {
    expect(parseWalletCardToken('invalid_bsim_abc123')).toBeNull();
    expect(parseWalletCardToken('WSIM_bsim_abc123')).toBeNull();
  });

  it('should return null for wrong number of parts', () => {
    expect(parseWalletCardToken('wsim_only')).toBeNull();
    expect(parseWalletCardToken('wsim_a_b_c')).toBeNull();
    expect(parseWalletCardToken('wsim')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseWalletCardToken('')).toBeNull();
  });

  it('should roundtrip with generateWalletCardToken', () => {
    const bsimId = 'test-bank';
    const token = generateWalletCardToken(bsimId);
    const parsed = parseWalletCardToken(token);

    expect(parsed).not.toBeNull();
    expect(parsed?.bsimId).toBe(bsimId);
    expect(parsed?.uniqueId).toHaveLength(12);
  });
});
