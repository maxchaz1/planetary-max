import { describe, expect, it } from 'vitest';
import { MaxOsError } from '../../src/maxos/errors';
import { attachIdentityMetadata, enforceIdentityMode, validateIdentityEnvelope } from '../../src/maxos/identity/lane';
import { envelope, identity } from './fixtures';

describe('identity lane', () => {
  it('validates authenticated identities and attaches sorted metadata', () => {
    expect(validateIdentityEnvelope(identity)).toBe(true);
    const metadata = attachIdentityMetadata(
      envelope({ identity: { ...identity, roles: ['writer', 'operator'] } }),
      { PLANETARY_MODE: 'active', UMBRELLA_ENFORCEMENT: 'enabled' },
    );
    expect(metadata.roles).toEqual(['operator', 'writer']);
    expect(metadata.structurallyValidated).toBe(true);
  });

  it('fails closed for invalid identity or disabled enforcement modes', () => {
    expect(validateIdentityEnvelope({ ...identity, authenticated: false })).toBe(false);
    expect(() => enforceIdentityMode({ PLANETARY_MODE: 'inactive', UMBRELLA_ENFORCEMENT: 'enabled' }))
      .toThrowError(MaxOsError);
    expect(() => enforceIdentityMode({ PLANETARY_MODE: 'active', UMBRELLA_ENFORCEMENT: 'disabled' }))
      .toThrowError(MaxOsError);
  });
});
