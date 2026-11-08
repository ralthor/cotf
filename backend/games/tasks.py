from celery import shared_task

from accounts.models import ExternalAccount

from .providers import ProviderError
from .services import sync_account


@shared_task(
    bind=True,
    autoretry_for=(ProviderError,),
    retry_backoff=60,
    retry_backoff_max=900,
    max_retries=3,
    rate_limit="30/m",
)
def sync_account_task(self, account_id: int) -> dict:
    account = ExternalAccount.objects.filter(id=account_id).first()
    if account is None:
        return {"skipped": "account deleted"}
    return sync_account(account)


@shared_task
def sync_all_accounts() -> int:
    ids = list(ExternalAccount.objects.values_list("id", flat=True))
    for account_id in ids:
        sync_account_task.delay(account_id)
    return len(ids)
