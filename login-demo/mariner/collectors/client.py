import time
from urllib.parse import urljoin, urlparse

import httpx

ALLOWED_HOSTS = {"www.federalregister.gov", "public-inspection.federalregister.gov", "hts.usitc.gov"}


class CollectorHTTP:
    def __init__(self, sleep=time.sleep):
        self.sleep = sleep
        self.last_request = 0.0

    def get(self, url, params=None):
        for redirect in range(6):
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.port not in (None, 443) or parsed.username:
                raise ValueError("Collector host is not allowed")
            for attempt in range(4):
                remaining = 1 - (time.monotonic() - self.last_request)
                if remaining > 0:
                    self.sleep(remaining)
                self.last_request = time.monotonic()
                try:
                    response = httpx.get(url, params=params, timeout=30, headers={"User-Agent": "MarinerAI/0.1"}, follow_redirects=False)
                    if response.is_redirect:
                        url = urljoin(url, response.headers["location"])
                        params = None
                        break
                    response.raise_for_status()
                    return response
                except (httpx.HTTPError, KeyError):
                    if attempt == 3:
                        raise
                    self.sleep(2 ** attempt)
            else:
                continue
        raise ValueError("Too many redirects")
