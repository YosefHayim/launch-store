// Exit 2 when the person typed a command or a flag Launch does not accept.

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
