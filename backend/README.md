# ROADMAP card creator — backend (v2)

A small FastAPI service that turns a paper (PDF or text) into a schema-valid
ROADMAP / RSNA ATLAS **dataset** or **model** card, and validates cards.

## Run it

From the repository root:

```bash
cp .env.example .env      # then put your ANTHROPIC_API_KEY in .env
docker compose up --build
```

The app is then at <http://localhost:8000> (the same container serves the web app from
`frontend/` and this API); interactive API docs are at <http://localhost:8000/api/docs>.

| Endpoint | What it does |
|---|---|
| `GET /api/health` | Status, active provider/model, whether a key is configured |
| `GET /api/schemas/{dataset\|model}` | The ATLAS 2025-11 JSON Schema (same file the server validates with) |
| `POST /api/validate` | Body = a card. Returns `{valid, errors[]}`; every error names its field |
| `POST /api/extract` | Multipart form: `card_type` + `file` (PDF) or `text`. Returns `{card, valid, errors, warnings, meta}` |

Try it:

```bash
curl -F card_type=dataset -F file=@paper.pdf http://localhost:8000/api/extract
```

## How a card is produced

```
PDF ──► model provider ──► parse JSON ──► normalize ──► validate ──► card
                                              │             │
                                              │        problems? one repair
                                              │        request, keep the better card
                                              └─ root rebuilt as exactly {"$schema", "Dataset"|"Model"};
                                                 body walked against the schema
```

- `schemas/` is the single source of truth. The prompt (`app/prompt.py`), the normalizer
  (`app/normalize.py`) and the validator (`app/validation.py`) all read it, so the extractor and
  the validator cannot disagree — the cause of v1's "root: must NOT have additional properties".
- The normalizer fixes what can be fixed deterministically (mis-cased or snake_case field names,
  `"CT"` → `"Computed tomography (RID10321)"`, `"2024"` → `2024`, `"12,611"` → `12611`, …) and
  removes what the schema does not allow. Everything it changes is returned in `warnings`.
- Whatever is still wrong is returned in `errors` for the user to fix in the editor; extraction
  never returns a card in a shape the validator rejects wholesale.

## Model providers

One interface (`app/providers/base.py`): `complete(system, user, pdf) -> text`.
Choose with `LLM_PROVIDER`:

| `LLM_PROVIDER` | Default model | Key | File |
|---|---|---|---|
| `anthropic` (default) | `claude-fable-5-2` | `ANTHROPIC_API_KEY` | `app/providers/anthropic.py` |
| `gemini` | `gemini-2.5-pro` | `GEMINI_API_KEY` | `app/providers/gemini.py` |

To add a provider: one new file with one class, registered in `app/providers/__init__.py`.
All settings are environment variables — see `.env.example`.

## Develop / test without Docker

```bash
cd backend
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt pytest httpx   # Windows
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m uvicorn app.main:app --reload
```

The tests use a fake provider, so they need no API key and cost nothing.

For frontend work, run `npm install && npm run dev` in `frontend/` (http://localhost:5173);
it proxies `/api` to the backend on port 8000.

## Running on AWS

The image (root `Dockerfile`) is plain Docker + HTTP on port 8000: push it to ECR and run it on
App Runner or ECS Fargate with the same environment variables. Nothing in the code is AWS- or
droplet-specific.
