import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.user ? {
    id: locals.user.sub,
    name: locals.user.name,
    email: locals.user.email,
    picture: locals.user.picture
  } : null
});
