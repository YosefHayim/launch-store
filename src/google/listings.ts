// Lists the languages already present on a Google Play listings resource.

import type { GooglePlay } from '../google-play.ts';

export class PlayListings {
  constructor(private readonly play: GooglePlay) {}

  async list(packageName: string): Promise<readonly string[]> {
    const editId = await this.play.openEdit(packageName);

    try {
      var languages = await this.play.listListings(packageName, editId);
    } catch (error) {
      await this.play.deleteEdit(packageName, editId);
      throw error;
    }

    await this.play.deleteEdit(packageName, editId);

    return languages;
  }
}
