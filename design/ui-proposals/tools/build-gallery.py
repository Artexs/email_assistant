#!/usr/bin/env python3
"""Writes gallery-data.js: every version (current panel + each proposal) and its screenshots.

Shots are named <screen>-<device>-<scheme>.png, for example 02-approvals-phone-dark.png.
Current panel: current/*.png. A proposal: proposals/NN-slug/shots/*.png plus proposals/NN-slug/meta.json
({"name": "...", "pitch": "...", "page": "index.html"}).
"""
import json, re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
SCREENS = {
    "00-today": "Home (today)",
    "01-login": "Sign in", "02-approvals": "Approvals", "02c-approval-detail": "Approval open",
    "03-review": "Review", "04a-rules": "Rules", "04b-mailboxes": "Mailboxes", "04c-settings": "Settings",
    "05-activity": "Activity", "06a-stats": "Stats", "06b-report": "Report", "07-onboarding": "Onboarding",
    "08-delegations": "Delegations", "09-landing": "Landing page", "10-empty": "Empty state",
}
pattern = re.compile(r"^(?P<screen>.+)-(?P<device>desktop|phone)-(?P<scheme>light|dark)\.png$")

def shots(folder: Path, prefix: str):
    out = {}
    for f in sorted(folder.glob("*.png")):
        m = pattern.match(f.name)
        if not m:
            continue
        s = m["screen"]
        out.setdefault(s, {})[f"{m['device']}-{m['scheme']}"] = f"{prefix}/{f.name}"
    return out

versions = [{"id": "current", "name": "Current panel", "pitch": "Today's panel at commit cd7c95a39 (e2e test data).",
             "page": None, "shots": shots(root / "current", "current")}]
for d in sorted(x for x in (root / "proposals").glob("*/") if not x.name.startswith("_")) if (root / "proposals").exists() else []:
    meta_file = d / "meta.json"
    if not meta_file.exists():
        continue
    meta = json.loads(meta_file.read_text())
    versions.append({"id": d.name, "name": meta["name"], "pitch": meta.get("pitch", ""), "tokens": meta.get("tokens", ""), "components": meta.get("components", ""),
                     "page": f"proposals/{d.name}/{meta.get('page', 'index.html')}",
                     "shots": shots(d / "shots", f"proposals/{d.name}/shots")})

used = sorted({s for v in versions for s in v["shots"]})
screens = [{"id": s, "label": SCREENS.get(s, s)} for s in used]
(root / "gallery-data.js").write_text("window.GALLERY = " + json.dumps({"versions": versions, "screens": screens}, indent=1) + ";\n")
print(f"versions={len(versions)} screens={len(screens)} shots={sum(len(x) for v in versions for x in v['shots'].values())}")
