/** Stable machine-readable errors for the authoring broker and MCP facade. */
export type AuthoringCode =
  | 'INVALID_PAYLOAD' | 'UNKNOWN_PROJECT' | 'PROJECT_EXISTS' | 'UNKNOWN_CHANGE' | 'UNKNOWN_RENDER' | 'UNKNOWN_BACKUP'
  | 'TARGET_CHANGED' | 'TARGET_MISMATCH' | 'LEASE_REQUIRED' | 'LEASE_CONFLICT' | 'OPERATION_ID_CONFLICT'
  | 'OUTCOME_UNKNOWN' | 'HOST_UNAVAILABLE' | 'HOST_BUSY' | 'EXPORT_FAILED' | 'EXPORT_INVALID' | 'SAVE_FAILED'
  | 'UNSUPPORTED_CAPABILITY' | 'UNSUPPORTED_PROJECT_FORMAT' | 'PACK_INVALID' | 'WRITER_BUSY'
  | 'JOURNAL_CORRUPT' | 'NOT_APPLIED' | 'OPERATION_FAILED';

export class AuthoringError extends Error {
  constructor(readonly code: AuthoringCode | string, detail: string, readonly effectsPossible = false) {
    super(`${code}: ${detail}`);
    this.name = 'AuthoringError';
  }
}
