# WhatsApp Order Assistant POC

Effect TS + Node.js + Express backend for a WhatsApp AI order assistant POC. The service verifies Meta webhooks, acknowledges inbound events immediately, stores them in SQLite, and processes them asynchronously.

## Features

- `GET /webhook` for Meta verification
- `POST /webhook` for inbound WhatsApp messages
- Effect-first service composition using `Effect`, `Layer`, and `Schema`
- SQLite-backed inbound queue, order sessions, and leads
- Catalog and FAQ answers grounded only in local JSON data
- OpenRouter or Google Gemini backed intent classification and optional reply phrasing
- Real WhatsApp Cloud API sending when configured, dry-run logging otherwise

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Required environment variables:

- `WEBHOOK_VERIFY_TOKEN`

Optional:

- `LLM_PROVIDER` (`openrouter` or `gemini`). If omitted, app prefers OpenRouter when configured, then Gemini, then heuristic fallback.
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `GOOGLE_GEMINI_API_KEY`
- `GOOGLE_GEMINI_MODEL`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `DATABASE_FILE`

If no supported LLM provider is configured, app falls back to deterministic intent classification and reply templates so POC remains runnable locally.

## Example Webhook Verification

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=replace-me&hub.challenge=12345"
```

Response:

```text
12345
```

## Example Inbound Message

```bash
curl -X POST "http://localhost:3000/webhook" \
  -H "content-type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "entry-1",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messages": [
                {
                  "from": "919999999999",
                  "id": "wamid.sample",
                  "timestamp": "1712217600",
                  "type": "text",
                  "text": { "body": "I want to order 2 protein granola jars for Bangalore 560001. My name is Riya." }
                }
              ]
            }
          }
        ]
      }
    ]
  }'
```

Response:

```json
{
  "received": true
}
```

## Example Logs

```text
{"level":"info","event":"webhook.received","messageCount":1}
{"level":"info","event":"queue.enqueued","messageId":"wamid.sample","phone":"919999999999"}
{"level":"info","event":"worker.intent","messageId":"wamid.sample","intent":"order_intent"}
{"level":"info","event":"lead.created","leadId":1,"phone":"919999999999"}
{"level":"info","event":"whatsapp.send.dry_run","phone":"919999999999","text":"Thanks Riya. I have your order for 2 x Protein Granola Jar to 560001."}
```
