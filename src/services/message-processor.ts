import { Context, Effect, Layer } from "effect";

import {
  ConversationEngine,
  type ConversationEngineError
} from "./conversation-engine.js";
import type { InboundEvent } from "../schema.js";

export interface MessageProcessorShape {
  readonly processEvent: (event: InboundEvent) => Effect.Effect<void, MessageProcessorError>;
}

export type MessageProcessorError = ConversationEngineError;

export class MessageProcessor extends Context.Tag("MessageProcessor")<
  MessageProcessor,
  MessageProcessorShape
>() {}

export const MessageProcessorLive = Layer.effect(
  MessageProcessor,
  Effect.gen(function* () {
    const conversationEngine = yield* ConversationEngine;

    return MessageProcessor.of({
      processEvent: (event) => conversationEngine.handleEvent(event)
    });
  })
);
