import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bytesToHex } from '@noble/hashes/utils.js';

import { deriveRoomMaterial } from '../src/scripts/phone-link.js';

const vectors = [
  {
    name: 'all-zero secret',
    secret: 'AAAAAAAAAAAAAAAAAAAAAA',
    tag: 'd333b4f388b30847510ff145e9fb2728',
    key: '38e6e4d416f58d6d2ec9ec08f939385f52b357a1a27bde6f22fb4cd5ae6a2c5d',
  },
  {
    name: 'incrementing-byte secret',
    secret: 'AAECAwQFBgcICQoLDA0ODw',
    tag: 'b3ef3ab05f4d2ae97542f2be6b56eddf',
    key: 'fb6269ad46400d7d9b5f9c94be905901317e4b44e4f70681922da7001388aeab',
  },
  {
    name: 'all-one secret',
    secret: '_____________________w',
    tag: '70a8c34b37604097ad6a27ad1725bd54',
    key: 'f2f072323ed777b9e0b9cbf45b95b1032c1c2e08e51116dd0071968713cf5b58',
  },
] as const;

describe('phone-link key derivation', () => {
  for (const vector of vectors) {
    it(`matches the ${vector.name} vector`, () => {
      const material = deriveRoomMaterial(vector.secret);

      assert.equal(material.tag, vector.tag);
      assert.equal(bytesToHex(material.keyBytes), vector.key);
      assert.equal(material.tag.length, 32);
      assert.equal(material.keyBytes.length, 32);
    });
  }

  it('separates the public room tag from the private AES key', () => {
    const material = deriveRoomMaterial(vectors[0].secret);

    assert.notEqual(material.tag, bytesToHex(material.keyBytes.subarray(0, 16)));
  });
});
