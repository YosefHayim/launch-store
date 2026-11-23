import { describe, expect, it, vi } from 'vitest';
import {
  describeExportComplianceConfig,
  reconcileExportCompliance,
  summarizeExportComplianceResult,
  type ExportComplianceApi,
} from './export-compliance.ts';

/** A fully-stubbed {@link ExportComplianceApi}: build exists & unanswered, no declarations, writes succeed. */
function makeApi(overrides: Partial<ExportComplianceApi> = {}): ExportComplianceApi {
  function mockCall() {
    return Promise.resolve({ id: 'build1', usesNonExemptEncryption: null });
  }

  function mockCall2() {
    return Promise.resolve();
  }

  function mockCall3() {
    return Promise.resolve([]);
  }

  function mockCall4() {
    return Promise.resolve();
  }

  return {
    findBuild: vi.fn(mockCall),
    setBuildUsesNonExemptEncryption: vi.fn(mockCall2),
    listEncryptionDeclarations: vi.fn(mockCall3),
    linkBuildToDeclaration: vi.fn(mockCall4),
    ...overrides,
  };
}
const BASE = { bundleId: 'com.acme.app', buildNumber: 42 };

function describeReconcileExportCompliance() {
  async function doesNothingWhenTheAppDeclaresNoAnswer() {
    const api = makeApi();
    const complianceOutcome = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: undefined,
    });

    expect(complianceOutcome).toEqual({ status: 'undeclared' });
    expect(api.findBuild).not.toHaveBeenCalled();
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
  }

  it('does nothing when the app declares no answer', doesNothingWhenTheAppDeclaresNoAnswer);

  async function reportsBuildNotFoundWhenTheBuildHasnTIngestedYet() {
    function mockCall5() {
      return Promise.resolve(null);
    }

    const api = makeApi({ findBuild: vi.fn(mockCall5) });
    const complianceOutcome = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: false,
    });

    expect(complianceOutcome).toEqual({ status: 'build-not-found', buildNumber: 42 });
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
  }

  it(
    "reports build-not-found when the build hasn't ingested yet",
    reportsBuildNotFoundWhenTheBuildHasnTIngestedYet,
  );

  async function isANoOpWhenTheBuildAlreadyCarriesTheDesiredAnswer() {
    function mockCall6() {
      return Promise.resolve({ id: 'build1', usesNonExemptEncryption: false });
    }

    const api = makeApi({
      findBuild: vi.fn(mockCall6),
    });
    const complianceOutcome = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: false,
    });

    expect(complianceOutcome).toEqual({
      status: 'already-answered',
      usesNonExemptEncryption: false,
    });
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
    expect(api.listEncryptionDeclarations).not.toHaveBeenCalled();
  }

  it(
    'is a no-op when the build already carries the desired answer',
    isANoOpWhenTheBuildAlreadyCarriesTheDesiredAnswer,
  );

  async function answersTheNoExemptEncryptionCaseWithASingleBuildWrite() {
    const api = makeApi();
    const complianceOutcome = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: false,
    });

    expect(complianceOutcome).toEqual({ status: 'answered', usesNonExemptEncryption: false });
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith('build1', false);
    expect(api.linkBuildToDeclaration).not.toHaveBeenCalled();
  }

  it(
    'answers the no/exempt-encryption case with a single build write',
    answersTheNoExemptEncryptionCaseWithASingleBuildWrite,
  );

  async function reusesAnApprovedDeclarationForNonExemptEncryption() {
    function mockCall7() {
      return Promise.resolve([
        { id: 'decl-old', state: 'REJECTED' },
        { id: 'decl-good', state: 'APPROVED' },
      ]);
    }

    const api = makeApi({
      listEncryptionDeclarations: vi.fn(mockCall7),
    });
    const complianceOutcome = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: true,
    });

    expect(complianceOutcome).toEqual({
      status: 'reused-declaration',
      declarationId: 'decl-good',
    });
    expect(api.linkBuildToDeclaration).toHaveBeenCalledWith('decl-good', 'build1');
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
  }

  it(
    'reuses an approved declaration for non-exempt encryption',
    reusesAnApprovedDeclarationForNonExemptEncryption,
  );

  async function flagsNeedsDeclarationWhenNoApprovedDeclarationExistsToReuse() {
    function mockCall8() {
      return Promise.resolve([{ id: 'decl-pending', state: 'IN_REVIEW' }]);
    }

    const api = makeApi({
      listEncryptionDeclarations: vi.fn(mockCall8),
    });
    const complianceOutcome = await reconcileExportCompliance(api, {
      ...BASE,
      usesNonExemptEncryption: true,
    });

    expect(complianceOutcome).toEqual({ status: 'needs-declaration' });
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith('build1', true);
    expect(api.linkBuildToDeclaration).not.toHaveBeenCalled();
  }

  it(
    'flags needs-declaration when no approved declaration exists to reuse',
    flagsNeedsDeclarationWhenNoApprovedDeclarationExistsToReuse,
  );
}

describe('reconcileExportCompliance', describeReconcileExportCompliance);

function describeDescribeExportCompliancePiece() {
  function treatsAnExplicitFalseAsCleanSelfAnsweringBinary() {
    const status = describeExportComplianceConfig(false);
    expect(status.ok).toBe(true);
    expect(status.message).toContain('no per-upload prompt');
  }

  it(
    'treats an explicit false as clean (self-answering binary)',
    treatsAnExplicitFalseAsCleanSelfAnsweringBinary,
  );

  function flagsTrueAsDeclaredButOwingADocumentedDeclaration() {
    const status = describeExportComplianceConfig(true);
    expect(status.ok).toBe(false);
    expect(status.message).toContain('App Encryption Declaration');
  }

  it(
    'flags true as declared-but-owing a documented declaration',
    flagsTrueAsDeclaredButOwingADocumentedDeclaration,
  );

  function flagsAnUnsetFieldAsNotDeclared() {
    const status = describeExportComplianceConfig(undefined);
    expect(status.ok).toBe(false);
    expect(status.message).toContain('not declared');
  }

  it('flags an unset field as not declared', flagsAnUnsetFieldAsNotDeclared);
}

describe('describeExportComplianceConfig', describeDescribeExportCompliancePiece);

function describeSummarizeExportCompliancePiece() {
  function rendersADistinctLinePerPiece() {
    const summarizeExportCompliance = summarizeExportComplianceResult({ status: 'undeclared' });

    expect(summarizeExportCompliance).toContain('left as-is');
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
  }

  it('renders a distinct line per outcome', rendersADistinctLinePerPiece);
}

describe('summarizeExportComplianceResult', describeSummarizeExportCompliancePiece);
