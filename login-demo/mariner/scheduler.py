from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger


def make_scheduler(settings, pipeline):
    scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    if settings.scheduler_enabled:
        scheduler.add_job(pipeline.start, trigger=CronTrigger(hour=7, minute=30, timezone="Asia/Shanghai"),
                          kwargs={"trigger": "schedule_0730"}, id="daily-pipeline", max_instances=1)
    return scheduler
