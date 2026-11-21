import type { GooglePlay } from '@/google-play.js';

interface PlayBundleUpload {
  path: string;
  packageName: string;
  track: string;
}

export class SubmitToPlay {
  constructor(private readonly play: GooglePlay) {}

  async upload(bundle: PlayBundleUpload): Promise<string> {
    const editId = await this.play.openEdit(bundle.packageName);
    const uploaded = await this.play.uploadBundle({
      packageName: bundle.packageName,
      editId,
      media: {
        mimeType: 'application/octet-stream',
        body: this.play.bundleStream(bundle.path),
      },
    });
    const versionCode = uploaded.versionCode;
    const isMissingCode = typeof versionCode != 'number';

    if (isMissingCode) {
      await this.play.deleteEdit(bundle.packageName, editId);
      throw new Error('Play did not return a version code');
    }

    try {
      await this.play.setTrack(bundle.packageName, editId, bundle.track, versionCode);
      await this.play.commitEdit(bundle.packageName, editId);
    } catch (error) {
      await this.play.deleteEdit(bundle.packageName, editId);
      throw error;
    }

    return bundle.path;
  }
}
