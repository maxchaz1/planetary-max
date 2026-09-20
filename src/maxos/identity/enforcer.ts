import { MaxOsError } from '../errors';
import type { Envelope, IdentityMetadata, MaxOsBindings } from '../types';
import { attachIdentityMetadata, validateIdentityEnvelope } from './lane';

export function enforceIdentity(
  envelope: Envelope,
  bindings: Pick<MaxOsBindings, 'PLANETARY_MODE' | 'UMBRELLA_ENFORCEMENT'>,
): IdentityMetadata {
  if (!validateIdentityEnvelope(envelope.identity)) {
    throw new MaxOsError('IDENTITY_INVALID', 'Identity validation failed closed', 401);
  }
  return attachIdentityMetadata(envelope, bindings);
}
