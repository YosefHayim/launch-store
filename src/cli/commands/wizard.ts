import { Effect } from 'effect';
import { BuildHistoryCommandServiceLive } from '@core/build/buildHistoryCommand.js';
import { wizardCommandProgram } from '@core/terminal/wizardCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Run the typed interactive front-door program with its build-history adapter. */
export const runWizard = () =>
  runCliProgram(wizardCommandProgram({}).pipe(Effect.provide(BuildHistoryCommandServiceLive)));
