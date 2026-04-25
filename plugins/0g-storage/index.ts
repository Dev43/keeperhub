import type { IntegrationPlugin } from "@/plugins/registry";
import { registerIntegration } from "@/plugins/registry";
import {
  ZERO_G_DEFAULT_CHAIN_ID,
  ZERO_G_DEFAULT_FLOW_ADDRESS,
  ZERO_G_DEFAULT_INDEXER_URL,
  ZERO_G_DEFAULT_KV_NODE_URL,
} from "./credentials";
import { ZeroGStorageIcon } from "./icon";

const zeroGStoragePlugin: IntegrationPlugin = {
  type: "0g-storage",
  label: "0G Storage",
  description:
    "Read and write KV entries and append-only logs on 0G Storage using your organization's KeeperHub wallet to sign on-chain Flow transactions",

  icon: ZeroGStorageIcon,

  // The plugin signs through the organization's KeeperHub wallet (Para or
  // Turnkey). Defaults work for 0G Galileo testnet, so credentials are
  // optional and only used to override endpoints or chain id.
  requiresCredentials: false,

  formFields: [
    {
      id: "chainId",
      label: "0G Chain ID",
      type: "text",
      placeholder: String(ZERO_G_DEFAULT_CHAIN_ID),
      defaultValue: String(ZERO_G_DEFAULT_CHAIN_ID),
      configKey: "chainId",
      envVar: "ZERO_G_CHAIN_ID",
      helpText:
        "0G chain to sign Flow transactions on. Defaults to 16601 (Galileo testnet); 16661 selects mainnet.",
    },
    {
      id: "indexerUrl",
      label: "0G Storage Indexer URL",
      type: "text",
      placeholder: ZERO_G_DEFAULT_INDEXER_URL,
      defaultValue: ZERO_G_DEFAULT_INDEXER_URL,
      configKey: "indexerUrl",
      envVar: "ZERO_G_INDEXER_URL",
      helpText:
        "Indexer endpoint used to discover storage nodes for blob and KV uploads",
    },
    {
      id: "kvNodeUrl",
      label: "0G KV Node URL",
      type: "text",
      placeholder: ZERO_G_DEFAULT_KV_NODE_URL,
      defaultValue: ZERO_G_DEFAULT_KV_NODE_URL,
      configKey: "kvNodeUrl",
      envVar: "ZERO_G_KV_NODE_URL",
      helpText:
        "KV node JSON-RPC endpoint used by KV reads. Defaults to the 0G Galileo testnet KV node",
    },
    {
      id: "flowAddress",
      label: "Flow Contract Address",
      type: "text",
      placeholder: ZERO_G_DEFAULT_FLOW_ADDRESS,
      defaultValue: ZERO_G_DEFAULT_FLOW_ADDRESS,
      configKey: "flowAddress",
      envVar: "ZERO_G_FLOW_ADDRESS",
      helpText:
        "0G Flow contract used to commit data roots. Defaults to the Galileo testnet deployment",
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
        {
          field: "value",
          description: "Stored value (UTF-8 decoded), or null if not present",
        },
        { field: "version", description: "Entry version, or null" },
      ],
      configFields: [
        {
          key: "streamId",
          label: "Stream ID",
          type: "template-input",
          placeholder: "0x...",
          example:
            "0x000000000000000000000000000000000000000000000000000000000000f2bd",
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
      description:
        "Write a value to a 0G Storage KV stream by submitting an on-chain Flow transaction signed by your KeeperHub wallet",
      category: "0G",
      stepFunction: "kvPutStep",
      stepImportPath: "kv-put",
      outputFields: [
        { field: "txHash", description: "0G chain tx hash for the write" },
        { field: "rootHash", description: "Data root hash committed on-chain" },
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
      description:
        "Append an entry to an append-only log by uploading a signed blob to 0G Storage with your KeeperHub wallet",
      category: "0G",
      stepFunction: "logAppendStep",
      stepImportPath: "log-append",
      outputFields: [
        {
          field: "rootHash",
          description: "Data root hash of the appended entry",
        },
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
