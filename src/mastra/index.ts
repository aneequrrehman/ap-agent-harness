import { Mastra } from "@mastra/core";
import { apAgent } from "./agents/ap-agent";
import { reflectorAgent } from "./agents/reflector-agent";

export const mastra = new Mastra({
  agents: { apAgent, reflectorAgent },
});
