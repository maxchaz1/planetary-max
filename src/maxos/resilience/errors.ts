export type MaxOsErrorCode =
  | 'CIRCUIT_OPEN'
  | 'GOVERNANCE_DENIED'
  | 'IDENTITY_INVALID'
  | 'INVALID_ENVELOPE'
  | 'KERNEL_INVALID_RESPONSE'
  | 'KERNEL_TIMEOUT'
  | 'KERNEL_UNAVAILABLE'
  | 'RESERVATION_CONFLICT'
  | 'ROUTE_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'SUBSTRATE_TIMEOUT'
  | 'SUBSTRATE_UNAVAILABLE';

export class MaxOsError extends Error {
  constructor(
    readonly code: MaxOsErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class IdentityError extends MaxOsError {
  constructor(message: string, status = 401) {
    super('IDENTITY_INVALID', message, status, false);
  }
}

export class GovernanceError extends MaxOsError {
  constructor(message: string) {
    super('GOVERNANCE_DENIED', message, 403, false);
  }
}

export class RoutingError extends MaxOsError {
  constructor(message: string) {
    super('ROUTE_NOT_FOUND', message, 422, false);
  }
}

export class KernelError extends MaxOsError {
  constructor(
    message: string,
    code: Extract<MaxOsErrorCode, 'CIRCUIT_OPEN' | 'KERNEL_INVALID_RESPONSE' | 'KERNEL_TIMEOUT' | 'KERNEL_UNAVAILABLE'>,
    status = 503,
    retryable = false,
  ) {
    super(code, message, status, retryable);
  }
}

export class SubstrateError extends MaxOsError {
  constructor(
    message: string,
    code: Extract<MaxOsErrorCode, 'STATE_CONFLICT' | 'SUBSTRATE_TIMEOUT' | 'SUBSTRATE_UNAVAILABLE'>,
    status = 503,
    retryable = false,
  ) {
    super(code, message, status, retryable);
  }
}

export class ReservationError extends MaxOsError {
  constructor(message: string) {
    super('RESERVATION_CONFLICT', message, 409, false);
  }
}

export function toErrorResponse(error: unknown): Response {
  const maxOsError = error instanceof MaxOsError
    ? error
    : new KernelError('MAX-OS-1 request failed', 'KERNEL_UNAVAILABLE');

  return Response.json(
    {
      ok: false,
      status: maxOsError.status,
      error: { code: maxOsError.code, message: maxOsError.message },
    },
    { status: maxOsError.status },
  );
}
