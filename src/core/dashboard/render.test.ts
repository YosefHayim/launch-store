import { describe, expect, it } from 'vitest';
import { renderDashboardHtml } from './render.js';
import type { DashboardState } from '../types.js';

const GENERATED_AT = '2026-06-18T12:00:00.000Z';

/** A populated baseline state; tests override only the slice they exercise. */
function state(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    generatedAt: GENERATED_AT,
    launchHome: '/home/dev/.launch',
    project: {
      providers: {
        credentials: 'local',
        storage: 'local',
        buildEngine: 'fastlane',
        submit: 'app-store-connect',
      },
      profiles: ['production', 'preview'],
      apps: [{ name: 'pomedero', version: '1.0.0', bundleId: 'com.x.pomedero', packageName: null }],
    },
    accounts: [{ label: 'Personal', keyId: 'KEY1', teamId: 'TEAM1', appCount: 2, active: true }],
    artifacts: [
      {
        app: 'pomedero',
        platform: 'ios',
        version: '1.0.0',
        buildNumber: 7,
        createdAt: GENERATED_AT,
        sizeMB: 30,
        pruned: false,
      },
    ],
    secrets: [{ app: 'pomedero', profile: null, name: 'SENTRY_AUTH_TOKEN' }],
    cloudHost: null,
    ...overrides,
  };
}

/** Extract the embedded `application/json` snapshot from rendered HTML. */
function embeddedJson(html: string): string {
  const match =
    /<script id="launch-dashboard-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error('no embedded state script found');
  return match[1];
}

describe('renderDashboardHtml', () => {
  it('is a self-contained HTML document with every section heading', () => {
    const html = renderDashboardHtml(state());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const heading of [
      'Project',
      'Apps',
      'Apple accounts',
      'Recent builds',
      'Build secrets',
      'Remote build host',
    ]) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
    // Self-contained: no external stylesheets, scripts, or images to fetch.
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="http');
  });

  it('renders the data the snapshot carries', () => {
    const html = renderDashboardHtml(state());
    expect(html).toContain('pomedero');
    expect(html).toContain('SENTRY_AUTH_TOKEN');
    expect(html).toContain('30 MB');
    expect(html).toContain('>active<');
  });

  it('escapes a script-injection attempt in user-controlled strings', () => {
    const html = renderDashboardHtml(
      state({
        project: {
          providers: {
            credentials: 'local',
            storage: 'local',
            buildEngine: 'fastlane',
            submit: 'app-store-connect',
          },
          profiles: [],
          apps: [
            { name: '<script>alert(1)</script>', version: null, bundleId: null, packageName: null },
          ],
        },
      }),
    );
    // The raw injection never appears as live markup …
    expect(html).not.toContain('<script>alert(1)</script>');
    // … it survives only in its escaped form.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it("embeds the snapshot as valid JSON with `<` escaped so it can't break out of the script tag", () => {
    const html = renderDashboardHtml(
      state({
        project: {
          ...state().project,
          apps: [{ name: 'a</script><b>', version: null, bundleId: null, packageName: null }],
        },
      }),
    );
    const json = embeddedJson(html);
    expect(json).not.toContain('</script>');
    const parsed: DashboardState = JSON.parse(json.replace(/\\u003c/g, '<'));
    expect(parsed.project.apps[0]?.name).toBe('a</script><b>');
    expect(parsed.generatedAt).toBe(GENERATED_AT);
  });

  it("shows muted empty notes when there's nothing to list", () => {
    const html = renderDashboardHtml(
      state({
        project: { providers: state().project.providers, profiles: [], apps: [] },
        accounts: [],
        artifacts: [],
        secrets: [],
      }),
    );
    expect(html).toContain('No apps discovered.');
    expect(html).toContain('No Apple accounts onboarded.');
    expect(html).toContain('No builds recorded yet.');
    expect(html).toContain('No build secrets stored.');
    expect(html).toContain('No remote host allocated.');
  });

  it('renders the live cloud host when one is allocated', () => {
    const html = renderDashboardHtml(
      state({
        cloudHost: {
          provider: 'aws-ec2-mac',
          region: 'us-east-1',
          instanceType: 'mac2.metal',
          instanceId: 'i-abc',
          allocatedAt: GENERATED_AT,
        },
      }),
    );
    expect(html).toContain('aws-ec2-mac');
    expect(html).toContain('mac2.metal');
    expect(html).not.toContain('No remote host allocated.');
  });
});
