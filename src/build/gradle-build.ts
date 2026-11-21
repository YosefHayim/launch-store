import { spawn } from 'node:child_process';
import { join } from 'node:path';

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

  private runGradle(gradleWrapper: string, workingDirectory: string): Promise<void> {
    function waitForGradle(resolveRun: () => void, rejectRun: (reason: Error) => void): void {
      const child = spawn(gradleWrapper, ['bundleRelease'], {
        cwd: workingDirectory,
        stdio: 'inherit',
      });

      function onStartError(error: Error): void {
        rejectRun(new Error('gradlew did not start', { cause: error }));
      }

      function onClose(exitCode: number | null): void {
        const isSuccess = exitCode == 0;

        if (isSuccess) {
          resolveRun();
          return;
        }

        rejectRun(new Error(`gradlew exited with ${exitCode}`));
      }

      child.on('error', onStartError);
      child.on('close', onClose);
    }

    return new Promise(waitForGradle);
  }
}
