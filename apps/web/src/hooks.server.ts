import { handleLogto, UserScope } from '@logto/sveltekit';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const configured = Boolean(env.LOGTO_ISSUER_URL && env.LOGTO_CLIENT_ID && env.LOGTO_CLIENT_SECRET && env.AUTH_SECRET);
const passthrough: Handle = ({ event, resolve }) => resolve(event);

export const handle: Handle = configured
  ? handleLogto({
      endpoint: env.LOGTO_ISSUER_URL!.replace(/\/oidc\/?$/, ''),
      appId: env.LOGTO_CLIENT_ID!,
      appSecret: env.LOGTO_CLIENT_SECRET!,
      scopes: [UserScope.Email]
    }, {
      encryptionKey: env.AUTH_SECRET!,
      cookieKey: 'aby.session'
    }, {
      signInCallback: '/callback',
      fetchUserInfo: true
    })
  : passthrough;
