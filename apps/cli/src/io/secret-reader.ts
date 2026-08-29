export interface SecretInput {
  input: NodeJS.ReadStream;
  output: Pick<NodeJS.WriteStream, "isTTY" | "write">;
}

const defaultInput: SecretInput = {
  input: process.stdin,
  output: process.stdout,
};

export async function readSecret(
  prompt: string,
  terminal: SecretInput = defaultInput,
): Promise<string> {
  if (!terminal.input.isTTY || !terminal.output.isTTY || !terminal.input.setRawMode) {
    throw new Error("Credential input requires an interactive TTY");
  }
  const wasRaw = terminal.input.isRaw ?? false;
  terminal.output.write(prompt);
  terminal.input.setRawMode(true);
  terminal.input.resume();
  let secret = "";

  try {
    const value = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        terminal.input.off("error", onError);
        terminal.input.off("data", onData);
        terminal.input.off("end", onEnd);
      };
      const succeed = (value: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onError = () => fail(new Error("Credential input failed"));
      const onEnd = () => fail(new Error("Credential input ended unexpectedly"));
      const onData = (chunk: string | Buffer) => {
        for (const character of chunk.toString()) {
          if (character === "\u0003") {
            fail(new Error("Credential input was cancelled"));
            return;
          }
          if (character === "\r" || character === "\n") {
            succeed(secret.trim());
            return;
          }
          if (character === "\b" || character === "\u007f") {
            secret = secret.slice(0, -1);
          } else if (character >= " " && secret.length < 16_384) {
            secret += character;
          }
        }
      };
      terminal.input.once("error", onError);
      terminal.input.on("data", onData);
      terminal.input.once("end", onEnd);
    });
    if (value.length === 0) throw new Error("Credential must not be empty");
    return value;
  } finally {
    secret = "";
    terminal.input.setRawMode(wasRaw);
    terminal.input.pause();
    terminal.output.write("\n");
  }
}
