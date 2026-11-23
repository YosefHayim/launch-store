import { join } from 'node:path';
import { executeCommand } from '../services/platform/exec.ts';

export class GradleBuild {
  async bundle(directory: string): Promise<string> {
    const androidDirectory = join(directory, 'android');
    const gradleWrapper = join(androidDirectory, 'gradlew');

    await this.runGradle(gradleWrapper, androidDirectory);

    return join(
      androidDirectory,
      'app',
      'build',
      'outputs',
      'bundle',
      'release',
      'app-release.aab',
    );
  }

  private async runGradle(gradleWrapper: string, workingDirectory: string): Promise<void> {
    try {
      await executeCommand(gradleWrapper, ['bundleRelease'], { workingDirectory });
    } catch (error) {
      throw new Error('gradlew failed', { cause: error });
    }
  }
}
