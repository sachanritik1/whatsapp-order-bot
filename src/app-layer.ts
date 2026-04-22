import { Layer, ManagedRuntime } from "effect";

import { AppConfigLive } from "./config.js";
import { CatalogRepoLive } from "./repos/catalog-repo.js";
import { FaqRepoLive } from "./repos/faq-repo.js";
import { SqliteDatabaseClientLive } from "./repos/sqlite/database.js";
import { SqliteInboundEventRepoLive } from "./repos/sqlite/inbound-event-repo.js";
import { SqliteLeadRepoLive } from "./repos/sqlite/lead-repo.js";
import { SqliteOrderSessionRepoLive } from "./repos/sqlite/order-session-repo.js";
import { CommerceToolsLive } from "./services/commerce-tools.js";
import { ConversationEngineLive } from "./services/conversation-engine.js";
import { InboundEventRunnerLive } from "./services/inbound-event-runner.js";
import { OrderSessionWorkflowLive } from "./services/order-session-workflow.js";
import { TurnPlannerLive } from "./services/turn-planner.js";
import { WhatsAppClientLive } from "./services/whatsapp-client.js";

const BaseLayer = AppConfigLive;

const DatabaseLayer = SqliteDatabaseClientLive.pipe(Layer.provide(BaseLayer));
const CatalogLayer = CatalogRepoLive.pipe(Layer.provide(BaseLayer));
const FaqLayer = FaqRepoLive.pipe(Layer.provide(BaseLayer));
const TurnPlannerLayer = TurnPlannerLive.pipe(Layer.provide(BaseLayer));
const WhatsAppLayer = WhatsAppClientLive.pipe(Layer.provide(BaseLayer));
const InboundEventLayer = SqliteInboundEventRepoLive.pipe(Layer.provide(DatabaseLayer));
const LeadLayer = SqliteLeadRepoLive.pipe(Layer.provide(DatabaseLayer));
const OrderSessionLayer = SqliteOrderSessionRepoLive.pipe(Layer.provide(DatabaseLayer));
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
const InboundEventRunnerLayer = InboundEventRunnerLive.pipe(
  Layer.provide(Layer.mergeAll(InboundEventLayer, ConversationEngineLayer))
);

export const AppLayer = Layer.mergeAll(
  BaseLayer,
  InboundEventLayer,
  LeadLayer,
  OrderSessionLayer,
  CommerceToolsLayer,
  TurnPlannerLayer,
  WhatsAppLayer,
  OrderSessionWorkflowLayer,
  ConversationEngineLayer,
  InboundEventRunnerLayer
);

export const makeAppRuntime = () => ManagedRuntime.make(AppLayer);

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
