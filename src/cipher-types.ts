// Shared interface to break the import cycle between extract.ts and cipher.ts.

export interface CipherLike {
  getSignature(cipheredSignature: string): string;
  calculateN(initialN: string): string;
}
