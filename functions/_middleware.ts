import { frontdoorAdmission, type FrontdoorEnv } from '../server/frontdoor/admission';
export const onRequest = async ({ request, env, next }: { request: Request; env: FrontdoorEnv; next: () => Promise<Response> }): Promise<Response> => {
  const blocked = await frontdoorAdmission(request, env);
  if (blocked) return blocked;
  const response = await next();
  // Never retain a protected page after logout or entitlement revocation.
  if (!new URL(request.url).pathname.startsWith('/_next/static/')) {
    const safe = new Response(response.body, response);
    safe.headers.set('cache-control', 'no-store');
    return safe;
  }
  return response;
};
