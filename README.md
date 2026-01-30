# OpenClaw WeCom AI Bot Plugin

[简体中文](https://github.com/sunnoy/openclaw-plugin-wecom/blob/main/README_ZH.md) | [English](https://github.com/sunnoy/openclaw-plugin-wecom/blob/main/README.md)

`openclaw-plugin-wecom` is an enterprise WeChat (WeCom) integration plugin specifically developed for the [OpenClaw](https://github.com/sunnoy/openclaw-plugin-wecom) framework. It allows you to seamlessly integrate powerful AI capabilities into WeCom with support for multiple advanced features.

## ✨ Key Features

- 🌊 **Streaming Output**: Based on the latest WeCom AI Bot streaming mechanism for a smooth typing-like response experience.
- 🤖 **Dynamic Agent Management**: Automatically creates an independent Agent per DM user and per group chat. Each Agent has its own workspace and conversation history, keeping data isolated by default.
- 👥 **Deep Group Chat Integration**: Supports group message parsing and precise triggering via @mentions.
- 🛠️ **Enhanced Commands**: Built-in support for common commands (e.g., `/new` for a new session, `/status` to check status) with command allowlist configuration.
- 🔒 **Security & Authentication**: Full support for WeCom message encryption/decryption, URL verification, and sender identity validation.
- ⚡ **High-Performance Async Processing**: Uses an asynchronous message processing architecture to ensure high responsiveness of the WeCom gateway even during long-running AI inference.

## 🤖 Dynamic Agent Routing (How it works)

OpenClaw decides which Agent to run by parsing `SessionKey`. This plugin uses that mechanism to provide per-user / per-group isolation:

1. When a WeCom message arrives, the plugin generates a deterministic `agentId`:
   - DM: `wxwork-dm-<userId>`
   - Group: `wxwork-group-<chatId>`
2. The plugin routes the message by setting `SessionKey` to:
   - `agent:<agentId>:<peerKind>:<peerId>`
3. OpenClaw extracts `<agentId>` from `SessionKey` and will automatically create / reuse the Agent workspace (typically under `~/.openclaw/workspace-<agentId>` for non-default agents).

If you prefer all WeCom messages to use OpenClaw’s **default Agent**, disable dynamic agents:

```json
{
  "channels": {
    "wxwork": {
      "dynamicAgents": { "enabled": false }
    }
  }
}
```

## 🚀 Quick Start

### 1. Install Plugin

Run the following in your OpenClaw project directory:

```bash
npm install openclaw-plugin-wecom
```

### 2. Configure Plugin

Add the plugin configuration to your OpenClaw configuration file (e.g., `config.json`):

```json
{
  "channels": {
    "wxwork": {
      "enabled": true,
      "token": "YOUR_TOKEN",
      "encodingAesKey": "YOUR_ENCODING_AES_KEY",
      "webhookPath": "/webhooks/wxwork",
      "accounts": {
        "default": {
          "allowFrom": ["*"]
        }
      },
      "commands": {
        "enabled": true,
        "allowlist": ["/new", "/status", "/help", "/compact"]
      },
      "dynamicAgents": {
        "enabled": true
      }
    }
  }
}
```

### 3. WeCom Admin Portal Setup

1. Create an "AI Bot" in the WeCom management backend.
2. Set the "Message Receiving Configuration" URL to your service address (e.g., `https://your-domain.com/webhooks/wxwork`).
3. Fill in the corresponding Token and EncodingAESKey.

## 🛠️ Command Support

The plugin has built-in handling for the following commands:

- `/new`: Reset current conversation and start a new session.
- `/compact`: Compact session context, keeping key summaries to save tokens.
- `/help`: View help information.
- `/status`: View current Agent and plugin status.

## 📂 Project Structure

- `index.js`: Plugin entry point, handling all core routing and lifecycle management.
- `webhook.js`: Handles WeCom HTTP communication, encryption/decryption, and message parsing.
- `dynamic-agent.js`: Dynamic Agent allocation logic.
- `stream-manager.js`: Manages the state and data partitioning of streaming responses.
- `crypto.js`: Implementation of WeCom encryption algorithms.

## 🤝 Contributing

We welcome contributions! If you find a bug or have suggestions for new features, please submit an Issue or Pull Request.

## 📄 License

This project is licensed under the [ISC License](./LICENSE).
