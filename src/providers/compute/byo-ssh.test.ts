import { describe, expect, it } from 'vitest';
import { parseSshTarget } from './byo-ssh.ts';
function describeParseSshTarget() {
  function parsesUserHostWithTheDefaultPort() {
    const sshTarget = parseSshTarget('ec2-user@1.2.3.4');
    expect(sshTarget).toEqual({
      host: '1.2.3.4',
      user: 'ec2-user',
      port: 22,
    });
  }

  it('parses user@host with the default port', parsesUserHostWithTheDefaultPort);
  function parsesAnExplicitPort() {
    const sshTarget = parseSshTarget('admin@build.example.com:2222');
    expect(sshTarget).toEqual({
      host: 'build.example.com',
      user: 'admin',
      port: 2222,
    });
  }

  it('parses an explicit port', parsesAnExplicitPort);
  function defaultsTheUserWhenOnlyAHostIsGiven() {
    const sshTarget = parseSshTarget('my-mac.local');
    expect(sshTarget).toEqual({
      host: 'my-mac.local',
      user: 'ec2-user',
      port: 22,
    });
  }

  it('defaults the user when only a host is given', defaultsTheUserWhenOnlyAHostIsGiven);
  function rejectsAnEmptyTargetOrABadPort() {
    function callParseSshTarget() {
      return parseSshTarget('  ');
    }

    expect(callParseSshTarget).toThrow(/Empty SSH target/);
    function callParseSshTarget2() {
      return parseSshTarget('user@host:notaport');
    }

    expect(callParseSshTarget2).toThrow(/Invalid port/);
  }

  it('rejects an empty target or a bad port', rejectsAnEmptyTargetOrABadPort);
}

describe('parseSshTarget', describeParseSshTarget);
