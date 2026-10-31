import io
import json
import re
from datetime import timedelta
from html.parser import HTMLParser

import pdfplumber

from mariner.collectors.client import CollectorHTTP
from mariner.db.models import HtsRelease, PolicyDocument, PipelineRun
from mariner.db.store import rows
from mariner.settings import FIXTURES, now

AGENCIES = {"trade-representative-office-of-united-states", "u-s-customs-and-border-protection",
            "international-trade-administration", "industry-and-security-bureau", "executive-office-of-the-president"}
FR_URL = "https://www.federalregister.gov/api/v1/documents.json"
PI_URL = "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json"
USITC_URL = "https://hts.usitc.gov/reststop/releaseList"


def read_fixture(path):
    return json.loads((FIXTURES / path).read_text(encoding="utf-8"))


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def strip_html(text):
    parser = TextParser()
    parser.feed(text)
    return normalize(" ".join(parser.parts))


def metadata(doc):
    return {key: doc.get(key) for key in ("document_number", "title", "type", "agencies", "abstract", "action", "dates", "publication_date", "effective_on")}


def metadata_text(doc):
    return normalize(" ".join(str(doc.get(key) or "") for key in ("title", "abstract", "action", "dates")))


def source_text(doc, settings, http=None):
    parts = [metadata_text(doc)]
    if settings.collector_mode == "fixture":
        file = FIXTURES / f'federal_register/document_{doc["document_number"]}_raw_text.html'
        if file.exists():
            parts.append(strip_html(file.read_text(encoding="utf-8")))
    else:
        http = http or CollectorHTTP()
        url = doc.get("pdf_url") if doc.get("is_public_inspection") else doc.get("raw_text_url")
        if not url:
            raise ValueError("Full text URL is missing")
        response = http.get(url)
        if doc.get("is_public_inspection"):
            with pdfplumber.open(io.BytesIO(response.content)) as pdf:
                parts.extend(page.extract_text() or "" for page in pdf.pages)
        else:
            parts.append(strip_html(response.text))
    return normalize(" ".join(parts))


def collect_documents(session, settings, kind, http=None):
    http = http or CollectorHTTP()
    preview = kind == "collector_pi"
    if settings.collector_mode == "fixture":
        page = read_fixture("federal_register/" + ("public_inspection_current_2026-10-31.json" if preview else "documents_ustr_cbp_2026-10-01_2026-10-29.json"))
    else:
        if preview:
            page = http.get(PI_URL).json()
        else:
            dates = [r.business_date for r in rows(session, PipelineRun) if any(s["agent"] == kind and s["status"] == "succeeded" for s in r.payload["steps"])]
            since = max(dates) if dates else str(settings.today - timedelta(days=30))
            fields = "title document_number publication_date type agency_names html_url effective_on abstract action dates raw_text_url pdf_url".split()
            params = [("conditions[agencies][]", slug) for slug in sorted(AGENCIES)] + [("fields[]", f) for f in fields]
            params += [("conditions[publication_date][gte]", since), ("order", "newest"), ("per_page", "100")]
            page = http.get(FR_URL, params=params).json()
    inputs = output = 0
    visited = set()
    while True:
        if preview and (page.get("count") == 0 or page.get("meta", {}).get("pil_unavailability_message")):
            break
        documents = page.get("results", [])
        inputs += len(documents)
        for raw in documents:
            if preview and not any(a.get("slug") in AGENCIES for a in raw.get("agencies", [])):
                continue
            doc = dict(raw)
            number = doc["document_number"]
            if session.get(PolicyDocument, number):
                continue
            supplement = FIXTURES / f"federal_register/document_{number}_fields.json"
            if settings.collector_mode == "fixture" and supplement.exists():
                extra = json.loads(supplement.read_text(encoding="utf-8"))
                doc.update({key: extra[key] for key in ("abstract", "action", "dates", "raw_text_url") if key in extra})
            doc["agencies"] = doc.get("agencies") or doc.get("agency_names", [])
            doc.update(is_public_inspection=preview, collector=kind, collected_at=now())
            session.add(PolicyDocument(id=number, business_date=str(settings.today), payload=doc))
            session.flush()
            output += 1
        next_url = page.get("next_page_url")
        if not next_url or settings.collector_mode == "fixture":
            break
        if next_url in visited:
            raise ValueError("Repeated pagination URL")
        visited.add(next_url)
        page = http.get(next_url).json()
    return dict(input=inputs, output=output, skipped=0, errors=0)


def collect_usitc(session, settings, http=None):
    data = read_fixture("usitc/releaseList_2026-10-31.json") if settings.collector_mode == "fixture" else (http or CollectorHTTP()).get(USITC_URL).json()
    current = next(item for item in data if item["status"] == "current")
    existing = session.get(HtsRelease, current["name"])
    if existing:
        existing.payload = {**current, "checked_at": now()}
    else:
        session.add(HtsRelease(id=current["name"], business_date=str(settings.today), payload={**current, "checked_at": now()}))
    session.flush()
    return dict(input=1, output=1, skipped=0, errors=0)


def lookup_hts(code, settings, http=None):
    if settings.collector_mode == "fixture":
        path = FIXTURES / f"usitc/search_{code}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    return (http or CollectorHTTP()).get("https://hts.usitc.gov/reststop/search", params={"keyword": code}).json()
