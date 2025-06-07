/**
 * @file Defines a custom error class for the application.
 */

/**
 * Interface for providing additional details in an AppError.
 * @interface AppErrorDetails
 * @property {string} [errorCode] - A unique code identifying the type of error (e.g., 'NETWORK_ERROR', 'FILE_NOT_FOUND').
 * @property {boolean} [isOperational] - True if the error is operational (expected, part of normal app flow), false if it's a programmer error.
 * @property {Error} [originalError] - The original error object, if this AppError is wrapping another error.
 * @property {any} [key: string] - Allows for other custom details to be included.
 */
export interface AppErrorDetails {
  errorCode?: string;
  isOperational?: boolean;
  originalError?: Error;
  [key: string]: any; // Allow other custom details
}

/**
 * Custom error class for the application.
 * Extends the built-in Error class to include additional details like error codes and operational status.
 * @class AppError
 * @extends {Error}
 */
export class AppError extends Error {
  /**
   * Optional details associated with the error, conforming to the AppErrorDetails interface.
   * @public
   * @readonly
   * @type {AppErrorDetails | undefined}
   */
  public readonly details?: AppErrorDetails;

  /**
   * Creates an instance of AppError.
   * @constructor
   * @param {string} message - The human-readable error message.
   * @param {AppErrorDetails} [details] - Optional object containing additional error details.
   */
  constructor(message: string, details?: AppErrorDetails) {
    super(message);
    this.name = this.constructor.name; // Sets the error name to the class name (AppError)
    this.details = details;

    // Maintains proper stack trace in V8 (Node.js / Chrome)
    // This ensures that the AppError class itself does not appear in the stack trace.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
