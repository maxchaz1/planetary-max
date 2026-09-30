import { MaxOsError } from '../errors';
import type { Envelope, GovernanceEnvelope, GovernanceMetadata } from '../types';

type GovernanceScope = 'planetary' | 'session' | 'umbrella';

const GOVERNANCE_SCOPES: GovernanceScope[] = ['umbrella', 'planetary', 'session'];

export function validateGovernanceContext(context: unknown): context is GovernanceEnvelope {
  if (typeof context !== 'object' || context === null) return false;
  const candidate = context as Partial<GovernanceEnvelope>;
  const scopesValid = GOVERNANCE_SCOPES.every((scope) => {
    const rule = candidate[scope];
    return typeof rule === 'object'
      && rule !== null
      && rule.allowed === true
      && typeof rule.policy === 'string'
      && rule.policy.trim().length > 0;
  });
  const denyValid = candidate.deny === undefined || typeof candidate.deny === 'boolean';
  const tenantValid = candidate.tenant === undefined
    || (typeof candidate.tenant === 'string' && candidate.tenant.trim().length > 0);
  return scopesValid && denyValid && candidate.deny !== true && tenantValid;
}

function enforceRule(context: GovernanceEnvelope, scope: GovernanceScope): void {
  if (!context[scope].allowed) {
    throw new MaxOsError('GOVERNANCE_DENIED', `${scope} governance denied the request`, 403);
  }
}

export function enforceUmbrellaRules(context: GovernanceEnvelope): void {
  enforceRule(context, 'umbrella');
}

export function enforcePlanetaryRules(context: GovernanceEnvelope): void {
  enforceRule(context, 'planetary');
}

export function enforceSessionRules(context: GovernanceEnvelope): void {
  enforceRule(context, 'session');
}

export function attachGovernanceMetadata(envelope: Envelope): GovernanceMetadata {
  if (!validateGovernanceContext(envelope.governanceContext)) {
    throw new MaxOsError('GOVERNANCE_DENIED', 'Governance validation failed closed', 403);
  }
  const context = envelope.governanceContext;
  enforceUmbrellaRules(context);
  enforcePlanetaryRules(context);
  enforceSessionRules(context);
  return {
    policies: GOVERNANCE_SCOPES.map((scope) => context[scope].policy),
    ...(context.tenant === undefined ? {} : { tenant: context.tenant }),
    umbrellaEnforced: true,
    planetaryEnforced: true,
    sessionEnforced: true,
    validated: true,
  };
}
