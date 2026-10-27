"""Fetch and validate the City's feed before publishing a new Pages deployment."""
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

url = "https://mediaresults.toronto.ca/results/unofficialresult.json"
request = Request(url, headers={"User-Agent": "electionTO-results"})
with urlopen(request, timeout=30) as response:
    data = json.load(response)

# Reject incomplete responses so a failed refresh leaves the last deployment intact.
offices = {office["name"]: office for office in data["office"]}
assert offices["Mayor"]["ward"][0]["candidate"], "Mayor results missing"
assert any(str(ward["num"]) == "13" for ward in offices["Councillor"]["ward"]), "Ward 13 missing"
data["fetchedAt"] = datetime.now(timezone.utc).isoformat()
Path("public/results.json").write_text(json.dumps(data), encoding="utf-8")
