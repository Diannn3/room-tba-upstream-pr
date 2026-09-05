/**
 * Compare the checked-in building-routing audit snapshot with a newer building
 * identity source.
 *
 * Deterministic canary (no network):
 *   bun scripts/building-route-source-coverage.ts
 *
 * Authority check against a deployment's current /api/buildings:
 *   bun scripts/building-route-source-coverage.ts --from-api https://www.uplb.tools
 *   bun scripts/building-route-source-coverage.ts --from-api https://www.uplb.tools --strict
 *
 * `--strict` exits non-zero on any missing/extra/duplicate identity. The
 * checked-in landmark-image manifest is deliberately called a canary rather
 * than a source of truth: its generator reads /api/buildings, but an image
 * manifest could stop covering every building in the future.
 */
import auditBuildingsJson from "../exports/deep-research/buildings.json";
import auditManifestJson from "../exports/deep-research/manifest.json";
import landmarkImagesJson from "../src/constants/landmark-images.json";
import {
  buildingNamesFromLandmarkManifest,
  compareBuildingRouteSourceCoverage,
  type BuildingRouteCoverageRow,
} from "./lib/building-route-source-coverage";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function buildingApiUrl(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  return trimmed.endsWith("/api/buildings")
    ? trimmed
    : `${trimmed}/api/buildings`;
}

async function liveBuildingNames(base: string): Promise<string[]> {
  const url = buildingApiUrl(base);
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "RoomTBA-building-route-source-audit/1.0 (https://github.com/uplbtools/room-tba)",
    },
  });
  if (!response.ok) {
    throw new Error(`building route source audit: ${response.status} from ${url}`);
  }
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error("building route source audit: buildings API did not return an array");
  }
  return rows.map((row, index) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("buildingName" in row) ||
      typeof row.buildingName !== "string"
    ) {
      throw new Error(
        `building route source audit: API row ${index} has no buildingName`,
      );
    }
    return row.buildingName;
  });
}

const apiBase = argValue("--from-api");
const referenceNames = apiBase
  ? await liveBuildingNames(apiBase)
  : buildingNamesFromLandmarkManifest(
      landmarkImagesJson as Record<string, unknown>,
    );
const referenceKind = apiBase
  ? `live API (${buildingApiUrl(apiBase)})`
  : "checked-in API-derived landmark manifest canary";
const coverage = compareBuildingRouteSourceCoverage(
  auditBuildingsJson as BuildingRouteCoverageRow[],
  referenceNames,
);
const auditExportedAt =
  typeof auditManifestJson.exported_at === "string"
    ? auditManifestJson.exported_at
    : null;

if (hasFlag("--json")) {
  console.log(
    JSON.stringify(
      {
        referenceKind,
        auditExportedAt,
        ...coverage,
      },
      null,
      2,
    ),
  );
} else {
  console.log("Room TBA building-routing source coverage audit");
  console.log(`reference: ${referenceKind}`);
  console.log(`audit export: ${auditExportedAt ?? "unknown"}`);
  console.log(
    `coverage: ${coverage.matchedCount}/${coverage.referenceUniqueCount} reference buildings matched; ` +
      `${coverage.auditUniqueCount} unique audit buildings`,
  );

  if (coverage.missingFromAudit.length > 0) {
    console.log("\nMissing from routing audit:");
    for (const name of coverage.missingFromAudit) console.log(`  - ${name}`);
  }
  if (coverage.extraInAudit.length > 0) {
    console.log("\nPresent only in routing audit:");
    for (const name of coverage.extraInAudit) console.log(`  - ${name}`);
  }
  if (coverage.duplicateAuditNames.length > 0) {
    console.log("\nDuplicate routing-audit identities:");
    for (const name of coverage.duplicateAuditNames) console.log(`  - ${name}`);
  }
  if (coverage.duplicateReferenceNames.length > 0) {
    console.log("\nDuplicate reference identities:");
    for (const name of coverage.duplicateReferenceNames)
      console.log(`  - ${name}`);
  }
  if (coverage.complete) {
    console.log("\nIdentity coverage matches this reference source.");
  } else {
    console.log(
      "\nCoverage mismatch: do not claim every selectable building is audited.",
    );
  }
}

if (hasFlag("--strict") && !coverage.complete) process.exitCode = 1;
