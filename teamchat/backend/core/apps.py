import os
import sys
import threading
import time

from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "core"

    def ready(self):
        argv = " ".join(sys.argv)
        serving = "runserver" in argv or "daphne" in argv
        if not serving:
            return
        # `runserver` with autoreload starts a parent and a child process: only the child serves requests
        if "runserver" in argv and "--noreload" not in argv and os.environ.get("RUN_MAIN") != "true":
            return
        threading.Thread(target=self._loop, daemon=True, name="teamchat-scheduler").start()

    @staticmethod
    def _loop():
        from django.db import close_old_connections

        last_clean = 0
        time.sleep(5)
        while True:
            try:
                from core.views_extra import cleanup_expired_status, run_due_scheduled

                run_due_scheduled()
                if time.time() - last_clean > 3600:
                    cleanup_expired_status()
                    last_clean = time.time()
            except Exception as e:  # keep the scheduler alive
                print("scheduler error:", e)
            finally:
                close_old_connections()
            time.sleep(15)
