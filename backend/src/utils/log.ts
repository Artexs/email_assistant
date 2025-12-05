/**
 * Simple logging utility
 * This is a placeholder that will be replaced with a more advanced logging system in the future
 */

export const log = {
  info: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.log(...args);
  },

  error: (...args: unknown[]): void => {
    // eslint-disable-next-line no-console
    console.error(...args);
  },
};
