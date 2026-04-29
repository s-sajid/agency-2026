"""Trace bus — translates agent + tool events into the SSE shape the
frontend's ChatDrawer expects:

    {"text": "..."}                                        — assistant token
    {"tool":"<name>", "label":"...", "question":"..."}     — agent/tool started
    {"tool_done":"<name>"}                                  — agent/tool finished
    {"error":"..."}                                         — fatal

Lands in Hour 3.
"""
