import { describe, expect, it } from 'vitest';
import { MaxOsError } from '../../src/maxos/errors';
import {
  attachGovernanceMetadata,
  enforcePlanetaryRules,
  enforceSessionRules,
  enforceUmbrellaRules,
  validateGovernanceContext,
} from '../../src/maxos/governance/lane';
import { envelope, governanceContext } from './fixtures';

describe('governance lane', () => {
  it('enforces all governance scopes and attaches deterministic policies', () => {
    expect(validateGovernanceContext(governanceContext)).toBe(true);
    expect(() => enforceUmbrellaRules(governanceContext)).not.toThrow();
    expect(() => enforcePlanetaryRules(governanceContext)).not.toThrow();
    expect(() => enforceSessionRules(governanceContext)).not.toThrow();
    expect(attachGovernanceMetadata(envelope()).policies).toEqual([
      'umbrella-v1',
      'planetary-v1',
      'session-v1',
    ]);
  });

  it('fails closed when a scope denies or an explicit deny is present', () => {
    const denied = { ...governanceContext, umbrella: { allowed: false, policy: 'deny' } };
    expect(validateGovernanceContext(denied)).toBe(false);
    expect(() => enforceUmbrellaRules(denied)).toThrowError(MaxOsError);
    expect(validateGovernanceContext({ ...governanceContext, deny: true })).toBe(false);
    expect(validateGovernanceContext({ ...governanceContext, tenant: 42 })).toBe(false);
  });
});
