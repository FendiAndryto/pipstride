/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
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
    {
      name: "pages-only-import-approved-layers",
      comment:
        "Pages may only import from features, components/ui, and lib (ADR 0009 §2).",
      severity: "error",
      from: { path: "^src/pages/" },
      to: {
        pathNot: "^(src/features|src/components/ui|src/lib|src/constants|src/context|src/hooks|src/assets|\\.css|\\.scss)",
        dependencyTypesNot: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
      },
    },
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
