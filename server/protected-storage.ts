import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const dataDirectory = () => resolve(process.env.ALLOWANCE_DATA_DIR || '.local');

function encryptionKey() {
  const value = process.env.ALLOWANCE_STORAGE_KEY;
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Protected storage requires a 32-byte base64 encryption key.');
  return key;
}

export function protectedStorageReady() {
  return Boolean(encryptionKey()) || process.platform === 'win32';
}

export function protect(value: string) {
  const key = encryptionKey();
  if (key) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return 'v1:' + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  if (process.platform !== 'win32') throw new Error('Set up protected storage for Testnet keys.');
  return execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',"$s=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $s -AsPlainText -Force)"], {
    input: value, encoding: 'utf8', windowsHide: true,
  }).trim();
}

export function unprotect(path: string) {
  const encoded = readFileSync(path, 'utf8');
  if (encoded.startsWith('v1:')) {
    const key = encryptionKey();
    if (!key) throw new Error('The protected storage key is missing.');
    const payload = Buffer.from(encoded.slice(3), 'base64');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Could not unlock protected Testnet storage.');
    }
  }
  if (process.platform !== 'win32') throw new Error('This legacy key is tied to the original Windows account. Save a key for this deployment.');
  return execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',"$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"], {
    input: encoded, encoding: 'utf8', windowsHide: true,
  }).trim();
}
