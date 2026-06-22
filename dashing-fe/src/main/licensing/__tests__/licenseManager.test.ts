import { LICENSING_ENABLED } from '../../../shared/config';
import { getLicenseManager } from '../licenseManager';
import { Feature } from '../features';

describe('licensing disabled flag', () => {
  const manager = getLicenseManager();

  it('is currently disabled (temporarily hidden)', () => {
    expect(LICENSING_ENABLED).toBe(false);
  });

  it('enables every feature when licensing is disabled', () => {
    // A feature that normally requires a Pro/Enterprise license
    expect(manager.isFeatureEnabled(Feature.TEST_CASE_GENERATION)).toBe(true);
    expect(manager.isFeatureEnabled(Feature.CLOUD_SYNC)).toBe(true);
    expect(manager.isFeatureEnabled(Feature.SSO)).toBe(true);
  });

  it('reports the highest tier so limits are generous', () => {
    expect(manager.getCurrentTier()).toBe('enterprise');
  });

  it('reports an unlocked enterprise status', () => {
    const status = manager.getStatus();
    expect(status.isLicensed).toBe(true);
    expect(status.tier).toBe('enterprise');
  });
});
