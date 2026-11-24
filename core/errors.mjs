// Errors the CLI turns into a message and an exit code instead of a stack trace.
//   exit 1 - a rule or check said no (gate failed, task not active, ...)
//   exit 2 - usage or configuration problem

export class AsdkError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'AsdkError';
    this.exitCode = exitCode;
  }
}

export const usageError = (message) => new AsdkError(message, 2);
export const ruleError = (message) => new AsdkError(message, 1);
