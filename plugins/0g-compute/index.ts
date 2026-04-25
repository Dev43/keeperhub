import type { IntegrationPlugin } from "@/plugins/registry";
import { registerIntegration } from "@/plugins/registry";
import { ZeroGComputeIcon } from "./icon";

const zeroGComputePlugin: IntegrationPlugin = {
  type: "0g-compute",
  label: "0G Compute",
  description:
    "Run sealed inference against models hosted on the 0G Compute network",

  icon: ZeroGComputeIcon,

  requiresCredentials: true,

  formFields: [
    {
      id: "network",
      label: "Network",
      type: "text",
      placeholder: "testnet",
      defaultValue: "testnet",
      configKey: "network",
      envVar: "ZERO_G_COMPUTE_NETWORK",
      helpText:
        "0G network: 'mainnet' or 'testnet'. Selects the default gateway URL when one is not provided below.",
    },
    {
      id: "gatewayUrl",
      label: "Gateway URL (optional)",
      type: "url",
      placeholder: "https://compute-testnet.0g.ai",
      configKey: "gatewayUrl",
      envVar: "ZERO_G_COMPUTE_GATEWAY_URL",
      helpText:
        "Override the default gateway endpoint for the selected network",
    },
    {
      id: "apiKey",
      label: "API Key",
      type: "password",
      placeholder: "0gc_...",
      configKey: "apiKey",
      envVar: "ZERO_G_COMPUTE_API_KEY",
      helpText: "API key for 0G Compute",
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
      slug: "sealed-inference",
      label: "Sealed Inference",
      description:
        "Run a verifiable sealed-inference call against a 0G-served model",
      category: "0G",
      stepFunction: "sealedInferenceStep",
      stepImportPath: "sealed-inference",
      outputFields: [
        { field: "output", description: "Model output text" },
        {
          field: "attestation",
          description: "TEE attestation blob (base64)",
        },
        { field: "modelHash", description: "Hash of the served model" },
      ],
      configFields: [
        {
          key: "model",
          label: "Model",
          type: "template-input",
          placeholder: "qwen2.5-0.5b-instruct",
          example: "qwen2.5-0.5b-instruct",
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
