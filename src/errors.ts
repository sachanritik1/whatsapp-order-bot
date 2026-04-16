import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DataLoadError extends Data.TaggedError("DataLoadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class IntegrationError extends Data.TaggedError("IntegrationError")<{
  readonly service: "openrouter" | "whatsapp";
  readonly message: string;
  readonly cause?: unknown;
}> {}
