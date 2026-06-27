import { describe, expect, it, vi } from 'vitest';
import {
  describeExportComplianceConfig,
  reconcileExportCompliance,
  summarizeExportComplianceResult,
  type ExportComplianceApi,
} from './exportCompliance.js';

/** A fully-stubbed {@link ExportComplianceApi}: build exists & unanswered, no declarations, writes succeed. */
function makeApi(overrides: Partial<ExportComplianceApi> = {}): ExportComplianceApi {
  return {
    findBuild: vi.fn().mockResolvedValue({ id: 'build1', usesNonExemptEncryption: null }),
    setBuildUsesNonExemptEncryption: vi.fn().mockResolvedValue(undefined),
    listEncryptionDeclarations: vi.fn().mockResolvedValue([]),
    linkBuildToDeclaration: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const BASE = { bundleId: 'com.acme.app', buildNumber: 42 };

describe('reconcileExportCompliance', () => {
  it('does nothing when the app declares no answer', async () => {
    const api = makeApi();
    const result = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: undefined,
    });
    expect(result).toEqual({ status: 'undeclared' });
    expect(api.findBuild).not.toHaveBeenCalled();
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
  });

  it("reports build-not-found when the build hasn't ingested yet", async () => {
    const api = makeApi({ findBuild: vi.fn().mockResolvedValue(null) });
    const result = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: false,
    });
    expect(result).toEqual({ status: 'build-not-found', buildNumber: 42 });
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
  });

  it('is a no-op when the build already carries the desired answer', async () => {
    const api = makeApi({
      findBuild: vi.fn().mockResolvedValue({ id: 'build1', usesNonExemptEncryption: false }),
    });
    const result = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: false,
    });
    expect(result).toEqual({ status: 'already-answered', usesNonExemptEncryption: false });
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
    expect(api.listEncryptionDeclarations).not.toHaveBeenCalled();
  });

  it('answers the no/exempt-encryption case with a single build write', async () => {
    const api = makeApi();
    const result = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: false,
    });
    expect(result).toEqual({ status: 'answered', usesNonExemptEncryption: false });
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith('build1', false);
    expect(api.linkBuildToDeclaration).not.toHaveBeenCalled();
  });

  it('reuses an approved declaration for non-exempt encryption', async () => {
    const api = makeApi({
      listEncryptionDeclarations: vi.fn().mockResolvedValue([
        { id: 'decl-old', state: 'REJECTED' },
        { id: 'decl-good', state: 'APPROVED' },
      ]),
    });
    const result = await reconcileExportCompliance(api, { ...BASE, usesNonExemptEncryption: true });
    expect(result).toEqual({ status: 'reused-declaration', declarationId: 'decl-good' });
    expect(api.linkBuildToDeclaration).toHaveBeenCalledWith('decl-good', 'build1');
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
  });

  it('flags needs-declaration when no approved declaration exists to reuse', async () => {
    const api = makeApi({
      listEncryptionDeclarations: vi
        .fn()
        .mockResolvedValue([{ id: 'decl-pending', state: 'IN_REVIEW' }]),
    });
    const result = await reconcileExportCompliance(api, { ...BASE, usesNonExemptEncryption: true });
    expect(result).toEqual({ status: 'needs-declaration' });
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith('build1', true);
    expect(api.linkBuildToDeclaration).not.toHaveBeenCalled();
  });
});

describe('describeExportComplianceConfig', () => {
  it('treats an explicit false as clean (self-answering binary)', () => {
    const status = describeExportComplianceConfig(false);
    expect(status.ok).toBe(true);
    expect(status.message).toContain('no per-upload prompt');
  });

  it('flags true as declared-but-owing a documented declaration', () => {
    const status = describeExportComplianceConfig(true);
    expect(status.ok).toBe(false);
    expect(status.message).toContain('App Encryption Declaration');
  });

  it('flags an unset field as not declared', () => {
    const status = describeExportComplianceConfig(undefined);
    expect(status.ok).toBe(false);
    expect(status.message).toContain('not declared');
  });
});

describe('summarizeExportComplianceResult', () => {
  it('renders a distinct line per outcome', () => {
    expect(summarizeExportComplianceResult({ status: 'undeclared' })).toContain('left as-is');
    expect(
      summarizeExportComplianceResult({ status: 'build-not-found', buildNumber: 7 }),
    ).toContain('7');
    expect(
      summarizeExportComplianceResult({
        status: 'already-answered',
        usesNonExemptEncryption: false,
      }),
    ).toContain('already answered');
    expect(
      summarizeExportComplianceResult({ status: 'answered', usesNonExemptEncryption: false }),
    ).toContain('answered the encryption question');
    expect(
      summarizeExportComplianceResult({ status: 'reused-declaration', declarationId: 'd1' }),
    ).toContain('d1');
    expect(summarizeExportComplianceResult({ status: 'needs-declaration' })).toContain(
      'App Encryption Declaration',
    );
  });
});
