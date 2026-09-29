---
name: Workspace package installs
description: Package-install tool limitation for dependencies belonging to a single pnpm workspace artifact.
---

For leaf-only dependencies in this pnpm workspace, the generic language-package installer cannot target a leaf package. Use pnpm's filtered add command as a fallback.

**Why:** The generic installer runs pnpm add at the workspace root, which pnpm rejects without an explicit root flag; passing CLI flags as package names is rejected by the installer. Installing at the root would also place leaf-only dependencies in the wrong package.

**How to apply:** Try the standard installer first. If it hits this workspace-root limitation, use a filtered pnpm add targeting the specific artifact, keeping its dependencies declared in its own package.