import { describe, expect, it } from 'vitest';
import { workflowYaml } from './ciCommand.js';

describe('workflowYaml', () => {
  it('targets macOS with the unattended iOS ship sequence', () => {
    const workflow = workflowYaml(false);
    expect(workflow).toContain('runs-on: macos-latest');
    expect(workflow).toContain('launch creds set-key --yes');
    expect(workflow).toContain('launch creds setup --yes');
    expect(workflow).toContain('launch doctor --yes');
    expect(workflow).toContain('launch build ios --yes');
  });

  it('wires App Store Connect secrets into the expected environment variables', () => {
    const workflow = workflowYaml(false);
    expect(workflow).toContain('ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}');
    expect(workflow).toContain('ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}');
    expect(workflow).toContain('ASC_API_KEY_PATH: ${{ runner.temp }}/launch/AuthKey.p8');
    expect(workflow).toContain('secrets.ASC_API_KEY_BASE64');
    expect(workflow).toContain('base64 --decode');
  });

  it('omits Android unless requested', () => {
    const workflow = workflowYaml(false);
    expect(workflow).not.toContain('ubuntu-latest');
    expect(workflow).not.toContain('launch build android');
  });

  it('adds the Android job and secrets when requested', () => {
    const workflow = workflowYaml(true);
    expect(workflow).toContain('runs-on: ubuntu-latest');
    expect(workflow).toContain('launch build android --yes');
    expect(workflow).toContain(
      'launch creds set-key --platform android "$RUNNER_TEMP/launch/play.json" --yes',
    );
    expect(workflow).toContain('PLAY_SERVICE_ACCOUNT: ${{ runner.temp }}/launch/play.json');
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_BASE64');
    expect(workflow).toContain('ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}');
  });

  it('documents required secrets in the header', () => {
    const workflow = workflowYaml(true);
    expect(workflow.startsWith('# Launch')).toBe(true);
    expect(workflow).toContain('Required repository secrets');
    expect(workflow).toContain('ASC_API_KEY_BASE64   base64 of your AuthKey_*.p8');
  });
});
