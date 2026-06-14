import { describe, expect, it } from "vitest";
import { workflowYaml } from "./ci.js";

describe("workflowYaml — the scaffolded GitHub Actions workflow", () => {
  it("targets a macOS runner and the real unattended ship sequence", () => {
    const yaml = workflowYaml({ android: false });
    expect(yaml).toContain("runs-on: macos-latest");
    expect(yaml).toContain("launch creds set-key --yes");
    expect(yaml).toContain("launch creds setup --yes");
    expect(yaml).toContain("launch doctor --yes");
    expect(yaml).toContain("launch build ios --yes");
  });

  it("wires the App Store Connect key from repo secrets to the env vars the CLI reads", () => {
    const yaml = workflowYaml({ android: false });
    expect(yaml).toContain("ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}");
    expect(yaml).toContain("ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}");
    expect(yaml).toContain("ASC_API_KEY_PATH: ${{ runner.temp }}/launch/AuthKey.p8");
    // The key arrives base64-encoded (a .p8 is multi-line) and is decoded to that path.
    expect(yaml).toContain("secrets.ASC_API_KEY_BASE64");
    expect(yaml).toContain("base64 --decode");
  });

  it("omits the Android job by default", () => {
    const yaml = workflowYaml({ android: false });
    expect(yaml).not.toContain("ubuntu-latest");
    expect(yaml).not.toContain("launch build android");
  });

  it("emits an Android job, with its secrets, when asked", () => {
    const yaml = workflowYaml({ android: true });
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain("launch build android --yes");
    expect(yaml).toContain('launch creds set-key --platform android "$RUNNER_TEMP/launch/play.json" --yes');
    expect(yaml).toContain("PLAY_SERVICE_ACCOUNT: ${{ runner.temp }}/launch/play.json");
    expect(yaml).toContain("secrets.ANDROID_KEYSTORE_BASE64");
    expect(yaml).toContain("ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}");
  });

  it("documents the required secrets in a header comment", () => {
    const yaml = workflowYaml({ android: true });
    expect(yaml.startsWith("# Launch")).toBe(true);
    expect(yaml).toContain("Required repository secrets");
    expect(yaml).toContain("ASC_API_KEY_BASE64   base64 of your AuthKey_*.p8");
  });
});
