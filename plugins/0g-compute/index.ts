import type { IntegrationPlugin } from "@/plugins/registry";
import { registerIntegration } from "@/plugins/registry";
import { ZERO_G_COMPUTE_DEFAULT_CHAIN_ID } from "./credentials";
import { ZeroGComputeIcon } from "./icon";

const zeroGComputePlugin: IntegrationPlugin = {
  type: "0g-compute",
  label: "0G Compute",
  description:
    "Run verifiable inference against models hosted on the 0G Compute network. Each request is signed by your organization's KeeperHub wallet via the 0G serving broker.",

  icon: ZeroGComputeIcon,

  // Signs through the org's KeeperHub wallet (Para or Turnkey). Defaults
  // target 0G Galileo testnet, so credentials are optional and only used to
  // override the chain id.
  requiresCredentials: false,

  formFields: [
    {
      id: "chainId",
      label: "0G Chain ID",
      type: "text",
      placeholder: String(ZERO_G_COMPUTE_DEFAULT_CHAIN_ID),
      defaultValue: String(ZERO_G_COMPUTE_DEFAULT_CHAIN_ID),
      configKey: "chainId",
      envVar: "ZERO_G_COMPUTE_CHAIN_ID",
      helpText:
        "0G chain to sign serving-broker requests on. Defaults to 16602 (Galileo testnet); 16661 selects mainnet.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testZeroGCompute } = await import("./test");
      return testZeroGCompute;
    },
  },

  actions: [
    {
      slug: "inference",
      label: "Inference",
      description:
        "Run a verifiable inference call against a 0G-served model via the serving broker",
      category: "0G Compute",
      stepFunction: "inferenceStep",
      stepImportPath: "inference",
      outputFields: [
        { field: "output", description: "Model output text" },
        { field: "model", description: "Model name reported by the provider" },
        { field: "provider", description: "Provider address used" },
        {
          field: "chatId",
          description: "Chat completion id returned by the provider",
        },
        {
          field: "verified",
          description:
            "Result of broker.processResponse signature verification",
        },
      ],
      configFields: [
        {
          key: "network",
          label: "Network",
          type: "select",
          defaultValue: String(ZERO_G_COMPUTE_DEFAULT_CHAIN_ID),
          options: [
            { value: "16602", label: "0G Galileo Testnet (16602)" },
            { value: "16661", label: "0G Mainnet (16661)" },
          ],
        },
        {
          key: "providerAddress",
          label: "Provider Address",
          type: "template-input",
          placeholder: "0x...",
          example: "0xf07240Efa67755B5311bc75784a061eDB47165Dd",
          required: true,
        },
        {
          key: "prompt",
          label: "Prompt",
          type: "template-textarea",
          placeholder: "User prompt or {{NodeName.field}}",
          rows: 4,
          required: true,
        },
        {
          key: "systemPrompt",
          label: "System Prompt",
          type: "template-textarea",
          placeholder: "Optional system prompt",
          rows: 3,
          required: false,
        },
        {
          key: "maxTokens",
          label: "Max Tokens",
          type: "number",
          placeholder: "256",
          min: 1,
          max: 4096,
          required: false,
        },
        {
          key: "temperature",
          label: "Temperature",
          type: "number",
          placeholder: "0.0",
          min: 0,
          max: 2,
          step: 0.1,
          required: false,
        },
      ],
    },
  ],
};

registerIntegration(zeroGComputePlugin);

export default zeroGComputePlugin;
