# 📄 Product Requirements Document (PRD)

## Project: Next.js AI Chat Agent (V1.1 Full)

---

## 1. 🎯 Objective

Build a full-stack AI generation platform that supports:

- Prompt-based AI generation (text + images)
- Async job processing via queue
- Real-time streaming responses for text
- Persistent history storage
- Token usage and cost tracking
- Real-time system observability dashboard

System goals:
- Fast UX (streaming)
- Reliable execution (queue + worker)
- Transparent costs (token tracking)
- Observable system state (dashboard)

---

## 2. 🧠 Core Architecture Concept

Hybrid execution model:

| Type  | Execution        | UX              |
|-------|-----------------|-----------------|
| Text  | Queue + Worker  | Streaming (SSE) |
| Image | Queue + Worker  | Async           |

---

## 3. 🧩 Features

### 3.1 Prompt Submission
- Chat-style UI
- Prompt type selector:
  - Text
  - Image

---

### 3.2 Async Job Processing

All requests create a job.

Lifecycle:
PENDING → QUEUED → STARTED → STREAMING → COMPLETED / FAILED / CANCELLED

---

### 3.3 Streaming (Text)

- Token-by-token streaming
- SSE endpoint: `/api/jobs/:id/stream`
- Final result persisted
- Supports reconnect

Flow:
Worker → Redis Pub/Sub → API (SSE) → Browser

---

### 3.4 Image Generation

- Processed via queue
- No streaming
- Stored and shown in gallery

---

### 3.5 Results Display

- Feed (text + mixed)
- Gallery (images)
- Each item shows:
  - prompt
  - status
  - result
  - token usage
  - cost

---

### 3.6 History

- Full job history in PostgreSQL
- Includes failed jobs

---

## 4. 💰 Token Tracking

Track per job:

- input_tokens
- output_tokens
- total_tokens
- estimated_cost
- model

Cost formula:
cost = input_tokens * input_price + output_tokens * output_price

---

## 5. 📊 System Dashboard

New tab: "System"

### Shows:
- Queue stats:
  - waiting
  - active
  - completed
  - failed
- Worker status:
  - online/offline
  - active jobs
- Active streams
- Live event logs

---

## 6. 🏗️ Architecture

### Services (Docker Compose)

- app (Next.js + API)
- worker (BullMQ)
- redis
- postgres

---

### Text Flow

Frontend → API → Queue → Worker → OpenAI → Redis Pub/Sub → SSE → UI → DB

---

### Image Flow

Frontend → API → Queue → Worker → OpenAI → DB → UI

---

## 7. 📦 API

POST /api/jobs  
GET /api/jobs/:id  
GET /api/jobs  
GET /api/jobs/:id/stream  
GET /api/system/stats  

---

## 8. 🗄️ Database

### jobs

- id
- prompt
- type
- status
- input_tokens
- output_tokens
- total_tokens
- estimated_cost
- model
- error
- timestamps

---

### results

- job_id
- output

---

## 9. ⚙️ Worker

Responsibilities:

- consume jobs
- call AI API
- stream tokens
- publish chunks
- calculate tokens
- store results
- retry failures

---

## 10. 🔄 Retry

- max 3 retries
- exponential backoff

---

## 11. 🔌 Real-Time

- SSE transport
- Redis Pub/Sub channel:
  job:{jobId}:stream

---

## 12. 🧪 Testing

Use Playwright

Test:
- prompt submit
- streaming
- job completion
- failure
- dashboard

---

## 13. 🎨 UI Tabs

- Chat
- History
- Gallery
- System

---

## 14. ⚠️ Risks

- streaming disconnects
- queue overload
- token miscalculation
- Redis pub/sub drops

---

## 15. 🚀 MVP Scope

Include:
- queue + worker
- streaming text
- image generation
- token tracking
- system dashboard

Exclude:
- auth
- multi-provider

---

## 16. 🧠 Final Notes

System layers:
- UX → streaming
- execution → queue
- observability → dashboard
- cost → token tracking

This is production-grade architecture in simplified form.
