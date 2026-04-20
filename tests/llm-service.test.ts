import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAppRuntime } from "../src/app-layer.js";
import { LLMService } from "../src/services/llm-service.js";
import type { TurnPlan } from "../src/schema.js";

describe("LLMService Gemini provider", () => {
  let tempDir: string;
  let runtime: ReturnType<typeof makeAppRuntime>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wa-order-bot-gemini-"));

    process.env.WEBHOOK_VERIFY_TOKEN = "verify-token";
    process.env.DATABASE_FILE = join(tempDir, "app.db");
    process.env.LLM_PROVIDER = "gemini";
    process.env.GOOGLE_GEMINI_API_KEY = "test-gemini-key";
    process.env.GOOGLE_GEMINI_MODEL = "gemini-2.0-flash";
    process.env.OPENROUTER_API_KEY = "";
    process.env.OPENROUTER_MODEL = "";
    process.env.WHATSAPP_ACCESS_TOKEN = "";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "";
    process.env.PORT = "0";

    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      intent: "greeting",
                      action: "greet_user",
                      extractedFields: {
                        name: null,
                        productQuery: null,
                        quantity: null,
                        cityOrPincode: null
                      },
                      missingFields: [],
                      selectedProductId: null,
                      requestedTools: [],
                      replyText: "Hi! I can help you browse products.",
                      confidence: 0.91
                    } satisfies Omit<TurnPlan, "provider">)
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      ) as unknown as Response
    );

    runtime = makeAppRuntime();
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await runtime.dispose();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses Gemini when configured", async () => {
    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.planTurn({
          userMessage: "Hi",
          session: null
        });
      })
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("generativelanguage.googleapis.com");
    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const requestBody =
      typeof requestInit?.body === "string" ? JSON.parse(requestInit.body) : null;
    expect(requestBody?.generationConfig?.responseMimeType).toBe("application/json");
    expect(requestBody?.generationConfig?.responseJsonSchema?.properties?.provider).toBeUndefined();
    expect(requestBody?.generationConfig?.responseJsonSchema?.propertyOrdering).toEqual([
      "intent",
      "action",
      "extractedFields",
      "missingFields",
      "selectedProductId",
      "requestedTools",
      "replyText",
      "confidence"
    ]);
    expect(plan.provider).toBe("gemini");
    expect(plan.intent).toBe("greeting");
    expect(plan.action).toBe("greet_user");
  });

  it("includes nested Gemini property ordering for nullable object fields", async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.planTurn({
          userMessage: "Hi",
          session: null
        });
      })
    );

    const requestInit = fetchSpy.mock.calls[0]?.[1];
    const requestBody =
      typeof requestInit?.body === "string" ? JSON.parse(requestInit.body) : null;

    expect(
      requestBody?.generationConfig?.responseJsonSchema?.properties?.extractedFields?.propertyOrdering
    ).toEqual(["name", "productQuery", "quantity", "cityOrPincode"]);
    expect(
      requestBody?.generationConfig?.responseJsonSchema?.properties?.extractedFields?.properties?.name?.type
    ).toEqual(["string", "null"]);
  });

  it("falls back to heuristics when Gemini structured output is not valid JSON", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Here is the plan:\n```json\n{\"intent\":\"greeting\"}\n```"
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      ) as unknown as Response
    );

    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.planTurn({
          userMessage: "Hi",
          session: null
        });
      })
    );

    expect(plan.provider).toBe("heuristic");
    expect(plan.intent).toBe("greeting");
    expect(plan.action).toBe("greet_user");
    expect(plan.replyText.length).toBeGreaterThan(0);
  });

  it("coerces empty extractedFields from Gemini into full schema", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      intent: "greeting",
                      action: "greet_user",
                      extractedFields: {},
                      missingFields: [],
                      selectedProductId: null,
                      requestedTools: [],
                      replyText: "Hi there! Welcome to our store.",
                      confidence: 1
                    })
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      ) as unknown as Response
    );

    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.planTurn({
          userMessage: "Hi",
          session: null
        });
      })
    );

    expect(plan.provider).toBe("gemini");
    expect(plan.extractedFields).toEqual({
      name: null,
      productQuery: null,
      quantity: null,
      cityOrPincode: null
    });
  });

  it("maps Gemini action aliases into internal turn actions", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      intent: "browse_catalog",
                      action: "browse_catalog",
                      extractedFields: {},
                      missingFields: [],
                      selectedProductId: null,
                      requestedTools: [],
                      replyText: "Hi! You can browse our catalog.",
                      confidence: 1
                    })
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      ) as unknown as Response
    );

    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.planTurn({
          userMessage: "What are your products?",
          session: null
        });
      })
    );

    expect(plan.provider).toBe("gemini");
    expect(plan.intent).toBe("browse_catalog");
    expect(plan.action).toBe("answer_catalog_overview");
  });

  it("maps Gemini hyphenated intents and string tool names", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      intent: "browse-catalog",
                      action: "list_products",
                      extractedFields: {},
                      missingFields: [],
                      selectedProductId: null,
                      requestedTools: ["get_catalog"],
                      replyText: "Sure! Let me fetch our latest catalog for you.",
                      confidence: 1
                    })
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      ) as unknown as Response
    );

    const plan = await runtime.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.planTurn({
          userMessage: "What are your products?",
          session: null
        });
      })
    );

    expect(plan.provider).toBe("gemini");
    expect(plan.intent).toBe("browse_catalog");
    expect(plan.action).toBe("answer_catalog_overview");
    expect(plan.requestedTools).toEqual([
      { name: "listCatalog", reason: "Requested by model as get_catalog." }
    ]);
  });
});
