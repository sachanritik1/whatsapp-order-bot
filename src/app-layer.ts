import { Layer, ManagedRuntime } from "effect";

import { AppConfigLive } from "./config.js";
import { CatalogRepoLive } from "./repos/catalog-repo.js";
import { DatabaseClientLive } from "./repos/database.js";
import { FaqRepoLive } from "./repos/faq-repo.js";
import { InboundEventRepoLive } from "./repos/inbound-event-repo.js";
import { LeadRepoLive } from "./repos/lead-repo.js";
import { OrderSessionRepoLive } from "./repos/order-session-repo.js";
import { CommerceToolsLive } from "./services/commerce-tools.js";
import { LLMServiceLive } from "./services/llm-service.js";
import { MessageProcessorLive } from "./services/message-processor.js";
import { WhatsAppClientLive } from "./services/whatsapp-client.js";

const BaseLayer = AppConfigLive;

const DatabaseLayer = DatabaseClientLive.pipe(Layer.provide(BaseLayer));
const CatalogLayer = CatalogRepoLive.pipe(Layer.provide(BaseLayer));
const FaqLayer = FaqRepoLive.pipe(Layer.provide(BaseLayer));
const LlmLayer = LLMServiceLive.pipe(Layer.provide(BaseLayer));
const WhatsAppLayer = WhatsAppClientLive.pipe(Layer.provide(BaseLayer));
const InboundEventLayer = InboundEventRepoLive.pipe(Layer.provide(DatabaseLayer));
const LeadLayer = LeadRepoLive.pipe(Layer.provide(DatabaseLayer));
const OrderSessionLayer = OrderSessionRepoLive.pipe(Layer.provide(DatabaseLayer));
const CommerceToolsLayer = CommerceToolsLive.pipe(
  Layer.provide(Layer.mergeAll(CatalogLayer, FaqLayer, LeadLayer, OrderSessionLayer))
);

const ProcessorDependencies = Layer.mergeAll(
  CommerceToolsLayer,
  LlmLayer,
  WhatsAppLayer
);

const ProcessorLayer = MessageProcessorLive.pipe(
  Layer.provide(ProcessorDependencies)
);

export const AppLayer = Layer.mergeAll(
  BaseLayer,
  InboundEventLayer,
  LeadLayer,
  OrderSessionLayer,
  CommerceToolsLayer,
  ProcessorLayer
);

export const makeAppRuntime = () => ManagedRuntime.make(AppLayer);
