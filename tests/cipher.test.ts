import { describe, expect, it } from 'vitest';
import { JsExecCipher } from '../src/cipher.js';

// Synthetic base.js that mimics the shape of YouTube's signature/throttling
// functions. This validates that JsExecCipher can extract function source via
// regex + parser and execute it under `Function()`.
// Note: pytube's throttling-name regex literally requires `a.X && (b=a.get("n"))`,
// so the call site below MUST use a parameter named `a`.
const FAKE_BASE_JS = `
var DE={
  AJ:function(a){a.reverse()},
  VR:function(a,b){a.splice(0,b)},
  kT:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c}
};
Cra=function(a){a=a.split("");DE.AJ(a,15);DE.VR(a,3);DE.kT(a,7);return a.join("")};
var x={};c&&a.set("signature",encodeURIComponent(Cra(b)));
Dea=function(a){var b=a.split("");b.reverse();return b.join("")};
function caller(a){a.x&&(b=a.get("n"))&&(b=Dea(b),a.set("n",b));}
`;

describe('JsExecCipher', () => {
  it('decrypts signatures using extracted base.js functions', () => {
    const cipher = new JsExecCipher(FAKE_BASE_JS);
    const input = 'abcdefghijklmnopqrstuvwxyz';
    const out = cipher.getSignature(input);
    // Expected: split → reverse → splice(3) → swap[0]/[7%len] → join.
    // Sanity-check by recomputing with the same JS shape.
    const expected = ((s: string) => {
      const a = s.split('');
      a.reverse();
      a.splice(0, 3);
      const idx = 7 % a.length;
      const tmp = a[0] ?? '';
      a[0] = a[idx] ?? '';
      a[idx] = tmp;
      return a.join('');
    })(input);
    expect(out).toBe(expected);
  });

  it('decrypts the n parameter', () => {
    const cipher = new JsExecCipher(FAKE_BASE_JS);
    const out = cipher.calculateN('abc123');
    expect(out).toBe('321cba');
  });

  it('memoizes calculateN for the same input', () => {
    const cipher = new JsExecCipher(FAKE_BASE_JS);
    const a = cipher.calculateN('hello');
    const b = cipher.calculateN('hello');
    expect(a).toBe(b);
  });
});
