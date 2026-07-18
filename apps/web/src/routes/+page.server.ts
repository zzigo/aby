import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(307, '/player');

export const actions: Actions = {
  signIn: async ({ locals, url }) => {
    if (!locals.logtoClient) error(503, 'Logto is not configured for Aby');
    await locals.logtoClient.signIn(`${url.origin}/callback`);
  },
  signOut: async ({ locals, url }) => {
    if (!locals.logtoClient) error(503, 'Logto is not configured for Aby');
    await locals.logtoClient.signOut(`${url.origin}/`);
  }
};
