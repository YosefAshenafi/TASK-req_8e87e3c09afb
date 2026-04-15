export type AppError =
  | { code: 'NotFound'; detail: string }
  | { code: 'Validation'; detail: string; field?: string }
  | { code: 'VersionConflict'; objectId: string; local: number; incoming: number }
  | { code: 'LockedOut'; until: number }
  | { code: 'QuotaExceeded'; sizeBytes: number; limitBytes: number }
  | { code: 'NotSupported'; feature: string };

export class AppException extends Error {
  constructor(public readonly error: AppError) {
    super(error.code);
    this.name = 'AppException';
  }
}
