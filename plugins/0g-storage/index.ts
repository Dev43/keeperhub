import type { IntegrationPlugin } from "@/plugins/registry";
import { registerIntegration } from "@/plugins/registry";
import { ZeroGStorageIcon } from "./icon";

const zeroGStoragePlugin: IntegrationPlugin = {
  type: "0g-storage",
  label: "0G Storage",
  description: "Read and write KV entries and append-only logs on 0G Storage",

  icon: ZeroGStorageIcon,

  requiresCredentials: true,

  formFields: [
    {
      id: "network",
      label: "Network",
      type: "text",
      placeholder: "testnet",
      defaultValue: "testnet",
      configKey: "network",
      envVar: "ZERO_G_STORAGE_NETWORK",
      helpText:
        "0G network: 'mainnet' or 'testnet'. Selects the default indexer URL when one is not provided below.",
    },
    {
      id: "indexerUrl",
      label: "Indexer URL (optional)",
      type: "text",
      placeholder: "https://indexer-storage-testnet-turbo.0g.ai",
      configKey: "indexerUrl",
      envVar: "ZERO_G_STORAGE_INDEXER_URL",
      helpText:
        "Override the default indexer endpoint for the selected network",
    },
    {
      id: "privateKey",
      label: "Signer Private Key",
      type: "password",
      placeholder: "0x...",
      configKey: "privateKey",
      envVar: "ZERO_G_STORAGE_PRIVATE_KEY",
      helpText:
        "Private key used to authorize KV writes and Log appends. Reads do not require a key.",
    },
  ],

  testConfig: {
    getTestFunction: async () => {
      const { testZeroGStorage } = await import("./test");
      return testZeroGStorage;
    },
  },

  actions: [
    {
      slug: "kv-get",
      label: "KV Get",
      description: "Read a value from a 0G Storage KV stream",
      category: "0G",
      stepFunction: "kvGetStep",
      stepImportPath: "kv-get",
      outputFields: [
        { field: "value", description: "Stored value, or null if not present" },
        { field: "version", description: "Entry version, or null" },
      ],
      configFields: [
        {
          key: "streamId",
          label: "Stream ID",
          type: "template-input",
          placeholder: "0x...",
          example: "0xabc123...",
          required: true,
        },
        {
          key: "key",
          label: "Key",
          type: "template-input",
          placeholder: "Key or {{NodeName.field}}",
          example: "phulax/exploit-corpus/v1",
          required: true,
        },
      ],
    },
    {
      slug: "kv-put",
      label: "KV Put",
      description: "Write a value to a 0G Storage KV stream",
      category: "0G",
      stepFunction: "kvPutStep",
      stepImportPath: "kv-put",
      outputFields: [
        { field: "txHash", description: "0G chain tx hash for the write" },
      ],
      configFields: [
        {
          key: "streamId",
          label: "Stream ID",
          type: "template-input",
          placeholder: "0x...",
          required: true,
        },
        {
          key: "key",
          label: "Key",
          type: "template-input",
          placeholder: "Key or {{NodeName.field}}",
          required: true,
        },
        {
          key: "value",
          label: "Value",
          type: "template-textarea",
          placeholder: "Value or {{NodeName.field}}",
          rows: 4,
          required: true,
        },
      ],
    },
    {
      slug: "log-append",
      label: "Log Append",
      description: "Append an entry to a 0G Storage append-only log stream",
      category: "0G",
      stepFunction: "logAppendStep",
      stepImportPath: "log-append",
      outputFields: [
        { field: "entryId", description: "Append-only log entry ID" },
        { field: "txHash", description: "0G chain tx hash for the append" },
      ],
      configFields: [
        {
          key: "streamId",
          label: "Stream ID",
          type: "template-input",
          placeholder: "0x...",
          required: true,
        },
        {
          key: "payload",
          label: "Payload",
          type: "template-textarea",
          placeholder: "Payload or {{NodeName.field}}",
          rows: 4,
          required: true,
        },
        {
          key: "tag",
          label: "Tag",
          type: "template-input",
          placeholder: "Optional tag",
          required: false,
        },
      ],
    },
  ],
};

registerIntegration(zeroGStoragePlugin);

export default zeroGStoragePlugin;
