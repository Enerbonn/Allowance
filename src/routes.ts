const paths = {
  Overview: '/',
  Requests: '/requests',
  Assistant: '/assistant',
  Projects: '/projects',
  Team: '/team',
  'Spending policy': '/spending-policy',
  Activity: '/activity',
  'Saved notes': '/saved-notes',
  Connections: '/connections',
} as const;

export type Page = keyof typeof paths;

export function pagePath(page: Page) {
  return paths[page];
}

export function projectRequestsPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/requests`;
}

export function requestPath(requestId: string, projectId?: string) {
  const base = projectId ? projectRequestsPath(projectId) : paths.Requests;
  return `${base}/${encodeURIComponent(requestId)}`;
}

export function readRoute(pathname: string, search = ''): { page: Page; projectId?: string; requestId?: string; setupAssistant?: boolean } {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === paths.Assistant) {
    return { page: 'Assistant', setupAssistant: new URLSearchParams(search).get('mode') === 'setup' };
  }
  const project = /^\/projects\/([^/]+)\/requests(?:\/([^/]+))?$/.exec(path);
  const request = /^\/requests\/([^/]+)$/.exec(path);
  try {
    if (project) return {
      page: 'Requests',
      projectId: decodeURIComponent(project[1]),
      requestId: project[2] ? decodeURIComponent(project[2]) : undefined,
    };
    if (request) return { page: 'Requests', requestId: decodeURIComponent(request[1]) };
  } catch {
    return { page: 'Overview' };
  }
  const page = (Object.keys(paths) as Page[]).find(page => paths[page] === path);
  return { page: page ?? 'Overview' };
}
