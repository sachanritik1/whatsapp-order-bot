import { Effect, Fiber } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAppRuntime } from "../src/app-layer.js";
import { startHttpServer, type RunningServer } from "../src/http/server.js";
import { InboundEventRepo } from "../src/repos/inbound-event-repo.js";
import { LeadRepo } from "../src/repos/lead-repo.js";
import { OrderSessionRepo } from "../src/repos/order-session-repo.js";
import { queueWorker } from "../src/worker/queue-worker.js";

interface TestContext {
  readonly runtime: ReturnType<typeof makeAppRuntime>;
  readonly server: RunningServer;
  readonly baseUrl: string;
  readonly cleanup: () => Promise<void>;
}

let webhookMessageSequence = 0;

const webhookEnvelope = (body: string) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "entry-1",
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                from: "919999999999",
                id: `wamid.${body.replace(/\W+/g, "-").slice(0, 12)}-${++webhookMessageSequence}`,
                timestamp: "1712217600",
                type: "text",
                text: {
                  body
                }
              }
            ]
          }
        }
      ]
    }
  ]
});

const statusOnlyWebhookEnvelope = () => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "entry-status-1",
      changes: [
        {
          field: "messages",
          value: {
            statuses: [
              {
                id: "wamid.status-1",
                status: "delivered",
                timestamp: "1712217600",
                recipient_id: "919999999999"
              }
            ]
          }
        }
      ]
    }
  ]
});

const waitUntil = async (
  condition: () => Promise<boolean>,
  timeoutMs = 3000
): Promise<void> => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for condition.");
};

const readLeads = (runtime: ReturnType<typeof makeAppRuntime>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const repo = yield* LeadRepo;
      return yield* repo.list;
    })
  );

const readEvents = (runtime: ReturnType<typeof makeAppRuntime>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const repo = yield* InboundEventRepo;
      return yield* repo.list;
    })
  );

const readSession = (runtime: ReturnType<typeof makeAppRuntime>, phone: string) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const repo = yield* OrderSessionRepo;
      return yield* repo.getByPhone(phone);
    })
  );

const latestDryRunLog = (consoleLogSpy: ReturnType<typeof vi.spyOn>): string | undefined =>
  consoleLogSpy.mock.calls
    .map((call) => String(call[0]))
    .reverse()
    .find((line) => line.includes('"event":"whatsapp.send.dry_run"'));

