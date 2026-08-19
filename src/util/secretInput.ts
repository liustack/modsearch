import * as readline from 'readline';

/**
 * Read a secret without it touching argv. `modsearch config set x.apiKey`
 * with no value lands here: on a terminal it prompts with the echo muted, and
 * on a pipe it reads the first line, so `pbpaste | modsearch config set
 * x.apiKey` works too. Either way the key stays out of shell history and out
 * of the conversation with whatever agent is driving the terminal.
 *
 * The chat path cannot be blocked, only not led to: most users will paste a
 * key wherever is most convenient, and the docs accept that. This is the
 * clean path for the ones who care.
 */
export async function readSecret(
  promptText: string,
  stdin: NodeJS.ReadStream = process.stdin,
  stderr: NodeJS.WriteStream = process.stderr,
): Promise<string> {
  if (!stdin.isTTY) {
    // Decode through the stream's own encoding state: concatenating raw
    // chunks re-decodes each one alone, and a multibyte character split
    // across two chunks turns into replacement characters.
    stdin.setEncoding('utf8');
    // No real key approaches this size; a newline-free stream (a binary file,
    // an endless pipe) must fail bounded instead of buffering forever.
    const MAX_CHARS = 64 * 1024;
    let data = '';
    for await (const chunk of stdin) {
      data += chunk;
      // The first line is the key; nothing after it is wanted, and a
      // multi-megabyte accidental pipe should not be buffered whole.
      if (data.includes('\n')) {
        break;
      }
      if (data.length > MAX_CHARS) {
        throw new Error('stdin exceeded 64KB with no newline; that is not a key');
      }
    }
    const value = data.split('\n')[0].trim();
    if (value === '') {
      throw new Error('no key arrived on stdin (pipe one line, or run on a terminal)');
    }
    return value;
  }

  // Terminal: prompt on stderr (stdout stays clean for scripts) with the
  // echo muted, the same trick every no-echo prompt uses with readline.
  const rl = readline.createInterface({ input: stdin, output: stderr, terminal: true });
  const muted = rl as unknown as { _writeToOutput: (text: string) => void };
  stderr.write(promptText);
  muted._writeToOutput = () => {};
  try {
    // Settled exactly once, whichever comes first: the answer, Ctrl+C, or
    // the stream closing (EOF included). An unsettled promise here left
    // the process to die of an unresolved top-level await, exit code 13
    // and an internal warning where a cancellation message belonged.
    const value = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void) => {
        if (!settled) {
          settled = true;
          action();
        }
      };
      rl.question('', (answer) => settle(() => resolve(answer)));
      rl.on('SIGINT', () => settle(() => reject(new Error('cancelled, nothing was saved'))));
      rl.on('close', () =>
        settle(() => reject(new Error('input ended before a key was entered'))),
      );
    });
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new Error('no key entered');
    }
    return trimmed;
  } finally {
    // The muted echo swallowed the user's newline too.
    stderr.write('\n');
    rl.close();
  }
}
