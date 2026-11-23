// Lists the release track names configured for one app on Google Play.

import type { GooglePlay } from '@/google-play.js';

export class PlayTracks {
  constructor(private readonly play: GooglePlay) {}

  async list(packageName: string): Promise<readonly string[]> {
    const editId = await this.play.openEdit(packageName);

    try {
      var trackNames = await this.play.listTracks(packageName, editId);
    } catch (error) {
      await this.play.deleteEdit(packageName, editId);
      throw error;
    }

    await this.play.deleteEdit(packageName, editId);

    return trackNames;
  }
}