const startTestApp = async (): Promise<TestContext> => {
  const tempDir = await mkdtemp(join(tmpdir(), "wa-order-bot-"));

  process.env.WEBHOOK_VERIFY_TOKEN = "verify-token";
  process.env.DATABASE_FILE = join(tempDir, "app.db");
  process.env.LLM_PROVIDER = "";
  process.env.OPENROUTER_API_KEY = "";
  process.env.OPENROUTER_MODEL = "";
  process.env.GOOGLE_GEMINI_API_KEY = "";
  process.env.GOOGLE_GEMINI_MODEL = "";
  process.env.WHATSAPP_ACCESS_TOKEN = "";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "";
  process.env.PORT = "0";

  const runtime = makeAppRuntime();
  const server = await startHttpServer(runtime, 0);
  const workerFiber = runtime.runFork(queueWorker);

  return {
    runtime,
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
    cleanup: async () => {
      await runtime.runPromise(Fiber.interrupt(workerFiber));
      await server.close();
      await runtime.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  };
};

describe("WhatsApp order assistant POC", () => {
  let context: TestContext;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    webhookMessageSequence = 0;
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    context = await startTestApp();
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await context.cleanup();
  });

  it("verifies the webhook challenge with the correct token", async () => {
    const response = await fetch(
      `${context.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=12345`
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345");
  });

  it("rejects webhook verification with the wrong token", async () => {
    const response = await fetch(
      `${context.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=12345`
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
  });

  it("acknowledges invalid JSON with HTTP 200 to avoid webhook retries", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{invalid-json"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it("acknowledges status-only webhook payloads without treating them as inbound messages", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(statusOnlyWebhookEnvelope())
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    await waitUntil(async () =>
      consoleLogSpy.mock.calls.some((call) =>
        String(call[0]).includes('"event":"webhook.ignored_non_message"')
      )
    );

    const events = await readEvents(context.runtime);
    expect(events).toHaveLength(0);
  });

  it("returns HTTP 503 when enqueue fails so webhook delivery can be retried", async () => {
    const runPromiseSpy = vi
      .spyOn(context.runtime, "runPromise")
      .mockRejectedValueOnce(new Error("database unavailable"));

    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookEnvelope("I want to order 1 protein granola jar"))
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ received: false });

    runPromiseSpy.mockRestore();

    const events = await readEvents(context.runtime);
    expect(events).toHaveLength(0);
  });

  it("captures an order across multiple messages and stores the lead in SQLite", async () => {
    const firstResponse = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(
        webhookEnvelope("I want to order 2 protein granola jars. My name is Riya.")
      )
    });

    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.json()).toEqual({ received: true });

    await waitUntil(async () => {
      const session = await readSession(context.runtime, "919999999999");
      return session?.status === "open";
    });

    const openSession = await readSession(context.runtime, "919999999999");
    expect(openSession).not.toBeNull();
    expect(openSession?.name).toBe("Riya");
    expect(openSession?.product).toBe("Protein Granola Jar");
    expect(openSession?.quantity).toBe(2);
    expect(openSession?.missingFields).toEqual(["cityOrPincode"]);
    expect(await readLeads(context.runtime)).toHaveLength(0);

    const secondResponse = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookEnvelope("Kanpur"))
    });

    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({ received: true });

    await waitUntil(async () => {
      const session = await readSession(context.runtime, "919999999999");
      return session?.status === "completed";
    });

    const leads = await readLeads(context.runtime);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      phone: "919999999999",
      name: "Riya",
      product: "Protein Granola Jar",
      quantity: 2,
      cityOrPincode: "Kanpur"
    });

    const completedSession = await readSession(context.runtime, "919999999999");
    expect(completedSession?.status).toBe("completed");
    expect(completedSession?.cityOrPincode).toBe("Kanpur");

    const events = await readEvents(context.runtime);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.status === "processed")).toBe(true);
  });

  it("returns grounded product recommendations in dry-run mode", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookEnvelope("Can you recommend a healthy breakfast option?"))
    });

    expect(response.status).toBe(200);

    await waitUntil(async () =>
      consoleLogSpy.mock.calls.some((call) =>
        String(call[0]).includes('"event":"whatsapp.send.dry_run"')
      )
    );

    const dryRunLog = latestDryRunLog(consoleLogSpy);

    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("Protein Granola Jar");
  });

  it("recovers from unavailable product requests by suggesting in-catalog options", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookEnvelope("Shoes"))
    });

    expect(response.status).toBe(200);

    await waitUntil(async () =>
      consoleLogSpy.mock.calls.some((call) => {
        const line = String(call[0]);
        return (
          line.includes('"event":"whatsapp.send.dry_run"') &&
          line.includes("I do not have that exact item in the catalog")
        );
      })
    );

    const dryRunLog = latestDryRunLog(consoleLogSpy);

    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("Masala Makhana Pack");
    expect(dryRunLog).toContain("Green Tea Detox Box");
    expect(dryRunLog).toContain("Filter Coffee Classic");
  });

  it("uses bundled follow-up text when multiple order fields are missing", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookEnvelope("I want to order something"))
    });

    expect(response.status).toBe(200);

    await waitUntil(async () =>
      consoleLogSpy.mock.calls.some((call) => {
        const line = String(call[0]);
        return line.includes('"event":"whatsapp.send.dry_run"') && line.includes("Please share");
      })
    );

    const dryRunLog = latestDryRunLog(consoleLogSpy);

    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("your name");
    expect(dryRunLog).toContain("the product you want");
    expect(dryRunLog).toContain("the quantity");
  });

  it("answers price questions only from catalog data", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(webhookEnvelope("What is the price of Protein Granola Jar?"))
    });

    expect(response.status).toBe(200);

    await waitUntil(async () =>
      consoleLogSpy.mock.calls.some((call) =>
        String(call[0]).includes('"event":"whatsapp.send.dry_run"')
      )
    );

    const dryRunLog = latestDryRunLog(consoleLogSpy);

    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("INR 599");
    expect(dryRunLog).toContain("Protein Granola Jar");
  });

  it("greets normally after a completed order instead of reusing stale order details", async () => {
    await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        webhookEnvelope("I want to order 2 protein granola jars. My name is Ritik. 208027")
      )
    });

    await waitUntil(async () => {
      const session = await readSession(context.runtime, "919999999999");
      return session?.status === "completed";
    });

    await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookEnvelope("Hi"))
    });

    await waitUntil(async () => {
      const log = latestDryRunLog(consoleLogSpy);
      return Boolean(log && log.includes("I can help you browse products"));
    }, 5000);

    const dryRunLog = latestDryRunLog(consoleLogSpy);
    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("I can help you browse products");
    expect(dryRunLog).not.toContain("Protein Granola Jar to 208027");
  });

  it("answers catalog browsing requests with a product overview", async () => {
    const response = await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookEnvelope("What are your products?"))
    });

    expect(response.status).toBe(200);

    await waitUntil(async () => {
      const log = latestDryRunLog(consoleLogSpy);
      return Boolean(log && log.includes("Here are some products we currently have"));
    });

    const dryRunLog = latestDryRunLog(consoleLogSpy);
    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("Here are some products we currently have");
    expect(dryRunLog).toContain("Protein Granola Jar");
  });

  it("starts a fresh order when the user asks for a new product after completing one", async () => {
    await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        webhookEnvelope("I want to order 2 protein granola jars. My name is Ritik. 208027")
      )
    });

    await waitUntil(async () => {
      const session = await readSession(context.runtime, "919999999999");
      return session?.status === "completed";
    });

    await fetch(`${context.baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookEnvelope("I want to order a new product"))
    });

    await waitUntil(async () => {
      const session = await readSession(context.runtime, "919999999999");
      return Boolean(session?.status === "open" && session.missingFields.includes("product"));
    }, 5000);

    const dryRunLog = latestDryRunLog(consoleLogSpy);
    expect(dryRunLog).toBeDefined();
    expect(dryRunLog).toContain("let's start a fresh order");
    expect(dryRunLog).not.toContain("Thanks Ritik. I have your order");

    const session = await readSession(context.runtime, "919999999999");
    expect(session?.status).toBe("open");
    expect(session?.missingFields).toContain("product");
  }, 10000);
});
