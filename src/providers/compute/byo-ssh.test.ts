import { describe, expect, it } from 'vitest';
import { parseSshTarget } from './byo-ssh.ts';

describe('parseSshTarget', () => {
  it('parses user@host with the default port', () => {
    const sshTarget = parseSshTarget('ec2-user@1.2.3.4');
    expect(sshTarget).toEqual({
      host: '1.2.3.4',
      user: 'ec2-user',
      port: 22,
    });
  });

  it('parses an explicit port', () => {
    const sshTarget = parseSshTarget('admin@build.example.com:2222');
    expect(sshTarget).toEqual({
      host: 'build.example.com',
      user: 'admin',
      port: 2222,
    });
  });

  it('defaults the user when only a host is given', () => {
    const sshTarget = parseSshTarget('my-mac.local');
    expect(sshTarget).toEqual({
      host: 'my-mac.local',
      user: 'ec2-user',
      port: 22,
    });
  });

  it('rejects an empty target or a bad port', () => {
    expect(() => parseSshTarget('  ')).toThrow(/Empty SSH target/);
    expect(() => parseSshTarget('user@host:notaport')).toThrow(/Invalid port/);
  });
});
