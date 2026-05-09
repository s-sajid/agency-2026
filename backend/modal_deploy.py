"""Modal deployment entrypoint.

Wraps the FastAPI app in `server.py` as a Modal ASGI app. Also registers
the hourly auto-scan scheduled function (replaces the AWS EventBridge →
scan_scheduler Lambda → SQS → orchestrator pipeline).

Deploy:
    cd backend && uv run modal deploy modal_deploy.py

The Modal CLI reads MODAL_TOKEN_ID / MODAL_TOKEN_SECRET from env. All
other secrets (OLLAMA_CLOUD_API_KEY, PG_DSN, CORS_ORIGINS, etc.) come
from a Modal Secret named `vendor-agent` — create with:

    modal secret create vendor-agent \\
        OLLAMA_CLOUD_API_KEY=... \\
        OLLAMA_HOST=https://ollama.com \\
        LLM_PROVIDER=ollama \\
        LLM_MODEL=gemma4:31b-cloud \\
        PG_DSN=... \\
        CORS_ORIGINS=https://your-app.vercel.app
"""

from __future__ import annotations

import modal

# Build the image from this directory's pyproject.toml so the deployed
# Modal container has the same dependency graph as local dev.
# add_local_dir is used (not add_local_python_source) so the prompts/*.md
# files in the package travel with the .py files.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libpq-dev", "gcc")
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_dir(
        "vendor_concentration_agent",
        remote_path="/root/vendor_concentration_agent",
    )
    .add_local_file("server.py", "/root/server.py")
)

# Persist the SQLite job store across container restarts so historical
# /status reads keep working. SQLite-on-Volume is fine for our single-
# writer workload (one Modal container at a time).
volume = modal.Volume.from_name("vendor-agent-jobstore", create_if_missing=True)

app = modal.App(
    "vendor-agent",
    image=image,
    secrets=[modal.Secret.from_name("vendor-agent")],
)


@app.function(
    volumes={"/data": volume},
    timeout=900,
    min_containers=1,  # avoid cold starts during the demo
)
@modal.concurrent(max_inputs=10)
@modal.asgi_app()
def web():
    import os
    os.environ.setdefault("JOBSTORE_DB", "/data/vendor_agent.db")
    from server import app as fastapi_app
    return fastapi_app


@app.function(
    volumes={"/data": volume},
    timeout=900,
    schedule=modal.Cron("0 * * * *"),  # hourly
)
async def scheduled_scan():
    """Hourly auto-scan: enqueue a synthetic 'find high-HHI categories'
    prompt and run it through the same orchestrator the chat uses.
    Notifications get written into SQLite when HHI > 2500.
    """
    import os
    import uuid

    os.environ.setdefault("JOBSTORE_DB", "/data/vendor_agent.db")
    from vendor_concentration_agent.jobstore import SqliteJobSink
    from vendor_concentration_agent.orchestration import run_job

    # Phrased to route to `pipeline` (uses "what … and why" — see
    # prompts/router.md). "Identify the top N" would route to `discovery`,
    # which skips Final Brief and therefore skips _maybe_notify.
    prompt = (
        "What is the most concentrated procurement category right now, "
        "and why? Report the HHI value, the dominant vendor, and how "
        "long they have held it."
    )
    sink = SqliteJobSink()
    job_id = str(uuid.uuid4())
    sink.create_job(job_id, prompt)
    await run_job(job_id, sink, prompt, "", scheduled=True)
