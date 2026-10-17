/** Minimal method + path-pattern router (`/workspaces/:wsId/people/:id`). */
import type { Ctx } from './api';
import { requireActor } from './api';
import { HttpError, notFound } from './errors';

export type Params = Record<string, string>;
export type RouteHandler = (ctx: Ctx, params: Params) => Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: RouteHandler;
  auth: 'required' | 'none';
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler, opts: { auth?: 'required' | 'none' } = {}): this {
    this.routes.push({
      method: method.toUpperCase(),
      parts: pattern.split('/').filter(Boolean),
      handler,
      auth: opts.auth ?? 'required',
    });
    return this;
  }

  get(p: string, h: RouteHandler, o?: { auth?: 'required' | 'none' }) {
    return this.add('GET', p, h, o);
  }
  post(p: string, h: RouteHandler, o?: { auth?: 'required' | 'none' }) {
    return this.add('POST', p, h, o);
  }
  put(p: string, h: RouteHandler, o?: { auth?: 'required' | 'none' }) {
    return this.add('PUT', p, h, o);
  }
  patch(p: string, h: RouteHandler, o?: { auth?: 'required' | 'none' }) {
    return this.add('PATCH', p, h, o);
  }
  delete(p: string, h: RouteHandler, o?: { auth?: 'required' | 'none' }) {
    return this.add('DELETE', p, h, o);
  }

  private match(parts: string[], route: Route): Params | null {
    if (parts.length !== route.parts.length) return null;
    const params: Params = {};
    for (let i = 0; i < parts.length; i++) {
      const rp = route.parts[i];
      if (rp.startsWith(':')) {
        try {
          params[rp.slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          return null;
        }
      } else if (rp !== parts[i]) return null;
    }
    return params;
  }

  async dispatch(ctx: Ctx, path: string): Promise<unknown> {
    const parts = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = this.match(parts, route);
      if (!params) continue;
      pathMatched = true;
      if (route.method !== ctx.method) continue;
      if (route.auth === 'required') requireActor(ctx);
      return route.handler(ctx, params);
    }
    if (pathMatched) throw new HttpError(405, 'bad_request', 'Method not allowed');
    throw notFound('Not found');
  }

  /** For the authorisation matrix test: every registered route. */
  list(): Array<{ method: string; pattern: string; auth: 'required' | 'none' }> {
    return this.routes.map((r) => ({ method: r.method, pattern: `/${r.parts.join('/')}`, auth: r.auth }));
  }
}
