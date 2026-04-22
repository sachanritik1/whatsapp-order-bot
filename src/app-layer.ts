import { Layer, ManagedRuntime } from "effect";

import { AppConfigLive } from "./config.js";
import { CatalogRepoLive } from "./repos/catalog-repo.js";
import { DatabaseClientLive } from "./repos/database.js";
import { FaqRepoLive } from "./repos/faq-repo.js";
import { InboundEventRepoLive } from "./repos/inbound-event-repo.js";
import { LeadRepoLive } from "./repos/lead-repo.js";
import { OrderSessionRepoLive } from "./repos/order-session-repo.js";
import { CommerceToolsLive } from "./services/commerce-tools.js";
import { ConversationEngineLive } from "./services/conversation-engine.js";
import { InboundEventRunnerLive } from "./services/inbound-event-runner.js";
import { LLMServiceLive } from "./services/llm-service.js";
import { MessageProcessorLive } from "./services/message-processor.js";
import { OrderSessionWorkflowLive } from "./services/order-session-workflow.js";
import { TurnPlannerLive } from "./services/turn-planner.js";
import { WhatsAppClientLive } from "./services/whatsapp-client.js";

const BaseLayer = AppConfigLive;

const DatabaseLayer = DatabaseClientLive.pipe(Layer.provide(BaseLayer));
const CatalogLayer = CatalogRepoLive.pipe(Layer.provide(BaseLayer));
const FaqLayer = FaqRepoLive.pipe(Layer.provide(BaseLayer));
const TurnPlannerLayer = TurnPlannerLive.pipe(Layer.provide(BaseLayer));
const LlmLayer = LLMServiceLive.pipe(Layer.provide(TurnPlannerLayer));
const WhatsAppLayer = WhatsAppClientLive.pipe(Layer.provide(BaseLayer));
const InboundEventLayer = InboundEventRepoLive.pipe(Layer.provide(DatabaseLayer));
const LeadLayer = LeadRepoLive.pipe(Layer.provide(DatabaseLayer));
const OrderSessionLayer = OrderSessionRepoLive.pipe(Layer.provide(DatabaseLayer));
const CommerceToolsLayer = CommerceToolsLive.pipe(
  Layer.provide(Layer.mergeAll(CatalogLayer, FaqLayer, LeadLayer, OrderSessionLayer))
);
const OrderSessionWorkflowLayer = OrderSessionWorkflowLive.pipe(
  Layer.provide(Layer.mergeAll(OrderSessionLayer, LeadLayer))
);

const ConversationDependencies = Layer.mergeAll(
  CommerceToolsLayer,
  TurnPlannerLayer,
  OrderSessionWorkflowLayer,
  WhatsAppLayer
);
const ConversationEngineLayer = ConversationEngineLive.pipe(
  Layer.provide(ConversationDependencies)
);

const ProcessorLayer = MessageProcessorLive.pipe(
  Layer.provide(ConversationEngineLayer)
);
const InboundEventRunnerLayer = InboundEventRunnerLive.pipe(
  Layer.provide(Layer.mergeAll(InboundEventLayer, ProcessorLayer))
);

export const AppLayer = Layer.mergeAll(
  BaseLayer,
  InboundEventLayer,
  LeadLayer,
  OrderSessionLayer,
  CommerceToolsLayer,
  TurnPlannerLayer,
  LlmLayer,
  WhatsAppLayer,
  OrderSessionWorkflowLayer,
  ConversationEngineLayer,
  ProcessorLayer,
  InboundEventRunnerLayer
);

export const makeAppRuntime = () => ManagedRuntime.make(AppLayer);

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
