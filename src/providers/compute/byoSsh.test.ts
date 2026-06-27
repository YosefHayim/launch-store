import { describe, expect, it } from 'vitest';
import { parseSshTarget } from './byoSsh.js';

describe('parseSshTarget', () => {
  it('parses user@host with the default port', () => {
    expect(parseSshTarget('ec2-user@1.2.3.4')).toEqual({
      host: '1.2.3.4',
      user: 'ec2-user',
      port: 22,
    });
  });

  it('parses an explicit port', () => {
    expect(parseSshTarget('admin@build.example.com:2222')).toEqual({
      host: 'build.example.com',
      user: 'admin',
      port: 2222,
    });
  });

  it('defaults the user when only a host is given', () => {
    expect(parseSshTarget('my-mac.local')).toEqual({
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
