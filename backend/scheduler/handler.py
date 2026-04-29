"""Smoke-test scheduler — pings App Runner /health on a cron and emits a
CloudWatch metric. Mirrors the deploy reference's hello-agent-scheduler.
"""

from __future__ import annotations

import logging
import os
import time
import urllib.request
from datetime import datetime

import boto3


logger = logging.getLogger()
logger.setLevel(logging.INFO)

APP_RUNNER_URL = os.environ["APP_RUNNER_URL"]
SERVICE_NAME = os.getenv("SERVICE_NAME", "vendor-agent")

cloudwatch = boto3.client("cloudwatch")


def handler(event, context):
    started = time.time()
    healthy = False
    error: str | None = None
    try:
        req = urllib.request.Request(f"{APP_RUNNER_URL}/health")
        with urllib.request.urlopen(req, timeout=10) as resp:
            healthy = resp.status == 200
    except Exception as e:
        error = str(e)

    latency_ms = (time.time() - started) * 1000.0
    cloudwatch.put_metric_data(
        Namespace=f"{SERVICE_NAME}/SmokeTest",
        MetricData=[
            {
                "MetricName": "Healthy",
                "Value": 1.0 if healthy else 0.0,
                "Unit": "Count",
                "Timestamp": datetime.utcnow(),
            },
            {
                "MetricName": "LatencyMs",
                "Value": latency_ms,
                "Unit": "Milliseconds",
                "Timestamp": datetime.utcnow(),
            },
        ],
    )
    logger.info("smoke healthy=%s latency=%.0fms err=%s", healthy, latency_ms, error)
    return {"healthy": healthy, "latency_ms": latency_ms, "error": error}
