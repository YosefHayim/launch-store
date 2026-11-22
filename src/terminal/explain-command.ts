import { createLogger } from '../services/platform/logger.ts';
import { explainTopic, isGlossaryTopic, listTopics } from './glossary.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

type ExplainCommandFailure = Readonly<{
  readonly _tag: 'ExplainCommandFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

function makeExplainCommandFailure(fields: {
  message: string;
  cause: unknown;
}): ExplainCommandFailure {
  return { _tag: 'ExplainCommandFailure', message: fields.message, cause: fields.cause };
}

function readExplainTopic(rawCommandInput: unknown): string | null {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Could not run the explain command.');
  }

  const topicIsPresent = Object.hasOwn(rawCommandInputObject, 'topic');

  if (topicIsPresent == false) {
    return null;
  }

  const topic = rawCommandInputObject['topic'];

  if (typeof topic == 'string') {
    return topic;
  }

  throw new Error('Could not run the explain command.');
}

export function explainCommandProgram(rawCommandInput: unknown): void {
  try {
    const topic = readExplainTopic(rawCommandInput);
    const logger = createLogger(false);

    if (topic == null) {
      logger.line(`Topics: ${listTopics().join(', ')}`);
      return;
    }

    if (isGlossaryTopic(topic)) {
      logger.line(explainTopic(topic));
      return;
    }

    throw makeExplainCommandFailure({
      message: `Unknown topic "${topic}". Known topics: ${listTopics().join(', ')}`,
      cause: topic,
    });
  } catch (cause) {
    if (isFailureTag(cause, 'ExplainCommandFailure')) {
      throw cause;
    }

    throw makeExplainCommandFailure({ message: 'Could not run the explain command.', cause });
  }
}
