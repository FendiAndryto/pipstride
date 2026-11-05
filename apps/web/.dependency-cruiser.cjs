/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // -------------------------------------------------------------------------
    // Cross-app isolation: apps/web must never import apps/marketing or
    // apps/admin. This is vacuous today (only one app bundle), but becomes
    // essential once apps/admin is created in Fase 007.
    // -------------------------------------------------------------------------
    {
      name: "no-cross-app-imports",
      comment:
        "An app bundle must not import from another app bundle (ADR 0009 §4). npm dependencies are excluded.",
      severity: "error",
      from: { path: "^src" },
      to: {
        path: "^[^src]",
        dependencyTypesNot: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
      },
    },

    // -------------------------------------------------------------------------
    // Domain purity: domain/ must not depend on React or browser APIs.
    // The directory does not exist yet; the rule is installed now so Fase 006
    // cannot accidentally leak UI concerns into domain.
    // -------------------------------------------------------------------------
    {
      name: "domain-pure",
      comment:
        "The domain layer must be pure business logic: no React, no DOM, no IO (ADR 0009 §2).",
      severity: "error",
      from: { path: "^src/domain" },
      to: {
        path: "^(react|react-dom|lucide-react|\\.css|\\.scss)",
      },
    },

    // -------------------------------------------------------------------------
    // Feature isolation: features/X must not import features/Y.
    // The rule activates as soon as features/ exists (Fase 006, ticket 03).
    // Intra-feature imports (features/X/a -> features/X/b) stay legal, and
    // features/* may import the shared lib/ + domain/ layers.
    // -------------------------------------------------------------------------
    {
      name: "no-feature-to-feature",
      comment:
        "A feature module must not depend on another feature module (ADR 0009 §2).",
      severity: "error",
      from: { path: "^src/features/([^/]+)/" },
      to: {
        path: "^src/features/",
        pathNot: "^src/features/$1/",
      },
    },

    // -------------------------------------------------------------------------
    // Pages thinness: pages/ may only depend on features, components/ui, lib.
    // The pages/ directory does not exist yet; this rule will activate once
    // it is created in Fase 006.
    // -------------------------------------------------------------------------
    {
      name: "pages-only-import-approved-layers",
      comment:
        "Pages may only import from features, components/ui, and lib (ADR 0009 §2).",
      severity: "error",
      from: { path: "^src/pages/" },
      to: {
        pathNot: "^(src/features|src/components/ui|src/lib|src/constants|src/context|src/hooks|src/assets|\\.css|\\.scss)",
      },
    },

    // -------------------------------------------------------------------------
    // Baseline for the current flat layout (Fase 006 will migrate to
    // features/domain/lib). The service client is allowed from components;
    // raw fetch is forbidden (enforced by convention / oxlint no-restricted-
    // globals in CI).
    // -------------------------------------------------------------------------
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
