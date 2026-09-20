import { MaxOsError } from '../errors';
import type { Envelope, IdentityEnvelope, IdentityMetadata, MaxOsBindings } from '../types';

const IDENTITY_TYPES = new Set<IdentityEnvelope['type']>(['service', 'system', 'user']);

export function validateIdentityEnvelope(identity: unknown): identity is IdentityEnvelope {
  if (typeof identity !== 'object' || identity === null) return false;
  const candidate = identity as Partial<IdentityEnvelope>;
  return typeof candidate.credential === 'string'
    && candidate.credential.trim().length > 0
    && typeof candidate.id === 'string'
    && candidate.id.trim().length > 0
    && typeof candidate.type === 'string'
    && IDENTITY_TYPES.has(candidate.type as IdentityEnvelope['type'])
    && candidate.authenticated === true
    && Array.isArray(candidate.roles)
    && candidate.roles.length > 0
    && candidate.roles.every((role) => typeof role === 'string' && role.trim().length > 0);
}

export function enforceIdentityMode(bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>): void {
  if (bindings.PLANETARY_MODE !== 'active') {
    throw new MaxOsError('IDENTITY_INVALID', 'PLANETARY_MODE must be active', 403);
  }
  if (bindings.UMBRELLA_ENFORCEMENT !== 'enabled') {
    throw new MaxOsError('IDENTITY_INVALID', 'UMBRELLA_ENFORCEMENT must be enabled', 403);
  }
}

export function attachIdentityMetadata(
  envelope: Envelope,
  bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
): IdentityMetadata {
  if (!validateIdentityEnvelope(envelope.identity)) {
    throw new MaxOsError('IDENTITY_INVALID', 'A valid authenticated identity is required', 401);
  }
  enforceIdentityMode(bindings);
  return {
    identityId: envelope.identity.id,
    identityType: envelope.identity.type,
    roles: [...envelope.identity.roles].sort(),
    planetaryMode: bindings.PLANETARY_MODE,
    umbrellaEnforcement: bindings.UMBRELLA_ENFORCEMENT,
    structurallyValidated: true,
  };
}
