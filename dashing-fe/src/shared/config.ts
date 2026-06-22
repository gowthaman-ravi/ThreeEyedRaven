/**
 * App-wide configuration flags shared by the main and renderer processes.
 */

/**
 * Master switch for the licensing and cloud-sync features.
 *
 * Temporarily disabled: all features are enabled by default and the
 * licensing/sync UI is hidden. Flip back to `true` to re-enable licensing.
 */
export const LICENSING_ENABLED = false;
