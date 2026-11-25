import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { parseSshTarget } from './byoSsh.js';
describe('parseSshTarget', () => {
  it('parses user@host with the default port', async () => {
    await expect(Effect.runPromise(parseSshTarget('ec2-user@1.2.3.4'))).resolves.toEqual({
      host: '1.2.3.4',
      user: 'ec2-user',
      port: 22,
    });
  });
  it('parses an explicit port', async () => {
    await expect(
      Effect.runPromise(parseSshTarget('admin@build.example.com:2222')),
    ).resolves.toEqual({
      host: 'build.example.com',
      user: 'admin',
      port: 2222,
    });
  });
  it('defaults the user when only a host is given', async () => {
    await expect(Effect.runPromise(parseSshTarget('my-mac.local'))).resolves.toEqual({
      host: 'my-mac.local',
      user: 'ec2-user',
      port: 22,
    });
  });
  it('rejects an empty target or a bad port', async () => {
    await expect(Effect.runPromise(parseSshTarget('  '))).rejects.toThrow(/Empty SSH target/);
    await expect(Effect.runPromise(parseSshTarget('user@host:notaport'))).rejects.toThrow(
      /Invalid port/,
    );
  });
});
