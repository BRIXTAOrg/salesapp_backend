#!/usr/bin/env python3
"""Remove legacy domain-specific backend code after applying the platform patch.

Dry-run by default. Run from the salesapp_backend repository root:

    python3 cleanup_legacy_backend.py
    python3 cleanup_legacy_backend.py --apply

This deliberately DOES NOT delete database schema definitions or migrations.
Those are retained until historical data has been migrated and a separate,
explicit database cleanup is approved.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

TARGETS = [
    "src/getRoutes",
    "src/postRoutes",
    "src/updateRoutes",
    "src/mobile/appliance.ts",
    "src/mobile/workflow.ts",
    "src/mobile/workflowSubmissions.ts",
    "src/admin/applianceHome.ts",
    "src/admin/applianceOperations.ts",
    "src/admin/mobileWorkspace.ts",
    "src/admin/workflowApprovalInterceptor.ts",
    "src/services/adminCatalog.ts",
    "src/services/adminHome.ts",
    "src/services/mobileHomeRanking.ts",
    "src/services/ownerResolver.ts",
    "README_WORKFLOW_RUNTIME_PATCH.md",
    ".DS_Store",
    "src/.DS_Store",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete the listed legacy files/directories.",
    )
    args = parser.parse_args()

    root = Path.cwd()
    if not (root / "package.json").exists() or not (root / "src").exists():
        raise SystemExit(
            "Run this from the salesapp_backend repository root."
        )

    existing = [root / item for item in TARGETS if (root / item).exists()]

    if not existing:
        print("No listed legacy backend files remain.")
        return 0

    print("Legacy backend paths:")
    for path in existing:
        print(f"  - {path.relative_to(root)}")

    if not args.apply:
        print("\nDRY RUN ONLY. Re-run with --apply to delete them.")
        return 0

    for path in existing:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()

    print(f"\nDeleted {len(existing)} legacy path(s).")
    print("Database tables/migrations were NOT touched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
