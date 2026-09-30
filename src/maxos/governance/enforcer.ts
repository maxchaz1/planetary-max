import { MaxOsError } from '../errors';
import type { Envelope, GovernanceMetadata } from '../types';
import { attachGovernanceMetadata, validateGovernanceContext } from './lane';

export function enforceGovernance(envelope: Envelope): GovernanceMetadata {
  if (!validateGovernanceContext(envelope.governanceContext)) {
    throw new MaxOsError('GOVERNANCE_DENIED', 'Governance validation failed closed', 403);
  }
  return attachGovernanceMetadata(envelope);
}
