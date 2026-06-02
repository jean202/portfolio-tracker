export function resolveProjectKey(
  project: { name: string; path: string },
  overrides?: Record<string, string>,
): string {
  if (overrides) {
    if (overrides[project.path]) return overrides[project.path];
    if (overrides[project.name]) return overrides[project.name];
  }
  return project.name;
}
