"""Scheduled-scan Lambda — fires every 10 minutes and enqueues a synthetic
"find high-HHI categories" job onto the same SQS queue the user-facing
chat uses. The orchestrator runs the full pipeline (Router → Discovery →
Investigation → Validator → Final Brief) and, because we set
`scheduled=True` on the job, also writes any high-concentration findings
into the notifications DynamoDB table.

Reusing the user-facing job queue means zero duplicated agent code: the
same pipeline that answers a judge's chat question also drives the
proactive scan.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid

import boto3


logger = logging.getLogger()
logger.setLevel(logging.INFO)

QUEUE_URL = os.environ["QUEUE_URL"]
JOBS_TABLE = os.environ["JOBS_TABLE"]

sqs = boto3.client("sqs")
dynamodb = boto3.resource("dynamodb")
jobs = dynamodb.Table(JOBS_TABLE)


SCAN_PROMPT = (
    "Scan government spending and identify any category with an HHI above "
    "2500 (highly concentrated, per the DOJ Horizontal Merger Guidelines). "
    "For each high-concentration category, name the dominant vendor and "
    "how long they have held it."
)


def handler(event, context):
    job_id = f"scan-{uuid.uuid4()}"

    jobs.put_item(Item={
        "job_id": job_id,
        "status": "pending",
        "message": SCAN_PROMPT,
        "context": "",
        "events": [],
        "audit": {},
        "scheduled": True,
        "ttl": int(time.time()) + 86400,
    })

    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({
            "job_id": job_id,
            "message": SCAN_PROMPT,
            "context": "",
            "scheduled": True,
        }),
    )

    logger.info("Enqueued scheduled scan job %s", job_id)
    return {"job_id": job_id}
