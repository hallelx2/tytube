// Regex-port cipher fallback for runtimes that block `Function()` / eval
// (Cloudflare Workers, browsers under strict CSP).
//
// This is a direct port of pytube/cipher.py's regex-mapped Python transforms.
// It is intentionally pessimistic: every YouTube `base.js` change can break it,
// just like it breaks pytube. The Eval-based JsExecCipher in cipher.ts is the
// preferred path on every runtime that allows it.
//
// Status: SCAFFOLD ONLY. This file is not yet wired into runtime selection.
// Implementing the full ~500 LOC port is tracked as future work — without it,
// tytube will throw on Cloudflare Workers.

import { ExtractError } from './exceptions.js';
import type { CipherLike } from './cipher-types.js';

export class RegexPortCipher implements CipherLike {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_js: string) {
    throw new ExtractError(
      'RegexPortCipher is not yet implemented. Use a runtime that supports Function() / eval.',
    );
  }

  getSignature(_cipheredSignature: string): string {
    throw new ExtractError('RegexPortCipher.getSignature not implemented.');
  }

  calculateN(_initialN: string): string {
    throw new ExtractError('RegexPortCipher.calculateN not implemented.');
  }
}
