import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";

export interface MockRequest {
  readonly body: unknown;
  readonly connectionClosed: Promise<void>;
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  readonly method: string;
  readonly path: string;
}

export interface MockHTTPResponse {
  readonly body: unknown;
  readonly status: number;
}

export interface MockServices {
  readonly close: () => Promise<void>;
  readonly endpoint: string;
  readonly requests: readonly MockRequest[];
}

export async function startMockServices(options: {
  readonly llmToken?: string;
  readonly respondToLLM: (
    request: MockRequest,
  ) => MockHTTPResponse | Promise<MockHTTPResponse | string> | string;
  readonly respondToWikimedia?: (request: MockRequest) => unknown;
  readonly respondToWikispine?: (request: MockRequest) => string;
  readonly wikimediaToken?: string;
  readonly wikispineToken?: string;
}): Promise<MockServices> {
  const requests: MockRequest[] = [];
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const bodyText = await readBody(request);
      const connectionClosed = new Promise<void>((resolvePromise) => {
        response.once("close", resolvePromise);
      });
      const item: MockRequest = {
        body: bodyText === "" ? undefined : JSON.parse(bodyText),
        connectionClosed,
        headers: request.headers,
        method: request.method ?? "GET",
        path: new URL(request.url ?? "/", "http://localhost").pathname,
      };
      requests.push(item);

      if (item.path === "/v1/chat/completions") {
        assertRequest(item, {
          authorization: `Bearer ${options.llmToken ?? "e2e-key"}`,
          contentType: "application/json",
          method: "POST",
        });
        readPrompt(item);
        const content = await options.respondToLLM(item);
        if (typeof content !== "string") {
          writeJSON(response, content.body, content.status);
          return;
        }
        if (isStreamingChatCompletion(item)) {
          writeChatCompletionStream(response, content);
        } else {
          writeJSON(response, createChatCompletion(content));
        }
        return;
      }
      if (item.path === "/wikispine/readyz") {
        assertRequest(item, {
          authorization: `Bearer ${options.wikispineToken ?? "e2e-wikispine-token"}`,
          method: "GET",
        });
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ready\n");
        return;
      }
      if (item.path === "/wikispine/metadata") {
        assertRequest(item, {
          authorization: `Bearer ${options.wikispineToken ?? "e2e-wikispine-token"}`,
          method: "GET",
        });
        writeJSON(response, {
          automaton_shard_count: 1,
          format: "wikispine-runtime-v1",
          qid_count: 2,
          surface_count: 2,
          surface_normalization: "unicode-nfc-casefold-v1",
        });
        return;
      }
      if (item.path === "/wikispine/match") {
        assertRequest(item, {
          accept: "application/x-ndjson",
          authorization: `Bearer ${options.wikispineToken ?? "e2e-wikispine-token"}`,
          contentType: "application/json",
          method: "POST",
        });
        response.writeHead(200, {
          "content-type": "application/x-ndjson",
        });
        response.end(
          options.respondToWikispine?.(item) ??
            `${JSON.stringify({ type: "done", stats: { matches: 0 } })}\n`,
        );
        return;
      }
      if (item.path === "/wikimedia/qids:resolve") {
        assertRequest(item, {
          authorization: `Bearer ${options.wikimediaToken ?? "e2e-wikimedia-token"}`,
          contentType: "application/json",
          method: "POST",
        });
        writeJSON(
          response,
          options.respondToWikimedia?.(item) ?? { results: [] },
        );
        return;
      }

      writeJSON(response, { error: `Unexpected route: ${item.path}` }, 404);
    } catch (error) {
      writeJSON(
        response,
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  }
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Mock service did not bind a TCP port.");
  }

  return {
    close: async () => await closeServer(server),
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

function assertRequest(
  request: MockRequest,
  expected: {
    readonly accept?: string;
    readonly authorization?: string;
    readonly contentType?: string;
    readonly method: string;
  },
): void {
  if (request.method !== expected.method) {
    throw new Error(
      `${request.path} expected ${expected.method}, received ${request.method}.`,
    );
  }
  if (
    expected.authorization !== undefined &&
    request.headers.authorization !== expected.authorization
  ) {
    throw new Error(`${request.path} received invalid authorization.`);
  }
  if (
    expected.contentType !== undefined &&
    request.headers["content-type"] !== expected.contentType
  ) {
    throw new Error(`${request.path} received invalid content-type.`);
  }
  if (
    expected.accept !== undefined &&
    request.headers.accept !== expected.accept
  ) {
    throw new Error(`${request.path} received invalid accept header.`);
  }
}

export function readPrompt(request: MockRequest): string {
  const body = request.body;
  if (
    typeof body !== "object" ||
    body === null ||
    !("messages" in body) ||
    !Array.isArray(body.messages)
  ) {
    throw new Error("OpenAI-compatible request is missing messages.");
  }
  const messages = body.messages as readonly unknown[];
  return messages
    .map((message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("content" in message)
      ) {
        return "";
      }
      return typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    })
    .join("\n");
}

function createChatCompletion(content: string): Record<string, unknown> {
  return {
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: { content, role: "assistant" },
      },
    ],
    created: Math.floor(Date.now() / 1000),
    id: `chatcmpl-e2e-${Date.now()}`,
    model: "wiki-graph-e2e",
    object: "chat.completion",
    usage: {
      completion_tokens: 8,
      prompt_tokens: 16,
      total_tokens: 24,
    },
  };
}

function isStreamingChatCompletion(request: MockRequest): boolean {
  return (
    typeof request.body === "object" &&
    request.body !== null &&
    "stream" in request.body &&
    request.body.stream === true
  );
}

function writeChatCompletionStream(
  response: ServerResponse,
  content: string,
): void {
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-e2e-${Date.now()}`;
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    JSON.stringify({
      choices: [{ delta, finish_reason: finishReason, index: 0 }],
      created,
      id,
      model: "wiki-graph-e2e",
      object: "chat.completion.chunk",
    });

  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  response.write(`data: ${chunk({ role: "assistant" }, null)}\n\n`);
  response.write(`data: ${chunk({ content }, null)}\n\n`);
  response.write(`data: ${chunk({}, "stop")}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
    } else {
      throw new TypeError("Mock service received an unsupported body chunk.");
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJSON(
  response: ServerResponse,
  body: unknown,
  status = 200,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) =>
      error === undefined ? resolvePromise() : reject(error),
    );
    server.closeAllConnections();
  });
}
