import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import withRnCacheVideo from '../src';

/**
 * These tests exercise the config-plugin mods directly: applying the plugin registers async
 * mods under `config.mods`, and we invoke each with a synthetic `modResults` (an Android
 * manifest object / an iOS Info.plist dict / a dangerous-mod temp dir) and assert the output.
 * No prebuild, no native project — just the transform contract.
 */

// Minimal synthetic Expo config — the plugin only touches mods, so name/slug is enough.
const baseConfig = (): any => ({ name: 'test-app', slug: 'test-app' });

const androidManifest = (extra: Record<string, string> = {}) => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    application: [
      {
        $: { 'android:name': '.MainApplication', ...extra },
      },
    ],
  },
});

const runManifestMod = async (
  config: any,
  manifestResults: any
): Promise<any> => {
  const result = await config.mods.android.manifest({
    ...config,
    modResults: manifestResults,
    modRequest: {},
  });
  return result.modResults;
};

const runInfoPlistMod = async (config: any, plist: any): Promise<any> => {
  const result = await config.mods.ios.infoPlist({
    ...config,
    modResults: plist,
    modRequest: {},
  });
  return result.modResults;
};

const runDangerousMod = async (
  config: any,
  platformProjectRoot: string
): Promise<void> => {
  await config.mods.android.dangerous({
    ...config,
    modResults: {},
    modRequest: { platformProjectRoot },
  });
};

describe('withRnCacheVideo — Android network security config', () => {
  it('points <application> at our scoped network-security-config resource', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const manifest = await runManifestMod(applied, androidManifest());
    expect(
      manifest.manifest.application[0].$['android:networkSecurityConfig']
    ).toBe('@xml/rncachevideo_network_security_config');
  });

  it('does NOT set a blanket usesCleartextTraffic on the application', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const manifest = await runManifestMod(applied, androidManifest());
    expect(
      manifest.manifest.application[0].$['android:usesCleartextTraffic']
    ).toBeUndefined();
  });

  it('does not clobber a networkSecurityConfig the host app already declares', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const manifest = await runManifestMod(
      applied,
      androidManifest({
        'android:networkSecurityConfig': '@xml/host_app_config',
      })
    );
    expect(
      manifest.manifest.application[0].$['android:networkSecurityConfig']
    ).toBe('@xml/host_app_config');
  });

  it('writes an xml scoping cleartext to loopback domains only', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rncv-nsc-'));
    const applied = withRnCacheVideo(baseConfig());
    await runDangerousMod(applied, tmp);
    const xml = await fs.readFile(
      path.join(
        tmp,
        'app',
        'src',
        'main',
        'res',
        'xml',
        'rncachevideo_network_security_config.xml'
      ),
      'utf8'
    );
    expect(xml).toContain('cleartextTrafficPermitted="true"');
    expect(xml).toContain(
      '<domain includeSubdomains="false">127.0.0.1</domain>'
    );
    expect(xml).toContain(
      '<domain includeSubdomains="false">localhost</domain>'
    );
    // scoped, not a base-config wildcard
    expect(xml).not.toContain('<base-config');
  });

  it('is idempotent — applying the manifest mod twice yields the same attribute', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const once = await runManifestMod(applied, androidManifest());
    const twice = await runManifestMod(withRnCacheVideo(baseConfig()), once);
    expect(
      twice.manifest.application[0].$['android:networkSecurityConfig']
    ).toBe('@xml/rncachevideo_network_security_config');
  });
});

describe('withRnCacheVideo — iOS ATS', () => {
  it('adds insecure-load exceptions for localhost and 127.0.0.1', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const plist = await runInfoPlistMod(applied, {});
    const domains = plist.NSAppTransportSecurity.NSExceptionDomains;
    expect(domains['127.0.0.1'].NSExceptionAllowsInsecureHTTPLoads).toBe(true);
    expect(domains.localhost.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
  });

  it('does NOT set NSAllowsArbitraryLoads', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const plist = await runInfoPlistMod(applied, {});
    expect(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBeUndefined();
  });

  it('preserves existing ATS exception domains', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const plist = await runInfoPlistMod(applied, {
      NSAppTransportSecurity: {
        NSExceptionDomains: {
          'example.com': { NSExceptionAllowsInsecureHTTPLoads: true },
        },
      },
    });
    const domains = plist.NSAppTransportSecurity.NSExceptionDomains;
    expect(domains['example.com'].NSExceptionAllowsInsecureHTTPLoads).toBe(
      true
    );
    expect(domains.localhost.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
  });

  it('is idempotent — applying the plist mod twice yields the same exceptions', async () => {
    const applied = withRnCacheVideo(baseConfig());
    const once = await runInfoPlistMod(applied, {});
    const twice = await runInfoPlistMod(withRnCacheVideo(baseConfig()), once);
    const domains = twice.NSAppTransportSecurity.NSExceptionDomains;
    expect(Object.keys(domains).sort()).toEqual(['127.0.0.1', 'localhost']);
    expect(domains.localhost.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
  });
});
