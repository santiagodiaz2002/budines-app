export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('X-Frame-Options', 'DENY');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'"
    ].join('; ')
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
