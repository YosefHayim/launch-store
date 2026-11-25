import { describe, expect, it } from 'vitest';

import { readServiceAccount } from './google-play.js';

describe('readServiceAccount', () => {
  it('reads the official service account fields', () => {
    const account = readServiceAccount(
      JSON.stringify({ client_email: 'play@example.iam.gserviceaccount.com', private_key: 'pem' }),
    );

    expect(account.clientEmail).toBe('play@example.iam.gserviceaccount.com');
  });
});
